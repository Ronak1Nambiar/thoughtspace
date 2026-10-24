import test from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspaceServer} from '../server.mjs';

test('desktop backend binds a free loopback port and requires its private token',async t=>{
  const previous=process.env.AI_ENABLED;process.env.AI_ENABLED='false';
  t.after(()=>{if(previous===undefined)delete process.env.AI_ENABLED;else process.env.AI_ENABLED=previous;});
  const server=await startWorkspaceServer({port:0,token:'test-private-token',desktopOrigin:'thoughtspace://workspace'});
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.equal(address.address,'127.0.0.1');
  const base='http://127.0.0.1:'+address.port;
  assert.equal((await fetch(base+'/api/health')).status,403);
  const headers={'x-thoughtspace-token':'test-private-token',origin:'thoughtspace://workspace'};
  const health=await (await fetch(base+'/api/health',{headers})).json();assert.equal(health.ready,false);
  assert.equal((await fetch(base+'/',{headers})).status,200);
  assert.equal((await fetch(base+'/.env',{headers})).status,404);
  assert.equal((await fetch(base+'/api/health',{headers:{...headers,origin:'https://untrusted.example'}})).status,403);
});
