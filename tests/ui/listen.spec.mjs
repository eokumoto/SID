import { test, expect } from '@playwright/test';
test.setTimeout(120000);
test('Listen on device voice picks a good voice, highlights, and keeps controls', async ({browser}, testInfo) => {
 const context=await browser.newContext({viewport:{width:1440,height:950},baseURL:testInfo.project.use.baseURL});
 await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return ['localhost','127.0.0.1'].includes(host)?route.continue():route.abort();});
 await context.addInitScript(()=>{
  class TestUtterance { constructor(text) { this.text=text; } }
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:TestUtterance,configurable:true});
  let timer=null,cursor=0,paused=false,loaded=false; window.__voices=[];
  const list=[{lang:'en-US',name:'Albert'},{lang:'en-US',name:'Bad News'},{lang:'en-US',name:'Bahh'},{lang:'en-US',name:'Fred'},{lang:'en-US',name:'Samantha'},{lang:'en-US',name:'Ava (Premium)'},{lang:'en-GB',name:'Daniel'}];
  const listeners=[];
  const engine={speaking:false,getVoices:()=>loaded?list:[],addEventListener:(n,f)=>listeners.push(f),removeEventListener:()=>{},
   cancel(){clearInterval(timer);engine.speaking=false;},pause(){paused=true;},resume(){paused=false;},
   speak(u){window.__voices.push(u.voice?.name);clearInterval(timer);cursor=0;paused=false;engine.speaking=true;queueMicrotask(()=>u.onstart?.({}));const words=[...u.text.matchAll(/\S+/g)];timer=setInterval(()=>{if(paused)return;const word=words[cursor++];if(!word){clearInterval(timer);engine.speaking=false;u.onend?.({});}else u.onboundary?.({name:'word',charIndex:word.index,charLength:word[0].length});},120);}};
  setTimeout(()=>{loaded=true;listeners.forEach(f=>f());},300); // Chrome loads voices late
  Object.defineProperty(window,'speechSynthesis',{value:engine,configurable:true});
 });
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?preview=pro');
 await page.getByRole('article',{name:'Transcribed text'}).waitFor();
 await page.getByRole('button',{name:'Listen',exact:true}).click();
 await page.getByRole('button',{name:'Pause reading',exact:true}).waitFor();
 await page.waitForTimeout(300);
 expect(await page.locator('.reader-copy mark').count()).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.__voices)).toEqual(['Ava (Premium)']);
 await page.getByRole('button',{name:'Pause reading',exact:true}).click();
 await page.getByRole('button',{name:'Resume reading',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 expect(await page.getByLabel('Reading speed',{exact:true}).isEnabled()).toBe(true);
 await page.getByRole('button',{name:'Warm',exact:true}).click();
 await page.waitForTimeout(400);
 expect(await page.evaluate(()=>window.__voices.at(-1))).toBe('Daniel');
 expect(errors).toEqual([]);
});
