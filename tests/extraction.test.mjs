import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locateQuote,cleanExtraction,extractMessages} from '../extraction.mjs';

const said='Um, so I need to finish the proposal by Friday. Uh, I also have an idea for a customer dashboard, like, with live sales numbers. And I should prepare questions for the meeting.';

test('exact quotes pass through unchanged',()=>{
  assert.equal(locateQuote(said,'I need to finish the proposal by Friday.'),'I need to finish the proposal by Friday.');
});
test('quotes with changed punctuation, case or dropped filler map back to the user\'s exact words',()=>{
  assert.equal(locateQuote(said,'i need to finish the proposal by friday'),'I need to finish the proposal by Friday');
  assert.equal(locateQuote(said,'I also have an idea for a customer dashboard with live sales numbers'),'I also have an idea for a customer dashboard, like, with live sales numbers');
  assert.equal(locateQuote(said,'I should prepare questions for the meeting'),'I should prepare questions for the meeting');
  assert.equal(locateQuote('I’d like a bike rack.',"I'd like a bike rack"),'I’d like a bike rack');
});
test('quotes the user never said are rejected',()=>{
  assert.equal(locateQuote(said,'Build a rocket to Mars next year'),null);
  assert.equal(locateQuote(said,'the podcast'),null);
  assert.equal(locateQuote(said,'The Proposal!'),'the proposal','short quotes still need every word to be there');
  assert.equal(locateQuote(said,'customer revenue forecasting tool for Friday meetings'),null);
  assert.equal(locateQuote(said,''),null);assert.equal(locateQuote(said,undefined),null);
});
test('one bad idea is dropped instead of failing the whole capture',()=>{
  const out=cleanExtraction({ideas:[
    {title:'Finish proposal',source:'I need to finish the proposal by Friday',engineering:{objective:'o',approach:'a',risk:'r',experiment:'e',question:'q'}},
    {title:'Invented',source:'Launch a podcast about gardening'},
    {title:'Dashboard',source:'idea for a customer dashboard with live sales numbers',existingId:'not-a-card',engineering:{objective:'o'}},
  ]},said,[]);
  assert.equal(out.dropped,1);
  assert.deepEqual(out.ideas.map(i=>i.title),['Finish proposal','Dashboard']);
  assert.equal(out.ideas[0].engineering.approach,'a');
  assert.equal(out.ideas[1].engineering,undefined,'an incomplete proposal is left off, the card still arrives');
  assert.equal(out.ideas[1].existingId,null);
  assert.ok(said.includes(out.ideas[1].source));
});
test('replies with nothing usable explain themselves; an empty list is fine',()=>{
  assert.throws(()=>cleanExtraction({ideas:[{title:'x',source:'never said this at all ever'}]},said),/did not match what you said/);
  assert.throws(()=>cleanExtraction({cards:[]},said),/unexpected format/);
  assert.deepEqual(cleanExtraction({ideas:[]},said),{ideas:[],dropped:0});
  assert.equal(cleanExtraction([{title:'Questions',source:'prepare questions for the meeting'}],said).ideas.length,1,'a bare array is accepted');
});
test('existing cards are reused only when real, and junk entries are ignored',()=>{
  const existing=[{id:'c1',title:'Proposal',source:'finish the proposal'},null,'junk',{title:'no id'}];
  const out=cleanExtraction({ideas:[{title:'Proposal',source:'finish the proposal by Friday',existingId:'c1'}]},said,existing);
  assert.equal(out.ideas[0].existingId,'c1');
  const payload=JSON.parse(extractMessages(said,existing)[1].content);
  assert.deepEqual(payload.existing,[{id:'c1',title:'Proposal',source:'finish the proposal'}]);
});
test('duplicates collapse and long fields are trimmed, not rejected',()=>{
  const out=cleanExtraction({ideas:[{title:'A'.repeat(500),source:'I should prepare questions for the meeting'},{title:'Same',source:'i should prepare questions for the meeting.'}]},said);
  assert.equal(out.ideas.length,1);assert.equal(out.ideas[0].title.length,160);
});
