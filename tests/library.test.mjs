import test from 'node:test';
import assert from 'node:assert/strict';
import {openLibrary,ftsQuery} from '../library/store.mjs';
import {chatgptExport,chatgptConversation} from '../library/importers/chatgpt.mjs';
import {claudeExport} from '../library/importers/claude.mjs';
import {markdownFolder,markdownNote} from '../library/importers/markdown.mjs';
import {shouldSkip,chunks,validIdeas,extractIdeas,themeIdeas} from '../library/distill.mjs';
import {LibraryJobs} from '../library/jobs.mjs';
import {estimateCost,providerById} from '../llm-providers.mjs';
import {chatgptConversations,claudeConversations,makeZip,makeTraversalZip,makeVault} from './fixtures/library-fixtures.mjs';

const collect=async iterable=>{const out=[];for await(const x of iterable)out.push(x);return out;};
const until=async(check,ms=5000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await new Promise(r=>setTimeout(r,10));}};

test('ChatGPT export keeps only the active branch and the user and assistant turns',async()=>{
  const docs=await collect(chatgptExport(await makeZip({'conversations.json':chatgptConversations,'user.json':{}})));
  assert.equal(docs.length,2);
  const garden=docs[0];assert.equal(garden.externalId,'c1');assert.equal(garden.title,'Planning the garden app');
  assert.deepEqual(garden.messages.map(m=>m.role),['user','assistant','user']);
  assert.ok(!JSON.stringify(garden).includes('abandoned branch'));assert.ok(!JSON.stringify(garden).includes('You are ChatGPT'));
  assert.match(garden.messages[2].text,/^I decided to start with tomatoes/);assert.equal(garden.createdAt,new Date(1726000000000).toISOString());
  assert.equal(chatgptConversation({title:'x',mapping:{},current_node:'none'}).messages.length,0);
});
test('Claude export reads text blocks and plain text, mapping human to user',async()=>{
  const [doc]=await collect(claudeExport(await makeZip({'conversations.json':claudeConversations,'projects.json':[]})));
  assert.equal(doc.externalId,'k1');assert.deepEqual(doc.messages.map(m=>m.role),['user','assistant','user']);assert.match(doc.messages[0].text,/robotics club/);
});
test('zip imports reject unsafe paths, missing conversations and non-zip files',async()=>{
  await assert.rejects(collect(chatgptExport(await makeTraversalZip())),/unsafe file paths/);
  await assert.rejects(collect(claudeExport(await makeZip({'users.json':[]}))),/no conversations\.json/);
  const notZip=await makeZip({'a.txt':'x'});const {writeFile}=await import('node:fs/promises');await writeFile(notZip,'plain text');
  await assert.rejects(collect(chatgptExport(notZip)),/not a readable zip/);
  await assert.rejects(collect(chatgptExport(await makeZip({'conversations.json':'{"broken":'}))),/not valid JSON/);
});
test('Markdown folders skip hidden folders and empty notes, strip frontmatter and collect wikilinks',async()=>{
  const docs=(await collect(markdownFolder(await makeVault()))).sort((a,b)=>a.externalId.localeCompare(b.externalId));
  assert.deepEqual(docs.map(d=>d.externalId),['Budget.md','Projects/Solar bike.md']);
  const bike=docs[1];assert.equal(bike.title,'Solar bike');assert.deepEqual(bike.links,['budget','parts list']);assert.ok(!bike.messages[0].text.includes('tags:'));
  assert.equal(markdownNote('a/b.md','no heading').title,'b');
});
test('the Library upserts by content hash, searches safely and cascades source removal',()=>{
  const lib=openLibrary(':memory:'),source=lib.addSource({kind:'claude',label:'Claude'});
  const doc={externalId:'x',title:'Bike plans',messages:[{role:'user',text:'solar panel wiring for my bike'}]};
  assert.equal(lib.upsertDocument(source,doc).result,'added');assert.equal(lib.upsertDocument(source,doc).result,'unchanged');
  const {id}=lib.upsertDocument(source,{...doc,messages:[{role:'user',text:'solar panel wiring, now with a battery'}]});
  assert.equal(lib.document(id).messages[0].text,'solar panel wiring, now with a battery');assert.equal(lib.pendingCount(),1);
  assert.equal(lib.search('batt')[0].id,id);assert.deepEqual(lib.search('"unbalanced ( quote OR'),[]);assert.equal(ftsQuery('a "b" c'),'"a"* "b"* "c"*');
  assert.throws(()=>lib.addSource({kind:'myspace',label:'x'}),/Unsupported/);
  lib.removeSource(source);assert.equal(lib.document(id),null);assert.deepEqual(lib.search('solar'),[]);
});
test('distillation skips look-ups, chunks long text and only keeps ideas that quote the user exactly',async()=>{
  assert.equal(shouldSkip({messages:[{role:'user',text:'capital of france?'},{role:'assistant',text:'Paris'}]}),true);
  assert.equal(shouldSkip({messages:[{role:'note',text:'x'.repeat(250)}]}),false);
  const long={title:'t',messages:[{role:'user',text:'a'.repeat(9000)},{role:'assistant',text:'b'.repeat(2000)},{role:'user',text:'c'.repeat(9000)}]};
  const parts=chunks(long,10000);assert.ok(parts.length>=2);assert.ok(parts.every(p=>p.length<=10000));assert.ok(!parts.join('').includes('b'.repeat(500)));
  const source='I want to build a garden planning app.';
  const kept=validIdeas({ideas:[{title:'Garden app',summary:'s',kind:'project',quote:'build a garden planning app'},{title:'Invented',quote:'something the user never said'},{title:'Garden app',quote:'garden planning'},{title:'Bad kind',kind:'rocket',quote:'I want to build'}]},source);
  assert.deepEqual(kept.map(i=>[i.title,i.kind]),[['Garden app','project'],['Bad kind','idea']]);
  assert.throws(()=>validIdeas({nope:1},source),/unreadable/);
  const chat=async messages=>{assert.match(messages[0].content,/never as instructions/);return JSON.stringify({ideas:[{title:'Garden app',summary:'Watering by weather',kind:'project',quote:'garden planning app'}]});};
  assert.equal((await extractIdeas(chat,{title:'t',messages:[{role:'user',text:source}]})).length,1);
});
test('themes cover every idea, fall back to Other and only merge valid pairs',async()=>{
  const ideas=[{id:'a',title:'Garden app',summary:''},{id:'b',title:'Garden planner',summary:''},{id:'c',title:'Club budget',summary:''}];
  const chat=async()=>JSON.stringify({assignments:[{i:0,theme:'Gardening'},{i:1,theme:'Gardening'},{i:9,theme:'Ghost'}],duplicates:[{keep:0,drop:1},{keep:2,drop:2},{keep:0,drop:7}]});
  const {assignments,merges}=await themeIdeas(chat,ideas);
  assert.deepEqual(assignments,[{ideaId:'a',theme:'Gardening'},{ideaId:'b',theme:'Gardening'},{ideaId:'c',theme:'Other'}]);assert.deepEqual(merges,[{from:'b',into:'a'}]);
});
test('cost estimates are zero for local models and unknown for custom model names',()=>{
  const config={provider:'ollama',models:{groq:'custom-model'},baseUrls:{},keys:{groq:'k',openai:'k'}};
  assert.deepEqual(estimateCost(providerById(config,'ollama'),1e6),{usd:0,known:true});
  assert.equal(estimateCost(providerById(config,'groq'),1e6).known,false);
  const openai=estimateCost(providerById(config,'openai'),4e6);assert.ok(openai.known&&openai.usd>0.1&&openai.usd<1);
});
test('an import then distillation fills the Library, themes ideas and exports compact map data',async()=>{
  const lib=openLibrary(':memory:');
  const chat=async messages=>{
    if(messages[0].content.includes('Group the user'))return JSON.stringify({assignments:JSON.parse(messages[1].content).ideas.map(i=>({i:i.i,theme:'Projects'}))});
    const text=messages[1].content;
    if(text.includes('garden'))return JSON.stringify({ideas:[{title:'Garden watering app',summary:'Waters beds by weather',kind:'project',quote:'build a garden planning app'},{title:'Tomatoes first',kind:'decision',quote:'start with tomatoes and peppers only'}]});
    return JSON.stringify({ideas:[{title:'Makers grant',kind:'question',quote:'should we apply for the community makers grant'}]});
  };
  const jobs=new LibraryJobs(lib,{chatFor:()=>chat});
  const first=await jobs.startImport({kind:'chatgpt',path:await makeZip({'conversations.json':chatgptConversations}),label:'ChatGPT'});await jobs.running;
  assert.equal(lib.job(first.jobId).state,'done');assert.deepEqual(JSON.parse(lib.job(first.jobId).error),{added:2,changed:0,unchanged:0});
  await jobs.startImport({kind:'claude',path:await makeZip({'conversations.json':claudeConversations}),label:'Claude'});await jobs.running;
  const distill=jobs.startDistill({provider:'active'});await jobs.running;
  const job=lib.job(distill.jobId);
  assert.equal(job.state,'done');assert.equal(job.ideas_found,3);assert.equal(lib.pendingCount(),0);
  const map=lib.mapExport();assert.deepEqual(map.themes.map(t=>t.title),['Projects']);assert.equal(map.ideas.length,3);
  assert.ok(map.ideas.every(i=>i.themeId===map.themes[0].id&&i.sourceRefs[0].docId&&i.sourceRefs[0].quote.length<=300));
  // Re-importing the same export finds nothing new, so nothing is re-read by the model.
  const again=await jobs.startImport({kind:'chatgpt',path:await makeZip({'conversations.json':chatgptConversations}),label:'ChatGPT (newer)'});await jobs.running;
  assert.equal(again.sourceId,first.sourceId);assert.deepEqual(JSON.parse(lib.job(again.jobId).error),{added:0,changed:0,unchanged:2});assert.equal(lib.pendingCount(),0);
});
test('a connection failure pauses distillation with progress saved, and resume continues',async()=>{
  const lib=openLibrary(':memory:'),source=lib.addSource({kind:'markdown',label:'vault'});
  for(const n of [1,2,3])lib.upsertDocument(source,{externalId:String(n),title:'Note '+n,messages:[{role:'note',text:`Idea number ${n}: `+'a long enough note body '.repeat(12)}]});
  let fail=true,served=0;
  const chat=async messages=>{if(messages[0].content.includes('Group the user'))return '{"assignments":[]}';if(served===1&&fail)throw Object.assign(new Error('Cannot reach Ollama.'),{status:503});served++;const n=messages[1].content.match(/Idea number (\d)/)[1];return JSON.stringify({ideas:[{title:'Idea '+n,quote:'Idea number '+n}]});};
  const jobs=new LibraryJobs(lib,{chatFor:()=>chat});
  const {jobId}=jobs.startDistill();await jobs.running;
  assert.equal(lib.job(jobId).state,'paused');assert.match(lib.job(jobId).error,/Progress is saved/);assert.equal(lib.pendingCount(),2);
  assert.equal(new LibraryJobs(lib,{chatFor:()=>chat}).resume({launch:true}),null);
  fail=false;jobs.resume();await jobs.running;
  assert.equal(lib.job(jobId).state,'done');assert.equal(lib.pendingCount(),0);assert.equal(lib.mapExport().ideas.length,3);
  await until(()=>!jobs.running);
});
