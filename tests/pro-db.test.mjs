import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Pro allowances count successes, reserve atomically, and keep entitlements private', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  `);
  for (const name of ['20261113000000_init.sql','20261114000000_scan_processing.sql','20261114010000_processing_claims.sql','20261114020000_transcription_layout.sql','20261115000000_pro_features.sql'])
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  const owner = '10000000-0000-4000-8000-000000000001';
  const other = '10000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
  let serial = 0;
  const doc = async () => {
    const id = `20000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
    await db.query('insert into public.documents (id,user_id,image_path) values ($1,$2,$3)', [id,owner,`${owner}/${id}.jpg`]); return id;
  };
  const call = async (name, params) => {
    await db.exec('set role service_role');
    try { return (await db.query(`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')}) as result`, params)).rows[0].result; }
    finally { await db.exec('reset role'); }
  };
  const quota = (uid=owner) => call('get_upload_allowance', [uid]);
  const claim = id => call('claim_pro_scan', [id,owner]);
  const finish = (id, attempt, outcome) => call('finish_pro_scan',[id,owner,attempt,JSON.stringify(outcome)]);
  const success = { status:'ready',error:null,ocr_text:'Exact text',ocr_source:'gemini',gemini_source_text:'Exact text',text_regions:[] };
  await t.test('browser cannot self-upgrade, change quota, access summary cache or execute quota RPCs', async () => {
    await db.exec('set role authenticated');
    try {
      for (const sql of ["insert into public.account_entitlements(user_id,plan) values ('"+owner+"','pro')",'select * from public.upload_allowances','select * from public.scan_attempt_limits','select * from public.scan_summaries',`select public.get_upload_allowance('${owner}')`,`select public.claim_pro_scan(gen_random_uuid(),'${owner}')`])
        await assert.rejects(db.exec(sql),/permission denied/);
    } finally { await db.exec('reset role'); }
    assert.equal((await quota()).remaining,10);
  });
  const ids=[], attempts=[];
  await t.test('ten reservations exhaust Free, duplicate and foreign requests do not consume slots', async () => {
    for(let i=0;i<10;i++){ const id=await doc(); ids.push(id); const result=await claim(id); attempts.push(result.document.attempt_id); }
    assert.equal((await quota()).remaining,0);
    assert.equal((await claim(ids[0])).error,'already_processing');
    assert.equal((await call('claim_pro_scan',[ids[0],other])).error,'not_found');
    assert.equal((await quota(other)).remaining,10);
    assert.equal((await claim(await doc())).error,'daily_limit');
  });
  await t.test('failure releases a slot exactly once; success consumes one permanently', async () => {
    await finish(ids[0],attempts[0],{error:'blurry'});
    assert.equal((await quota()).remaining,1);
    assert.equal((await quota()).used,0);
    assert.equal((await finish(ids[0],attempts[0],{error:'blurry'})).error,'superseded');
    const completed=await finish(ids[1],attempts[1],success);
    assert.equal(completed.document.status,'ready');
    assert.equal(completed.document.ocr_text,'Exact text');
    assert.equal((await quota()).used,1);
    assert.equal((await quota()).remaining,1);
    assert.equal((await finish(ids[1],attempts[1],success)).error,'superseded');
    await db.query('delete from public.documents where id=$1',[ids[1]]);
    assert.equal((await quota()).used,1);
  });
  await t.test('deleting an in-flight scan returns its reservation without admitting late writes', async () => {
    const before=(await quota()).remaining;
    await db.query('delete from public.documents where id=$1',[ids[2]]);
    assert.equal((await quota()).remaining,before+1);
    assert.equal((await finish(ids[2],attempts[2],success)).error,'superseded');
  });
  await t.test('expired work is released, retries rotate attempts, and the old worker cannot bill', async () => {
    // Isolate attempt recovery from the separate 10-minute request throttle.
    await db.query("update public.scan_attempt_limits set window_start=now()-interval '11 minutes' where user_id=$1",[owner]);
    await db.query("update public.documents set processing_started_at=now()-interval '3 minutes' where id=$1",[ids[3]]);
    const before=(await quota()).remaining;
    const row=(await db.query('select * from public.documents where id=$1',[ids[3]])).rows[0];
    assert.equal(row.status,'failed'); assert.equal(row.allowance_reserved,false);
    const retry=await claim(ids[3]);
    assert.notEqual(retry.document.attempt_id,attempts[3]);
    assert.equal((await finish(ids[3],attempts[3],success)).error,'superseded');
    await finish(ids[3],retry.document.attempt_id,{error:'timeout'});
    assert.equal((await quota()).remaining,before);
  });
  await t.test('Pro is server-assigned, grants 150, and expiry restores Free', async () => {
    await db.query("insert into public.account_entitlements(user_id,plan) values ($1,'pro')",[owner]);
    assert.equal((await quota()).plan,'pro'); assert.equal((await quota()).limit,150);
    await db.query("update public.account_entitlements set expires_at=now()-interval '1 second' where user_id=$1",[owner]);
    assert.equal((await quota()).plan,'free'); assert.equal((await quota()).limit,10);
    await db.query('insert into public.upload_allowances(user_id,day,successes) values ($1, current_date - 1, 150)',[other]);
    assert.equal((await quota(other)).used,0); assert.equal((await quota(other)).remaining,10);
  });
  await t.test('the last Pro slot is reserved once, failures refund it, and ready results reopen at zero', async () => {
    await db.query("update public.documents set processing_started_at=now()-interval '3 minutes' where user_id=$1 and allowance_reserved",[owner]);
    await quota();
    await db.query('update public.account_entitlements set expires_at=null where user_id=$1',[owner]);
    await db.query("update public.upload_allowances set successes=149 where user_id=$1 and day=(now() at time zone 'UTC')::date",[owner]);
    const last=await doc();const attempt=(await claim(last)).document.attempt_id;
    assert.equal((await quota()).remaining,0);
    assert.equal((await claim(await doc())).error,'daily_limit');
    await finish(last,attempt,{error:'server'});
    assert.equal((await quota()).remaining,1);
    const retry=(await claim(last)).document.attempt_id;
    await finish(last,retry,success);
    assert.equal((await quota()).used,150);
    assert.equal((await quota()).remaining,0);
    assert.equal((await claim(last)).document.status,'ready');
    assert.equal((await quota()).used,150);
    assert.equal((await quota(other)).plan,'free');
  });

  await t.test('ten failed attempts remain free, then processing is throttled until its window resets', async () => {
    const id=await doc();
    await db.query('update public.documents set user_id=$1,image_path=$2 where id=$3',[other,`${other}/${id}.jpg`,id]);
    for(let i=0;i<10;i++){
      const result=await call('claim_pro_scan',[id,other]);
      assert.ok(result.document?.attempt_id);
      await call('finish_pro_scan',[id,other,result.document.attempt_id,JSON.stringify({error:'blurry'})]);
    }
    assert.equal((await quota(other)).remaining,10);assert.equal((await quota(other)).used,0);
    const blocked=await call('claim_pro_scan',[id,other]);
    assert.equal(blocked.error,'rate_limit');assert.ok(blocked.retry_after>0&&blocked.retry_after<=600);
    await db.query("update public.scan_attempt_limits set window_start=now()-interval '11 minutes' where user_id=$1",[other]);
    const retry=await call('claim_pro_scan',[id,other]);
    assert.ok(retry.document?.attempt_id);
    await call('finish_pro_scan',[id,other,retry.document.attempt_id,JSON.stringify({error:'timeout'})]);
    assert.equal((await quota(other)).remaining,10);
  });

});
