import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
const key='thoughtspace.workspace.v1';
const proposal={objective:'Reduce noise without overheating',approach:'Compare vented baffles with a low-speed exhaust fan',risk:'Acoustic isolation can reduce heat rejection',experiment:'Measure temperature and noise under the same sustained load',question:'What temperature limit does the printer manufacturer specify?'};
async function setup(page){
  await page.route('**/api/health*',r=>r.fulfill({json:{ready:true,configured:true,provider:'Groq'}}));
  await page.route('**/api/extract',r=>r.fulfill({json:{ideas:[{title:'Quiet printer enclosure',source:'Build a quiet printer enclosure.',engineering:proposal}]}}));
  await page.route('**/api/discuss',r=>r.fulfill({json:{reply:'Start by measuring the temperature rise under a sustained load. Then compare passive baffles with a low speed fan.'}}));
  await page.goto('/?view=workbench');
  await page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key));s.voiceConfig={service:'groq',voice:'daniel'};localStorage.setItem(key,JSON.stringify(s));},key);await page.reload();
}
async function capture(page){await page.getByRole('textbox',{name:'Capture a thought',exact:true}).fill('Build a quiet printer enclosure.');await page.getByRole('button',{name:'Capture and extract ideas'}).click();await expect(page.getByTestId('idea-card')).toHaveCount(1);}
test('engineering brief adds reasoning, preserves attribution and source, and leaves layout under manual control',async({page})=>{
  await setup(page);await capture(page);
  await expect(page.locator('.inbox')).toHaveCount(0);await expect(page.locator('.transcript-strip')).toHaveCount(0);
  await expect(page.getByTestId('idea-card')).toContainText('AI PROPOSAL');await expect(page.getByTestId('idea-card')).toContainText(proposal.approach);
  await expect(page.locator('.engineering-brief')).toContainText(proposal.experiment);
  await page.getByTestId('idea-card').click();await expect(page.locator('.context-chips')).toContainText('Quiet printer enclosure');
  await page.getByRole('button',{name:'Review wording: Quiet printer enclosure'}).click();await expect(page.getByTestId('original-wording')).toContainText('Build a quiet printer enclosure.');
  const s=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);expect(s.cards[0].position).toBeNull();expect(s.cards[0].notes[0].kind).toBe('assistant');
  await page.reload();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).toEqual(s);
});
test('natural voice generation error keeps reply saved and explains provider terms',async({page})=>{
  await setup(page);await capture(page);await page.getByTestId('idea-card').click();
  await page.route('**/api/speech',r=>r.fulfill({status:424,json:{error:'Natural voice needs Orpheus terms acceptance. Reply saved as text.'}}));
  await page.getByRole('button',{name:'Text-only replies',exact:true}).click();await page.getByRole('button',{name:'Discuss selected',exact:false}).click();
  await page.getByRole('textbox',{name:'Discuss selected ideas'}).fill('How should I test it?');await page.getByRole('button',{name:'Send discussion'}).click();
  await expect(page.locator('.banner')).toContainText('Orpheus terms');await expect(page.locator('.message.assistant')).toContainText('temperature rise');
  expect((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).messages.at(-1).status).toBe('complete');
});
test('natural voice uses real audio playback, interruption stops it, and text-only avoids generation',async({page})=>{
  await setup(page);await capture(page);await page.getByTestId('idea-card').click();
  const audio=await readFile('artifacts/voice-capture.wav');let requests=0;
  await page.route('**/api/speech',r=>{requests++;const body=r.request().postDataJSON();expect(body.voice).toBe('daniel');expect(body.text.length).toBeLessThanOrEqual(200);return r.fulfill({contentType:'audio/wav',body:audio});});
  await page.evaluate(()=>{window.audioPauses=0;const pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){window.audioPauses++;return pause.call(this);};});
  await page.getByRole('button',{name:'Discuss selected',exact:false}).click();await page.getByRole('textbox',{name:'Discuss selected ideas'}).fill('First test?');await page.getByRole('button',{name:'Send discussion'}).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);expect(requests).toBe(0);
  await page.getByRole('button',{name:'Read reply',exact:true}).click();await expect(page.getByTestId('voice-state')).toHaveText('Speaking');
  await page.getByRole('button',{name:'Interrupt reply'}).click();await expect(page.getByTestId('voice-state')).toHaveText('Ready');expect(await page.evaluate(()=>window.audioPauses)).toBeGreaterThan(0);expect(requests).toBe(1);
});
