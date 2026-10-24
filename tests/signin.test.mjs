import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loopbackAuthorize} from '../connectors/oauth.mjs';
import {SIGNIN_PROVIDERS,signInSessions} from '../llm-signin.mjs';
import {startWorkspaceServer} from '../server.mjs';

test('OpenRouter-style loopback: callback_url carries the state in its path; other paths and states are refused',async()=>{
  let opened;
  const pending=loopbackAuthorize({authUrl:'https://openrouter.ai/auth',params:{key_label:'ThoughtSpace'},style:'openrouter',open:url=>{opened=new URL(url);},timeoutMs:5000});
  while(!opened)await new Promise(r=>setTimeout(r,10));
  assert.equal(opened.origin+opened.pathname,'https://openrouter.ai/auth');
  assert.equal(opened.searchParams.get('code_challenge_method'),'S256');
  assert.equal(opened.searchParams.get('key_label'),'ThoughtSpace');
  assert.equal(opened.searchParams.get('redirect_uri'),null);
  const callback=new URL(opened.searchParams.get('callback_url'));
  assert.equal(callback.hostname,'localhost');assert.match(callback.pathname,/^\/callback\/[\w-]{20,}$/);
  const local=`http://127.0.0.1:${callback.port}`;
  assert.equal((await fetch(`${local}/callback?code=stolen`)).status,404);
  assert.equal((await fetch(`${local}/callback/wrong-state?code=stolen`)).status,404);
  assert.equal((await fetch(`${local}${callback.pathname}?code=the-code`)).status,200);
  const {code,verifier}=await pending;
  assert.equal(code,'the-code');assert.ok(verifier.length>40);
});

test('OpenRouter sign-in exchanges the code with the PKCE verifier and returns the key',async()=>{
  const calls=[];
  const result=await SIGNIN_PROVIDERS.openrouter.signIn({
    open:()=>{},authorize:async options=>{assert.equal(options.style,'openrouter');return {code:'c1',verifier:'v1'};},
    fetcher:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return Response.json({key:'sk-or-v1-abc'});},
  });
  assert.deepEqual(result,{key:'sk-or-v1-abc'});
  assert.deepEqual(calls,[['https://openrouter.ai/api/v1/auth/keys',{code:'c1',code_verifier:'v1',code_challenge_method:'S256'}]]);
  await assert.rejects(SIGNIN_PROVIDERS.openrouter.signIn({open:()=>{},authorize:async()=>({code:'c',verifier:'v'}),fetcher:async()=>Response.json({error:'bad'},{status:400})}),/did not finish/);
});

test('sign-in routes: start returns the link, wait saves a signed-in model and switches to it; only OpenRouter is offered',async t=>{
  let saved=null;
  const fake={openrouter:{label:'OpenRouter',signIn:async({open})=>{open('https://openrouter.ai/auth?x=1');await new Promise(r=>setTimeout(r,20));return {key:'sk-or-v1-secretkey1234'};}}};
  const fetchOriginal=globalThis.fetch;
  globalThis.fetch=async(url,options)=>String(url).startsWith('http://127.0.0.1:')?fetchOriginal(url,options):Response.json({data:[{id:'openai/gpt-4o-mini'}]});
  const server=await startWorkspaceServer({port:0,signIns:signInSessions({providers:fake}),providerStore:{load:()=>({enabled:true,provider:'ollama'}),save:c=>{saved=c;}}});
  t.after(()=>{server.closeAllConnections();server.close();globalThis.fetch=fetchOriginal;});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const refused=await post('/api/provider/signin',{provider:'anthropic'});
  assert.equal(refused.status,400);assert.match((await refused.json()).error,/only available for OpenRouter/);
  const start=await (await post('/api/provider/signin',{provider:'openrouter'})).json();
  assert.equal(start.authUrl,'https://openrouter.ai/auth?x=1');assert.equal(start.opened,false);
  const response=await post('/api/provider/signin/wait',{id:start.id});const text=await response.text();
  assert.equal(response.status,200);assert.ok(!text.includes('secretkey'),'the key never goes back to the page');
  const data=JSON.parse(text),active=data.profiles.find(p=>p.active);
  assert.equal(active.provider,'openrouter');assert.equal(active.signedIn,true);assert.equal(active.keyHint,'••••1234');
  assert.equal(saved.profileKeys[active.id],'sk-or-v1-secretkey1234');
  assert.equal((await post('/api/provider/signin/wait',{id:'nope'})).status,404);
  // A settings request cannot mark a model as signed in.
  const edited=await (await post('/api/provider',{action:'saveProfile',signedIn:true,profile:{provider:'groq',model:'m',apiKey:'gsk_abcdefgh12345678'},activate:true})).json();
  assert.equal(edited.profiles.find(p=>p.active).signedIn,false);
  // Renaming the signed-in model keeps it signed in; pasting a new key turns it into an ordinary saved model.
  const renamed=await (await post('/api/provider',{action:'saveProfile',profile:{id:active.id,provider:'openrouter',model:active.model,name:'My router'}})).json();
  assert.equal(renamed.profiles.find(p=>p.id===active.id).signedIn,true);
  const rekeyed=await (await post('/api/provider',{action:'saveProfile',profile:{id:active.id,provider:'openrouter',model:active.model,apiKey:'sk-or-v1-pasted00009999'}})).json();
  assert.equal(rekeyed.profiles.find(p=>p.id===active.id).signedIn,false);
});
