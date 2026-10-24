import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../src/core.js';
import {edgeKey,mapLinks,mapLayout,mapSignature} from '../src/thought-map.js';
const card=(id,title,source=title)=>({id,title,source,notes:[],groupId:null});
test('map suggests shared wording, ignores filler and AI notes, and respects dismissed links',()=>{
  const s={...emptyWorkspace(),cards:[card('a','Garden rain water'),card('b','Collect garden water'),card('c','I want to create a project'),{...card('d','I want to build something'),notes:[{kind:'assistant',text:'garden water'}]}]};
  assert.deepEqual(mapLinks(s).map(l=>l.ids),[['a','b']]);
  assert.equal(mapLinks({...s,dismissedMapLinks:[edgeKey('a','b')]}).length,0);
  const confirmed=mapLinks({...s,connections:[['b','a']]});assert.equal(confirmed.length,1);assert.equal(confirmed[0].kind,'manual');
});
test('stale AI suggestions disappear after edits; manual links remain',()=>{
  const s={...emptyWorkspace(),cards:[card('a','Power supply'),card('b','Battery storage')],connections:[['a','b']]};
  s.mapAnalysis={signature:mapSignature(s.cards),links:[{ids:['a','b'],reason:'Related power systems'}]};
  assert.equal(mapLinks({...s,connections:[]})[0].kind,'ai');
  const changed={...s,cards:[card('a','Birthday party'),s.cards[1]]};
  assert.equal(mapLinks({...changed,connections:[]}).length,0);assert.equal(mapLinks(changed)[0].kind,'manual');
});
test('map includes disconnected thoughts and lays out branching graphs without card overlap',()=>{
  const cards=Array.from({length:35},(_,i)=>card(String(i),'Thought '+i));
  const links=cards.slice(1,28).map((c,i)=>({ids:[String(Math.floor(i/4)),c.id]}));
  const layout=mapLayout(cards,links);assert.equal(Object.keys(layout).length,cards.length);
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
    const a=layout[cards[i].id],b=layout[cards[j].id];
    assert.ok(Math.abs(a.x-b.x)>=240||Math.abs(a.y-b.y)>=110,`${i} overlaps ${j}`);
  }
});
