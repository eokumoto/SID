import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, overrides={}, globals={}) {
  const compiled={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module:compiled,exports:compiled.exports,require:id=>overrides[id]??require(id),Buffer,Request,Response,AbortSignal,TextEncoder,console,...globals},{filename:file});
  return compiled.exports;
}
const pro=load('lib/pro.ts'), speech=load('lib/speech.ts'), accuracy=load('lib/accuracy.ts'), transcription=load('lib/transcription.ts');
const owner='10000000-0000-4000-8000-000000000001', id='20000000-0000-4000-8000-000000000001';
const source='Campus housing update. Move out by Dec 18 at 5 PM. Leave your key at the front desk. Rooms will be checked on Dec 19. Items will be stored for 30 days. '+('Please take your belongings with you and contact the housing office if you need assistance. '.repeat(5));
const bullets=['Move out by Dec 18 at 5 PM.','Leave your key at the front desk.','Rooms will be checked on Dec 19. Items will be stored for 30 days.'];
function fixture(route, options={}) {
  const reads=[], writes=[], providers=[];
  const quota={plan:options.free?'free':'pro',limit:options.free?10:150,remaining:options.free?10:142,used:options.free?0:8,resetsAt:'2027-01-01T00:00:00Z'};
  const client={
    auth:{getUser:async token=>{assert.equal(token,'caller-token');return {data:{user:options.invalid?null:{id:owner}},error:options.invalid?{}:null};}},
    rpc:async(name,args)=>{assert.equal(name,'get_upload_allowance');assert.equal(args.owner_id,owner);return options.migrationMissing?{error:{}}:{data:quota};},
    from:table=>{
      const filters=[];reads.push({table,filters});
      const query={select:()=>query,eq:(k,v)=>{filters.push([k,v]);return query;},maybeSingle:async()=>({data:table==='documents'?(options.foreign?null:{id,status:'ready',ocr_text:options.source??source,key_terms:[]}):null}),upsert:async value=>{writes.push(value);return {error:null};}};
      return query;
    },
  };
  const endpoint=load(route,{'@supabase/supabase-js':{createClient:()=>client},'../../../lib/pro':pro,'../../../lib/speech':speech,'../../../lib/accuracy':accuracy,'../../../lib/transcription':transcription},{
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://sid.test',SUPABASE_SECRET_KEY:'server-key',GEMINI_API_KEY:'gemini-private',...(options.noCloud?{}:{GOOGLE_TTS_API_KEY:'tts-private'})}},
    fetch:async(url,init)=>{
      providers.push({url,init});assert.ok(!url.includes('key='));
      if(url.includes('-tts')){if(options.geminiQuota)return Response.json({error:{code:429,status:'RESOURCE_EXHAUSTED'}},{status:429});return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;codec=pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')}}]}}]});}
      if(url.includes('texttospeech')){if(options.ttsDisabled)return Response.json({error:{code:403,status:'PERMISSION_DENIED',message:'Cloud Text-to-Speech API has not been used in project 1 before or it is disabled.',details:[{reason:'SERVICE_DISABLED'}]}},{status:403});if(options.hdFails&&init.body.includes('Chirp3'))return new Response('{}',{status:400});return Response.json({audioContent:'AAAA',timepoints:[{markName:'w0',timeSeconds:0},{markName:'w1',timeSeconds:.3}]});}
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({bullets:options.bullets??bullets})}]}}]});
    },
  });
  const run=(body=route.includes('summary')?{documentId:id}:{text:'Hello world',voice:'Calm'},token=true)=>{
    const request=new Request('https://sid.test/api/test',{method:route.includes('account')?'GET':'POST',headers:token?{authorization:'Bearer caller-token'}:{},...(route.includes('account')?{}:{body:JSON.stringify(body)})});
    return route.includes('account')?endpoint.GET(request):endpoint.POST(request);
  };
  return {run,reads,writes,providers};
}

