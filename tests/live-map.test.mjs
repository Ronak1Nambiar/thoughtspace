import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relateMessages,cleanRelate,cleanSuggestions,readSuggestReply} from '../assist.mjs';
import {parseJsonReply} from '../llm-providers.mjs';
import {addItems,keepItem,removeItem,childrenOf,emptyWorkspace} from '../src/core.js';
import {mapLinks,focusLayout} from '../src/thought-map.js';
import {availableVoices} from '../src/voices.js';
import {startWorkspaceServer} from '../server.mjs';

const card=(id,title,extra={})=>({id,title,source:title,notes:[],history:[],color:'sage',...extra});
const cards=[card('shop','Etsy candle shop'),card('fair','Holiday craft fair'),card('garden','Garden beds')];

test('relate keeps only real ids, at most two, in order',()=>{
  assert.deepEqual(cleanRelate({ids:['fair','made-up','shop','garden']},cards),{ids:['fair','shop']});
  assert.deepEqual(cleanRelate({ids:'shop'},cards),{ids:[]});
  assert.deepEqual(cleanRelate(null,cards),{ids:[]});
  const [system,user]=relateMessages('how do I juggle the shop and the fair',cards,['shop']);
  assert.match(system.content,/untrusted data/);
  assert.deepEqual(JSON.parse(user.content).recent,['shop']);
});

test('suggestions are tied to supplied thoughts, trimmed, deduplicated and capped',()=>{
  const ctx=[{id:'shop',items:['Email the supplier']},{id:'fair',items:[]}];
  const out=cleanSuggestions({suggestions:[
    {cardId:'shop',text:'- Email the supplier'},{cardId:'shop',text:'Order wax and wicks'},{cardId:'shop',text:'order wax and wicks'},
    {cardId:'ghost',text:'Invented'},{cardId:'fair',text:'x'},{cardId:'fair',text:'Block two study evenings'},
    {cardId:'fair',text:'Plan weekends'},{cardId:'fair',text:'Drop one club'},{cardId:'fair',text:'Fifth item'}]},ctx);
  assert.deepEqual(out.map(s=>s.text),['Order wax and wicks','Block two study evenings','Plan weekends','Drop one club']);
});

test('a reply that ignores the JSON format still comes through, without suggestions',()=>{
  assert.deepEqual(readSuggestReply('Sure, start with the supplier.',cards,parseJsonReply),{reply:'Sure, start with the supplier.',suggestions:[]});
  const r=readSuggestReply('{"reply":"Two steps.","suggestions":[{"cardId":"garden","text":"Buy compost"}]}',cards,parseJsonReply);
  assert.equal(r.reply,'Two steps.');assert.deepEqual(r.suggestions,[{cardId:'garden',text:'Buy compost'}]);
  assert.throws(()=>readSuggestReply('{"reply":""}',cards,parseJsonReply),/empty reply/);
});

test('items hang off their parent: suggested until kept, removable with everything under them',()=>{
  let s={...emptyWorkspace(),cards:[...cards]};
  ({state:s}=addItems(s,[{cardId:'shop',text:'Email the supplier'},{cardId:'shop',text:'Email  the supplier'},{cardId:'nope',text:'x'}],{requestId:'r1'}));
  assert.equal(childrenOf(s,'shop').length,1);
  const item=childrenOf(s,'shop')[0];
  assert.equal(item.suggested,true);assert.equal(item.kind,'item');
  ({state:s}=addItems(s,[{cardId:item.id,text:'Draft the email'}],{origin:'manual',requestId:'r2'}));
  const sub=childrenOf(s,item.id)[0];assert.equal(sub.suggested,false);
  // The same request id twice adds nothing new for an index already used (retries are safe).
  assert.equal(addItems(s,[{cardId:'shop',text:'Another'}],{requestId:'r1'}).added.length,0);
  s=keepItem(s,item.id);assert.equal(s.cards.find(c=>c.id===item.id).suggested,false);
  const links=mapLinks(s);
  assert.ok(links.some(l=>l.kind==='item'&&l.ids.includes('shop')&&l.ids.includes(item.id)));
  assert.ok(links.every(l=>l.kind!=='topic'||!l.ids.some(id=>id.startsWith('r'))),'items never create word-overlap links');
  s={...s,connections:[[sub.id,'garden']],mapPositions:{[sub.id]:{x:1,y:1}}};
  s=removeItem(s,item.id);
  assert.equal(s.cards.length,3);assert.deepEqual(s.connections,[]);assert.deepEqual(s.mapPositions,{});
});

