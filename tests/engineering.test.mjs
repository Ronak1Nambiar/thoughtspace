import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,captureText,applyExtraction,addNote,correctCapture} from '../src/core.js';
import {NaturalSpeaker,speechSegments} from '../src/natural-speaker.js';

test('engineering proposals are attributed, retained across corrections, and do not duplicate',()=>{
  const engineering={objective:'Move air',approach:'Compare passive and forced ventilation',risk:'Fan noise',experiment:'Measure temperature under the same load',question:'What is the enclosure size?'};
  let s=captureText(emptyWorkspace(),'Build a quiet enclosure','source');
  s=applyExtraction(s,'source',0,[{title:'Quiet enclosure',source:'Build a quiet enclosure',engineering}]);
  const id=s.cards[0].id;assert.equal(s.cards[0].origin,'captured');assert.equal(s.cards[0].notes[0].kind,'assistant');
  assert.deepEqual(s.cards[0].notes[0].engineering,engineering);
  assert.equal(applyExtraction(s,'source',0,[{source:'Build a quiet enclosure',engineering}]),s);
  s=addNote(s,[id],'Keep the existing bracket');s.cards[0].position={x:90,y:120};
  s=correctCapture(s,'source','Build a silent enclosure');
  s=applyExtraction(s,'source',1,[{existingId:id,title:'Silent enclosure',source:'Build a silent enclosure',engineering:{...engineering,risk:'Passive heat rejection'}}]);
  assert.equal(s.cards.length,1);assert.equal(s.cards[0].notes.length,3);assert.equal(s.cards[0].originalSource,'Build a quiet enclosure');assert.deepEqual(s.cards[0].position,{x:90,y:120});
});
test('speech segments preserve words and stay inside Groq limits',()=>{
  const text='First, establish the load. '+('Then measure the result and compare it with the baseline. ').repeat(30);
  const parts=speechSegments(text);assert.ok(parts.length>1);assert.ok(parts.every(p=>p.length<=200));assert.equal(parts.join(' '),text.trim());
});
test('natural speech fails clearly on terms, with no silent device fallback',async()=>{
  let localCalls=0;
  const speaker=new NaturalSpeaker({speechSynthesis:{cancel(){},speak(){localCalls++;}},fetch:async()=>({ok:false,json:async()=>({error:'Orpheus terms required'})})});
  assert.deepEqual(await speaker.speak('Test'),{status:'failed',reason:'Orpheus terms required'});assert.equal(localCalls,0);
});
test('interrupting natural voice aborts pending generation',async()=>{
  let started;
  const ready=new Promise(r=>started=r);
  const speaker=new NaturalSpeaker({fetch:(_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('Aborted')));started();})});
  const result=speaker.speak('Test');await ready;speaker.cancel();assert.equal((await result).status,'interrupted');
});
