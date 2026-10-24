import {test,expect,record} from './fixtures.js';

async function setup(page,{supported=true}={}){
  await page.route('**/api/health*',r=>r.fulfill({json:{configured:true,ready:true,provider:'Groq'}}));
  await page.addInitScript(({supported})=>{
    class Recognition{
      constructor(){if(supported)this.processLocally=false;window.previewRecognition=this;}
      static async available(){return 'available';}
      start(){window.previewStarts=(window.previewStarts||0)+1;}
      abort(){window.previewAborts=(window.previewAborts||0)+1;}
      emit(text){this.onresult?.({results:[Object.assign([{transcript:text}],{isFinal:false})]});}
    }
    window.SpeechRecognition=Recognition;
    const Recorder=window.MediaRecorder;
    window.MediaRecorder=class extends Recorder{
      constructor(...args){super(...args);this.addEventListener('dataavailable',e=>{window.recordedBytes=(window.recordedBytes||0)+e.data.size;});}
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      const ctx=new AudioContext(),out=ctx.createMediaStreamDestination();
      window.previewAudioContext=ctx;
      await ctx.resume();const tone=ctx.createOscillator();tone.connect(out);tone.start();
      return out.stream;
    };
  },{supported});
}

test('provisional hypotheses never persist or extract; finalized text replaces preview and survives reopening',async({page})=>{
  await setup(page);
  let extracts=0;
  await page.route('**/api/transcribe',r=>r.fulfill({json:{text:'Build a customer dashboard.'}}));
  await page.route('**/api/extract',r=>{extracts++;expect(r.request().postDataJSON().text).toBe('Build a customer dashboard.');return r.fulfill({json:{ideas:[{title:'Customer dashboard',source:'Build a customer dashboard.'}]}});});
  await page.goto('/?view=workbench');await record(page);
  await expect.poll(()=>page.evaluate(()=>window.previewStarts)).toBe(1);
  expect(await page.evaluate(()=>({local:window.previewRecognition.processLocally,interim:window.previewRecognition.interimResults}))).toEqual({local:true,interim:true});
  await page.evaluate(()=>window.previewRecognition.emit('Build a costume'));
  await expect(page.getByTestId('provisional-transcript')).toContainText('Build a costume');
  await page.evaluate(()=>window.previewRecognition.emit('Build a customer dashboard'));
  await expect(page.getByTestId('provisional-transcript')).not.toContainText('costume');
  await expect(page.getByTestId('provisional-transcript')).toContainText('Not saved');
  expect(extracts).toBe(0);await expect(page.getByTestId('idea-card')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('thoughtspace.workspace.v1')||'')).not.toContain('Build a customer');
  await expect.poll(()=>page.evaluate(()=>window.recordedBytes||0)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();
  expect(await page.evaluate(()=>window.previewAborts)).toBe(1);
  await page.evaluate(()=>window.previewRecognition.emit('Muted words'));
  await expect(page.getByTestId('provisional-transcript')).not.toContainText('Muted words');
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await expect(page.getByTestId('finalized-transcript')).toContainText('Build a customer dashboard.');
  await expect(page.getByTestId('finalized-transcript')).toContainText('Saved on this device');
  await expect(page.getByTestId('provisional-transcript')).toHaveCount(0);
  await expect(page.getByTestId('idea-card')).toHaveCount(1);expect(extracts).toBe(1);
  await page.reload();await page.getByRole('button',{name:'Source transcripts',exact:true}).click();await expect(page.getByTestId('finalized-transcript')).toContainText('Build a customer dashboard.');
  await page.getByRole('button',{name:'Review or correct transcripts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Correct transcript',exact:true})).toBeVisible();
});

test('unsupported local preview never starts browser cloud recognition; finalized transcription still works',async({page})=>{
  await setup(page,{supported:false});
  await page.route('**/api/transcribe',r=>r.fulfill({json:{text:'Keep my thought'}}));
  await page.route('**/api/extract',r=>r.fulfill({json:{ideas:[{title:'My thought',source:'Keep my thought'}]}}));
  await page.goto('/?view=workbench');await record(page);
  await expect(page.getByTestId('provisional-transcript')).toContainText('Live preview is unavailable here');
  expect(await page.evaluate(()=>window.previewStarts||0)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.recordedBytes||0)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await expect(page.getByTestId('finalized-transcript')).toContainText('Keep my thought');
  await expect(page.getByTestId('idea-card')).toHaveCount(1);
});
