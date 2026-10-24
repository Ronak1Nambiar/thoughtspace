const {spawn}=require('node:child_process');
const errors={
  'missing-recognizer':'Windows English speech recognition is not installed. Add an English speech language in Windows Settings to use wake mode.',
  'microphone-denied':'Windows denied microphone access for wake listening. Check Windows microphone privacy settings.',
  'recognition-error':'Windows wake recognition stopped unexpectedly. Turn wake mode off and on to retry.',
  unavailable:'The Windows wake listener could not open the microphone. Pick another one in Settings under Microphone, and check Windows microphone privacy settings.',
};
// Same rule as src/assistant.js: letters, spaces, hyphens, apostrophes; starts with a letter; up to 24 characters.
const NAME_PATTERN=/^\p{L}[\p{L}' -]{0,23}$/u;
const DEFAULT_NAME='Atlas';
// Microphone names come from the renderer's device list; the listener matches them against Windows' names.
function cleanDevice(value){const name=String(value??'').replace(/\s+/g,' ').trim();return name.length<=120&&!/[\u0000-\u001f]/.test(name)?name:'';}
const deviceArgs=device=>device?['--device',device]:[];
// Peak below this for every report means the device delivered digital silence (a muted or gated input).
const SILENT_PEAK=0.0005;
function cleanName(value){const name=String(value??'').replace(/\s+/g,' ').trim();return NAME_PATTERN.test(name)?name:DEFAULT_NAME;}
// Windows commonly hears Atlas as Atlus or Atless, so the default name keeps those close forms.
function wakePhrases(value){
  const name=cleanName(value);
  const forms=name.toLowerCase()==='atlas'?['Atlas','Atlus','Atless']:[name];
  return forms.flatMap(form=>[form,`Hey ${form}`]).join('|');
}
function lines(child,onEvent){
  let buffer='';
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString();
    // Candidate lines carry a few seconds of audio; anything far larger is not ours.
    if(buffer.length>2*1024*1024){buffer='';return;}
    let end;
    while((end=buffer.indexOf('\n'))!==-1){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{onEvent(JSON.parse(line));}catch{}
    }
  });
}

const clip=event=>{const wav=Buffer.from(String(event.wav||''),'base64');return wav.length>44?wav:null;};

