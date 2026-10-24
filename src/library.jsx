import React,{useEffect,useRef,useState} from 'react';
import {X,Upload,FolderOpen,Search,ArrowLeft,LoaderCircle,Pause,Play,Trash2,Sparkles,MessageSquare,FileText,RefreshCw,Link2} from 'lucide-react';
import './library.css';

const api=async(path,options)=>{const response=await fetch('/api/library'+path,options);const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'The Library is unavailable. Your workspace is safe.');return data;};
export const SOURCE_LABELS={chatgpt:'ChatGPT',claude:'Claude',markdown:'Notes',notion:'Notion',gdrive:'Google Drive'};
const HOW_TO={chatgpt:'In ChatGPT: Settings → Data controls → Export data. OpenAI emails you a zip.',claude:'In Claude: Settings → Privacy → Export data. Anthropic emails you a zip.',markdown:'Choose an Obsidian vault or any folder of .md notes. Hidden folders are skipped.'};
const speaker={user:'You',note:'Note',assistant:'Assistant'};
const when=value=>value?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
const money=estimate=>!estimate.known?'cost unknown for this model':estimate.usd===0?'free':estimate.usd<0.01?'under $0.01':`about $${estimate.usd.toFixed(2)}`;
// Quotes are highlighted by splitting plain text; conversation content is never rendered as HTML.
function Highlighted({text,quotes}){
  const hit=quotes.find(q=>q&&text.includes(q));if(!hit)return <p>{text}</p>;
  const at=text.indexOf(hit);return <p>{text.slice(0,at)}<mark>{hit}</mark>{text.slice(at+hit.length)}</p>;
}

