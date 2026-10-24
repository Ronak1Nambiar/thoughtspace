import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplySpeaker} from '../src/reply-speaker.js';
test('reply playback prefers local matching voice and completes',async()=>{
  const local={name:'Local English',lang:'en-US',localService:true};let active;
  const speaker=new ReplySpeaker({document:{documentElement:{lang:'en'}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{cancel(){},getVoices:()=>[{name:'Remote English',lang:'en-US',localService:false},local],speak:u=>{active=u;u.onstart();queueMicrotask(()=>u.onend());}}});
  assert.equal((await speaker.speak('A saved idea')).status,'complete');assert.equal(active.voice,local);
});
test('interruption resolves pending playback without waiting for browser callbacks',async()=>{
  const speaker=new ReplySpeaker({SpeechSynthesisUtterance:class{},speechSynthesis:{cancel(){},speak(){}}});
  const pending=speaker.speak('A reply');speaker.cancel();assert.equal((await pending).status,'interrupted');
});
test('missing and failing speech services return recoverable results',async()=>{
  assert.equal((await new ReplySpeaker({}).speak('A reply')).status,'unavailable');
  const speaker=new ReplySpeaker({SpeechSynthesisUtterance:class{},speechSynthesis:{cancel(){},speak(){throw new Error('Unavailable');}}});
  assert.equal((await speaker.speak('A reply')).status,'failed');
});
