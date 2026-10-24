import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readMicrophone,saveMicrophone,inputDevices,openMicrophone,InputCheck,meterLevel} from '../src/microphone.js';
import {WakeController,cleanDevice} from '../desktop/wake-controller.cjs';

const memory=()=>{const data=new Map();return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};};

test('microphone choice round-trips, rejects tampered values, and null returns to the default',()=>{
  const store=memory();
  assert.equal(readMicrophone(store),null);
  saveMicrophone({deviceId:'abc',label:'Microphone (Contoso(R) Audio)'},store);
  assert.deepEqual(readMicrophone(store),{deviceId:'abc',label:'Microphone (Contoso(R) Audio)'});
  saveMicrophone(null,store);
  assert.equal(readMicrophone(store),null);
  store.setItem('thoughtspace.microphone.v1',JSON.stringify({deviceId:42}));
  assert.equal(readMicrophone(store),null);
  store.setItem('thoughtspace.microphone.v1','not json');
  assert.equal(readMicrophone(store),null);
});

test('device list drops the duplicate default entries and names unlabelled inputs',()=>{
  const list=inputDevices([
    {kind:'audioinput',deviceId:'default',label:'Default - Microphone Array'},
    {kind:'audioinput',deviceId:'communications',label:'Communications - Microphone Array'},
    {kind:'audioinput',deviceId:'a1',label:'Microphone Array (Contoso(R) Audio)'},
    {kind:'audiooutput',deviceId:'s1',label:'Speakers'},
    {kind:'audioinput',deviceId:'b2',label:''},
  ]);
  assert.deepEqual(list,[{deviceId:'a1',label:'Microphone Array (Contoso(R) Audio)'},{deviceId:'b2',label:'Microphone 2'}]);
});

test('opening the microphone uses the chosen device and falls back when it is unplugged',async()=>{
  const calls=[];
  const media=fail=>({getUserMedia:async c=>{calls.push(c);if(fail&&c.audio?.deviceId){const e=new Error('gone');e.name=fail;throw e;}return 'stream';}});
  await openMicrophone({},media(),null);
  assert.deepEqual(calls.at(-1),{audio:true});
  await openMicrophone({noiseSuppression:true},media(),{deviceId:'a1',label:'x'});
  assert.deepEqual(calls.at(-1),{audio:{noiseSuppression:true,deviceId:{exact:'a1'}}});
  assert.equal(await openMicrophone({noiseSuppression:true},media('OverconstrainedError'),{deviceId:'a1',label:'x'}),'stream');
  assert.deepEqual(calls.at(-1),{audio:{noiseSuppression:true}});
  await assert.rejects(openMicrophone({},media('NotAllowedError'),{deviceId:'a1',label:'x'}),/gone/);
});

test('input check: waits, then tells digital silence from faint sound, and hears speech at once',()=>{
  const silent=new InputCheck();
  assert.equal(silent.add({rms:0,peak:0},0),'waiting');
  for(let t=80;t<1500;t+=80)assert.equal(silent.add({rms:0,peak:0.00003},t),'waiting');
  assert.equal(silent.add({rms:0,peak:0},1600),'silent');
  const faint=new InputCheck();
  for(let t=0;t<=1600;t+=80)faint.add({rms:0.002,peak:0.01},t);
  assert.equal(faint.state(1600),'signal');
  assert.equal(faint.add({rms:0.05,peak:0.3},1680),'hearing');
  assert.equal(new InputCheck().add({rms:0.05,peak:0.3},0),'hearing');
  assert.equal(meterLevel(0),0);assert.equal(meterLevel(1),1);assert.ok(meterLevel(0.03)>0.4&&meterLevel(0.03)<0.6);
});

function harness(){
  const children=[];
  const controller=new WakeController({executable:'wake.exe',onEvent:()=>{},spawnProcess:(_exe,args)=>{
    const child=new EventEmitter();child.args=args;child.stdout=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=()=>queueMicrotask(()=>child.emit('close',0));child.kill=()=>child.emit('close',0);
    children.push(child);return child;
  }});
  return {controller,children};
}

test('wake listening opens the chosen microphone and restarts when it changes',async()=>{
  const {controller,children}=harness();
  await controller.configure({enabled:true,suspended:false,name:'Nova',device:'Microphone (Contoso(R) Audio)'});
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova','--device','Microphone (Contoso(R) Audio)']);
  await controller.configure({enabled:true,suspended:false,name:'Nova',device:'Microphone (Contoso(R) Audio)'});
  assert.equal(children.length,1);
  await controller.configure({enabled:true,suspended:true,name:'Nova'});
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.deepEqual(children[1].args,['--phrases','Nova|Hey Nova','--device','Microphone (Contoso(R) Audio)'],'pausing keeps the device');
  await controller.configure({enabled:true,suspended:false,name:'Nova',device:''});
  assert.equal(children.length,3);assert.deepEqual(children[2].args,['--phrases','Nova|Hey Nova']);
  controller.dispose();
  assert.equal(cleanDevice('Mic\u0000evil'),'');assert.equal(cleanDevice('x'.repeat(121)),'');assert.equal(cleanDevice('  USB   Mic '),'USB Mic');
});

test('name test reports which microphone the listener opened and whether it was silent',async()=>{
  const {controller,children}=harness();
  const pending=controller.calibrate({name:'Nova',seconds:3,device:'Microphone Array (Contoso(R) Audio)'});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova','--calibrate','--levels','--device','Microphone Array (Contoso(R) Audio)']);
  children[0].stdout.emit('data','{"type":"device","name":"Microphone Array (Contoso(R) Au","matched":true}\n{"type":"ready"}\n{"type":"level","rms":0,"peak":0.00006}\n{"type":"level","rms":0,"peak":0}\n');
  children[0].emit('close',0);
  const result=await pending;
  assert.deepEqual(result.input,{name:'Microphone Array (Contoso(R) Au',matched:true});
  assert.deepEqual(result.level,{peak:0.00006,silent:true,reports:2});
  const second=harness();
  const loud=second.controller.calibrate({name:'Nova',seconds:3});
  await new Promise(r=>setImmediate(r));
  second.children[0].stdout.emit('data','{"type":"ready"}\n{"type":"level","rms":0,"peak":0}\n{"type":"level","rms":0.04,"peak":0.2}\n');
  second.children[0].emit('close',0);
  assert.equal((await loud).level.silent,false);
});
