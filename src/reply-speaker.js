export class ReplySpeaker {
  constructor(host=globalThis){this.host=host;this.finish=null;}
  cancel(){
    // Resolve first because some browsers synchronously emit an error on cancel.
    this.finish?.({status:'interrupted'});
    this.host.speechSynthesis?.cancel();
  }
  speak(text,{onVoice=()=>{}}={}){
    this.cancel();
    const synth=this.host.speechSynthesis;
    if(!synth||!this.host.SpeechSynthesisUtterance)return Promise.resolve({status:'unavailable'});
    return new Promise(resolve=>{
      let ended=false,startTimer,endTimer;
      const utterance=new this.host.SpeechSynthesisUtterance(text);
      const voices=synth.getVoices?.()||[];
      const language=this.host.document?.documentElement.lang||'en';
      const matches=voices.filter(voice=>voice.lang?.toLowerCase().startsWith(language.toLowerCase()));
      const voice=matches.find(voice=>voice.localService)||matches.find(voice=>voice.default)||matches[0];
      if(voice){utterance.voice=voice;utterance.lang=voice.lang;onVoice({name:voice.name,local:voice.localService});}
      const finish=result=>{if(ended)return;ended=true;clearTimeout(startTimer);clearTimeout(endTimer);utterance.onstart=null;utterance.onend=null;utterance.onerror=null;this.finish=null;resolve(result);};
      this.finish=finish;
      utterance.onstart=()=>clearTimeout(startTimer);
      utterance.onend=()=>finish({status:'complete'});
      utterance.onerror=event=>finish({status:event.error==='canceled'||event.error==='interrupted'?'interrupted':'failed',reason:event.error});
      startTimer=setTimeout(()=>{finish({status:'failed',reason:'Playback did not start'});synth.cancel();},15000);
      endTimer=setTimeout(()=>{finish({status:'failed',reason:'Playback timed out'});synth.cancel();},Math.max(90000,text.length*110));
      try{synth.speak(utterance);}catch{finish({status:'failed',reason:'Speech service unavailable'});}
    });
  }
}
