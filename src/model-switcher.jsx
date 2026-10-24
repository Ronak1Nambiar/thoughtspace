import React,{useEffect,useRef,useState} from 'react';
import {ChevronDown,Check,Plus,Settings,X,LoaderCircle,LogIn} from 'lucide-react';
import './model-switcher.css';

// Saved models: the header pill switches instantly; the form adds or edits one. Keys go to the local service and never come back.
const send=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Model settings could not be saved. Your previous model is unchanged.');return data;};
export const loadModels=async()=>{const response=await fetch('/api/provider');if(!response.ok)throw new Error('Model settings are unavailable. Saved work remains available.');return response.json();};
export const saveModels=body=>send('/api/provider',body);
const service=p=>(p.providerLabel||'').split(' (')[0];

// Sign in with OpenRouter: the local service starts the sign-in and waits for it; the browser tab is where the user approves.
// A blank tab is opened during the click so pop-up blockers allow it; the desktop app opens the system browser instead.
export async function signInWithOpenRouter(){
  const tab=globalThis.window?.thoughtspaceDesktop?null:window.open('about:blank','_blank');
  try{
    const start=await send('/api/provider/signin',{provider:'openrouter'});
    if(!start.opened){if(tab)tab.location.href=start.authUrl;else window.open(start.authUrl,'_blank','noopener');}
    else tab?.close();
    return await send('/api/provider/signin/wait',{id:start.id});
  }catch(e){tab?.close();throw e;}
}
export function SignInButton({onSaved,onError,className='primary'}){
  const [busy,setBusy]=useState(false);
  async function go(){setBusy(true);try{onSaved(await signInWithOpenRouter());}catch(e){onError?.(e.message);}finally{setBusy(false);}}
  return <button className={className} disabled={busy} onClick={()=>void go()}>{busy?<><LoaderCircle size={14} className="spin"/> Waiting for you to approve in the browser…</>:<><LogIn size={14}/> Sign in with OpenRouter</>}</button>;
}