test('focus fans items and linked thoughts out around the focused thought and pulls a far second focus close',()=>{
  const cs=[card('a','A'),card('b','B',{parentId:'a'}),card('c','C',{parentId:'a'}),card('d','D',{parentId:'b'}),card('e','E'),card('far','Far'),card('lonely','Lonely')];
  const pos={a:{x:0,y:0},b:{x:9,y:9},c:{x:9,y:9},d:{x:9,y:9},e:{x:4000,y:0},far:{x:5000,y:5000},lonely:{x:7000,y:0}};
  const one=focusLayout(['a'],cs,[{ids:['a','e']}],pos);
  assert.deepEqual([...one.visible].sort(),['a','b','c','d','e']);
  for(const id of ['b','c','e']){const p=one.positions[id];assert.ok(Math.abs((p.x/400)**2+(p.y/190)**2-1)<1e-9,id+' sits on the ellipse');}
  assert.ok(Math.hypot(one.positions.d.x,one.positions.d.y)>Math.hypot(one.positions.b.x,one.positions.b.y),'items of items go further out');
  assert.equal(one.positions.a,undefined,'the focused thought itself stays put');
  const two=focusLayout(['a','far','ghost','lonely'],cs,[],pos);
  assert.deepEqual(two.focus,['a','far']);assert.deepEqual(two.positions.far,{x:520,y:0});
  assert.equal(focusLayout([],cs,[],pos).visible.size,0);
});

test('the voice list offers what this install can use',()=>{
  assert.deepEqual(availableVoices({}).map(v=>v.service),['device']);
  const all=availableVoices({naturalSpeech:true,openaiSpeech:true});
  assert.equal(all.filter(v=>v.service==='groq').length,6);assert.equal(all.filter(v=>v.service==='openai').length,11);
});

test('server: relate, suggestions and OpenAI voices',async t=>{
  const fetchOriginal=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options={})=>{
    url=String(url);if(url.startsWith('http://127.0.0.1:'))return fetchOriginal(url,options);
    const body=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;calls.push({url,body});
    if(url.endsWith('/audio/speech'))return new Response(new Uint8Array([82,73,70,70]),{headers:{'content-type':'audio/wav'}});
    if(url.endsWith('/models'))return Response.json({data:[{id:'gpt-4o-mini'}]});
    const system=body.messages[0].content;
    const content=system.includes('match what the user just said')?'{"ids":["shop","invented"]}':system.includes('"suggestions"')?'{"reply":"Start with access.","suggestions":[{"cardId":"shop","text":"Order wax"}]}':'Plain reply.';
    return Response.json({choices:[{message:{content}}]});
  };
  const server=await startWorkspaceServer({port:0,providerStore:{load:()=>({enabled:true,provider:'openai',keys:{openai:'sk-test-openai'}}),save:()=>{}}});
  t.after(()=>{server.closeAllConnections();server.close();globalThis.fetch=fetchOriginal;});
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.deepEqual(await (await post('relate',{text:'the shop and the fair',cards:cards.map(({id,title})=>({id,title}))})).json(),{ids:['shop']});
  assert.deepEqual(await (await post('relate',{text:'hello',cards:[]})).json(),{ids:[]});
  assert.equal((await post('relate',{text:'',cards:[]})).status,400);
  const d=await (await post('discuss',{prompt:'next?',cards:[{id:'shop',title:'Candle shop',source:'s',notes:[]}],suggest:true})).json();
  assert.deepEqual(d,{reply:'Start with access.',suggestions:[{cardId:'shop',text:'Order wax'}]});
  assert.deepEqual(await (await post('discuss',{prompt:'hi',cards:[]})).json(),{reply:'Plain reply.'});
  const speech=await post('speech',{text:'Hi there.',voice:'nova',service:'openai'});
  assert.equal(speech.status,200);assert.equal(speech.headers.get('content-type'),'audio/wav');
  assert.equal(calls.find(c=>c.url.endsWith('/audio/speech')).body.voice,'nova');
  assert.equal((await post('speech',{text:'Hi',voice:'daniel',service:'openai'})).status,400);
  const health=await (await fetch(base+'health')).json();
  assert.equal(health.voice.openaiSpeech,true);
});
