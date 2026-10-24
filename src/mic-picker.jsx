import React,{useEffect,useState} from 'react';
import {Mic,MicOff} from 'lucide-react';
import {readMicrophone,saveMicrophone,listMicrophones,openMicrophone,InputCheck,meterLevel} from './microphone.js';

const CHECK_MS=20000;
const STATUS={
  waiting:{tone:'',text:'Listening for sound…'},
  hearing:{tone:'good',text:'Hearing you. This microphone works.'},
  signal:{tone:'warn',text:'The microphone is on, but it only hears faint background sound. Speak normally to check it, or move closer.'},
  silent:{tone:'bad',text:'No sound at all from this microphone: it is sending pure silence. That usually means it is muted, switched off, or blocked by your laptop’s built-in noise-cancelling software. Pick another microphone above.'},
};

// Which microphone to use, plus a live check that sound is actually arriving. The meter reads the raw
// device (no browser noise suppression) so it shows what the wake listener hears too.
export function MicPicker({onChange}){
  const [devices,setDevices]=useState([]),[mic,setMic]=useState(readMicrophone);
  const [testing,setTesting]=useState(false),[level,setLevel]=useState(0),[status,setStatus]=useState('waiting'),[error,setError]=useState('');
  const refresh=()=>listMicrophones().then(setDevices).catch(()=>{});
  useEffect(()=>{
    void refresh();
    const media=navigator.mediaDevices;media?.addEventListener?.('devicechange',refresh);
    return ()=>media?.removeEventListener?.('devicechange',refresh);
  },[]);
  useEffect(()=>{
    if(!testing)return;
    let stream,context,timer,stopped=false;const check=new InputCheck();
    (async()=>{
      try{
        stream=await openMicrophone({echoCancellation:false,noiseSuppression:false,autoGainControl:false},navigator.mediaDevices,mic);
        if(stopped){stream.getTracks().forEach(t=>t.stop());return;}
        void refresh(); // device names appear once the microphone is allowed
        context=new AudioContext();await context.resume();
        const analyser=context.createAnalyser();analyser.fftSize=2048;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples=new Float32Array(analyser.fftSize),started=performance.now();
        timer=setInterval(()=>{
          analyser.getFloatTimeDomainData(samples);
          let sum=0,peak=0;for(const v of samples){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
          const rms=Math.sqrt(sum/samples.length),now=performance.now();
          setLevel(meterLevel(rms));setStatus(check.add({rms,peak},now));
          if(now-started>CHECK_MS)setTesting(false);
        },80);
      }catch(e){if(!stopped){setError(e?.name==='NotAllowedError'?'Microphone access was not allowed.':e?.message||'The microphone could not be opened.');setTesting(false);}}
    })();
    return ()=>{stopped=true;clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());void context?.close();setLevel(0);};
  },[testing,mic?.deviceId]);
  function choose(id){
    const saved=saveMicrophone(devices.find(d=>d.deviceId===id)||null);
    setMic(saved);setStatus('waiting');setError('');onChange?.(saved);
  }
  const connected=!mic||devices.some(d=>d.deviceId===mic.deviceId);
  const current=STATUS[status];
  return <div className="mic-picker">
    <label>Input device
      <select aria-label="Microphone" value={mic?.deviceId||''} onChange={e=>choose(e.target.value)}>
        <option value="">System default</option>
        {devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        {!connected&&<option value={mic.deviceId}>{mic.label||'Saved microphone'} (not connected)</option>}
      </select>
    </label>
    <div className="mic-check">
      <button className="quiet" onClick={()=>{setError('');setStatus('waiting');setTesting(t=>!t);}}>{testing?<><MicOff size={14}/> Stop check</>:<><Mic size={14}/> Check microphone</>}</button>
      <div className={`mic-meter ${testing?'is-on':''} ${testing?status:''}`} role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)}><span style={{width:`${Math.round(level*100)}%`}}/></div>
    </div>
    {testing&&<p className={`field-note ${current.tone}`} role="status">{current.text}</p>}
    {!connected&&<p className="field-note warn">Your chosen microphone isn't connected, so the system default is used until it is.</p>}
    {error&&<p className="field-note error" role="alert">{error}</p>}
  </div>;
}
