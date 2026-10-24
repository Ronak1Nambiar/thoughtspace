import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {cleanName,nameProblem,nameAdvice,readProfile,saveProfile,DEFAULT_NAME} from '../src/assistant.js';
import {cleanAppearance,readAppearance,saveAppearance,applyAppearance,DEFAULT_APPEARANCE,THEME_FADE_MS} from '../src/appearance.js';
import {WakeController,wakePhrases} from '../desktop/wake-controller.cjs';

const memory=()=>{const data=new Map();return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v))};};

test('assistant names: letters, spaces, hyphens and apostrophes, starting with a letter, up to 24 characters',()=>{
  assert.equal(cleanName('  Nova  '),'Nova');
  assert.equal(cleanName('Mary  Jane'),'Mary Jane');
  assert.equal(cleanName("O'Neil-Smith"),"O'Neil-Smith");
  assert.equal(cleanName('Zoë'),'Zoë');
  for(const bad of ['','9lives','Nova!','<script>','A'.repeat(25),' - '])assert.equal(cleanName(bad),null,bad);
  assert.equal(nameProblem(''),'Give your assistant a name.');
  assert.equal(nameProblem('1x'),'Start the name with a letter.');
  assert.equal(nameProblem('Nova!'),'Use letters, spaces, hyphens or apostrophes only.');
  assert.equal(nameProblem('Nova'),'');
  assert.match(nameAdvice('Max'),/Hey Max/);
  assert.equal(nameAdvice('Nova'),'');
});

test('assistant profile defaults to Atlas, round-trips, and rejects a tampered name',()=>{
  const store=memory();
  assert.deepEqual(readProfile(store),{completedAt:null,assistantName:DEFAULT_NAME});
  saveProfile({completedAt:'2031-09-28',assistantName:'Nova'},store);
  assert.deepEqual(readProfile(store),{completedAt:'2031-09-28',assistantName:'Nova'});
  store.setItem('thoughtspace.onboarding.v1',JSON.stringify({completedAt:'x',assistantName:'<img onerror=1>'}));
  assert.equal(readProfile(store).assistantName,'Atlas');
  store.setItem('thoughtspace.onboarding.v1','not json');
  assert.equal(readProfile(store).completedAt,null);
});

test('appearance falls back to defaults for unknown values and applies data attributes',()=>{
  assert.deepEqual(cleanAppearance({theme:'neon',accent:'plaid',density:'huge'}),DEFAULT_APPEARANCE);
  const store=memory();
  assert.equal(readAppearance(store).saved,false);
  saveAppearance({theme:'paper',accent:'rose',density:'compact'},store);
  assert.deepEqual(readAppearance(store),{theme:'paper',accent:'rose',density:'compact',saved:true});
  const root={dataset:{}};
  applyAppearance({theme:'workbench',accent:'blue',density:'comfortable'},root);
  assert.deepEqual({...root.dataset},{theme:'workbench',mode:'light',accent:'blue',density:'comfortable'});
});

test('changing the look fades colours; first paint, unchanged looks and density-only changes do not',async()=>{
  const classes=new Set();
  const root={dataset:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}};
  applyAppearance({theme:'midnight',accent:'teal',density:'comfortable'},root);
  assert.equal(classes.has('theme-switching'),false,'first paint is instant');
  applyAppearance({theme:'midnight',accent:'teal',density:'compact'},root);
  assert.equal(classes.has('theme-switching'),false,'density alone does not fade');
  applyAppearance({theme:'paper',accent:'teal',density:'compact'},root);
  assert.equal(classes.has('theme-switching'),true,'theme change fades');
  await new Promise(r=>setTimeout(r,THEME_FADE_MS+120));
  assert.equal(classes.has('theme-switching'),false,'fade class is removed afterwards');
  applyAppearance({theme:'paper',accent:'rose',density:'compact'},root);
  assert.equal(classes.has('theme-switching'),true,'accent change fades');
  await new Promise(r=>setTimeout(r,THEME_FADE_MS+120));
});

test('wake phrases use the chosen name; Atlas keeps its common mishearings; bad names fall back',()=>{
  assert.equal(wakePhrases('Nova'),'Nova|Hey Nova');
  assert.equal(wakePhrases('atlas'),'Atlas|Hey Atlas|Atlus|Hey Atlus|Atless|Hey Atless');
  assert.equal(wakePhrases('bad|name'),wakePhrases('Atlas'));
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
test('the wake listener starts with the chosen name and restarts when the name changes',async()=>{
  const {controller,children}=harness();
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova']);
  await controller.configure({enabled:true,suspended:false,name:'Nova'});
  assert.equal(children.length,1);
  await controller.configure({enabled:true,suspended:false,name:'Ada'});
  assert.equal(children.length,2);assert.deepEqual(children[1].args,['--phrases','Ada|Hey Ada']);
  controller.dispose();
});
test('name test collects confidences and stops the helper when time is up',async()=>{
  const {controller,children}=harness();
  const pending=controller.calibrate({name:'Nova',seconds:3});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(children[0].args,['--phrases','Nova|Hey Nova','--calibrate','--levels']);
  children[0].stdout.emit('data','{"type":"ready"}\n{"type":"heard","phrase":"Nova","confidence":0.91}\n{"type":"heard","phrase":"Hey Nova","confidence":0.72}\n');
  const result=await pending;
  assert.deepEqual(result,{status:'ok',ready:true,heard:[{phrase:'Nova',confidence:0.91},{phrase:'Hey Nova',confidence:0.72}],input:null,level:{peak:0,silent:false,reports:0}});
});
