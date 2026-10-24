import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const live=JSON.parse(await readFile('artifacts/live-results.json','utf8'));
const result={date:new Date().toISOString(),input:'Reply text produced by the completed live Groq test',speech:'Real browser speechSynthesis; response delivery replayed locally',audibility:'Not heard or independently recorded'};
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage();
try{
  await page.addInitScript(()=>{
    window.speechEvents=[];
    const Original=window.SpeechSynthesisUtterance;
    window.SpeechSynthesisUtterance=function(text){const u=new Original(text);for(const kind of ['start','end','error'])u.addEventListener(kind,e=>window.speechEvents.push({kind,error:e.error}));return u;};
  });
  await page.route('**/api/discuss',r=>r.fulfill({json:{reply:live.discussionReply}}));
  await page.goto('http://localhost:3000');
  await page.getByRole('textbox',{name:'Capture a thought',exact:true}).fill('Customer dashboard');
  await page.getByRole('button',{name:'Save as one card · no AI',exact:true}).click();
  await page.getByTestId('idea-card').click();
  await page.getByRole('button',{name:'Text-only replies',exact:true}).click();
  await page.getByRole('button',{name:'Discuss selected',exact:false}).click();
  await page.getByRole('textbox',{name:'Discuss selected ideas',exact:true}).fill('Explore this idea');
  await page.getByRole('button',{name:'Send discussion',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.speechEvents.some(e=>e.kind==='start')),{timeout:15000}).toBe(true);
  await page.getByRole('button',{name:'Interrupt reply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.speechSynthesis.speaking)).toBe(false);
  result.status='passed';result.events=await page.evaluate(()=>window.speechEvents);
  console.log('PASS Real browser speech started and cancellation stopped playback');
}catch(error){result.status='blocked';result.error=error.message;result.events=await page.evaluate(()=>window.speechEvents);console.log(JSON.stringify(result));process.exitCode=1;}
finally{await writeFile('artifacts/speech-results.json',JSON.stringify(result,null,2));await browser.close();}