export function Library({onClose,onApply,openDoc,onOpenDoc,cards,onSelectCard}){
  const [connectors,setConnectors]=useState([]),[tokens,setTokens]=useState({}),[connecting,setConnecting]=useState(''),[confirming,setConfirming]=useState(null),[overview,setOverview]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[results,setResults]=useState(null),[doc,setDoc]=useState(null),[choice,setChoice]=useState('active'),[filter,setFilter]=useState('');
  const upload=useRef(null),uploadKind=useRef('chatgpt');
  const desktop=window.thoughtspaceDesktop;
  const refresh=()=>{api('/connectors').then(r=>setConnectors(r.connectors)).catch(()=>{});return api('').then(data=>{setOverview(data);setError('');return data;}).catch(e=>setError(e.message));};
  useEffect(()=>{refresh();},[]);
  // Poll while something is running; when a distillation finishes, its ideas go onto the map.
  useEffect(()=>{
    const job=overview?.job;if(!job||!['queued','running'].includes(job.state))return;
    const timer=setTimeout(async()=>{const data=await refresh();const next=data?.job;if(job.kind==='distill'&&(!next||next.id!==job.id||next.state==='done'))onApply(await api('/map'));},2000);
    return ()=>clearTimeout(timer);
  },[overview]);
  useEffect(()=>{if(!query.trim()){setResults(null);return;}const timer=setTimeout(()=>api(`/search?q=${encodeURIComponent(query)}${filter?'&source='+filter:''}`).then(r=>setResults(r.documents)).catch(e=>setError(e.message)),250);return ()=>clearTimeout(timer);},[query,filter]);
  useEffect(()=>{if(!openDoc){setDoc(null);return;}api('/documents/'+openDoc.docId).then(setDoc).catch(e=>{setError(e.message);onOpenDoc(null);});},[openDoc?.docId]);
  // Reload the list when sources change or a job finishes (an import can end after its source row first appears).
  useEffect(()=>{if(!query.trim())api(`/documents${filter?'?source='+filter:''}`).then(r=>setResults(r.documents)).catch(()=>{});},[filter,overview?.sources?.length,overview?.job?.id,overview?.job?.state]);

  async function start(kind){
    setError('');
    if(desktop?.pickImport){const result=await desktop.pickImport(kind);if(result?.error)setError(result.error);refresh();return;}
    if(kind==='markdown'){setError('Notes folders can be imported in the Windows app.');return;}
    uploadKind.current=kind;upload.current.value='';upload.current.click();
  }
  async function uploaded(file){if(!file)return;try{await api(`/upload?kind=${uploadKind.current}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});refresh();}catch(e){setError(e.message);}}
  const act=(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(refresh).catch(e=>setError(e.message));
  // Two-step removal instead of a blocking browser dialog. Cards already on the map stay.
  // Tokens go to the local server once and are never shown again; Google sign-in opens in the system browser.
  async function connect(c){setError('');setConnecting(c.id);try{const r=await api(`/connectors/${c.id}/connect`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c.auth==='token'?{token:tokens[c.id]||''}:{})});setConnectors(r.connectors);setTokens(t=>({...t,[c.id]:''}));refresh();}catch(e){setError(e.message);}finally{setConnecting('');}}
  async function disconnect(c){if(confirming!=='connector-'+c.id){setConfirming('connector-'+c.id);return;}setConfirming(null);try{const r=await api(`/connectors/${c.id}?documents=1`,{method:'DELETE'});setConnectors(r.connectors);refresh();}catch(e){setError(e.message);}}
  async function remove(source){if(confirming!==source.id){setConfirming(source.id);return;}setConfirming(null);try{await api('/sources/'+source.id,{method:'DELETE'});refresh();}catch(e){setError(e.message);}}

  const job=overview?.job,running=job&&['queued','running'].includes(job.state),chosen=overview?.choices?.find(c=>choice==='active'?c.active:c.id===choice);
  const counts=job?.kind==='import'&&job.state==='done'&&job.error?JSON.parse(job.error):null;
  const quotes=doc?(openDoc?.quote?[openDoc.quote]:[]).concat(doc.ideas.map(i=>i.quote)):[];
  return <div className="modal-backdrop"><section className="modal library" role="dialog" aria-modal="true" aria-label="Your Library">
    <button className="modal-close" aria-label="Close Library" onClick={onClose}><X size={20}/></button>
    <input ref={upload} type="file" accept=".zip,application/zip" hidden onChange={e=>uploaded(e.target.files[0])} data-testid="library-upload"/>
    {doc?<div className="library-reader">
      <button className="library-back" onClick={()=>onOpenDoc(null)}><ArrowLeft size={15}/> Library</button>
      <span className="eyebrow">{SOURCE_LABELS[doc.source_kind]} · {when(doc.updated_at||doc.created_at)}</span><h2>{doc.title}</h2>
      {doc.ideas.length>0&&<div className="library-doc-ideas"><strong>Ideas from this {doc.source_kind==='markdown'?'note':'conversation'}</strong>{doc.ideas.map(i=>{const card=cards.find(c=>c.importId===i.id);return <button key={i.id} disabled={!card} title={card?'Show on map':'Not on your map yet'} onClick={()=>{onSelectCard(card.id);onClose();}}>{i.title}</button>;})}</div>}
      <div className="library-messages">{doc.messages.map((m,n)=><div key={n} className={`library-message ${m.role}`}><span>{m.role==='assistant'?SOURCE_LABELS[doc.source_kind]||'Assistant':speaker[m.role]}</span><Highlighted text={m.text} quotes={m.role==='assistant'?[]:quotes}/></div>)}</div>
    </div>:<>
      <span className="eyebrow">YOUR LIBRARY</span><h2>Bring in what you have already thought through.</h2>
      <p>ChatGPT and Claude do not let apps read your chat history directly, so you import the export file each service emails you. Everything stays on this computer.</p>
      {error&&<div role="alert" className="banner error">{error}</div>}
      <div className="library-add">{['chatgpt','claude','markdown'].map(kind=><div key={kind}><button disabled={running} onClick={()=>start(kind)}>{kind==='markdown'?<FolderOpen size={16}/>:<Upload size={16}/>} Add {kind==='markdown'?'notes folder':SOURCE_LABELS[kind]+' export'}</button><small>{HOW_TO[kind]}</small></div>)}</div>
      {job&&['queued','running','paused','failed'].includes(job.state)&&<div className={`library-job ${job.state}`} role="status" aria-live="polite">
        {running&&<LoaderCircle size={16} className="spin"/>}
        <div><strong>{job.kind==='import'?'Importing':job.kind==='sync'?`Syncing ${SOURCE_LABELS[job.options?.connector]||''}`:job.state==='paused'?'Paused':'Reading your conversations'}</strong>
        <span>{job.kind==='sync'?`${job.done} pages checked`:job.kind==='import'?`${job.done} conversations read`:`${job.done} of ${job.total} · ${job.ideas_found} ideas found`}{job.current_title?` · ${job.current_title}`:''}</span>
        {job.state==='paused'&&job.error&&<span className="error">{job.error}</span>}{job.state==='failed'&&<span className="error">{job.error}</span>}</div>
        {job.kind==='distill'&&job.state==='running'&&<button onClick={()=>act('/job/pause')}><Pause size={14}/> Pause</button>}
        {job.state==='paused'&&<button onClick={()=>act('/job/resume')}><Play size={14}/> Resume</button>}
        {(running||job.state==='paused')&&<button onClick={()=>act('/job/cancel')}>Cancel</button>}
      </div>}
      {counts&&<p className="helper">Last import: {counts.added} new, {counts.changed} updated, {counts.unchanged} unchanged.{counts.warning?' '+counts.warning:''}</p>}
      {connectors.length>0&&<div className="library-connectors"><h3><Link2 size={14}/> Live connections</h3><p className="helper">These stay in sync by themselves (on launch and every six hours). New pages are read automatically when you think with a model on this computer.</p>
        {connectors.map(c=><div key={c.id} className="library-connector" data-testid={`connector-${c.id}`}>
          <strong>{c.label}</strong>
          {c.connected?<><span>{c.account} · {c.documents} items{c.lastSync?' · synced '+when(c.lastSync):''}</span><button disabled={running} onClick={()=>act(`/connectors/${c.id}/sync`)}><RefreshCw size={13}/> Sync now</button><button className={confirming==='connector-'+c.id?'confirm':''} disabled={running} onClick={()=>disconnect(c)}>{confirming==='connector-'+c.id?'Disconnect and remove its items?':'Disconnect'}</button></>
          :c.auth==='token'?<><input type="password" autoComplete="off" aria-label={`${c.label} integration secret`} placeholder="Paste integration secret" value={tokens[c.id]||''} onChange={e=>setTokens(t=>({...t,[c.id]:e.target.value}))}/><button disabled={!tokens[c.id]||connecting===c.id||running} onClick={()=>connect(c)}>{connecting===c.id?'Connecting…':'Connect'}</button><small>{c.help}</small></>
          :c.available?<><span>Sign in with {c.label} in your browser. Read-only.</span><button disabled={connecting===c.id||running} onClick={()=>connect(c)}>{connecting===c.id?'Waiting for your browser…':'Connect'}</button></>
          :<small>{c.unavailableHelp}</small>}
        </div>)}</div>}
      {job?.kind==='sync'&&job.state==='done'&&job.error&&(()=>{const n=JSON.parse(job.error);return <p className="helper">Last sync: {n.added} new, {n.changed} updated, {n.removed} removed.</p>;})()}
      {job?.kind==='distill'&&job.state==='done'&&<p className="helper">Last reading: {job.done} items, {job.ideas_found} ideas found and placed on your map by theme.</p>}
      {overview?.pending>0&&!running&&job?.state!=='paused'&&<div className="library-distill">
        <div><strong><Sparkles size={15}/> {overview.pending} {overview.pending===1?'item':'items'} ready to turn into ideas</strong>
        <span>{chosen?.local?'Runs on this computer. Private and free, but a large history can take hours; you can pause and keep working.':'Sends these conversations to '+(chosen?.label||'the provider')+'. Much faster.'} Estimate: {chosen?money(chosen.estimate):'n/a'}.</span></div>
        <select aria-label="Model for reading conversations" value={choice} onChange={e=>setChoice(e.target.value)}>{overview.choices.map(c=><option key={c.id} value={c.active?'active':c.id}>{c.active?'Current model: ':'Speed up with '}{c.label} ({c.model}){c.local?' · on this computer':''}</option>)}</select>
        <button onClick={()=>act('/distill',{provider:choice})}>Find my ideas</button>
      </div>}
      {overview?.sources?.length>0&&<div className="library-sources">{overview.sources.map(s=><div key={s.id}><strong>{SOURCE_LABELS[s.kind]}</strong><span>{s.label} · {s.documents} items · {s.distilled||0} read{s.last_sync_at?' · updated '+when(s.last_sync_at):''}</span><button aria-label={confirming===s.id?`Confirm removing ${s.label}`:`Remove ${s.label}`} className={confirming===s.id?'confirm':''} disabled={running} onClick={()=>remove(s)}><Trash2 size={14}/>{confirming===s.id?' Remove? Map cards stay':''}</button></div>)}</div>}
      {overview?.sources?.length>0&&<div className="library-browse">
        <div className="library-search"><Search size={15}/><input aria-label="Search your Library" placeholder="Search every conversation and note…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter by source" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All sources</option>{overview.sources.map(s=><option key={s.id} value={s.id}>{SOURCE_LABELS[s.kind]} · {s.label}</option>)}</select></div>
        <div className="library-results">{(results||[]).map(d=><button key={d.id} data-testid="library-document" onClick={()=>onOpenDoc({docId:d.id})}>{d.source_kind==='markdown'?<FileText size={14}/>:<MessageSquare size={14}/>}<span><strong>{d.title}</strong>{d.snippet&&<small>{d.snippet}</small>}</span><em>{when(d.updated_at||d.created_at)}</em></button>)}{results&&!results.length&&<p className="helper">{query?'Nothing matches that search.':'Nothing here yet.'}</p>}</div>
      </div>}
    </>}
  </section></div>;
}
