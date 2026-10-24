import test from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspaceServer} from '../server.mjs';
test('connection endpoint validates requests and provider IDs, deduplicates links, and preserves failures',async t=>{
  const fetchOriginal=globalThis.fetch,previous={enabled:process.env.AI_ENABLED,key:process.env.GROQ_API_KEY};
  process.env.AI_ENABLED='true';process.env.GROQ_API_KEY='test-only';
  let calls=0,answer={links:[{ids:['a','b'],reason:'One supplies the other'},{ids:['b','a'],reason:'Duplicate'}]};
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://api.groq.com/')){calls++;return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});}
    return fetchOriginal(url,options);
  };
  const server=await startWorkspaceServer({port:0});
  t.after(()=>{server.closeAllConnections();server.close();globalThis.fetch=fetchOriginal;for(const [name,value] of [['AI_ENABLED',previous.enabled],['GROQ_API_KEY',previous.key]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  const request=cards=>fetchOriginal(`http://127.0.0.1:${server.address().port}/api/connections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards})});
  const cards=[{id:'a',title:'Water collection',source:'Collect rainwater'},{id:'b',title:'Vegetables',source:'Grow food'}];
  assert.equal((await request([cards[0],cards[0]])).status,400);assert.equal(calls,0);
  const valid=await request(cards);assert.equal(valid.status,200);assert.equal((await valid.json()).links.length,1);
  answer={links:[{ids:['a','invented'],reason:'Invalid'}]};assert.equal((await request(cards)).status,502);
  answer={links:[{ids:['a','a'],reason:'Self'}]};assert.equal((await request(cards)).status,502);
  answer={links:[]};assert.deepEqual(await (await request(cards)).json(),{links:[]});
});
