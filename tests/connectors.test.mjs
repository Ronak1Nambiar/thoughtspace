import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {notion,blockText,pageTitle} from '../connectors/notion.mjs';
import {gdrive} from '../connectors/gdrive.mjs';
import {loopbackAuthorize} from '../connectors/oauth.mjs';
import {openLibrary} from '../library/store.mjs';
import {LibraryJobs} from '../library/jobs.mjs';
import {libraryRoutes} from '../library/routes.mjs';

const collect=async iterable=>{const out=[];for await(const x of iterable)out.push(x);return out;};
const noWait=async()=>{};
// A tiny fake HTTP API: routes map "METHOD path" (query stripped unless present in the key) to handlers.
const fakeApi=routes=>{const calls=[];const fetcher=async(url,options={})=>{const u=new URL(url),key=`${options.method||'GET'} ${u.pathname}`;calls.push({url:u,options,body:options.body&&typeof options.body==='string'&&options.body.startsWith('{')?JSON.parse(options.body):options.body});const handler=routes[key+u.search]||routes[key];if(!handler)return new Response('{}',{status:404});const out=await handler(calls.at(-1));return out instanceof Response?out:typeof out==='string'?new Response(out):Response.json(out);};return {calls,fetcher};};
const rich=text=>[{plain_text:text}];
const page=(id,edited,title,extra={})=>({id,created_time:'2026-01-01T00:00:00.000Z',last_edited_time:edited,properties:{Name:{type:'title',title:rich(title)}},...extra});

