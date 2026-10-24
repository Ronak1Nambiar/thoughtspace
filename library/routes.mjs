import express from 'express';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {PROVIDERS,providerById,activeProvider,serviceKey,estimateCost,chatWith} from '../llm-providers.mjs';
import {openLibrary} from './store.mjs';
import {LibraryJobs} from './jobs.mjs';
import {MAX_ZIP_BYTES} from './importers/zip.mjs';
import {CONNECTORS} from '../connectors/index.mjs';

export const SYNC_EVERY_MS=6*60*60*1000;
// Without a desktop credential store (dev server, tests) tokens live in memory only and are never written to disk.
export const memoryCredentials=()=>{const saved=new Map();return {load:id=>saved.get(id)||null,save:(id,value)=>{if(value)saved.set(id,value);else saved.delete(id);}};};

const bad=(res,message,status=400)=>res.status(status).json({error:message});
// Local models get smaller chunks so prompt, text and answer fit the default 8k context.
const chunkSize=p=>p.kind==='ollama'?Math.max(4000,Math.min(40000,Number(process.env.LOCAL_CONTEXT||8192)*2)):40000;

// Mounts the Library API. getConfig returns the live provider configuration (keys never leave the server).
export function libraryRoutes({libraryPath,getConfig,allowPathImport=false,chat=chatWith,connectors=CONNECTORS,credentials=memoryCredentials(),openExternal=null,syncEveryMs=SYNC_EVERY_MS}){
  const lib=openLibrary(libraryPath);
  // 'active' is whichever saved model the user switched to; any other id is a service with a saved key.
  const resolve=options=>{const config=getConfig();return !options?.provider||options.provider==='active'?activeProvider(config):providerById(config,options.provider);};
  const jobs=new LibraryJobs(lib,{chatFor:options=>{const p=resolve(options);return (messages,opts)=>chat(p,messages,{...opts,timeout:p.kind==='ollama'?Number(process.env.LOCAL_TIMEOUT||180000)*2:120000});}});
  jobs.resume({launch:true});
  const router=express.Router();
  const choices=()=>{
    const config=getConfig(),chars=lib.pendingText();
    const current=activeProvider(config),entry=(p,active)=>({id:p.id,label:active&&p.profileName?p.profileName:p.label,model:p.model,active,local:p.kind==='ollama',estimate:estimateCost(p,chars)});
    return [entry(current,true),...Object.keys(PROVIDERS).filter(id=>id!==current.id&&PROVIDERS[id].needsKey&&serviceKey(config,id)).map(id=>entry(providerById(config,id),false))];
  };
  router.get('/',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({sources:lib.sources(),...jobs.status(),choices:choices()});});
  router.get('/job',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(jobs.status());});
  router.post('/distill',(req,res)=>{
    const provider=req.body?.provider||'active';
    if(provider!=='active'&&!choices().some(c=>c.id===provider))return bad(res,'Add an API key for that provider in workspace settings first.');
    if(!getConfig().enabled)return bad(res,'AI is turned off. Turn it on in workspace settings; your imported conversations are saved.',503);
    if(!lib.pendingCount())return bad(res,'Everything imported has already been read.');
    try{res.json(jobs.startDistill({provider,maxChars:chunkSize(resolve({provider}))}));}catch(e){bad(res,e.message,e.status||500);}
  });
  router.post('/job/:action',(req,res)=>{
    const action=req.params.action;
    if(action==='pause')jobs.pause();else if(action==='cancel')jobs.cancel();else if(action==='resume')jobs.resume();else return bad(res,'Unknown action.',404);
    res.json(jobs.status());
  });
  router.get('/documents',(req,res)=>res.json({documents:lib.documents({sourceId:req.query.source||null,offset:Math.max(0,Number(req.query.offset)||0)})}));
  router.get('/search',(req,res)=>{const q=String(req.query.q||'');if(q.length>200)return bad(res,'Search for fewer words.');res.json({documents:lib.search(q,{sourceId:req.query.source||null})});});
  router.get('/documents/:id',(req,res)=>{const doc=lib.document(req.params.id);if(!doc)return bad(res,'That conversation is no longer in your Library.',404);res.json(doc);});
  router.delete('/sources/:id',(req,res)=>{try{jobs.busy();}catch(e){return bad(res,e.message,409);}if(!lib.source(req.params.id))return bad(res,'Source not found.',404);lib.removeSource(req.params.id);res.json({sources:lib.sources()});});
  // Live connectors. One account per service; its source row holds the sync cursor, the credential store holds the token.
  const connectorSource=id=>lib.sources().find(s=>s.kind===id)||null;
  const connectorList=()=>Object.values(connectors).map(c=>{const source=connectorSource(c.id);return {id:c.id,label:c.label,auth:c.auth,help:c.tokenHelp||null,available:c.available?c.available():true,unavailableHelp:c.available&&!c.available()?c.unavailableHelp:null,connected:!!credentials.load(c.id),account:source?.label||null,sourceId:source?.id||null,lastSync:source?.last_sync_at||null,documents:source?.documents||0};});
  // After a sync, a local (free) model reads new pages automatically; a cloud model waits for the user because it costs money.
  const afterSync=()=>{const config=getConfig();if(config.enabled&&activeProvider(config).kind==='ollama'&&lib.pendingCount()){try{jobs.startDistill({provider:'active',maxChars:chunkSize(resolve({provider:'active'}))});}catch{}}};
  const sync=id=>{const connector=connectors[id],saved=credentials.load(id),source=connectorSource(id);if(!connector||!saved||!source)throw Object.assign(new Error('Connect this service first.'),{status:400});
    return jobs.startSync({connector,credentials:saved,sourceId:source.id,saveCredentials:value=>credentials.save(id,{...value,account:saved.account}),onDone:afterSync});};
  router.get('/connectors',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({connectors:connectorList()});});
  router.post('/connectors/:id/connect',async(req,res)=>{
    const connector=connectors[req.params.id];if(!connector)return bad(res,'Unknown service.',404);
    try{
      jobs.busy();
      const result=connector.auth==='token'?await connector.verify({token:req.body?.token}):await connector.connect({open:url=>{if(!openExternal)throw Object.assign(new Error('Connecting this service needs the Windows app.'),{status:400});return openExternal(url);}});
      await credentials.save(connector.id,{...result.credentials,account:result.account});
      const source=connectorSource(connector.id);
      if(source)lib.db.prepare('update sources set label=? where id=?').run(result.account.slice(0,200),source.id);else lib.addSource({kind:connector.id,label:result.account});
      sync(connector.id);res.json({connectors:connectorList()});
    }catch(e){bad(res,e.status&&e.status<500?e.message:e.message||'Could not connect. Nothing was changed.',e.status||502);}
  });
  router.post('/connectors/:id/sync',(req,res)=>{try{sync(req.params.id);res.json({connectors:connectorList()});}catch(e){bad(res,e.message,e.status||500);}});
  router.delete('/connectors/:id',async(req,res)=>{
    const connector=connectors[req.params.id];if(!connector)return bad(res,'Unknown service.',404);
    try{jobs.busy();}catch(e){return bad(res,e.message,409);}
    await credentials.save(connector.id,null);
    const source=connectorSource(connector.id);if(source&&req.query.documents==='1')lib.removeSource(source.id);
    res.json({connectors:connectorList(),sources:lib.sources()});
  });
  // Background sync: shortly after launch, then every six hours. Skipped quietly while another job runs.
  const syncAll=async()=>{for(const c of connectorList().filter(c=>c.connected&&c.sourceId).sort((a,b)=>String(a.lastSync).localeCompare(String(b.lastSync)))){if(jobs.running)return;try{sync(c.id);await jobs.running;}catch{return;}}};
  const timers=syncEveryMs?[setTimeout(syncAll,60000),setInterval(syncAll,syncEveryMs)]:[];timers.forEach(t=>t.unref?.());
  router.get('/map',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(lib.mapExport());});
  // Browser (non-desktop) imports: the zip is streamed to a private temp folder, never buffered in memory.
  router.post('/upload',async(req,res)=>{
    const kind=String(req.query.kind||'');if(!['chatgpt','claude'].includes(kind))return bad(res,'Upload a ChatGPT or Claude export zip.');
    try{jobs.busy();}catch(e){return bad(res,e.message,409);}
    const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-import-')),file=path.join(dir,'export.zip');let size=0;
    try{
      await pipeline(req,new Transform({transform(chunk,_e,done){size+=chunk.length;done(size>MAX_ZIP_BYTES?Object.assign(new Error('This export is larger than 2 GB.'),{status:413}):null,chunk);}}),createWriteStream(file));
      const started=await jobs.startImport({kind,path:file,label:String(req.query.name||`${kind} export`).slice(0,200)});
      jobs.running?.finally(()=>rm(dir,{recursive:true,force:true}));
      res.json(started);
    }catch(e){await rm(dir,{recursive:true,force:true});bad(res,e.status?e.message:'The upload was interrupted. Nothing was imported; try again.',e.status||500);}
  });
  if(allowPathImport)router.post('/import',async(req,res)=>{const {kind,path:target}=req.body||{};if(typeof target!=='string'||!path.isAbsolute(target))return bad(res,'Give an absolute path.');try{res.json(await jobs.startImport({kind,path:target}));}catch(e){bad(res,e.message,e.status||500);}});
  return {router,lib,jobs,close(){timers.forEach(t=>clearTimeout(t));jobs.stop();lib.close();}};
}
