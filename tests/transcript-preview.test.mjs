import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TranscriptPreview} from '../src/transcript-preview.js';

test('stopping during capability detection prevents a late microphone start',async t=>{
  const previous=globalThis.SpeechRecognition;t.after(()=>{globalThis.SpeechRecognition=previous;});
  let resolve,starts=0;
  globalThis.SpeechRecognition=class{
    processLocally=false;
    static available(){return new Promise(r=>{resolve=r;});}
    start(){starts++;}
  };
  const preview=new TranscriptPreview(()=>{}),pending=preview.start();
  preview.stop();resolve('available');await pending;assert.equal(starts,0);
});

test('missing local language pack never starts recognition or downloads a pack',async t=>{
  const previous=globalThis.SpeechRecognition;t.after(()=>{globalThis.SpeechRecognition=previous;});
  let starts=0,installs=0,state;
  globalThis.SpeechRecognition=class{
    processLocally=false;
    static async available(options){assert.equal(options.processLocally,true);return 'downloadable';}
    static install(){installs++;}
    start(){starts++;}
  };
  await new TranscriptPreview(s=>{state=s;}).start();
  assert.equal(state.status,'unavailable');assert.equal(starts,0);assert.equal(installs,0);
});

test('recognition failure preserves provisional text and detaches late callbacks',async t=>{
  const previous=globalThis.SpeechRecognition;t.after(()=>{globalThis.SpeechRecognition=previous;});
  let recognition,state,aborts=0;
  globalThis.SpeechRecognition=class{
    processLocally=false;
    constructor(){recognition=this;}
    static async available(){return 'available';}
    start(){}
    abort(){aborts++;}
  };
  const preview=new TranscriptPreview(s=>{state=s;});await preview.start();
  recognition.onresult({results:[[{transcript:'Still provisional'}]]});
  const late=recognition.onresult;recognition.onerror({error:'network'});
  late({results:[[{transcript:'Stale text'}]]});
  assert.deepEqual(state,{text:'Still provisional',status:'unavailable'});assert.equal(aborts,1);
});
