import React,{useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {ModelForm,loadModels,saveModels,SignInButton} from './model-switcher.jsx';

// "Your models": every saved model, switch/edit/delete, and Add your model. Keys go to the local service and are never sent back here.
export function ProviderSettings({name='Atlas',health,onHealth,onCheck}){
  const [config,setConfig]=useState(null),[message,setMessage]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState('');
  useEffect(()=>{loadModels().then(setConfig).catch(e=>setMessage(e.message));},[health?.providerId,health?.models?.chat]);
  const applied=data=>{setConfig(data);onHealth?.({...data.health,voice:data.voice});};
  async function act(body,id){setBusy(id);setMessage('');try{const data=await saveModels(body);applied(data);if(body.action==='deleteProfile')setMessage(config.profiles.find(p=>p.id===body.id)?.signedIn?'Signed out. The key was deleted from this computer. You can also revoke it at openrouter.ai/settings/keys.':'Model removed. Its key was deleted from this computer.');}catch(e){setMessage(e.message);}finally{setBusy('');}}
  if(!config)return <><h3>AI model</h3><p>{message||'Loading model settings...'}</p></>;
  const voice=config.voice||{};
  return <>
    <h3>Your models</h3>
    <p>{name} thinks with the model marked current. Switch any time from the model button at the top of the workspace. Bring your own: a ChatGPT, Claude, Gemini, Groq or OpenRouter key, any OpenAI-compatible server, or Ollama running free on this computer.</p>
    <div className="model-list">{config.profiles.map(p=><div key={p.id} className={`model-row ${p.active?'active':''}`} data-testid="model-row">
      <span className="model-text"><strong>{p.name}</strong><small>{p.model} · {p.providerLabel.split(' (')[0]}{p.baseUrl?` · ${p.baseUrl}`:''}{p.signedIn?' · signed in':p.usesKey?(p.hasKey?` · key ${p.keyHint}`:p.needsKey?' · no key':''):''}</small></span>
      {p.active?<span className="current">CURRENT</span>:<button disabled={!!busy} onClick={()=>void act({action:'activate',id:p.id},p.id)}>{busy===p.id?'Switching…':'Use'}</button>}
      <button disabled={!!busy} onClick={()=>setEditing(p)}>Edit</button>
      <button disabled={!!busy||p.active} title={p.active?'Switch to another model before deleting this one':undefined} aria-label={`${p.signedIn?'Sign out of':'Delete'} ${p.name}`} onClick={()=>void act({action:'deleteProfile',id:p.id},p.id)}>{p.signedIn?'Sign out':'Delete'}</button>
    </div>)}</div>
    <button className="primary" onClick={()=>setEditing('new')}><Plus size={14}/> Add your model</button>{' '}
    <SignInButton className="quiet" onSaved={data=>{applied(data);setMessage(`Signed in to OpenRouter. ${name} is thinking with ${data.profiles.find(p=>p.active)?.name}.`);}} onError={setMessage}/>{' '}
    <button className="quiet" onClick={()=>void onCheck?.()}>Check connection</button>
    <p role="status">{message||health?.message||'Checking the connection...'}</p>
    <h3>Voice services</h3>
    <p>Transcription: {voice.transcription?`${voice.transcription} (whisper)`:'not connected. Save a Groq or OpenAI key to talk instead of type.'} Natural spoken replies: {voice.naturalSpeech?'Groq Orpheus.':'save a Groq key, or use device voice below.'} Voice works alongside any thinking model, including Ollama.</p>
    {editing&&<ModelForm config={config} initial={editing==='new'?null:editing} onClose={()=>setEditing(null)} onSaved={data=>{setEditing(null);applied(data);setMessage(`Saved. ${name} is thinking with ${data.profiles.find(p=>p.active)?.name}.`);}}/>}
  </>;
}
