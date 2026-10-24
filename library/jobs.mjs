import {chatgptExport} from './importers/chatgpt.mjs';
import {claudeExport} from './importers/claude.mjs';
import {markdownFolder} from './importers/markdown.mjs';
import {shouldSkip,extractIdeas,themeIdeas} from './distill.mjs';

export const IMPORTERS={chatgpt:chatgptExport,claude:claudeExport,markdown:markdownFolder};
export const MAX_DOCUMENTS_PER_SOURCE=100000;
// Connection problems pause the job (retry later); a bad answer about one document only skips that document.
const transient=e=>e.name==='TimeoutError'||e.name==='TypeError'||e.status===503||e.status===429||/busy|rate limited|unreachable|cannot reach/i.test(e.message||'');

// Runs one import or distillation at a time in the background. Progress lives in SQLite, so an interrupted job resumes on the next launch.
export class LibraryJobs{
  constructor(lib,{chatFor,importers=IMPORTERS}){this.lib=lib;this.chatFor=chatFor;this.importers=importers;this.running=null;this.controller=null;}
  // A job may start the next one (sync → distil); only clear `running` if it still points at this job.
  #track(work){const tracked=work.catch(()=>{}).finally(()=>{if(this.running===tracked)this.running=null;});this.running=tracked;return tracked;}
  // The latest job, finished or not, so the UI can report what the last import found.
  status(){const job=this.lib.activeJob()||this.lib.latestJob()||null;return {job,pending:this.lib.pendingCount(),pendingChars:this.lib.pendingText()};}
  busy(){const job=this.lib.activeJob();if(job&&['queued','running'].includes(job.state))throw Object.assign(new Error('Another import is still running. Wait for it to finish or cancel it.'),{status:409});}
  // A second export of the same service updates the existing source, so unchanged conversations are recognised and skipped.
  async startImport({kind,path,label=path,sourceId=null}){
    if(!this.importers[kind])throw Object.assign(new Error('Unsupported import type.'),{status:400});
    this.busy();
    const reuse=sourceId?this.lib.source(sourceId):this.lib.sources().filter(s=>s.kind===kind&&(kind!=='markdown'||s.label===label));
    const source=sourceId?reuse:reuse.length===1?reuse[0]:null;
    const id=source?.id??this.lib.addSource({kind,label});
    const jobId=this.lib.createJob('import',{kind,sourceId:id});
    this.#track(this.#runImport(jobId,id,kind,path));
    return {jobId,sourceId:id};
  }
  async #runImport(jobId,sourceId,kind,path){
    const counts={added:0,changed:0,unchanged:0};let done=0;
    this.lib.updateJob(jobId,{state:'running'});
    try{
      for await(const doc of this.importers[kind](path)){
        if(this.lib.job(jobId).state==='cancelled')return;
        if(++done>MAX_DOCUMENTS_PER_SOURCE)throw Object.assign(new Error('This source has more than 100,000 documents; the first 100,000 were imported.'),{partial:true});
        counts[this.lib.upsertDocument(sourceId,doc).result]++;
        if(done%25===0)this.lib.updateJob(jobId,{done,current_title:doc.title});
      }
      this.lib.touchSource(sourceId);
      this.lib.updateJob(jobId,{state:'done',done,total:done,current_title:null,error:JSON.stringify(counts)});
    }catch(e){this.lib.touchSource(sourceId);this.lib.updateJob(jobId,{state:e.partial?'done':'failed',done,error:e.partial?JSON.stringify({...counts,warning:e.message}):e.message||'Import failed. Nothing was lost; retry with the same file.'});}
  }
  // Live connectors: pull what changed since the saved cursor. onDone runs after a clean sync (used to start local distillation).
  startSync({connector,credentials,sourceId,saveCredentials,onDone=()=>{},options={}}){
    this.busy();
    const jobId=this.lib.createJob('sync',{connector:connector.id,sourceId});
    this.#track(this.#runSync(jobId,{connector,credentials,sourceId,saveCredentials,options}).then(ok=>ok&&onDone()));
    return {jobId};
  }
  async #runSync(jobId,{connector,credentials,sourceId,saveCredentials,options}){
    const counts={added:0,changed:0,unchanged:0,removed:0};let done=0;
    this.lib.updateJob(jobId,{state:'running'});
    try{
      for await(const item of connector.changes({credentials,cursor:this.lib.source(sourceId)?.cursor??null},options)){
        if(this.lib.job(jobId).state==='cancelled')return false;
        if(item.document){counts[this.lib.upsertDocument(sourceId,item.document).result]++;if(++done%10===0)this.lib.updateJob(jobId,{done,current_title:item.document.title});}
        if(item.removed){this.lib.markRemoved(sourceId,item.removed);counts.removed+=item.removed.length;}
        if(item.credentials)await saveCredentials(item.credentials);
        if('cursor' in item)this.lib.touchSource(sourceId,item.cursor);
      }
      this.lib.updateJob(jobId,{state:'done',done,total:done,current_title:null,error:JSON.stringify(counts)});return true;
    }catch(e){this.lib.updateJob(jobId,{state:'failed',done,error:e.message||`${connector.label} sync failed. Your Library is unchanged; try again later.`});return false;}
  }
  startDistill(options={provider:'active'}){
    this.busy();
    const paused=this.lib.activeJob();if(paused?.state==='paused')this.lib.updateJob(paused.id,{state:'cancelled'});
    const jobId=this.lib.createJob('distill',options);this.lib.updateJob(jobId,{total:this.lib.pendingCount()});
    this.#track(this.#runDistill(jobId));return {jobId};
  }
  // On launch only jobs interrupted mid-run continue; a job the user paused waits for them.
  resume({launch=false}={}){
    const job=this.lib.activeJob();if(!job||this.running||(launch&&job.state==='paused'))return null;
    if(job.kind==='import'||job.kind==='sync'){this.lib.updateJob(job.id,{state:'failed',error:job.kind==='sync'?'The app closed during a sync. It will sync again automatically.':'The app closed during import. Import the same file again; finished conversations are kept.'});return null;}
    if(job.state==='paused'||job.state==='running'||job.state==='queued'){this.lib.updateJob(job.id,{state:'running',error:null,total:job.done+this.lib.pendingCount()});this.#track(this.#runDistill(job.id));}
    return job.id;
  }
  pause(){const job=this.lib.activeJob();if(job?.kind==='distill'&&job.state==='running'){this.lib.updateJob(job.id,{state:'paused'});this.controller?.abort();}}
  // Quitting stops work without changing the job's state, so it resumes on the next launch.
  stop(){this.controller?.abort();}
  cancel(){const job=this.lib.activeJob();if(job){this.lib.updateJob(job.id,{state:'cancelled'});this.controller?.abort();}}
  async #runDistill(jobId){
    const job=this.lib.job(jobId),chat=this.chatFor(job.options);let {done,ideas_found:found}=job;
    this.lib.updateJob(jobId,{state:'running'});
    const stopped=()=>['paused','cancelled'].includes(this.lib.job(jobId).state);
    try{
      for(let [id]=this.lib.pending(1);id;[id]=this.lib.pending(1)){
        if(stopped())return;
        const doc=this.lib.document(id);this.lib.updateJob(jobId,{current_title:doc.title});
        if(shouldSkip(doc)){this.lib.finishDocument(id,'skipped');}
        else{
          this.controller=new AbortController();
          try{const ideas=await extractIdeas(chat,doc,{maxChars:job.options.maxChars||16000,signal:this.controller.signal});this.lib.finishDocument(id,'distilled',ideas);found+=ideas.length;}
          catch(e){if(stopped())return;if(transient(e))throw e;this.lib.finishDocument(id,'failed');}
        }
        this.lib.updateJob(jobId,{done:++done,ideas_found:found});
      }
      const unthemed=this.lib.unthemedIdeas();
      if(unthemed.length){this.lib.updateJob(jobId,{current_title:'Grouping ideas into themes'});const {assignments,merges}=await themeIdeas(chat,unthemed,this.lib.themes().map(t=>t.title));this.lib.applyThemes(assignments,merges);}
      this.lib.updateJob(jobId,{state:'done',current_title:null});
    }catch(e){if(!stopped())this.lib.updateJob(jobId,{state:'paused',error:(e.message||'The model stopped responding.')+' Progress is saved; resume when the model is available.'});}
  }
}
