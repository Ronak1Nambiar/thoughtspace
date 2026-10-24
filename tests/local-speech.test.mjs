import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalTranscriber,secondsOf} from '../desktop/local-transcribe.cjs';
import {encodeWav,toWav16k,SAMPLE_RATE} from '../src/wav.js';
import {startWorkspaceServer} from '../server.mjs';

const wav=async(seconds,rate=SAMPLE_RATE)=>{const b=Buffer.from(await encodeWav(new Float32Array(Math.round(seconds*SAMPLE_RATE)).fill(0.25)).arrayBuffer());b.writeUInt32LE(rate,24);return b;};

test('WAV encoding: 16 kHz mono 16-bit PCM with a correct header and clipped samples',async()=>{
  const blob=encodeWav(new Float32Array([0,1,-1,2,-2,0.5]));
  assert.equal(blob.type,'audio/wav');
  const b=Buffer.from(await blob.arrayBuffer());
  assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');assert.equal(b.toString('ascii',36,40),'data');
  assert.equal(b.readUInt16LE(20),1);assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt32LE(24),16000);assert.equal(b.readUInt16LE(34),16);
  assert.equal(b.readUInt32LE(40),12);assert.equal(b.length,44+12);
  assert.deepEqual([0,1,2,3,4,5].map(i=>b.readInt16LE(44+i*2)),[0,32767,-32768,32767,-32768,16383]);
  assert.equal(secondsOf(await wav(2)),2);
});

test('toWav16k leaves WAV alone and falls back to the original where audio APIs are missing',async()=>{
  const already=new Blob([new Uint8Array(4)],{type:'audio/wav'});
  assert.equal(await toWav16k(already,{}),already);
  const webm=new Blob([new Uint8Array(4)],{type:'audio/webm'});
  assert.equal(await toWav16k(webm,{}),webm);
});

test('local transcription runs whisper on a private temp file, deletes it, and drops non-speech markers',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'local-speech-'));
  writeFileSync(path.join(dir,'whisper-cli.exe'),'');writeFileSync(path.join(dir,'ggml-base.en-q5_1.bin'),'');
  const temp=path.join(dir,'tmp'),calls=[];
  const t=new LocalTranscriber({folder:dir,tempDir:temp,threads:3,run:(exe,args,options,done)=>{
    const file=args[args.indexOf('-f')+1];calls.push({exe,args,options,existed:existsSync(file)});
    setImmediate(()=>done(null,'\n How should I run the shop\n alongside the craft fair?\n [BLANK_AUDIO]\n'));
  }});
  assert.equal(t.available(),true);
  assert.equal(await t.transcribe(await wav(10)),'How should I run the shop alongside the craft fair?');
  const [call]=calls;
  assert.equal(call.existed,true);assert.match(call.exe,/whisper-cli\.exe$/);
  assert.equal(call.args[call.args.indexOf('-m')+1],path.join(dir,'ggml-base.en-q5_1.bin'));
  assert.ok(call.args.includes('-ng')&&call.args.includes('-nt'));
  assert.equal(call.options.timeout,30000,'timeout grows with the clip');
  assert.deepEqual(readdirSync(temp),[],'the temp clip is deleted');
  // Bad input never reaches whisper.
  await assert.rejects(t.transcribe(Buffer.from('not audio')),/needs WAV/);
  await assert.rejects(t.transcribe(await wav(1,48000)),/16 kHz/);
  assert.equal(calls.length,1);
  // Failures and timeouts explain themselves and still clean up.
  const failing=new LocalTranscriber({folder:dir,tempDir:temp,run:(e,a,o,done)=>setImmediate(()=>done(Object.assign(new Error('x'),{killed:true})))});
  await assert.rejects(failing.transcribe(await wav(1)),/took too long/);
  assert.deepEqual(readdirSync(temp),[]);
  writeFileSync(path.join(temp,'speech-old.wav'),'');t.clean();assert.deepEqual(readdirSync(temp),[]);
  assert.equal(new LocalTranscriber({folder:path.join(dir,'missing'),tempDir:temp}).available(),false);
});

test('server: speech-to-text uses this computer without a key, the cloud with one, and honours the choice',async t=>{
  const fetchOriginal=globalThis.fetch,cloud=[];
  globalThis.fetch=async(url,options)=>{url=String(url);if(url.startsWith('http://127.0.0.1:'))return fetchOriginal(url,options);cloud.push(url);return Response.json({text:'from the cloud'});};
  const local={available:()=>true,transcribe:async b=>b.length>44?'from this computer':''};
  const start=async keys=>{const s=await startWorkspaceServer({port:0,localTranscriber:local,providerStore:{load:()=>({enabled:true,provider:'ollama',keys}),save:()=>{}}});t.after(()=>{s.closeAllConnections();s.close();});return `http://127.0.0.1:${s.address().port}/api/`;};
  t.after(()=>{globalThis.fetch=fetchOriginal;});
  const send=(base,engine,type='audio/wav')=>fetch(base+'transcribe'+(engine?'?engine='+engine:''),{method:'POST',headers:{'Content-Type':type},body:new Uint8Array(100)});
  const keyless=await start({});
  assert.deepEqual(await (await send(keyless)).json(),{text:'from this computer',engine:'local'});
  assert.equal((await (await fetch(keyless+'health')).json()).voice.transcription,'This computer');
  assert.equal((await send(keyless,'local','audio/webm')).status,400,'local needs WAV');
  assert.equal((await send(keyless,'cloud')).status,503,'cloud without a key explains itself');
  const keyed=await start({groq:'gsk_test_key_123456'});
  assert.deepEqual(await (await send(keyed)).json(),{text:'from the cloud'});
  assert.deepEqual(await (await send(keyed,'local')).json(),{text:'from this computer',engine:'local'},'privacy choice wins over a saved key');
  assert.equal(cloud.length,1);
});

test('noise never becomes words: sound tags and silence phantoms are dropped, VAD is used when shipped',async()=>{
  const {cleanTranscript}=await import('../desktop/local-transcribe.cjs');
  for(const junk of [' (beep)\n','[BLANK_AUDIO]',' you',' Thank you.','Bye!','(water rushing)',' ...'])assert.equal(cleanTranscript(junk),'',junk);
  assert.equal(cleanTranscript(' Hey (laughs) what do you think?\n Okay.'),'Hey what do you think? Okay.');
  assert.equal(cleanTranscript('Thank you for the idea.'),'Thank you for the idea.');
  const dir=mkdtempSync(path.join(os.tmpdir(),'local-vad-'));
  for(const f of ['whisper-cli.exe','ggml-base.en-q5_1.bin','ggml-silero-v5.1.2.bin'])writeFileSync(path.join(dir,f),'');
  let args;
  await new LocalTranscriber({folder:dir,tempDir:path.join(dir,'t'),run:(e,a,o,done)=>{args=a;setImmediate(()=>done(null,' (beep)'));}}).transcribe(await wav(1)).then(text=>assert.equal(text,''));
  assert.equal(args[args.indexOf('-vm')+1],path.join(dir,'ggml-silero-v5.1.2.bin'));assert.ok(args.includes('--vad'));
});
