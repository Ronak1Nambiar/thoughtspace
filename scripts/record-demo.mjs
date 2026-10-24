// Records the README/site demo (docs/live-map.gif, site/media/live-map.gif, docs/screenshot.png)
// from invented thoughts with every AI call mocked, so the published media never shows a real workspace.
// Usage: start the app (`npm run dev`), then `node scripts/record-demo.mjs [baseURL]`. Needs ffmpeg on PATH.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const base=process.argv[2]||'http://localhost:3000';
const viewport={width:1440,height:900};
const said='I want to get my candle shop on Etsy before the holidays. The holiday craft fair is in five weeks and I have no booth plan. I am training for a half marathon in March. I should learn enough Spanish for the summer trip. The kitchen needs repainting before spring. I want to plan a camping trip for May.';
const ideas=[
  ['Etsy candle shop','I want to get my candle shop on Etsy before the holidays'],
  ['Holiday craft fair','The holiday craft fair is in five weeks and I have no booth plan'],
  ['Half marathon in March','I am training for a half marathon in March'],
  ['Spanish for the summer trip','I should learn enough Spanish for the summer trip'],
  ['Repaint the kitchen','The kitchen needs repainting before spring'],
  ['Plan a camping trip','I want to plan a camping trip for May']
].map(([title,source])=>({title,source}));
const question='How do I keep the candle shop going while I get ready for the craft fair? What should I do this week?';
const reply='Treat the shop as one batch day a week and give the fair two evenings. Get the listings live now, then pause new products until the fair is done.';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function mockHealth(page){await page.route('**/api/health*',r=>r.fulfill({json:{configured:true,ready:true,provider:'OpenRouter',model:'openai/gpt-4o-mini'}}));}
const onboarded=()=>localStorage.setItem('thoughtspace.onboarding.v1',JSON.stringify({completedAt:'2026-10-01T00:00:00.000Z',assistantName:'Atlas'}));

const browser=await chromium.launch({channel:'msedge'});
try{
  // 1. Build the invented map (not recorded).
  const seed=await browser.newContext({viewport});
  const page=await seed.newPage();
  await page.addInitScript(onboarded);await mockHealth(page);
  await page.route('**/api/extract',r=>r.fulfill({json:{ideas}}));
  await page.goto(base);
  await page.getByLabel('Capture a thought',{exact:true}).fill(said);
  await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();
  await page.getByTestId('map-thought').nth(ideas.length-1).waitFor();
  const ids=await page.evaluate(titles=>{
    const key='thoughtspace.workspace.v1',s=JSON.parse(localStorage.getItem(key));
    const id=t=>s.cards.find(c=>c.title===t).id;
    s.connections=[[0,1],[1,2],[1,4],[0,4],[0,5]].map(([a,b])=>[id(titles[a]),id(titles[b])]);
    s.voiceConfig={service:'device',voice:'daniel'};s.draft='';
    localStorage.setItem(key,JSON.stringify(s));
    return titles.map(id);
  },ideas.map(i=>i.title));
  const state=await seed.storageState();await seed.close();

  // 2. Record one spoken turn on that map.
  const dir=await mkdtemp(path.join(tmpdir(),'thoughtspace-demo-'));
  const ctx=await browser.newContext({viewport,storageState:state,recordVideo:{dir,size:viewport}});
  const rec=await ctx.newPage();await mockHealth(rec);
  await rec.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),out=ctx.createMediaStreamDestination();window.tone=async()=>{await ctx.resume();const o=ctx.createOscillator(),g=ctx.createGain();g.gain.value=1;o.connect(g).connect(out);o.start();o.stop(ctx.currentTime+1.2);await new Promise(r=>setTimeout(r,1300));};return out.stream;};
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),4500);}}});
  });
  await rec.route('**/api/transcribe*',async r=>{await pause(900);await r.fulfill({json:{text:question}});});
  await rec.route('**/api/relate',async r=>{await pause(700);await r.fulfill({json:{ids:[ids[0],ids[1]]}});});
  await rec.route('**/api/discuss',async r=>{await pause(1400);await r.fulfill({json:{reply,suggestions:[
    {cardId:ids[0],text:'Pour a holiday batch on Sunday'},{cardId:ids[0],text:'Photograph and list five candles'},
    {cardId:ids[1],text:'Book a booth table by Friday'},{cardId:ids[1],text:'Make a price sign and card reader setup'}]}});});
  if(process.env.DEMO_DEBUG)rec.on('request',q=>q.url().includes('/api/')&&console.log('api',q.method(),q.url().split('/api/')[1]));
  await rec.goto(base);await pause(1500);
  await rec.getByRole('button',{name:'Start conversation',exact:true}).click();
  await rec.getByTestId('voice-state').filter({hasText:'Listening'}).waitFor();
  await rec.evaluate(()=>window.tone());
  await rec.getByRole('button',{name:'Finish thought',exact:true}).click();
  try{await rec.getByText('Pour a holiday batch on Sunday').first().waitFor({timeout:20000});}
  catch(error){await rec.screenshot({path:path.join(dir,'failed.png')});console.error('Demo stalled; see',path.join(dir,'failed.png'),'voice state:',await rec.getByTestId('voice-state').textContent());throw error;}
  await pause(3500);
  await rec.screenshot({path:'docs/screenshot.png'});
  await pause(1500);
  const video=rec.video();await ctx.close();
  const webm=await video.path();

  // 3. GIF: 6 fps, 860 px wide, one palette, only changed rectangles per frame (keeps it small).
  execFileSync('ffmpeg',['-y','-loglevel','error','-i',webm,'-vf','fps=6,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','docs/live-map.gif']);
  await copyFile('docs/live-map.gif','site/media/live-map.gif');
  console.log('Recorded',(await readdir(dir)).length,'video; wrote docs/live-map.gif, site/media/live-map.gif, docs/screenshot.png');
}finally{await browser.close();}