// check: the optional local Whisper confirmation (desktop/wake-check.cjs). With it the listener only
// proposes candidates and nothing wakes until Whisper heard the name; without it the listener decides alone.
class WakeController {
  constructor({executable,onEvent,spawnProcess=spawn,args=[],check=null}){Object.assign(this,{executable,onEvent,spawnProcess,args,check});this.run=null;this.state={status:'off'};this.triggered=false;this.name=DEFAULT_NAME;this.device='';}
  emit(status,message){this.state={status,...(message?{message}:{})};this.onEvent(this.state);}
  async configure({enabled,suspended,name,device}){
    const next=cleanName(name??this.name),mic=device===undefined?this.device:cleanDevice(device);
    if(next!==this.name||mic!==this.device){this.name=next;this.device=mic;this.triggered=false;await this.stop();}
    if(!enabled||suspended){this.triggered=false;await this.stop();this.emit(enabled?'paused':'off');return this.state;}
    if(this.run||this.triggered)return this.state;
    this.emit('starting');
    const twoStage=this.twoStage();
    const child=this.spawnProcess(this.executable,['--phrases',wakePhrases(this.name),...(twoStage?['--candidates']:[]),...deviceArgs(this.device),...this.args],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const run={child,detected:false,error:false,checking:false,pending:null};this.run=run;
    run.closed=new Promise(resolve=>{run.resolve=resolve;});
    run.timeout=setTimeout(()=>{if(this.run===run){run.error=true;this.emit('error','The Windows wake listener did not become ready. Turn wake mode off and on to retry.');void this.stop();}},10000);
    lines(child,event=>{
      if(this.run!==run)return;
      if(event.type==='ready'){clearTimeout(run.timeout);this.emit('listening');}
      if(event.type==='detected')run.detected=true;
      if(event.type==='candidate'&&twoStage)void this.confirm(run,event);
      if(errors[event.type]){run.error=true;clearTimeout(run.timeout);this.emit('error',errors[event.type]);}
    });
    child.stdin.on('error',()=>{});
    child.on('error',()=>{if(this.run===run){run.error=true;clearTimeout(run.timeout);this.emit('error','The local wake listener is missing or could not start. Reinstall the Windows application.');}});
    child.on('close',async()=>{
      clearTimeout(run.timeout);clearTimeout(run.kill);run.resolve();
      // The listener can end while its last candidate is still being checked; that answer decides.
      if(run.checkDone)await run.checkDone;
      if(this.run!==run)return;
      this.run=null;
      if(run.detected&&!run.error){this.triggered=true;this.emit('detected');}
      else if(!run.error)this.emit('error','Wake listening stopped. Turn wake mode off and on to retry.');
    });
    return this.state;
  }
  twoStage(){try{return !!this.check?.available();}catch{return false;}}
  // One check at a time; while one runs, only the newest candidate waits. A confirmed name ends the
  // listener, and its exit reports the wake.
  confirm(run,event){
    if(run.checking){run.pending=event;return run.checkDone;}
    run.checking=true;
    run.checkDone=(async()=>{
      try{
        for(let next=event;next&&this.run===run&&!run.detected;next=run.pending,run.pending=null){
          const wav=clip(next);if(!wav)continue;
          const result=await this.check.check(wav,this.name).catch(()=>({ok:false}));
          if(this.run!==run)return;
          if(result.ok){run.detected=true;try{run.child.stdin.end();}catch{}run.kill=setTimeout(()=>run.child.kill(),1500);return;}
        }
      }finally{run.checking=false;}
    })();
    return run.checkDone;
  }
  // Name test: listen for `seconds` and report every match with its confidence. Standby listening is stopped first;
  // the caller turns it back on through configure().
  // Also reports what reached the listener: the microphone it opened and whether any sound arrived.
  async calibrate({name,seconds=12,device}){
    await this.stop();this.triggered=false;this.emit('off');
    const ms=Math.min(Math.max(Number(seconds)||12,3),30)*1000,mic=device===undefined?this.device:cleanDevice(device);
    const twoStage=this.twoStage(),checkName=cleanName(name);
    const child=this.spawnProcess(this.executable,['--phrases',wakePhrases(name),'--calibrate','--levels',...(twoStage?['--candidates']:[]),...deviceArgs(mic),...this.args],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const heard=[];let error=null,ready=false,timer,startup,input=null,checks=Promise.resolve();const level={reports:0,silent:0,peak:0};
    return new Promise(resolve=>{
      // Checks still running when time is up are waited for, briefly, so the count is complete.
      const finish=async()=>{clearTimeout(timer);clearTimeout(startup);let limit;await Promise.race([checks,new Promise(r=>{limit=setTimeout(r,8000);})]);clearTimeout(limit);resolve(error?{status:'error',message:error}:{status:'ok',ready,heard,input,level:{peak:level.peak,silent:level.reports>0&&level.silent===level.reports,reports:level.reports}});};
      lines(child,event=>{
        if(event.type==='device')input={name:String(event.name).slice(0,60),matched:event.matched===true};
        if(event.type==='level'){const peak=Number(event.peak)||0;level.reports++;level.peak=Math.max(level.peak,peak);if(peak<SILENT_PEAK)level.silent++;}
        if(event.type==='ready'){ready=true;timer=setTimeout(()=>{try{child.stdin.end();}catch{}setTimeout(()=>child.kill(),700);},ms);}
        if(event.type==='heard'&&!twoStage&&heard.length<20)heard.push({phrase:String(event.phrase).slice(0,40),confidence:Number(event.confidence)||0});
        if(event.type==='candidate'&&twoStage){const wav=clip(event),phrase=String(event.phrase).slice(0,40),confidence=Number(event.confidence)||0;
          if(wav)checks=checks.then(()=>this.check.check(wav,checkName)).then(r=>{if(r.ok&&heard.length<20)heard.push({phrase,confidence,verified:true});},()=>{});}
        if(errors[event.type])error=errors[event.type];
      });
      child.stdin.on('error',()=>{});
      child.on('error',()=>{error='The local wake listener is missing or could not start. Reinstall the Windows application.';});
      child.on('close',()=>void finish());
      startup=setTimeout(()=>{if(!ready){error='The Windows wake listener did not become ready.';child.kill();}},10000);
    });
  }
  async stop(){
    const run=this.run;if(!run)return;
    this.run=null;clearTimeout(run.timeout);
    run.child.stdin.end();
    const kill=setTimeout(()=>run.child.kill(),700);
    const limit=setTimeout(()=>run.resolve(),2000);
    await run.closed;clearTimeout(kill);clearTimeout(limit);
  }
  dispose(){const run=this.run;this.run=null;if(run){clearTimeout(run.timeout);run.child.stdin.end();run.child.kill();run.resolve();}}
}
module.exports={WakeController,wakePhrases,cleanName,cleanDevice};
