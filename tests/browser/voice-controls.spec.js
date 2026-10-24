import {test,expect,record} from './fixtures.js';

async function setup(page,{pendingPermission=false}={}){
  await page.route('**/api/health*',r=>r.fulfill({json:{configured:true,ready:true,provider:'Groq'}}));
  await page.route('**/api/extract',r=>r.fulfill({json:{ideas:[{title:'Dashboard',source:'Build a dashboard'}]}}));
  await page.route('**/api/discuss',r=>r.fulfill({json:{reply:'Start with onboarding progress.'}}));
  await page.addInitScript(pendingPermission=>{
    const NativeRecorder=MediaRecorder;
    window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);window.testRecorder=this;}};
    navigator.mediaDevices.getUserMedia=async()=>{
      const ctx=new AudioContext(),destination=ctx.createMediaStreamDestination();
      window.testTrack=destination.stream.getAudioTracks()[0];
      window.tone=async()=>{await ctx.resume();const oscillator=ctx.createOscillator();oscillator.connect(destination);oscillator.start();oscillator.stop(ctx.currentTime+0.5);await new Promise(resolve=>setTimeout(resolve,600));};
      if(pendingPermission)await new Promise(resolve=>{window.allowMicrophone=resolve;});
      return destination.stream;
    };
    Object.defineProperty(window,'speechSynthesis',{value:{cancel(){window.testUtterance?.onerror?.({error:'interrupted'});},speak(utterance){window.testUtterance=utterance;utterance.onstart?.();}}});
  },pendingPermission);
}

test('explicit start, mute and stop controls preserve a thought and expose every active state',async({page})=>{
  await setup(page);let transcriptions=0;
  await page.route('**/api/transcribe',async r=>{transcriptions++;await new Promise(resolve=>setTimeout(resolve,750));await r.fulfill({json:{text:'Build a dashboard'}});});
  await page.goto('/?view=workbench');const status=page.getByTestId('voice-state');
  await expect(status).toHaveText('Ready');await expect(page.getByRole('button',{name:'Mute microphone',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Start conversation',exact:true}).click();await expect(status).toHaveText('Listening');
  await expect(page.getByRole('button',{name:'Stop conversation',exact:true})).toBeVisible();
  await page.evaluate(()=>window.tone());await page.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await expect(status).toHaveText('Microphone muted');await expect(page.getByRole('button',{name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>({enabled:window.testTrack.enabled,state:window.testRecorder.state}))).toEqual({enabled:false,state:'paused'});
  await page.evaluate(()=>window.tone());await page.waitForTimeout(1800);expect(transcriptions).toBe(0);
  await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();await expect(status).toHaveText('Listening');
  expect(await page.evaluate(()=>window.testTrack.enabled)).toBe(true);
  await page.evaluate(()=>window.tone());await page.getByRole('button',{name:'Finish thought',exact:true}).click();await expect(status).toHaveText('Processing');
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();await expect(status).toContainText('Mic muted');
  await expect(status).toContainText('Speaking');await expect(page.getByTestId('idea-card')).toHaveCount(1);expect(transcriptions).toBe(1);
  await page.getByRole('button',{name:'Interrupt and listen',exact:true}).click();await expect(status).toHaveText('Microphone muted');expect(await page.evaluate(()=>window.testTrack.enabled)).toBe(false);
  await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();await expect(status).toHaveText('Listening');
  await page.getByRole('button',{name:'Stop conversation',exact:true}).click();await expect(status).toHaveText('Ready');
  expect(await page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
  await expect(page.getByRole('button',{name:'Mute microphone',exact:true})).toBeDisabled();
});

test('single recording can be muted and stopped without losing already recorded audio',async({page})=>{
  await setup(page);await page.route('**/api/transcribe',r=>r.fulfill({json:{text:'Build a dashboard'}}));
  await page.goto('/?view=workbench');await record(page);await expect(page.getByTestId('voice-state')).toHaveText('Listening');
  await page.evaluate(()=>window.tone());await page.getByRole('button',{name:'Mute microphone',exact:true}).click();await expect(page.getByTestId('voice-state')).toHaveText('Microphone muted');
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByTestId('idea-card')).toHaveCount(1);await expect(page.getByTestId('voice-state')).toHaveText('Ready');
  expect(await page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
});

test('stop during a pending microphone request releases a subsequently granted stream',async({page})=>{
  await setup(page,{pendingPermission:true});await page.goto('/?view=workbench');await page.getByRole('button',{name:'Start conversation',exact:true}).click();await expect(page.getByTestId('voice-state')).toHaveText('Starting microphone');
  await page.getByRole('button',{name:'Stop conversation',exact:true}).click();await expect(page.getByTestId('voice-state')).toHaveText('Stopping microphone');
  await page.evaluate(()=>window.allowMicrophone());await expect(page.getByTestId('voice-state')).toHaveText('Ready');expect(await page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
});