test('Summary excludes menus, lists, schedules and short documents',()=>{
  for(const text of ['Lunch specials\nSoup $4\nSalad $6','A short notice.','Schedule\n09:00 Doors open\n10:00 Meeting\n11:00 Lunch','- task one\n- task two\n- task three'])assert.equal(typeof pro.summaryUnavailable(text),'string');
  assert.equal(pro.summaryUnavailable(source),null);
  assert.equal(pro.summaryUnavailable(source+' A $20 deposit and a $50 fee are required.'),null);
});
test('speech markup escapes untrusted source and uses stable word positions',()=>{
  const input=speech.speechInput('Hello <script> & goodbye');
  assert.ok(!input.ssml.includes('<script>'));assert.ok(input.ssml.includes('&lt;script&gt;'));
  assert.equal(input.words[1].start,6);assert.equal(input.words[1].length,8);
});
test('speech chunks preserve source positions and stay within SSML byte limits',()=>{
  const text=('a & résumé words '.repeat(600));
  const chunks=speech.speechChunks(text);
  assert.ok(chunks.length>1);
  for(const chunk of chunks){assert.equal(text.slice(chunk.offset,chunk.offset+chunk.text.length),chunk.text);assert.ok(new TextEncoder().encode(speech.speechInput(chunk.text).ssml).length<=4700);assert.ok(chunk.text.length<=1900);}
});
for(const file of ['account','summary','speak']){
  test(`${file}: missing and invalid auth never grants Pro`,async()=>{
    const f=fixture(`app/api/${file}/route.ts`);assert.equal((await f.run(undefined,false)).status,401);assert.equal(f.providers.length,0);
    const invalid=fixture(`app/api/${file}/route.ts`,{invalid:true});assert.equal((await invalid.run()).status,401);
  });
  test(`${file}: a missing migration fails closed`,async()=>{
    const f=fixture(`app/api/${file}/route.ts`,{migrationMissing:true});assert.equal((await f.run()).status,503);assert.equal(f.providers.length,0);
  });
}
test('Free users cannot bypass Summary or Listen by calling their endpoints',async()=>{
  for(const file of ['summary','speak']){const f=fixture(`app/api/${file}/route.ts`,{free:true});assert.equal((await f.run()).status,403);assert.equal(f.providers.length,0);}
});
test('account returns only validated caller allowance with no-store',async()=>{
  const f=fixture('app/api/account/route.ts');const response=await f.run();assert.equal(response.status,200);assert.equal((await response.json()).remaining,142);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('Summary scopes its document lookup to the verified owner',async()=>{
  const f=fixture('app/api/summary/route.ts',{foreign:true});assert.equal((await f.run()).status,404);assert.equal(f.providers.length,0);assert.ok(f.reads[0].filters.some(([key,value])=>key==='user_id'&&value===owner));
});
test('Summary returns an explanation for short text without a provider call',async()=>{
  const f=fixture('app/api/summary/route.ts',{source:'Lunch specials\nSoup $4\nSalad $6'});const response=await f.run();assert.equal(response.status,200);assert.match((await response.json()).reason,/menus/);assert.equal(f.providers.length,0);
});
test('Summary keeps protected dates, times and numbers and caches by source',async()=>{
  const f=fixture('app/api/summary/route.ts');const response=await f.run();assert.equal(response.status,200);assert.deepEqual((await response.json()).bullets,bullets);assert.equal(f.writes[0].document_id,id);assert.equal(f.writes[0].source_hash.length,64);
});
test('Summary rejects changed or missing values instead of displaying a risky result',async()=>{
  const f=fixture('app/api/summary/route.ts',{bullets:['Move out by Dec 19 at 5 PM.','Leave your key.','Stored for 30 days.']});assert.equal((await f.run()).status,502);assert.equal(f.writes.length,0);
});
test('Listen uses the Chirp 3 HD voice and returns no marks so the client estimates timing',async()=>{
  const f=fixture('app/api/speak/route.ts');const response=await f.run({text:'Hello <world>',voice:'Warm'});assert.equal(response.status,200);const body=await response.json();
  assert.equal(f.providers.length,1);const sent=JSON.parse(f.providers[0].init.body);assert.equal(sent.voice.name,'en-US-Chirp3-HD-Sulafat');assert.equal(sent.input.text,'Hello <world>');assert.equal(sent.input.ssml,undefined);
  assert.equal(body.marks.length,0);assert.ok(!JSON.stringify(body).includes('tts-private'));
});
test('Listen falls back to Neural2 with escaped SSML and maps word timepoints when HD fails',async()=>{
  const f=fixture('app/api/speak/route.ts',{hdFails:true});const response=await f.run({text:'Hello <world>',voice:'Warm'});assert.equal(response.status,200);const body=await response.json();
  assert.equal(f.providers.length,2);const sent=JSON.parse(f.providers[1].init.body);assert.equal(sent.voice.name,'en-US-Neural2-C');assert.ok(sent.input.ssml.includes('&lt;world&gt;'));
  assert.equal(body.marks[1].start,6);assert.equal(body.marks[1].time,.3);
});
test('Listen tells the client why the cloud voice failed without leaking the key',async()=>{
  const f=fixture('app/api/speak/route.ts',{ttsDisabled:true,geminiQuota:true});const response=await f.run();const body=await response.json();
  assert.equal(response.status,502);assert.equal(f.providers.length,3);assert.equal(body.reason,'RESOURCE_EXHAUSTED');assert.ok(!JSON.stringify(body).includes('tts-private'));
});
test('Listen uses Gemini speech with the existing Gemini key when there is no Cloud TTS key',async()=>{
  const f=fixture('app/api/speak/route.ts',{noCloud:true});const response=await f.run({text:'Hello world',voice:'Clear'});assert.equal(response.status,200);const body=await response.json();
  assert.equal(f.providers.length,1);assert.match(f.providers[0].url,/gemini-3\.1-flash-tts-preview:generateContent$/);
  const sent=JSON.parse(f.providers[0].init.body);assert.equal(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Iapetus');assert.equal(sent.contents[0].parts[0].text,'Hello world');
  assert.equal(body.mimeType,'audio/wav');const wav=Buffer.from(body.audioContent,'base64');assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.length,4844);
  assert.equal(body.marks.length,0);assert.ok(!JSON.stringify(body).includes('gemini-private'));
});
test('estimated word marks are ordered, start at each word and fit the audio',()=>{
  const text='Move out by Dec 18, at 5 PM. Leave your key.';const marks=speech.estimateMarks(text,4);
  assert.equal(marks.length,11);assert.equal(marks[1].start,5);
  for(let i=1;i<marks.length;i++)assert.ok(marks[i].time>marks[i-1].time);
  assert.ok(marks[0].time>=0&&marks.at(-1).time<4);
  assert.ok(marks[8].time-marks[7].time>marks[2].time-marks[1].time,'pause after a sentence');
  assert.equal(speech.estimateMarks(text,NaN).length,0);
});
test('device voice picker skips novelty voices and prefers natural ones',()=>{
  const voices=[{name:'Albert',lang:'en-US'},{name:'Bad News',lang:'en-US'},{name:'Bubbles',lang:'en-US'},{name:'Microsoft David Desktop',lang:'en-US'},{name:'Samantha',lang:'en-US'},{name:'Microsoft Aria Online (Natural) - English (United States)',lang:'en-US'},{name:'Thomas',lang:'fr-FR'}];
  assert.match(speech.pickDeviceVoice(voices,'Calm').name,/Aria/);
  assert.equal(speech.pickDeviceVoice(voices,'Clear').name,'Samantha');
  assert.equal(speech.pickDeviceVoice(voices,'Warm').name,'Microsoft David Desktop');
  assert.equal(speech.pickDeviceVoice([{name:'Thomas',lang:'fr-FR'}],'Calm'),undefined);
});
test('Listen validates voices and rejects input that exceeds the actual SSML limit',async()=>{
  const f=fixture('app/api/speak/route.ts');assert.equal((await f.run({text:'Hello',voice:'Injected voice'})).status,400);assert.equal((await f.run({text:'a '.repeat(999),voice:'Calm'})).status,400);assert.equal(f.providers.length,0);
});
