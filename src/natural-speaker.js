import {ReplySpeaker} from './reply-speaker.js';

// Groq Orpheus accepts at most 200 characters per request. Prefer sentence or
// word boundaries, and never discard the final fragment of a reply.
export function speechSegments(text,limit=200){
  let rest=text.replace(/[*#`]/g,'').trim();const parts=[];
  while(rest.length>limit){
    const head=rest.slice(0,limit);let end=0;
    for(const match of head.matchAll(/[.!?]\s+/g))end=match.index+1;
    if(end<limit/3)end=head.lastIndexOf(' ');
    if(end<1)end=limit;
    parts.push(rest.slice(0,end));rest=rest.slice(end).trimStart();
  }
  if(rest)parts.push(rest);return parts;
}

export class NaturalSpeaker {
  constructor(host=globalThis){this.host=host;this.local=new ReplySpeaker(host);this.active=null;}
  cancel(){
    const job=this.active;this.active=null;
    job?.controller.abort();job?.finishPlayback?.();job?.audio?.pause();
    this.local.cancel();
  }
  async speak(text,{voice='daniel',service='groq',onVoice=()=>{},onState=()=>{}}={}){
    this.cancel();
    if(service==='device'){onState('speaking');return this.local.speak(text,{onVoice});}
    const job={controller:new AbortController()};this.active=job;
    try{
      onVoice({name:`${service==='openai'?'OpenAI':'Groq Orpheus'} · ${voice}`,local:false});
      for(const segment of speechSegments(text)){
        onState('processing');
        const response=await this.host.fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:segment,voice,service}),signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(45000)])});
        if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Natural voice is unavailable. Reply saved as text.');}
        const blob=await response.blob();
        if(job.controller.signal.aborted)break;
        const url=this.host.URL.createObjectURL(blob),audio=new this.host.Audio(url);job.audio=audio;
        try{
          await new Promise((resolve,reject)=>{
            let done=false;const timer=setTimeout(()=>finish(new Error('Audio playback timed out.')),60000);
            const finish=error=>{if(done)return;done=true;clearTimeout(timer);audio.onended=null;audio.onerror=null;job.finishPlayback=null;error?reject(error):resolve();};
            job.finishPlayback=()=>finish();audio.onended=()=>finish();audio.onerror=()=>finish(new Error('Audio output is unavailable. Reply saved as text.'));
            audio.onplaying=()=>onState('speaking');
            Promise.resolve(audio.play()).catch(finish);
          });
        }finally{audio.pause();audio.removeAttribute('src');audio.load();this.host.URL.revokeObjectURL(url);job.audio=null;}
        if(job.controller.signal.aborted)break;
      }
      return {status:job.controller.signal.aborted?'interrupted':'complete'};
    }catch(error){return {status:job.controller.signal.aborted?'interrupted':'failed',reason:error.message};}
    finally{if(this.active===job)this.active=null;}
  }
}
