import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile,mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {libraryRoutes} from '../library/routes.mjs';
import {startWorkspaceServer} from '../server.mjs';
import {chatgptConversations,makeZip} from './fixtures/library-fixtures.mjs';

const settle=async(base,ms=5000)=>{const end=Date.now()+ms;for(;;){const s=await (await fetch(base+'/job')).json();if(!s.job||['done','failed','paused','cancelled'].includes(s.job.state))return s;if(Date.now()>end)throw new Error('job did not finish');await new Promise(r=>setTimeout(r,20));}};

test('Library API: upload, estimate, distil, browse, search, map export and removal',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-api-'));let config={enabled:true,provider:'ollama',models:{},baseUrls:{},keys:{openai:'sk-secret-value-1234'}};
  const chat=async(p,messages)=>{assert.equal(p.id,'ollama');if(messages[0].content.includes('Group the user'))return '{"assignments":[{"i":0,"theme":"Garden"}]}';return messages[1].content.includes('garden')?'{"ideas":[{"title":"Garden app","kind":"project","quote":"build a garden planning app"}]}':'{"ideas":[]}';};
  const {router,lib}=libraryRoutes({libraryPath:path.join(dir,'library.db'),getConfig:()=>config,chat});
  const app=express();app.use(express.json());app.use('/api/library',router);
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>{server.close();lib.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/library`;
  assert.equal((await fetch(base+'/upload?kind=pdf',{method:'POST',body:'x'})).status,400);
  const upload=await (await fetch(base+'/upload?kind=chatgpt&name=my%20export.zip',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await readFile(await makeZip({'conversations.json':chatgptConversations}))})).json();
  assert.ok(upload.jobId);assert.equal((await settle(base)).job.state,'done');
  const overview=await (await fetch(base)).json();
  assert.equal(overview.sources[0].label,'my export.zip');assert.equal(overview.pending,2);assert.ok(!JSON.stringify(overview).includes('sk-secret'));
  assert.deepEqual(overview.choices.map(c=>[c.id,c.estimate.usd]),[['ollama',0],['openai',overview.choices[1].estimate.usd]]);
  assert.equal((await fetch(base+'/distill',{method:'POST',headers:{'content-type':'application/json'},body:'{"provider":"anthropic"}'})).status,400);
  assert.equal((await fetch(base+'/distill',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,200);await settle(base);
  const map=await (await fetch(base+'/map')).json();assert.deepEqual(map.themes.map(t=>t.title),['Garden']);assert.equal(map.ideas[0].title,'Garden app');
  const docId=map.ideas[0].sourceRefs[0].docId,doc=await (await fetch(base+'/documents/'+docId)).json();
  assert.equal(doc.title,'Planning the garden app');assert.equal(doc.ideas[0].title,'Garden app');
  assert.equal((await (await fetch(base+'/search?q=tomatoes')).json()).documents[0].id,docId);
  assert.equal((await (await fetch(base+'/documents')).json()).documents.length,2);
  assert.equal((await fetch(base+'/documents/nope')).status,404);
  assert.deepEqual((await (await fetch(base+'/sources/'+overview.sources[0].id,{method:'DELETE'})).json()).sources,[]);
  assert.equal((await (await fetch(base+'/map')).json()).ideas.length,0);
});
test('the workspace server only exposes the Library when given a database path',async t=>{
  const plain=await startWorkspaceServer({port:0});t.after(()=>{plain.closeAllConnections();plain.close();});
  assert.equal((await fetch(`http://127.0.0.1:${plain.address().port}/api/library`)).status,404);
  const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-api-'));
  const withLibrary=await startWorkspaceServer({port:0,libraryPath:path.join(dir,'library.db')});t.after(()=>{withLibrary.closeAllConnections();withLibrary.close();});
  const body=await (await fetch(`http://127.0.0.1:${withLibrary.address().port}/api/library`)).json();assert.deepEqual(body.sources,[]);
  assert.equal((await fetch(`http://127.0.0.1:${withLibrary.address().port}/api/library/import`,{method:'POST'})).status,404);
});
