import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {heardWake,WakeCheck} from '../desktop/wake-check.cjs';
import {WakeController} from '../desktop/wake-controller.cjs';

test('the name counts only when it is called: after a greeting or as the last word',()=>{
  for(const said of ['Hey, Atlas.','Atlas.','Okay so, hey Atlas.','Hey Atless, I have an idea.','Hi Atlus!','Hey, Atlis.'])assert.equal(heardWake(said,'Atlas'),true,said);
  for(const said of ['We bought two Atlas and some salsa.','Atlas and Gretel went home.','I had a hamburger.','Hey, handsome.','',"Atlas is the assistant's name.",'[BLANK_AUDIO]'])assert.equal(heardWake(said,'Atlas'),false,said);
  assert.equal(heardWake('Hey Nova.','Nova'),true);
  assert.equal(heardWake('Hey Nora.','Nova'),false,'short names must match exactly');
  assert.equal(heardWake('Okay, Mary Jane','Mary Jane'),true,'two-word names');
  assert.equal(heardWake('hey zoe','Zoë'),true,'accents are ignored');
});

test('the check runs whisper on a private temp file and always deletes it',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'wake-check-'));
  writeFileSync(path.join(dir,'whisper-cli.exe'),'');writeFileSync(path.join(dir,'ggml-tiny.en-q5_1.bin'),'');
  const temp=path.join(dir,'tmp');const calls=[];
  const check=new WakeCheck({folder:dir,tempDir:temp,threads:2,run:(exe,args,options,done)=>{
    const file=args[args.indexOf('-f')+1];calls.push({exe,args,options,existed:existsSync(file)});
    setImmediate(()=>done(null,calls.length===1?' Hey, Nova.\n':' Two novas please.\n'));
  }});
  assert.equal(check.available(),true);
  assert.deepEqual(await check.check(Buffer.from('RIFF....'),'Nova'),{ok:true,text:'Hey, Nova.'});
  assert.deepEqual(await check.check(Buffer.from('RIFF....'),'Nova'),{ok:false,text:'Two novas please.'});
  assert.equal(calls[0].existed,true);assert.equal(calls[0].options.windowsHide,true);
  assert.ok(calls[0].args.includes("Nova is the assistant's name."));
  assert.deepEqual(readdirSync(temp),[],'clips are deleted after the check');
  const failing=new WakeCheck({folder:dir,tempDir:temp,run:(_e,_a,_o,done)=>done(new Error('crashed'))});
  assert.deepEqual(await failing.check(Buffer.from('x'),'Nova'),{ok:false,text:null});
  assert.deepEqual(readdirSync(temp),[]);
  writeFileSync(path.join(temp,'wake-old.wav'),'x');check.clean();assert.deepEqual(readdirSync(temp),[]);
  assert.equal(new WakeCheck({folder:path.join(dir,'missing'),tempDir:temp}).available(),false);
});

function harness(check){
  const children=[],events=[];
  const controller=new WakeController({executable:'wake.exe',check,onEvent:e=>events.push(e),spawnProcess:(_exe,args)=>{
    const child=new EventEmitter();child.args=args;child.stdout=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=()=>queueMicrotask(()=>child.emit('close',0));child.kill=()=>child.emit('close',0);
    children.push(child);return child;
  }});
  return {controller,children,events};
}
const wav=Buffer.alloc(200,1).toString('base64');
const candidate=phrase=>JSON.stringify({type:'candidate',phrase,confidence:0.8,wav})+'\n';
const tick=()=>new Promise(r=>setImmediate(r));

test('two-stage wake: candidates are checked, rejections keep listening, a confirmed name wakes',async()=>{
  const verdicts=[false,true];const seen=[];
  const {controller,children,events}=harness({available:()=>true,check:async(clip,name)=>{seen.push(name);await tick();return {ok:verdicts.shift()};}});
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova','--candidates']);
  children[0].stdout.emit('data','{"type":"ready"}\n'+candidate('Nova'));
  await tick();await tick();
  assert.equal(events.at(-1).status,'listening','a rejected candidate does not wake');
  children[0].stdout.emit('data',candidate('Hey Nova'));
  await tick();await tick();await tick();
  assert.equal(events.at(-1).status,'detected');assert.deepEqual(seen,['Nova','Nova']);
  controller.dispose();
});

test('while a check runs only the newest candidate waits, and stopping drops pending checks',async()=>{
  let release;const seen=[];
  const {controller,children,events}=harness({available:()=>true,check:async clip=>{seen.push(clip.length);await new Promise(r=>{release=r;});return {ok:false};}});
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  children[0].stdout.emit('data','{"type":"ready"}\n'+candidate('a'));
  await tick();
  children[0].stdout.emit('data',candidate('b')+candidate('c'));
  release();await tick();await tick();
  assert.equal(seen.length,2,'the middle candidate was replaced by the newest');
  await controller.configure({enabled:false,suspended:false});release();await tick();
  assert.equal(events.at(-1).status,'off');assert.equal(seen.length,2);
});

test('without the whisper files the listener decides alone, as before',async()=>{
  const {controller,children}=harness({available:()=>false,check:async()=>({ok:true})});
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova']);
  controller.dispose();
  const broken=harness({available:()=>{throw new Error('fs');}});
  await broken.controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.deepEqual(broken.children[0].args,['--phrases','Nova|Hey Nova']);broken.controller.dispose();
});

test('the name test counts only confirmed candidates and waits for checks still running',async()=>{
  let n=0;
  const {controller,children}=harness({available:()=>true,check:async(_clip,name)=>{await new Promise(r=>setTimeout(r,30));n++;return {ok:name==='Nova'&&n!==2};}});
  const pending=controller.calibrate({name:'Nova',seconds:3});
  await tick();
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova','--calibrate','--levels','--candidates']);
  children[0].stdout.emit('data','{"type":"ready"}\n'+candidate('Nova')+candidate('Hey Nova')+candidate('Nova'));
  children[0].emit('close',0);
  const result=await pending;
  assert.equal(result.heard.length,2);assert.ok(result.heard.every(h=>h.verified));
});

test('a listener that ends while its last candidate is checked still wakes when the name is confirmed',async()=>{
  const {controller,children,events}=harness({available:()=>true,check:async()=>{await new Promise(r=>setTimeout(r,20));return {ok:true};}});
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  children[0].stdout.emit('data','{"type":"ready"}\n'+candidate('Nova'));
  children[0].emit('close',0);
  await new Promise(r=>setTimeout(r,60));
  assert.equal(events.at(-1).status,'detected');
  const rejected=harness({available:()=>true,check:async()=>({ok:false})});
  await rejected.controller.configure({enabled:true,suspended:false,name:'Nova'});
  rejected.children[0].stdout.emit('data','{"type":"ready"}\n'+candidate('Nova'));
  rejected.children[0].emit('close',0);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(rejected.events.at(-1).status,'error');
});
