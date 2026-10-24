import React,{useEffect,useState} from 'react';
import {Check,LoaderCircle,Mic,ArrowRight,ArrowLeft} from 'lucide-react';
import {THEMES,ACCENTS,DENSITIES,applyAppearance,saveAppearance} from './appearance.js';
import {cleanName,nameProblem,nameAdvice,saveProfile} from './assistant.js';
import {ModelForm,loadModels,SignInButton} from './model-switcher.jsx';
import {MicPicker} from './mic-picker.jsx';
import {readMicrophone} from './microphone.js';
import './onboarding.css';

// A small, real-looking slice of the workspace drawn in one look.
function LookPreview({theme,accent}){
  const mode=THEMES.find(t=>t.id===theme).mode;
  return <div className="look-preview" data-theme-preview data-theme={theme} data-mode={mode} data-accent={accent} aria-hidden="true">
    <div className="lp-bar"><span className="lp-brand">thoughtspace</span><span className="lp-pill"><i/>model</span></div>
    <div className="lp-body"><strong className="lp-title">What are we building?</strong>
      <div className="lp-cards"><div className="lp-card selected"><small>IDEA</small><b>Customer dashboard</b></div><div className="lp-card"><small>TASK</small><b>Finish the proposal</b></div></div>
      <span className="lp-button">Start conversation</span></div>
  </div>;
}

export function LookPicker({value,onChange}){
  const set=patch=>onChange({...value,...patch});
  return <div className="look-picker">
    <div className="look-grid" role="radiogroup" aria-label="Look">{THEMES.map(t=><button key={t.id} role="radio" aria-checked={value.theme===t.id} className={`look-option ${value.theme===t.id?'chosen':''}`} onClick={()=>set({theme:t.id})}>
      <LookPreview theme={t.id} accent={value.accent}/>
      <span className="look-name">{value.theme===t.id&&<Check size={14}/>}{t.name}</span><span className="look-blurb">{t.blurb}</span>
    </button>)}</div>
    <div className="look-row"><span className="look-label">Accent</span><div className="swatches" role="radiogroup" aria-label="Accent colour">{ACCENTS.map(a=>{const mode=THEMES.find(t=>t.id===value.theme).mode;return <button key={a.id} role="radio" aria-checked={value.accent===a.id} aria-label={a.name} title={a.name} className={`swatch ${value.accent===a.id?'chosen':''}`} style={{'--swatch':a[mode]}} onClick={()=>set({accent:a.id})}>{value.accent===a.id&&<Check size={13}/>}</button>;})}</div></div>
    <div className="look-row"><span className="look-label">Text size</span><div className="segmented" role="radiogroup" aria-label="Text size">{DENSITIES.map(d=><button key={d.id} role="radio" aria-checked={value.density===d.id} className={value.density===d.id?'chosen':''} onClick={()=>set({density:d.id})}>{d.name}</button>)}</div></div>
  </div>;
}

