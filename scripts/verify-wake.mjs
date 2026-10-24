import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const result={date:new Date().toISOString(),checks:[],physicalWakePhrase:'NOT VERIFIED - acoustic phrase tests use synthesized speech',providerMocks:false};
const pass=name=>{result.checks.push(name);console.log('PASS '+name);};
const helper=path.resolve('desktop/native/WakeListener.exe');
const output=execFileSync(helper,['--wave',path.resolve('artifacts/wake.wav')],{encoding:'utf8',windowsHide:true});
expect(output).toContain('"detected"');
const nonWake=execFileSync(helper,['--wave',path.resolve('artifacts/voice-capture.wav')],{encoding:'utf8',windowsHide:true});
expect(nonWake).not.toContain('"detected"');
pass('Real Windows acoustic recognition detects Hey Atlas and rejects unrelated spoken fixture');
let app;
async function launch(extra={}){
  const env={...process.env,AI_ENABLED:'true',THOUGHTSPACE_USER_DATA:await mkdtemp(path.join(os.tmpdir(),'thoughtspace-wake-test-')),...extra};delete env.ELECTRON_RUN_AS_NODE;
  const instance=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.')],env});
  const page=await instance.firstWindow();await page.waitForURL('thoughtspace://workspace/**');return {instance,page};
}
try{
  let launched=await launch({THOUGHTSPACE_WAKE_TEST_WAV:path.resolve('artifacts/wake.wav')});app=launched.instance;let page=launched.page;
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  const fixture=(await readFile('artifacts/voice-capture.wav')).toString('base64');
  await page.addInitScript(fixture=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const context=new AudioContext(),destination=context.createMediaStreamDestination();window.testTrack=destination.stream.getAudioTracks()[0];
      window.sayThought=async()=>{await context.resume();const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));const buffer=await context.decodeAudioData(bytes.buffer);const source=context.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();};
      return destination.stream;
    };
  },fixture);
  await page.reload();
  await page.getByRole('button',{name:'Text-only replies',exact:true}).click();await page.getByRole('button',{name:'Spoken replies',exact:true}).click();
  await expect(page.getByText('Groq connected',{exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Enable Atlas wake word'}).click();
  await expect(page.getByTestId('voice-state')).toHaveText('Listening',{timeout:15000});
  await expect(page.getByRole('button',{name:'Stop conversation'})).toBeVisible();
  pass('Native recognizer exits, IPC wake event starts conversation, and microphone handoff reaches Listening');
  await page.getByRole('button',{name:'Dismiss notification'}).click();
  await page.evaluate(()=>window.sayThought());
  await expect(page.getByTestId('idea-card')).toHaveCount(3,{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')).messages.filter(m=>m.role==='assistant').length),{timeout:100000}).toBe(1);
  await expect(page.getByTestId('voice-state')).toHaveText('Listening');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')));
  expect(saved.captures).toHaveLength(1);expect(saved.captures[0].original).not.toMatch(/atlas/i);
  pass('After wake, live Groq transcribes the thought, creates three ideas and replies; wake phrase creates no card');
  await page.getByRole('button',{name:'Disable Atlas wake word'}).click();
  await page.getByRole('button',{name:'Stop conversation'}).click();
  expect(await page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
  await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')))).toEqual(saved);
  await expect(page.getByRole('button',{name:'Enable Atlas wake word'})).toHaveAttribute('aria-pressed','false');
  pass('Disable and Stop release capture; reopen preserves work and does not silently arm wake listening');
  await app.close();app=null;

  // Exercise the actual default microphone, with native permission outcomes controlled by the test.
  launched=await launch({THOUGHTSPACE_WAKE_TEST_WAV:'',AI_ENABLED:'false',GROQ_API_KEY:''});app=launched.instance;page=launched.page;
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await page.getByRole('button',{name:'Enable Atlas wake word'}).click();
  await expect(page.locator('.banner')).toContainText('Microphone access denied');
  await expect(page.getByRole('button',{name:'Enable Atlas wake word'})).toHaveAttribute('aria-pressed','false');
  pass('Denied microphone permission leaves wake mode off');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  await page.getByRole('button',{name:'Enable Atlas wake word'}).click();
  await expect(page.getByTestId('voice-state')).toHaveText('Listening for Atlas',{timeout:15000});
  await page.getByRole('button',{name:'Mute microphone'}).click();await expect(page.getByTestId('voice-state')).toHaveText('Microphone muted');
  await page.getByRole('button',{name:'Unmute microphone'}).click();await expect(page.getByTestId('voice-state')).toHaveText('Listening for Atlas',{timeout:15000});
  await page.screenshot({path:'artifacts/wake-desktop.png'});
  await page.getByRole('button',{name:'Disable Atlas wake word'}).click();await expect(page.getByTestId('voice-state')).toHaveText('Ready');
  pass('Local default-microphone wake listener starts, mutes, resumes and disables without AI availability');
  await page.getByRole('button',{name:'Enable Atlas wake word'}).click();await expect(page.getByTestId('voice-state')).toHaveText('Listening for Atlas',{timeout:15000});
  await app.close();app=null;
  const processes=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process WakeListener -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim();
  expect(processes).toBe('0');pass('Quitting the application terminates the wake listener');
  result.status='passed';
}catch(error){result.status='failed';result.error=error.message;console.error(error.message);process.exitCode=1;}
finally{if(app)await app.close();await writeFile('artifacts/wake-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
