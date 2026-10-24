import {openMicrophone} from './microphone.js';

// Turn-taking stays in the browser. Only complete utterances leave the device.
export class VoiceSession {
  constructor({onTurn,onState,onSpeechStart,onError,onListen=()=>{},settleMs=0}) {
    Object.assign(this,{onTurn,onState,onSpeechStart,onError,onListen,settleMs});
    this.stopped=false;this.pending=false;this.finishing=false;this.muted=false;
  }
  async start(){
    try {
      if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder||!globalThis.AudioContext)throw new Error('Voice recording is not supported here. Open the app in a supported browser on localhost; text capture remains available.');
      this.stream=await openMicrophone({echoCancellation:true,noiseSuppression:true,autoGainControl:true});
      if(this.stopped){this.stream.getTracks().forEach(t=>t.stop());return;}
      this.stream.getAudioTracks().forEach(track=>{track.enabled=!this.muted;});
      this.context=new AudioContext();await this.context.resume();
      this.analyser=this.context.createAnalyser();this.analyser.fftSize=2048;
      this.context.createMediaStreamSource(this.stream).connect(this.analyser);
      this.listen();
    } catch(error){this.stop();this.onError(error);}
  }
  listen(){
    if(this.stopped)return;
    if(this.muted){this.onState('muted');return;}
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
    const recorder=new MediaRecorder(this.stream,mime?{mimeType:mime}:undefined);
    this.recorder=recorder;this.heardSpeech=false;this.startedAt=performance.now();this.lastSpeech=0;this.voicedMs=0;
    const settleUntil=this.startedAt+this.settleMs;this.settleMs=0;
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{this.stop();this.onError(new Error('The microphone recording was interrupted. Try starting the conversation again.'));};
    recorder.onstop=async()=>{
      clearInterval(this.timer);
      this.finishing=false;
      if(this.heardSpeech&&chunks.length){
        this.pending=true;this.onState('processing');
        try {await this.onTurn(new Blob(chunks,{type:recorder.mimeType}));}
        catch(error){this.stop();this.onError(error);}
        finally{this.pending=false;}
      }
      if(!this.stopped)this.listen();
    };
    recorder.start(500);this.onState('listening');this.onListen({reset:true});
    const samples=new Float32Array(this.analyser.fftSize);
    this.tick=()=>{
      if(this.muted||recorder.state!=='recording'||performance.now()<settleUntil)return;
      this.analyser.getFloatTimeDomainData(samples);
      const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
      const now=performance.now();
      if(rms>0.015){
        if(!this.heardSpeech){this.heardSpeech=true;this.onSpeechStart();}
        this.voicedMs+=80;this.lastSpeech=now;
      }
      if(this.heardSpeech&&this.voicedMs>=320&&now-this.lastSpeech>1600)this.finishTurn();
      // Short bursts/noise cannot leave the microphone stuck forever.
      else if(this.heardSpeech&&now-this.lastSpeech>4000)this.finishTurn();
      else if(now-this.startedAt>120000)this.finishTurn();
    };
    this.timer=setInterval(this.tick,80);
  }
  setMuted(muted){
    if(this.stopped)return;
    this.muted=muted;
    this.stream?.getAudioTracks().forEach(track=>{track.enabled=!muted;});
    if(this.pending||this.finishing)return;
    if(muted){
      clearInterval(this.timer);
      if(this.recorder?.state==='recording')this.recorder.pause();
      this.onState('muted');
    }else if(this.recorder?.state==='paused'){
      this.lastSpeech=performance.now();
      this.recorder.resume();
      this.timer=setInterval(this.tick,80);
      this.onState('listening');
      this.onListen({reset:false});
    }else if(this.analyser){this.listen();}
  }
  finishTurn(){if(['recording','paused'].includes(this.recorder?.state)){this.finishing=true;clearInterval(this.timer);this.recorder.stop();}}
  stop(){
    this.stopped=true;clearInterval(this.timer);this.finishTurn();
    this.stream?.getTracks().forEach(t=>t.stop());
    void this.context?.close();
  }
}