export function ModelForm({config,initial=null,provider=null,onClose,onSaved}){
  const first=initial?{...initial,apiKey:''}:{name:'',provider:provider||config.providers.find(p=>p.id===config.provider)?.id||'ollama',model:'',baseUrl:'',apiKey:''};
  const [draft,setDraft]=useState(first),[status,setStatus]=useState(null),[busy,setBusy]=useState(false),[available,setAvailable]=useState([]);
  const spec=config.providers.find(p=>p.id===draft.provider)||config.providers[0];
  const usesAddress=spec.baseUrl!==null,usesKey=spec.id!=='ollama';
  const profile=()=>({...(initial?{id:initial.id}:{}),name:draft.name,provider:draft.provider,model:draft.model.trim()||spec.defaultModel||'',...(usesAddress?{baseUrl:draft.baseUrl}:{}),...(usesKey&&draft.apiKey.trim()?{apiKey:draft.apiKey}:{})});
  const change=patch=>{setDraft(d=>({...d,...patch}));setStatus(null);};
  const pickService=id=>{const next=config.providers.find(p=>p.id===id);change({provider:id,model:'',baseUrl:next.baseUrl||'',apiKey:''});setAvailable([]);};
  async function test(){const result=await send('/api/provider/test',{profile:profile()});setAvailable(result.available||[]);return result;}
  async function save(force=false){
    setBusy(true);setStatus(null);
    try{
      if(!force){const result=await test();if(!result.ready){setStatus({failed:true,message:result.message});return;}}
      // Adding a model switches to it; editing another one leaves the current model alone.
      onSaved(await saveModels({action:'saveProfile',profile:profile(),activate:!initial||initial.active}));
    }catch(e){setStatus({failed:true,message:e.message,invalid:true});}finally{setBusy(false);}
  }
  const keyPlaceholder=initial?.ownKey||(initial&&initial.provider===draft.provider&&initial.hasKey)?`Saved ${initial.keyHint} · type to replace`:spec.hasKey?`Uses your saved ${service({providerLabel:spec.label})} key · or paste another`:spec.needsKey?'Paste your key':'Optional';
  return <div className="modal-backdrop" onKeyDown={e=>{if(e.key==='Escape')onClose();}}><section className="modal model-form" role="dialog" aria-modal="true" aria-label={initial?'Edit model':'Add your model'}>
    <button className="modal-close" aria-label="Close" onClick={onClose}><X size={20}/></button>
    <span className="eyebrow">{initial?'EDIT MODEL':'ADD YOUR MODEL'}</span><h2>{initial?initial.name:'Bring any model you use.'}</h2>
    <p>ChatGPT, Claude, Gemini, Groq and OpenRouter models with your key, any OpenAI-compatible server (LM Studio, vLLM, llama.cpp), or Ollama on this computer. Keys are encrypted here and only sent to that service.</p>
    <label>Service<select aria-label="Service" value={draft.provider} onChange={e=>pickService(e.target.value)}>{config.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <label>Model<input aria-label="Model" list="model-form-models" value={draft.model} placeholder={spec.defaultModel||'model name, e.g. llama3.2'} onChange={e=>change({model:e.target.value})} autoFocus/><datalist id="model-form-models">{available.map(m=><option key={m} value={m}/>)}</datalist></label>
    {usesAddress&&<label>{spec.id==='ollama'?'Ollama address':'Server address (ending in /v1)'}<input aria-label="Server address" value={draft.baseUrl} placeholder={spec.id==='ollama'?'http://127.0.0.1:11434':'http://localhost:1234/v1'} onChange={e=>change({baseUrl:e.target.value})}/></label>}
    {usesKey&&<label>API key{spec.needsKey?'':' (optional)'}<input aria-label="API key" type="password" autoComplete="off" value={draft.apiKey} placeholder={keyPlaceholder} onChange={e=>change({apiKey:e.target.value})}/></label>}
    <label>Name in your list (optional)<input aria-label="Name" value={draft.name} maxLength={60} placeholder={`${draft.model||spec.defaultModel||'model'} · ${service({providerLabel:spec.label})}`} onChange={e=>change({name:e.target.value})}/></label>
    {spec.keyUrl&&usesKey&&<p className="helper"><a href={spec.keyUrl} target="_blank" rel="noreferrer">Get an API key from {service({providerLabel:spec.label})} ↗</a></p>}
    {status&&<p role="alert" className="error">{status.message}</p>}
    <div className="model-form-actions">
      <button className="primary" disabled={busy} onClick={()=>void save(false)}>{busy?<><LoaderCircle size={14} className="spin"/> Testing…</>:initial?'Test and save':'Test and add'}</button>
      {status?.failed&&!status.invalid&&<button className="quiet" disabled={busy} onClick={()=>void save(true)}>Save anyway</button>}
      <button className="quiet" onClick={onClose}>Cancel</button>
    </div>
  </section></div>;
}

export function ModelSwitcher({health,onHealth,onManage,onNotice,version=0}){
  const [config,setConfig]=useState(null),[open,setOpen]=useState(false),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false);
  const root=useRef(null),list=useRef(null);
  const refresh=()=>loadModels().then(setConfig).catch(()=>setConfig(null));
  useEffect(()=>{refresh();},[version,health?.providerId,health?.models?.chat]);
  useEffect(()=>{if(!open)return;const close=e=>{if(!root.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',close);requestAnimationFrame(()=>list.current?.querySelector('[aria-selected="true"],[role="option"]')?.focus());return ()=>document.removeEventListener('pointerdown',close);},[open]);
  const applied=(data,message)=>{setConfig(data);onHealth?.({...data.health,voice:data.voice});onNotice?.(message);};
  async function use(profile){
    setOpen(false);if(profile.active)return;setBusy(true);
    try{const data=await saveModels({action:'activate',id:profile.id});applied(data,`Now thinking with ${profile.name}. ${data.health?.ready?'':data.health?.message||''}`.trim());}
    catch(e){onNotice?.(e.message);}finally{setBusy(false);}
  }
  // Arrow keys move between options; Escape closes and returns focus to the pill.
  const keys=e=>{const items=[...list.current.querySelectorAll('[role="option"],.model-menu-action')],at=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    if(e.key==='Escape'){setOpen(false);root.current.querySelector('.model-pill')?.focus();}};
  const active=config?.profiles?.find(p=>p.active);
  return <div className="model-switcher" ref={root}>
    <button className="model-pill" aria-haspopup="listbox" aria-expanded={open} aria-label={`AI model: ${active?.name||'not set'}. Change model`} disabled={!config||busy} onClick={()=>setOpen(o=>!o)}>
      <span className={`dot ${health?.ready?'ready':'offline'}`}/><span className="model-pill-name">{busy?'Switching…':health?.unset?'Connect a model':active?.name||'Choose a model'}</span><ChevronDown size={13}/>
    </button>
    {open&&config&&<div className="model-menu" ref={list} onKeyDown={keys}>
      <div role="listbox" aria-label="Your models">{config.profiles.map(p=><button key={p.id} role="option" aria-selected={p.active} className={p.active?'active':''} onClick={()=>void use(p)}>
        <span className="model-check">{p.active&&<Check size={13}/>}</span><span className="model-text"><strong>{p.name}</strong><small>{p.model} · {service(p)}{p.signedIn?' · signed in':p.usesKey&&p.needsKey&&!p.hasKey?' · no key':''}</small></span></button>)}</div>
      <button className="model-menu-action" onClick={()=>{setOpen(false);setAdding(true);}}><Plus size={14}/> Add your model…</button>
      <button className="model-menu-action" onClick={()=>{setOpen(false);setBusy(true);signInWithOpenRouter().then(data=>applied(data,`Signed in to OpenRouter. Now thinking with ${data.profiles.find(p=>p.active)?.name}.`)).catch(e=>onNotice?.(e.message)).finally(()=>setBusy(false));}}><LogIn size={14}/> Sign in with OpenRouter…</button>
      <button className="model-menu-action" onClick={()=>{setOpen(false);onManage?.();}}><Settings size={14}/> Manage models</button>
    </div>}
    {adding&&config&&<ModelForm config={config} onClose={()=>setAdding(false)} onSaved={data=>{setAdding(false);applied(data,`Added and switched to ${data.profiles.find(p=>p.active)?.name}.`);}}/>}
  </div>;
}
