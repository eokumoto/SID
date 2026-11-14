import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('processing migration enforces claims, quotas, owner isolation and restricted writes', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Minimal Supabase-owned schemas; application SQL is read from real migrations.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select string_to_array($1, '/') $$;
  `);
  for (const name of ['20261113000000_init.sql', '20261114000000_scan_processing.sql', '20261114010000_processing_claims.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  const owner = '10000000-0000-4000-8000-000000000001';
  const foreign = '10000000-0000-4000-8000-000000000002';
  const id = '20000000-0000-4000-8000-000000000001';
  const second = '20000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users (id) values ($1), ($2)', [owner, foreign]);
  const asOwner = async (sql, params = [], uid = owner) => {
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
      await db.exec('set role authenticated');
      return await db.query(sql, params);
    } finally { await db.exec('reset role'); }
  };
  const claim = async (docId = id, limit = 2, uid = owner) => {
    try {
      await db.exec('set role service_role');
      const { rows } = await db.query('select public.claim_scan($1, $2, $3) as result', [docId, uid, limit]);
      return rows[0].result;
    } finally { await db.exec('reset role'); }
  };
  const usage = async () => (await db.query('select scans from public.usage where user_id = $1', [owner])).rows[0]?.scans;

  await t.test('browser inserts queued input but cannot forge results, paths or ownership', async () => {
    await asOwner('insert into public.documents (id, image_path) values ($1, $2)', [id, `${owner}/${id}.jpg`]);
    const { rows } = await asOwner('select * from public.documents');
    assert.equal(rows[0].status, 'queued');
    await assert.rejects(asOwner("update public.documents set plain_text = 'forged' where id = $1", [id]), /permission denied/);
    await assert.rejects(asOwner("insert into public.documents (id, image_path, status) values ($1, $2, 'ready')", [second, `${owner}/${second}.jpg`]), /permission denied/);
    await assert.rejects(asOwner('insert into public.documents (id, image_path) values ($1, $2)', [second, `${foreign}/${second}.jpg`]), /row-level security/);
    await assert.rejects(asOwner('select public.claim_scan($1, $2, 2)', [id, owner]), /permission denied/);
    assert.equal((await asOwner('select * from public.documents', [], foreign)).rows.length, 0);
    assert.equal((await claim(id, 2, foreign)).error, 'not_found');
    assert.equal(await usage(), undefined);
  });
  let firstAttempt;
  await t.test('duplicate claims reserve usage once', async () => {
    const first = await claim();
    firstAttempt = first.document.attempt_id;
    assert.ok(firstAttempt);
    assert.equal(first.document.status, 'processing');
    assert.equal((await claim()).error, 'already_processing');
    assert.equal(await usage(), 1);
  });
  let nextAttempt;
  await t.test('stale recovery rotates attempt and rejects the expired worker', async () => {
    await db.query("update public.documents set processing_started_at = now() - interval '3 minutes' where id = $1", [id]);
    nextAttempt = (await claim()).document.attempt_id;
    assert.notEqual(nextAttempt, firstAttempt);
    assert.equal(await usage(), 2);
    const { affectedRows } = await db.query("update public.documents set status = 'ready' where id = $1 and user_id = $2 and status = 'processing' and attempt_id = $3", [id, owner, firstAttempt]);
    assert.equal(affectedRows, 0);
  });
  await t.test('exhausted quota admits no new work and expires stale processing honestly', async () => {
    await asOwner('insert into public.documents (id, image_path) values ($1, $2)', [second, `${owner}/${second}.jpg`]);
    assert.equal((await claim(second)).error, 'daily_limit');
    assert.equal((await db.query('select status from public.documents where id = $1', [second])).rows[0].status, 'queued');
    await db.query("update public.documents set processing_started_at = now() - interval '3 minutes' where id = $1", [id]);
    assert.equal((await claim()).error, 'daily_limit');
    const row = (await db.query('select status, error from public.documents where id = $1', [id])).rows[0];
    assert.deepEqual(row, { status: 'failed', error: 'timeout' });
    assert.equal(await usage(), 2);
  });
  await t.test('ready rows do not reserve usage and deleted rows stay deleted', async () => {
    await db.query("update public.documents set status = 'ready', plain_text = 'Saved result' where id = $1", [id]);
    assert.equal((await claim()).document.plain_text, 'Saved result');
    assert.equal(await usage(), 2);
    await asOwner('delete from public.documents where id = $1', [id]);
    assert.equal((await claim()).error, 'not_found');
    const { affectedRows } = await db.query("update public.documents set status = 'ready' where id = $1 and attempt_id = $2", [id, nextAttempt]);
    assert.equal(affectedRows, 0);
  });
});
