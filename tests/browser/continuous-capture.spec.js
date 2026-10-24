import {test,expect,record} from './fixtures.js';

test('one start captures multiple ideas per turn and automatically accepts another turn',async({page})=>{
  const turns=[
    ['Finish the proposal','Explore a customer dashboard','Prepare questions for Friday'],
    ['Plan the launch','Review customer feedback'],
  ];
  const transcripts=turns.map(ideas=>ideas.join('. ')+'.');
  let requests=0;
  await page.route('**/api/health*',r=>r.fulfill({json:{configured:true,ready:true,provider:'Groq'}}));
  await page.route('**/api/transcribe',r=>r.fulfill({json:{text:transcripts[requests++]}}));
  await page.route('**/api/extract',r=>{
    const text=r.request().postDataJSON().text;
    return r.fulfill({json:{ideas:turns[transcripts.indexOf(text)].map(title=>({title,source:title}))}});
  });
  await page.route('**/api/discuss',r=>r.fulfill({json:{reply:'Your ideas are saved. What else is on your mind?'}}));
  await page.addInitScript(()=>{
    window.microphoneRequests=0;
    navigator.mediaDevices.getUserMedia=async()=>{
      window.microphoneRequests++;
      const ctx=new AudioContext(),destination=ctx.createMediaStreamDestination();
      window.captureTrack=destination.stream.getAudioTracks()[0];
      window.speakSeveralThoughts=async()=>{
        await ctx.resume();
        // Brief pauses inside a turn must not require another recording action.
        for(const offset of [0,1.1,2.2]){
          const tone=ctx.createOscillator();tone.connect(destination);
          tone.start(ctx.currentTime+offset);tone.stop(ctx.currentTime+offset+0.6);
        }
      };
      return destination.stream;
    };
  });
  await page.goto('/?view=workbench');
  // Explicitly choose text-only replies so the test concerns continuous capture.
  await page.getByRole('button',{name:'Text-only replies',exact:true}).click();
  await page.getByRole('button',{name:'Spoken replies',exact:true}).click();
  await page.getByRole('button',{name:'Start conversation',exact:true}).click();
  const listening=page.getByTestId('voice-state').filter({hasText:'Listening'});
  await expect(listening).toBeVisible();
  for(let turn=0;turn<2;turn++){
    await page.evaluate(()=>window.speakSeveralThoughts());
    await expect(page.getByTestId('idea-card')).toHaveCount(turn===0?3:5,{timeout:12000});
    await expect(listening).toBeVisible();
  }
  expect(requests).toBe(2);
  expect(await page.evaluate(()=>window.microphoneRequests)).toBe(1);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')));
  expect(saved.captures.map(c=>c.original)).toEqual(transcripts);
  expect(saved.cards.map(c=>c.title)).toEqual(turns.flat());
  expect(saved.cards.slice(0,3).every(c=>c.captureId===saved.captures[0].id)).toBe(true);
  expect(saved.cards.slice(3).every(c=>c.captureId===saved.captures[1].id)).toBe(true);
  expect(saved.cards.every(c=>c.position===null)).toBe(true);
  await page.getByRole('button',{name:'Stop conversation',exact:true}).click();
  expect(await page.evaluate(()=>window.captureTrack.readyState)).toBe('ended');
  await page.reload();
  await expect(page.getByTestId('idea-card')).toHaveCount(5);
});
