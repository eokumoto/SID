import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);

function load(file, overrides = {}, globals = {}) {
  const tsModule = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module: tsModule, exports: tsModule.exports, require: (id) => overrides[id] ?? nativeRequire(id), Buffer, Response, Request, AbortSignal, Error, DOMException, URLSearchParams, ...globals }, { filename: file });
  return tsModule.exports;
}
const accuracy = load('lib/accuracy.ts');
const transcription = load('lib/transcription.ts');
const { scanStatus } = load('lib/scan-state.ts');
const { scanErrorCode, scanErrorCopy } = load('lib/scan-errors.ts');
const id = '12345678-1234-4234-8234-123456789abc';
const owner = '12345678-1234-4234-8234-123456789def';
const result = { source_text: 'Room 204 costs $5.', plain_text: 'Room 204 costs $5.', flags: [], unsure_words: [], key_terms: [] };

function fixture(options = {}) {
  const writes = [];
  const reads = [];
  const providerUrls = [];
  const logs = [];
  let calls = 0, claims = 0, downloads = 0;
  const doc = { id, user_id: owner, image_path: `${owner}/${id}.jpg`, status: 'queued', ...options.document };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc: async (name, args) => {
      if (name === 'claim_pro_scan') { claims++; return { data: options.claim ?? { document: { ...doc, status: 'processing', attempt_id: 'attempt-1' } } }; }
      assert.equal(name, 'finish_pro_scan');
      writes.push({ data: args.outcome, scope: args });
      return { data: options.superseded ? { error: 'superseded' } : { document: { ...doc, ...args.outcome } } };
    },
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob([options.bytes ?? Buffer.from([255,216,255,0])], { type: 'image/jpeg' }) }; } }) },
    from: () => {
      let value;
      const filters = [];
      const query = {
        select: () => query,
        eq: (key, val) => { filters.push([key, val]); return query; },
        update: (data) => { value = data; writes.push({ data, filters }); return query; },
        maybeSingle: async () => {
          if (value && Object.hasOwn(value, 'text_regions') && options.layoutMigrationMissing) return { data: null, error: { code: 'PGRST204' } };
          if (value) return { data: options.superseded ? null : { ...doc, ...value } };
          reads.push(filters);
          return { data: doc };
        },
        then: (resolve) => Promise.resolve({ data: null }).then(resolve),
      };
      return query;
    },
  };
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'secret', GEMINI_API_KEY: 'key', VISION_ENABLED: 'false', ...options.env };
  const route = load('app/api/process/route.ts', {
    '@supabase/supabase-js': { createClient: () => client },
    '../../../lib/accuracy': accuracy,
    '../../../lib/transcription': transcription,
  }, {
    process: { env },
    console: { warn: (...args) => logs.push(args) },
    fetch: async (url, init) => {
      calls++;
      providerUrls.push(url);
      assert.ok(!url.includes('key='));
      assert.equal(init.headers['x-goog-api-key'], 'key');
      if (options.upstreamFailure) return Response.json(options.upstreamBody ?? {}, { status: options.upstreamStatus ?? 429 });
      if (options.providerBody) return Response.json(options.providerBody);
      const output = options.outputs?.[calls - 1] ?? JSON.stringify(result);
      return Response.json({ candidates: [{ content: { parts: [{ text: output }] } }] });
    },
  });
  return { writes, reads, logs, providerUrls, stats: () => ({ calls, claims, downloads }), run: (body = { documentId: id }, token = true) => route.POST(new Request('https://sid.test/api/process', { method: 'POST', headers: token ? { authorization: 'Bearer test' } : {}, body: JSON.stringify(body) })) };
}

