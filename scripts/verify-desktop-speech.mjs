import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {emptyWorkspace,captureText,localExtract,addNote} from '../src/core.js';
const live=JSON.parse(await readFile('artifacts/desktop-live-results.json','utf8'));
const env={...process.env,AI_ENABLED:'false',GROQ_API_KEY:'',THOUGHTSPACE_USER_DATA:await mkdtemp(path.join(os.tmpdir(),'thoughtspace-desktop-speech-'))};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Thoughtspace.exe'),env});
const page=await app.firstWindow();
const result={runtime:'Packaged Windows desktop application',audio:'Actual runtime speechSynthesis with a real Groq-generated reply',audibility:'NOT VERIFIED - no human listener'};
try{
  await page.waitForURL('thoughtspace://workspace/**');
  await page.addInitScript(()=>{window.speechEvents=[];const Original=window.SpeechSynthesisUtterance;window.SpeechSynthesisUtterance=function(text){const u=new Original(text);for(const kind of ['start','end','error'])u.addEventListener(kind,e=>window.speechEvents.push({kind,error:e.error}));return u;};});
  let state=localExtract(captureText(emptyWorkspace(),'Customer dashboard','speech-test'),'speech-test');
  const id=state.cards[0].id;state=addNote(state,[id],live.discussionReply,'assistant','reply');
  state.messages=[{id:'reply',role:'assistant',text:live.discussionReply,scope:id,context:['Customer dashboard'],status:'complete'}];
  await page.evaluate(state=>localStorage.setItem('thoughtspace.workspace.v1',JSON.stringify(state)),state);await page.reload();
  await page.getByTestId('idea-card').click();await page.getByRole('button',{name:'Read reply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.speechEvents.some(e=>e.kind==='start')),{timeout:15000}).toBe(true);
  await page.getByRole('button',{name:'Interrupt reply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>speechSynthesis.speaking)).toBe(false);
  result.status='passed';result.events=await page.evaluate(()=>window.speechEvents);
}catch(error){result.status='blocked';result.error=error.message;process.exitCode=1;}
finally{await app.close();await writeFile('artifacts/desktop-speech-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