// Name field plus, in the Windows app, a short test of how well Windows hears it. withMic adds the
// microphone choice above the test (setup); Settings shows the microphone in its own section.
export function NamePicker({value,onChange,withMic=false,desktop=globalThis.window?.thoughtspaceDesktop}){
  const [test,setTest]=useState(null);
  const problem=nameProblem(value),name=cleanName(value);
  useEffect(()=>setTest(null),[value]);
  async function runTest(){
    setTest({status:'listening'});
    try{
      const result=await desktop.testWakeName(name,10,readMicrophone()?.label||'');
      if(result.status!=='ok'){setTest({status:'error',message:result.message});return;}
      const count=result.heard.filter(h=>h.verified||h.confidence>=0.6).length;
      setTest({status:'done',count,silent:result.level?.silent===true,input:result.input});
    }catch(e){setTest({status:'error',message:e.message});}
  }
  const where=withMic?'above':'in Settings under Microphone';
  const verdict=test?.status!=='done'?null
    :test.silent?{tone:'bad',text:`The wake listener got no sound at all from “${test.input?.name||'the microphone'}”. Choose another microphone ${where} and test again.`}
    :test.count>=3?{tone:'good',text:`Heard “${name}” ${test.count} times. Wake by name will work well.`}
    :test.count>=1?{tone:'warn',text:`Heard it ${test.count} of 3 times. Saying “Hey ${name}” is more reliable, or try a longer name.`}
    :{tone:'bad',text:`Windows didn't catch “${name}”. Try “Hey ${name}”, speak a little slower, or pick a name with two or more syllables. You can keep it anyway.`};
  const fallback=test?.status==='done'&&test.input&&!test.input.matched&&readMicrophone();
  return <div className="name-picker">
    <label>Assistant name<input aria-label="Assistant name" value={value} maxLength={24} onChange={e=>onChange(e.target.value)} placeholder="Atlas" autoFocus/></label>
    {problem?<p className="field-note error" role="alert">{problem}</p>:<p className="field-note">You'll say <b>“{name}”</b> or <b>“Hey {name}”</b> to start a conversation. {nameAdvice(name)}</p>}
    {desktop?.testWakeName?<>
      {withMic&&<MicPicker onChange={()=>setTest(null)}/>}
      <div className="name-test">
        <button className="quiet" disabled={!!problem||test?.status==='listening'} onClick={()=>void runTest()}>{test?.status==='listening'?<><LoaderCircle size={14} className="spin"/> Listening… say “{name}” three times</>:<><Mic size={14}/> Test the name</>}</button>
        {verdict&&<p className={`field-note ${verdict.tone}`} role="status">{verdict.text}</p>}
        {fallback&&<p className="field-note warn">Windows couldn't find your chosen microphone for wake listening, so it used the default input.</p>}
        {test?.status==='error'&&<p className="field-note error" role="alert">{test.message}</p>}
      </div>
    </>:<p className="field-note">Waking by name works in the Windows app. In the browser, use Start conversation.</p>}
  </div>;
}

function ModelStep({health,onHealth}){
  const [config,setConfig]=useState(null),[adding,setAdding]=useState(false),[error,setError]=useState('');
  useEffect(()=>{loadModels().then(setConfig).catch(e=>setError(e.message));},[]);
  const active=config?.profiles?.find(p=>p.active);
  const ready=health?.ready;
  return <div className="model-step">
    <div className={`model-status ${ready?'ready':''}`}><span className="dot"/><span>{ready?<>Connected to <b>{active?.name||health?.provider}</b>.</>:<>No model connected yet. {health?.unset?'Pick one below.':health?.message||''}</>}</span></div>
    <div className="model-choices">
      <div className="choice signin-choice"><b>Sign in with an account</b><span>One OpenRouter sign-in gives you Claude, GPT, Gemini, Llama and hundreds more. No key to copy.</span><SignInButton onSaved={data=>{setConfig(data);setError('');onHealth?.({...data.health,voice:data.voice});}} onError={setError}/></div>
      <button className="choice" onClick={()=>setAdding(true)} disabled={!config}><b>Use an API key or a local model</b><span>OpenAI, Anthropic, Gemini, Groq or OpenRouter with a key, a server of your own, or Ollama free on this computer.</span></button>
    </div>
    <p className="field-note">You can skip this. Typed and saved thoughts work without AI, and you can add a model any time from the model button at the top.</p>
    {error&&<p className="field-note error">{error}</p>}
    {adding&&config&&<ModelForm config={config} provider={config.providers.some(p=>p.hasKey)?null:'openai'} onClose={()=>setAdding(false)} onSaved={data=>{setAdding(false);setConfig(data);onHealth?.({...data.health,voice:data.voice});}}/>}
  </div>;
}

const STEPS=['look','name','model'];
export function Onboarding({initialAppearance,initialName,returning,health,onHealth,onDone}){
  const [step,setStep]=useState(0),[look,setLook]=useState(initialAppearance),[name,setName]=useState(initialName);
  useEffect(()=>{applyAppearance(look);},[look]);
  const id=STEPS[step];
  const canNext=id!=='name'||!nameProblem(name);
  function finish(){
    const appearance=saveAppearance(look);
    const profile=saveProfile({completedAt:new Date().toISOString(),assistantName:name});
    onDone({appearance,profile});
  }
  const heading={look:returning?'ThoughtSpace has a new look. Pick yours.':'First, pick how it looks.',name:'Name your assistant.',model:'Connect the model it thinks with.'}[id];
  const sub={look:'You can change this any time in Settings.',name:'This is who you talk to, and the word that wakes it up.',model:'Bring any model you already use. Keys stay encrypted on this computer.'}[id];
  return <div className="onboarding" role="dialog" aria-modal="true" aria-label="Set up ThoughtSpace">
    <div className="onboarding-panel">
      <div className="onboarding-progress" aria-label={`Step ${step+1} of ${STEPS.length}`}>{STEPS.map((s,i)=><span key={s} className={i<=step?'on':''}/>)}</div>
      <span className="eyebrow">STEP {step+1} OF {STEPS.length}</span>
      <h1>{heading}</h1><p className="onboarding-sub">{sub}</p>
      {id==='look'&&<LookPicker value={look} onChange={setLook}/>}
      {id==='name'&&<NamePicker value={name} onChange={setName} withMic/>}
      {id==='model'&&<ModelStep health={health} onHealth={onHealth}/>}
      <div className="onboarding-actions">
        {step>0?<button className="quiet" onClick={()=>setStep(step-1)}><ArrowLeft size={15}/> Back</button>:<span/>}
        {step<STEPS.length-1?<button className="primary" disabled={!canNext} onClick={()=>setStep(step+1)}>Continue <ArrowRight size={15}/></button>
          :<button className="primary" onClick={finish}>{health?.ready?'Open ThoughtSpace':'Skip for now and open'} <ArrowRight size={15}/></button>}
      </div>
    </div>
  </div>;
}
