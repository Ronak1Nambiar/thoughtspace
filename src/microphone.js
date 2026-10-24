// One microphone choice for conversation, single recordings and (in the Windows app) wake listening.
const KEY='thoughtspace.microphone.v1';
export const MICROPHONE_EVENT='thoughtspace-microphone';

export function readMicrophone(storage=globalThis.localStorage){
  try{
    const raw=JSON.parse(storage?.getItem(KEY)||'null');
    if(typeof raw?.deviceId!=='string'||!raw.deviceId||raw.deviceId.length>256)return null;
    return {deviceId:raw.deviceId,label:typeof raw.label==='string'?raw.label.slice(0,120):''};
  }catch{return null;}
}
// null goes back to the system default.
export function saveMicrophone(mic,storage=globalThis.localStorage){
  const clean=mic?.deviceId?{deviceId:String(mic.deviceId).slice(0,256),label:String(mic.label||'').slice(0,120)}:null;
  try{if(clean)storage?.setItem(KEY,JSON.stringify(clean));else storage?.removeItem?.(KEY);}catch{}
  try{globalThis.dispatchEvent?.(new CustomEvent(MICROPHONE_EVENT,{detail:clean}));}catch{}
  return clean;
}

// Chromium lists the system default again as "default" and "communications"; keep only real devices.
export function inputDevices(devices){
  return devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&!['default','communications'].includes(d.deviceId))
    .map((d,i)=>({deviceId:d.deviceId,label:d.label||`Microphone ${i+1}`}));
}
export async function listMicrophones(media=globalThis.navigator?.mediaDevices){
  return media?.enumerateDevices?inputDevices(await media.enumerateDevices()):[];
}

// A chosen microphone that has been unplugged falls back to the default instead of failing.
export async function openMicrophone(constraints={},media=globalThis.navigator?.mediaDevices,mic=readMicrophone()){
  const plain=Object.keys(constraints).length?constraints:true;
  if(!mic)return media.getUserMedia({audio:plain});
  try{return await media.getUserMedia({audio:{...constraints,deviceId:{exact:mic.deviceId}}});}
  catch(error){
    if(['OverconstrainedError','NotFoundError'].includes(error?.name))return media.getUserMedia({audio:plain});
    throw error;
  }
}

// Input check: a rolling verdict over the last 1.5 s of level readings (rms and peak, 0..1).
// "silent" is digital silence: every sample is (almost) exactly zero, which a working microphone
// never produces even in a quiet room. Muted inputs and aggressive noise gates do.
export const SILENT_PEAK=0.0005,VOICE_RMS=0.015;
export class InputCheck {
  constructor(windowMs=1500){this.windowMs=windowMs;this.frames=[];this.started=null;}
  add({rms,peak},now){
    if(this.started===null)this.started=now;
    this.frames.push({rms,peak,now});
    while(this.frames.length&&this.frames[0].now<now-this.windowMs)this.frames.shift();
    return this.state(now);
  }
  state(now){
    const frames=this.frames;
    if(!frames.length)return 'waiting';
    if(frames.some(f=>f.rms>=VOICE_RMS))return 'hearing';
    if(now-this.started<this.windowMs)return 'waiting';
    return frames.every(f=>f.peak<SILENT_PEAK)?'silent':'signal';
  }
}
// Meter bar position: square root so normal speech fills about half the bar.
export const meterLevel=rms=>Math.min(1,Math.sqrt(Math.max(0,rms)/0.12));