test('rejects unauthenticated and malformed requests before any database work', async () => {
  const f = fixture();
  assert.equal((await f.run({}, false)).status, 401);
  assert.equal((await f.run({ documentId: id, image_path: 'foreign' })).status, 400);
  assert.equal(f.reads.length, 0);
});
test('ready scans return the full saved row without providers or quota', async () => {
  const f = fixture({ document: { status: 'ready', title: 'Saved', plain_text: 'Saved text' }, env: { GEMINI_API_KEY: '' } });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).document.title, 'Saved');
  assert.deepEqual(f.stats(), { calls: 0, claims: 0, downloads: 0 });
});
test('forged paths are rejected before privileged download', async () => {
  const f = fixture({ document: { image_path: `foreign/${id}.jpg` } });
  assert.equal((await f.run()).status, 400);
  assert.equal(f.stats().downloads, 0);
});
for (const [code, status] of [['already_processing', 409], ['daily_limit', 429], ['rate_limit',429], ['not_found', 404]]) {
  test(`${code} makes no provider call or download`, async () => {
    const f = fixture({ claim: { error: code } });
    assert.equal((await f.run()).status, status);
    assert.equal(f.stats().calls + f.stats().downloads, 0);
  });
}
test('successful processing saves provenance and scopes completion to its attempt', async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  const saved = (await response.json()).document;
  assert.equal(saved.plain_text, result.plain_text);
  assert.equal(saved.ocr_source, 'gemini');
  assert.deepEqual(saved.warnings, ['vision_disabled']);
  assert.equal(f.writes[0].scope.expected_attempt, 'attempt-1');
  assert.equal(f.writes[0].scope.owner_id, owner);
});
test('default model uses the current documented replacement for restricted 2.5 Flash', async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 200);
  assert.equal(f.providerUrls[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
});
test('transcription is authoritative even if a model returns a paraphrase in the legacy field', async () => {
  const source = '21. Suppose you’re asked to determine the curve.\nF is conservative.\n\nDo not simplify.';
  const regions = [{ text: 'F is conservative.', box_2d: [100, 50, 150, 800] }];
  const f = fixture({ outputs: [JSON.stringify({ ...result, source_text: source, plain_text: 'Here is a simpler explanation.', text_regions: regions })] });
  const document = (await (await f.run()).json()).document;
  assert.equal(document.ocr_text, source);
  assert.equal(document.plain_text, source);
  assert.deepEqual(document.text_regions, regions);
});
test('malformed optional geometry does not fail transcription', async () => {
  const f = fixture({ outputs: [JSON.stringify({ ...result, text_regions: [{ text: 'Hallucinated text', box_2d: [-1, 0, 5, 5] }] })] });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).document.text_regions, []);
});
test('completion sends layout and text through the same atomic allowance RPC', async () => {
  const f = fixture({ layoutMigrationMissing: true });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].data.text_regions.length, 0);
  assert.equal(f.writes[0].data.ocr_text, result.source_text);
});
test('older saved scans display original OCR rather than their saved rewrite', () => {
  const source = '  EXACT punctuation: −3, 500 mg.\n\nSecond paragraph.\n';
  assert.equal(transcription.originalText({ ocr_text: source, plain_text: 'Simplified.' }), source);
  assert.equal(transcription.originalText({ gemini_source_text: source, plain_text: 'Simplified.' }), source);
  assert.equal(transcription.originalText({ plain_text: 'Legacy only' }), 'Legacy only');
});
test('overlay validation rejects missing text, out-of-image boxes and reversed coordinates', () => {
  const valid = { text: 'Room 204 costs $5.', box_2d: [10, 20, 50, 500] };
  assert.equal(transcription.readTextRegions([valid, { ...valid, text: 'Invented' }, { ...valid, box_2d: [5, 0, 1, 10] }, { ...valid, box_2d: [0, 0, 1001, 1] }], result.source_text).length, 1);
  assert.equal(transcription.readTextRegions(null, result.source_text).length, 0);
});
test('photo fitting preserves image bounds for portrait and landscape photos', () => {
  const landscape = transcription.fitPhoto({ width: 2000, height: 500 }, { width: 1000, height: 600 });
  assert.equal(landscape.width, 1000);
  assert.equal(landscape.height, 250);
  const portrait = transcription.fitPhoto({ width: 600, height: 800 }, { width: 350, height: 500 });
  assert.equal(portrait.width, 350);
  assert.ok(Math.abs(portrait.height - 466.6666667) < 0.001);
  assert.equal(transcription.fitPhoto({ width: 0, height: 0 }, { width: 1, height: 1 }), null);
});
test('configured model names tolerate surrounding whitespace and a models/ prefix', async () => {
  const f = fixture({ env: { GEMINI_MODEL: ' models/gemini-3.8-flash ' } });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.providerUrls[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
});
test('invalid model JSON retries once inside the same claim', async () => {
  const f = fixture({ outputs: ['{', JSON.stringify(result)] });
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(f.stats(), { calls: 2, claims: 1, downloads: 1 });
});
test('oversized flag fields fail after one repair and failure writes are attempt scoped', async () => {
  const bad = JSON.stringify({ ...result, flags: [{ original: 'x'.repeat(1001), reason: '', question: '' }] });
  const f = fixture({ outputs: [bad, bad] });
  const response = await f.run();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'no_text');
  assert.equal(f.stats().calls, 2);
  assert.equal(f.writes[0].scope.expected_attempt, 'attempt-1');
});
test('upstream errors fail without an automatic retry storm', async () => {
  const f = fixture({ upstreamFailure: true });
  assert.equal((await f.run()).status, 502);
  assert.equal(f.stats().calls, 1);
});
for (const status of [400,401,403,404,429,503]) {
  test(`Gemini ${status} produces a safe diagnostic without leaking upstream text`, async () => {
    const f = fixture({ upstreamFailure: true, upstreamStatus: status, upstreamBody: { error: { message: 'PRIVATE_DOCUMENT_OR_KEY' } } });
    const response = await f.run();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, { error: 'server' });
    assert.equal(f.writes[0].data.error, 'server');
    assert.equal(f.stats().calls, 1);
    assert.ok(!JSON.stringify([body, f.logs]).includes('PRIVATE_DOCUMENT_OR_KEY'));
    assert.equal(f.logs[0][1].reason, 'gemini_failed');
  });
}
test('invalid API key details on a 400 response are distinguished from invalid requests', async () => {
  const f = fixture({ upstreamFailure: true, upstreamStatus: 400, upstreamBody: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } });
  assert.deepEqual(await (await f.run()).json(), { error: 'server' });
});
test('blocked and incomplete responses do not blame image readability', async () => {
  for (const [providerBody, reason] of [[{ promptFeedback: { blockReason: 'SAFETY' } }, 'ai_response_blocked'], [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'ai_output_incomplete'], [{ candidates: [] }, 'ai_empty_response']]) {
    const f = fixture({ providerBody });
    assert.equal((await (await f.run()).json()).error, reason === 'ai_empty_response' ? 'no_text' : 'server');
    assert.equal(f.stats().calls, 1);
  }
});
test('multipart Gemini text is joined and thought parts are ignored', async () => {
  const json = JSON.stringify(result);
  const f = fixture({ providerBody: { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'internal reasoning' }, { text: json.slice(0, 30) }, { text: json.slice(30) }] } }] } });
  assert.equal((await f.run()).status, 200);
});
test('daily upload exhaustion is distinct from processing errors and arbitrary content is ignored', () => {
  assert.equal(scanErrorCode('daily_limit'), 'daily_limit');
  assert.equal(scanErrorCopy('daily_limit').title, 'No uploads left today');
  assert.equal(scanErrorCopy('daily_limit').canRetry, false);
  assert.equal(scanErrorCopy('already_processing').canRetry, true);
  assert.equal(scanErrorCopy('<private text>').title, 'Something went wrong');
  assert.equal(scanErrorCode('__proto__'), 'server');
});
test('a superseded worker cannot return success or fail a newer attempt', async () => {
  const f = fixture({ superseded: true });
  assert.equal((await f.run()).status, 409);
  assert.equal(f.writes.length, 1);
});
test('MIME spoofing is rejected before sending bytes to a provider', async () => {
  const f = fixture({ bytes: Buffer.from('not an image') });
  assert.equal((await f.run()).status, 400);
  assert.equal(f.stats().calls, 0);
});
test('missing credentials leave the document unclaimed', async () => {
  const f = fixture({ env: { GEMINI_API_KEY: '' } });
  assert.equal((await f.run()).status, 503);
  assert.equal(f.stats().claims, 0);
});
test('unavailable Vision leaves successful Gemini output usable', async () => {
  const f = fixture({ env: { VISION_ENABLED: 'true' } });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).document.warnings, ['vision_unavailable']);
});
test('an original removed from a nonready scan cannot be retried', async () => {
  const f = fixture({ document: { image_path: null } });
  assert.equal((await f.run()).status, 409);
  assert.equal(f.stats().claims, 0);
});
test('history expires work from the latest attempt timestamp', () => {
  assert.equal(scanStatus('queued'), 'queued');
  assert.equal(scanStatus('ready'), 'ready');
  assert.equal(scanStatus('processing', new Date().toISOString()), 'processing');
  assert.equal(scanStatus('processing', new Date(Date.now() - 121000).toISOString()), 'failed');
  assert.equal(scanStatus('processing', null), 'failed');
});
test('accuracy checks detect protected value and occurrence changes', () => {
  for (const [before, after] of [['3', '30'], ['500 mg', '500 g'], ['$5', '€5'], ['Room 003', 'Room 3'], ['2026-11-14', '2027-11-14'], ['https://a.test/A?q=3', 'https://a.test/a?q=3'], ['5 5', '5'], ['-3', '3']]) {
    assert.ok(accuracy.checkAccuracy(before, after, []).length, `${before} -> ${after}`);
  }
  assert.equal(accuracy.checkAccuracy('Meet Ada in Room 204 at 3:30 pm.', 'Meet Ada in Room 204 at 3:30 pm.', ['Ada']).length, 0);
  assert.ok(accuracy.checkAccuracy('Ada arrives.', 'Adam arrives.', ['Ada']).length);
});
test('equal inventories cannot detect swapped relationships or lost negation', () => {
  assert.equal(accuracy.checkAccuracy('Members $5, guests $10', 'Members $10, guests $5', []).length, 0);
  assert.equal(accuracy.checkAccuracy('Do not enter', 'Do enter', []).length, 0);
});


test('the request throttle supplies Retry-After without calling AI or charging an upload', async () => {
  const f=fixture({claim:{error:'rate_limit',retry_after:120}});
  const response=await f.run();
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'120');
  assert.deepEqual(await response.json(),{error:'rate_limit'});
  assert.equal(f.stats().calls,0);assert.equal(f.writes.length,0);
  assert.equal(scanErrorCopy('rate_limit').canRetry,true);
});
