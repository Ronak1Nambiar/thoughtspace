import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {recordOpen,usageNumbers,usageLines,feedbackText,FEEDBACK_QUESTIONS} from '../src/usage.js';
import {cardsForAI} from '../src/thought-map.js';
import {validIdeas} from '../library/distill.mjs';

const require=createRequire(import.meta.url);
const {Backups}=require('../desktop/backups.cjs');
const {DEFAULTS,normalizePrefs,loadPrefs,savePrefs,startedHidden}=require('../desktop/desktop-prefs.cjs');
const workspace=(cards=1)=>JSON.stringify({version:1,cards:Array.from({length:cards},(_,i)=>({id:'c'+i,title:'t'+i,notes:[]})),captures:[]});
const at=iso=>new Date(iso);

test('backups: one a day, skip unchanged and unreadable, keep the newest 14',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'ts-backups-'));
  try{
    const b=new Backups({folder,keep:14});
    assert.equal(b.save('not json',{now:at('2031-10-01T10:00:00Z')}).why,'unreadable');
    assert.equal(b.save(JSON.stringify({version:2,cards:[],captures:[]})).why,'unreadable');
    assert.equal(b.save(workspace(1),{now:at('2031-10-01T10:00:00Z')}).saved,true);
    assert.equal(b.save(workspace(2),{now:at('2031-10-01T12:00:00Z')}).why,'today');
    assert.equal(b.save(workspace(1),{reason:'quit',now:at('2031-10-01T13:00:00Z')}).why,'unchanged');
    assert.equal(b.save(workspace(2),{reason:'quit',now:at('2031-10-01T14:00:00Z')}).saved,true);
    for(let d=2;d<=20;d++)b.save(workspace(d+2),{now:at(`2031-10-${String(d).padStart(2,'0')}T09:00:00Z`)});
    const list=b.list();
    assert.equal(list.length,14);
    assert.equal(list[0].date,'2031-10-20T09:00:00Z');assert.equal(list[0].cards,22);
    assert.ok(!readdirSync(folder).some(n=>n.endsWith('.tmp')));
    assert.equal(JSON.parse(b.read(list[0].name)).cards.length,22);
    assert.throws(()=>b.read('../provider-config.json'),/not available/);
    assert.throws(()=>b.read('workspace-2031-10-01T10-00-00Z.json'),/not available/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('backups: a missing folder lists nothing and a damaged snapshot shows as unreadable',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'ts-backups-'));
  try{
    assert.deepEqual(new Backups({folder:path.join(folder,'none')}).list(),[]);
    writeFileSync(path.join(folder,'workspace-2031-10-05T08-00-00Z.json'),'{broken');
    writeFileSync(path.join(folder,'notes.txt'),'ignored');
    const [only,...rest]=new Backups({folder}).list();
    assert.equal(rest.length,0);assert.equal(only.cards,null);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('desktop prefs: defaults, booleans only, unreadable file falls back, --hidden start',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'ts-prefs-')),file=path.join(folder,'desktop-prefs.json');
  try{
    assert.deepEqual(loadPrefs(file),{...DEFAULTS});
    assert.deepEqual(normalizePrefs({closeToTray:'yes',openAtLogin:true,extra:1}),{closeToTray:true,openAtLogin:true,quickCapture:true});
    assert.deepEqual(savePrefs(file,{closeToTray:false}),{closeToTray:false,openAtLogin:false,quickCapture:true});
    assert.equal(loadPrefs(file).closeToTray,false);
    writeFileSync(file,'{oops');assert.deepEqual(loadPrefs(file),{...DEFAULTS});
    assert.equal(startedHidden(['electron.exe','--hidden']),true);assert.equal(startedHidden(['electron.exe']),false);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('usage numbers come from this device only and land in the editable feedback text',()=>{
  let usage={days:[]};
  usage=recordOpen(usage,at('2031-10-01T09:00:00Z'));
  assert.equal(recordOpen(usage,at('2031-10-01T22:00:00Z')),usage);
  usage=recordOpen(usage,at('2031-10-09T09:00:00Z'));
  const state={cards:[{id:'a'},{id:'b',origin:'imported'},{id:'i',kind:'item',suggested:false},{id:'j',kind:'item',suggested:true}],messages:[{role:'user'},{role:'assistant'}]};
  const n=usageNumbers(usage,state,{ready:true,provider:'Groq'},at('2031-10-09T10:00:00Z'));
  assert.deepEqual(n,{daysOpened:2,daysSinceFirstOpen:8,returnedAfterWeekOne:true,thoughts:1,keptItems:1,importedIdeas:1,conversations:1,modelConnected:true,provider:'Groq'});
  assert.match(usageLines(n)[0],/came back after week one/);
  const text=feedbackText(n,'Thoughtspace 1.12.0');
  assert.equal(FEEDBACK_QUESTIONS.length,5);
  for(const q of FEEDBACK_QUESTIONS)assert.ok(text.includes(q));
  assert.match(text,/Model connected: yes · provider: Groq/);assert.match(text,/Thoughtspace 1\.12\.0$/);
  assert.equal(usageNumbers({days:[]},null,null).provider,'none');
});

test('AI routes get at most 200 cards: selection first, then the newest thoughts, items last',()=>{
  const small=[{id:'a'},{id:'b',parentId:'a'}];
  assert.equal(cardsForAI(small),small);
  const cards=[...Array.from({length:250},(_,i)=>({id:'t'+i})),...Array.from({length:30},(_,i)=>({id:'i'+i,parentId:'t0'}))];
  const sent=cardsForAI(cards,['t3','i5']);
  assert.equal(sent.length,200);
  assert.deepEqual(sent.slice(0,2).map(c=>c.id),['t3','i5']);
  assert.ok(sent.some(c=>c.id==='t249'));assert.ok(!sent.some(c=>c.id==='t10'));
  assert.ok(!sent.slice(2).some(c=>c.parentId));
  assert.equal(new Set(sent.map(c=>c.id)).size,200);
  assert.equal(cardsForAI(cards,cards.map(c=>c.id)).length,200);
});

test('imported ideas keep near-miss quotes in the user\'s exact words, like live capture',()=>{
  const source='So um I want to build a garden planning app, one that waters by the weather.';
  const kept=validIdeas({ideas:[{title:'Garden app',quote:'I want to build a garden-planning app that waters by the weather'},{title:'Invented',quote:'a rocket company on the moon by next year'}]},source);
  assert.deepEqual(kept.map(i=>i.title),['Garden app']);
  assert.ok(source.includes(kept[0].quote));
  const huge='x '.repeat(60000)+source;
  assert.equal(validIdeas({ideas:[{title:'Garden app',quote:'I want to build a garden-planning app'}]},huge).length,0);
  assert.equal(validIdeas({ideas:[{title:'Garden app',quote:'I want to build a garden planning app'}]},huge).length,1);
});