test('Notion blocks become readable text and page titles come from the title property',()=>{
  assert.equal(blockText({type:'heading_2',heading_2:{rich_text:rich('Plan')}}),'## Plan');
  assert.equal(blockText({type:'to_do',to_do:{checked:true,rich_text:rich('Order parts')}}),'[x] Order parts');
  assert.equal(blockText({type:'image',image:{}}),'');
  assert.equal(pageTitle({properties:{}}),'Untitled page');
});
test('Notion token check rejects malformed secrets before any request and reads the workspace name',async()=>{
  const {calls,fetcher}=fakeApi({'GET /v1/users/me':()=>({bot:{workspace_name:'Maya HQ'}})});
  await assert.rejects(notion.verify({token:'hello'},fetcher),/does not look like a Notion/);assert.equal(calls.length,0);
  const result=await notion.verify({token:' ntn_abcdefghijklmnopqrstuvwxyz '},fetcher);
  assert.deepEqual(result,{credentials:{token:'ntn_abcdefghijklmnopqrstuvwxyz'},account:'Maya HQ'});
  assert.equal(calls[0].options.headers.Authorization,'Bearer ntn_abcdefghijklmnopqrstuvwxyz');assert.equal(calls[0].options.headers['Notion-Version'],'2022-06-28');
});
test('Notion sync reads nested blocks, reports trashed pages, retries 429 and stops at the saved cursor',async()=>{
  let limited=false;
  const {calls,fetcher}=fakeApi({
    'POST /v1/search':({body})=>body.start_cursor?{results:[page('p3','2026-03-01T00:00:00.000Z','Old page')],has_more:false}:{results:[page('p1','2026-05-01T00:00:00.000Z','Solar bike'),page('p2','2026-04-01T00:00:00.000Z','Trash',{in_trash:true})],has_more:true,next_cursor:'c2'},
    'GET /v1/blocks/p1/children':()=>{if(!limited){limited=true;return new Response('{}',{status:429,headers:{'retry-after':'1'}});}return {results:[{id:'b1',type:'paragraph',paragraph:{rich_text:rich('Panel on the rear rack.')},has_children:true}],has_more:false};},
    'GET /v1/blocks/b1/children':()=>({results:[{id:'b2',type:'bulleted_list_item',bulleted_list_item:{rich_text:rich('Budget 300 dollars')}}],has_more:false}),
    'GET /v1/blocks/p3/children':()=>({results:[],has_more:false}),
  });
  const items=await collect(notion.changes({credentials:{token:'ntn_x'},cursor:'2026-03-15T00:00:00.000Z'},{fetcher,wait:noWait}));
  assert.deepEqual(items[0].document.messages,[{role:'note',text:'Panel on the rear rack.\n- Budget 300 dollars'}]);assert.equal(items[0].document.title,'Solar bike');
  assert.deepEqual(items[1],{removed:['p2']});assert.deepEqual(items.at(-1),{cursor:'2026-05-01T00:00:00.000Z'});assert.equal(items.length,3);
  assert.ok(!calls.some(c=>c.url.pathname.includes('p3')));
  await assert.rejects(collect(notion.changes({credentials:{token:'bad'}},{fetcher:async()=>new Response('{}',{status:401}),wait:noWait})),/rejected the integration token/);
});
test('the loopback sign-in checks state, returns the code and closes its listener',async()=>{
  let opened;
  const signIn=loopbackAuthorize({authUrl:'https://accounts.example/auth',params:{client_id:'abc',scope:'s'},open:async url=>{opened=new URL(url);}});
  await new Promise(r=>setTimeout(r,50));
  assert.equal(opened.searchParams.get('code_challenge_method'),'S256');assert.equal(opened.searchParams.get('client_id'),'abc');
  const callback=new URL(opened.searchParams.get('redirect_uri'));assert.equal(callback.hostname,'127.0.0.1');
  const wrong=await (await fetch(`${callback}?code=evil&state=forged`)).text();assert.match(wrong,/not the one Thoughtspace opened/);
  await fetch(`${callback}?code=good-code&state=${opened.searchParams.get('state')}`);
  const result=await signIn;assert.equal(result.code,'good-code');assert.ok(result.verifier.length>40);
  await assert.rejects(fetch(callback),/fetch failed/);
  await assert.rejects(loopbackAuthorize({authUrl:'https://a.example/',params:{},open:async()=>{},timeoutMs:30}),/five minutes/);
});
test('Google Drive connects with PKCE, lists Docs and text files, then follows the change feed and refreshes tokens',async()=>{
  const env={THOUGHTSPACE_GOOGLE_CLIENT_ID:'client-1',THOUGHTSPACE_GOOGLE_CLIENT_SECRET:'desktop-secret'};
  assert.equal(gdrive.available({}),false);await assert.rejects(gdrive.connect({open:async()=>{},env:{}}),/Google Cloud OAuth client/);
  let refreshed=0;
  const {calls,fetcher}=fakeApi({
    'POST /token':({body})=>{const form=new URLSearchParams(body);if(form.get('grant_type')==='refresh_token'){refreshed++;return {access_token:'fresh',expires_in:3600};}assert.equal(form.get('code_verifier'),'v');return {access_token:'a1',refresh_token:'r1',expires_in:3600};},
    'GET /drive/v3/about':()=>({user:{emailAddress:'maya@example.com'}}),
    'GET /drive/v3/changes/startPageToken':()=>({startPageToken:'100'}),
    'GET /drive/v3/files':()=>({files:[{id:'d1',name:'Garden plan',mimeType:'application/vnd.google-apps.document',createdTime:'2026-01-01T00:00:00Z',modifiedTime:'2026-02-01T00:00:00Z'},{id:'m1',name:'ideas.md',mimeType:'text/markdown',size:'40'},{id:'big',name:'huge.txt',mimeType:'text/plain',size:String(5*1024*1024)}]}),
    'GET /drive/v3/files/d1/export':()=>'Water the beds when rain is unlikely.',
    'GET /drive/v3/files/m1':()=>'# Ideas\nA solar bike.',
    'GET /drive/v3/changes':()=>({changes:[{fileId:'m1',removed:true},{fileId:'x',file:{id:'x',name:'photo.png',mimeType:'image/png'}},{fileId:'d1',file:{id:'d1',name:'Garden plan',mimeType:'application/vnd.google-apps.document'}}],newStartPageToken:'205'}),
  });
  const connected=await gdrive.connect({open:async()=>{},env,fetcher,authorize:async({params})=>{assert.equal(params.scope,'https://www.googleapis.com/auth/drive.readonly');return {code:'c',verifier:'v',redirectUri:'http://127.0.0.1:1/callback'};}});
  assert.equal(connected.account,'maya@example.com');assert.equal(connected.credentials.refresh_token,'r1');
  const first=await collect(gdrive.changes({credentials:connected.credentials},{fetcher,env}));
  assert.deepEqual(first.filter(i=>i.document).map(i=>i.document.title),['Garden plan','ideas']);assert.equal(first.at(-1).cursor,'100');
  const expired={...connected.credentials,expires_at:0};
  const second=await collect(gdrive.changes({credentials:expired,cursor:'100'},{fetcher,env}));
  assert.deepEqual(second[0],{removed:['m1']});assert.equal(second[1].document.externalId,'d1');assert.equal(second.at(-1).cursor,'205');
  assert.equal(refreshed,1);assert.equal(second.at(-1).credentials.access_token,'fresh');assert.equal(second.at(-1).credentials.refresh_token,'r1');
  assert.ok(calls.filter(c=>c.url.pathname.startsWith('/drive')).every(c=>c.options.headers.Authorization.startsWith('Bearer ')));
});
test('a sync stores new pages, marks removals, saves the cursor and refreshed credentials',async()=>{
  const lib=openLibrary(':memory:'),sourceId=lib.addSource({kind:'notion',label:'HQ'}),saved=[];
  const connector={id:'notion',label:'Notion',async *changes({cursor}){if(!cursor){yield {document:{externalId:'a',title:'A',messages:[{role:'note',text:'alpha '.repeat(60)}]}};yield {document:{externalId:'b',title:'B',messages:[{role:'note',text:'beta '.repeat(60)}]}};yield {cursor:'t1',credentials:{token:'new'}};}else{yield {removed:['a']};yield {cursor:'t2'};}}};
  const jobs=new LibraryJobs(lib,{chatFor:()=>async()=>'{"ideas":[]}'});
  let after=0;jobs.startSync({connector,credentials:{token:'old'},sourceId,saveCredentials:c=>saved.push(c),onDone:()=>after++});await jobs.running;
  assert.equal(lib.source(sourceId).cursor,'t1');assert.deepEqual(saved,[{token:'new'}]);assert.equal(lib.pendingCount(),2);assert.equal(after,1);
  jobs.startSync({connector,credentials:{token:'new'},sourceId,saveCredentials:()=>{}});await jobs.running;
  assert.equal(lib.source(sourceId).cursor,'t2');assert.equal(lib.documents().length,1);assert.equal(JSON.parse(lib.latestJob().error).removed,1);
});
test('connector API: connect with a token, auto-read with a local model, sync, never expose tokens, disconnect',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-connectors-'));
  const fake={id:'notion',label:'Notion',auth:'token',tokenHelp:'help',async verify({token}){if(token!=='ntn_good')throw Object.assign(new Error('Notion rejected the integration token.'),{status:401});return {credentials:{token},account:'Maya HQ'};},
    async *changes(){yield {document:{externalId:'p1',title:'Solar bike',messages:[{role:'note',text:'I am building a solar bike with a panel on the rear rack. '.repeat(6)}]}};yield {cursor:'2026-05-01'};}};
  const chat=async(p,messages)=>messages[0].content.includes('Group the user')?'{"assignments":[{"i":0,"theme":"Bikes"}]}':'{"ideas":[{"title":"Solar bike","kind":"project","quote":"building a solar bike"}]}';
  const credentials=new Map();const store={load:id=>credentials.get(id)||null,save:(id,v)=>v?credentials.set(id,v):credentials.delete(id)};
  const {router,close}=libraryRoutes({libraryPath:path.join(dir,'library.db'),getConfig:()=>({enabled:true,provider:'ollama',models:{},baseUrls:{},keys:{}}),chat,connectors:{notion:fake},credentials:store,syncEveryMs:0});
  const app=express();app.use(express.json());app.use('/api/library',router);
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>{server.close();close();});
  const base=`http://127.0.0.1:${server.address().port}/api/library`,post=(p,body)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
  assert.equal((await post('/connectors/notion/connect',{token:'ntn_bad'})).status,401);assert.equal(credentials.size,0);
  const connected=await (await post('/connectors/notion/connect',{token:'ntn_good'})).json();
  assert.equal(connected.connectors[0].account,'Maya HQ');assert.ok(!JSON.stringify(connected).includes('ntn_good'));
  const end=Date.now()+5000;let map;while(Date.now()<end){map=await (await fetch(base+'/map')).json();if(map.ideas.length)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(map.ideas[0].title,'Solar bike');assert.deepEqual(map.themes.map(t=>t.title),['Bikes']);
  assert.equal((await post('/connectors/gdrive/sync')).status,400);
  const list=await (await fetch(base+'/connectors')).json();assert.equal(list.connectors[0].connected,true);assert.ok(list.connectors[0].lastSync);
  const gone=await (await fetch(base+'/connectors/notion?documents=1',{method:'DELETE'})).json();
  assert.equal(gone.connectors[0].connected,false);assert.deepEqual(gone.sources,[]);assert.equal(credentials.size,0);
});
