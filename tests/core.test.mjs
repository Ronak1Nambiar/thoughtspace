import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,captureText,correctCapture,applyExtraction,addNote,localExtract,localIdea,originalWording,aiSuggestionCount,summaryLabel} from '../src/core.js';
const sample='I need to finish the proposal. I also have an idea for a customer dashboard, and I should prepare questions for Friday’s meeting.';
test('example capture yields three separate locally sourced ideas',()=>{const s=localExtract(captureText(emptyWorkspace(),sample,'a'),'a');assert.equal(s.cards.length,3);assert.deepEqual(s.cards.map(c=>c.title),['Finish the proposal','A customer dashboard','Prepare questions for Friday’s meeting']);assert.equal(s.captures[0].original,sample);s.cards.forEach(c=>assert.ok(sample.includes(c.source)));});
test('same event and processing retry are idempotent; different events are preserved',()=>{let s=captureText(emptyWorkspace(),'One idea','a');s=captureText(s,'One idea','a');assert.equal(s.captures.length,1);s=applyExtraction(s,'a',0,[{title:'One',source:'One idea'},{title:'One again',source:'One idea'}]);assert.equal(s.cards.length,1);s=applyExtraction(s,'a',0,[{title:'Duplicate',source:'One idea'}]);assert.equal(s.cards.length,1);s=localExtract(captureText(s,'One idea','b'),'b');assert.equal(s.cards.length,2);});
test('correction and stale response preserve identities, notes, position and original',()=>{let s=localExtract(captureText(emptyWorkspace(),'A customer dashboard','a'),'a');const id=s.cards[0].id;s.cards[0].position={x:127,y:83};s=addNote(s,[id],'Keep this note');s=correctCapture(s,'a','A client dashboard');const stale=applyExtraction(s,'a',0,[{title:'Old',source:'A customer dashboard'}]);assert.deepEqual(stale,s);s=applyExtraction(s,'a',1,[{title:'Client dashboard',source:'A client dashboard',existingId:id}]);assert.equal(s.cards.length,1);assert.equal(s.cards[0].id,id);assert.equal(s.cards[0].notes[0].text,'Keep this note');assert.deepEqual(s.cards[0].position,{x:127,y:83});assert.equal(s.captures[0].original,'A customer dashboard');assert.equal(s.cards[0].sourceHistory[0],'A customer dashboard');});
test('new capture cannot rearrange existing cards',()=>{let s=localExtract(captureText(emptyWorkspace(),'First','a'),'a');s.cards[0].position={x:303,y:107};s=localExtract(captureText(s,'Second','b'),'b');assert.deepEqual(s.cards[0].position,{x:303,y:107});assert.equal(s.cards[1].position,null);});
test('discussion notes append exactly once only to captured selection',()=>{let s=localExtract(captureText(emptyWorkspace(),'First. Second.','a'),'a');const [a,b]=s.cards;s=addNote(s,[a.id],'New note','assistant','request');s=addNote(s,[a.id],'New note','assistant','request');assert.equal(s.cards[0].notes.length,1);assert.equal(s.cards[1].notes.length,0);assert.equal(s.cards[0].source,a.source);assert.equal(s.cards[1].id,b.id);});

test('original excerpt survives successive re-extractions and older workspace histories',()=>{
  let state=localExtract(captureText(emptyWorkspace(),'A customer dashboard','capture'),'capture');
  const id=state.cards[0].id;
  for(const text of ['A client dashboard','A client onboarding dashboard']){
    state=correctCapture(state,'capture',text);
    state=applyExtraction(state,'capture',state.captures[0].revision,[{title:'Summary',source:text,existingId:id}]);
    assert.equal(originalWording(state.cards[0]),'A customer dashboard');
  }
  assert.equal(state.cards.length,1);assert.equal(state.cards[0].source,'A client onboarding dashboard');
  const legacy={...state.cards[0]};delete legacy.originalSource;
  assert.equal(originalWording(legacy),'A customer dashboard');
  assert.equal(state.captures[0].original,'A customer dashboard');
});

test('AI summaries keep captured origin while generated additions retain assistant authorship',()=>{
  let state=applyExtraction(captureText(emptyWorkspace(),'My dashboard idea','capture'),'capture',0,[{title:'Dashboard',source:'My dashboard idea',origin:'assistant'}]);
  const id=state.cards[0].id;
  assert.equal(state.cards[0].origin,'captured');assert.equal(summaryLabel(state.cards[0]),'AI-assisted summary');
  state=addNote(state,[id],'My requirement','manual','one');
  state=addNote(state,[id],'My spoken addition','spoken','two');
  state=addNote(state,[id],'An AI-generated possibility','assistant','three');
  state=addNote(state,[id],'Repeated callback','assistant','three');
  assert.equal(aiSuggestionCount(state.cards[0]),1);assert.equal(state.cards.length,1);
  assert.equal(state.cards[0].source,'My dashboard idea');
  assert.equal(summaryLabel(localExtract(captureText(emptyWorkspace(),'Local','local'),'local').cards[0]),'Summary from your words');
  assert.equal(summaryLabel(localIdea(captureText(emptyWorkspace(),'Manual','manual'),'manual').cards[0]),'Your summary');
  assert.equal(aiSuggestionCount({notes:[{kind:'assistant'},{kind:'manual'}]}),1);
});

test('imported ideas become themed cards once, keep user edits on re-import and respect the map limit',async()=>{
  const {applyImport,emptyWorkspace}=await import('../src/core.js');
  const data={themes:[{id:'t1',title:'Garden'},{id:'t2',title:'Unused'}],docEdges:[['d1','d2']],ideas:[
    {id:'i1',title:'Garden app',summary:'Waters beds by weather',kind:'project',themeId:'t1',sourceRefs:[{docId:'d1'}]},
    {id:'i2',title:'Soil sensor',summary:'',kind:'question',themeId:'t1',sourceRefs:[{docId:'d2'}]},
    {id:'i3',title:'Tomatoes first',summary:'',kind:'decision',themeId:null,sourceRefs:[{docId:'d3'},{docId:'d4'}]}]};
  let {state,added,remaining}=applyImport(emptyWorkspace(),data,{limit:2});
  assert.equal(added,2);assert.equal(remaining,1);assert.deepEqual(state.cards.map(c=>c.title),['Tomatoes first','Garden app']);
  assert.deepEqual(state.groups,[{id:'theme-t1',name:'Garden',imported:true}]);assert.ok(state.cards.every(c=>c.origin==='imported'&&c.position===null));
  state={...state,cards:state.cards.map(c=>c.title==='Garden app'?{...c,title:'My garden app',position:{x:5,y:5}}:c)};
  const again=applyImport(state,{...data,ideas:data.ideas.map(i=>i.id==='i1'?{...i,sourceRefs:[...i.sourceRefs,{docId:'d9'}]}:i)});
  const garden=again.state.cards.find(c=>c.importId==='i1');
  assert.equal(garden.title,'My garden app');assert.deepEqual(garden.position,{x:5,y:5});assert.deepEqual(garden.sourceRefs.map(r=>r.docId),['d1','d9']);
  assert.equal(again.added,1);assert.equal(again.state.cards.length,3);assert.equal(again.state.groups.length,1);
  assert.deepEqual(again.state.connections,[[garden.id,again.state.cards.find(c=>c.importId==='i2').id]]);
  assert.equal(applyImport(again.state,data).state.connections.length,1);
});
