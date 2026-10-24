// Speech-to-text on this computer: whisper.cpp's base English model turns a spoken turn into text
// without sending audio anywhere. The clip (16 kHz mono WAV from the renderer) is written to a private
// temporary file for whisper-cli and deleted as soon as it has been read.
const {execFile}=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const MODEL='ggml-base.en-q5_1.bin',VAD='ggml-silero-v5.1.2.bin';
// 16 kHz, 16-bit mono: 32,000 bytes per second of audio.
const secondsOf=wav=>Math.max(0,(wav.length-44)/32000);
// Whisper describes sounds in brackets ("(beep)", "[BLANK_AUDIO]") and, on near-silence, invents short
// stock phrases. Voice-activity detection removes most of it; this catches what slips through.
const SOUND=/[[(][^\])]*[\])]/g;
const PHANTOM=/^(?:you|thank you|thanks for watching|bye|okay|\.+)[.!]?$/i;
function cleanTranscript(stdout){
  const text=String(stdout||'').replace(SOUND,' ').replace(/\s+/g,' ').trim();
  return PHANTOM.test(text)?'':text;
}

class LocalTranscriber {
  constructor({folder,tempDir,run=execFile,threads=Math.max(2,Math.min(8,(os.cpus()?.length||4)-1))}){
    Object.assign(this,{folder,tempDir,run,threads});
    this.executable=path.join(folder,'whisper-cli.exe');this.model=path.join(folder,MODEL);this.vad=path.join(folder,VAD);
  }
  available(){return fs.existsSync(this.executable)&&fs.existsSync(this.model);}
  // Leftovers from a crash are removed when the app starts.
  clean(){try{for(const f of fs.readdirSync(this.tempDir))if(f.startsWith('speech-')&&f.endsWith('.wav'))fs.rmSync(path.join(this.tempDir,f),{force:true});}catch{}}
  transcribe(wav){
    if(!Buffer.isBuffer(wav)||wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')return Promise.reject(Object.assign(new Error('Speech on this computer needs WAV audio. Update ThoughtSpace and try again.'),{status:400}));
    if(wav.readUInt32LE(24)!==16000||wav.readUInt16LE(22)!==1)return Promise.reject(Object.assign(new Error('Speech on this computer needs 16 kHz mono audio. Update ThoughtSpace and try again.'),{status:400}));
    fs.mkdirSync(this.tempDir,{recursive:true});
    const file=path.join(this.tempDir,`speech-${crypto.randomBytes(8).toString('hex')}.wav`);
    fs.writeFileSync(file,wav,{mode:0o600});
    // With the VAD model, noise and silence are skipped instead of transcribed.
    const args=['-m',this.model,'-f',file,'-l','en','-t',String(this.threads),'-ng','-nt','-np','--temperature','0',...(fs.existsSync(this.vad)?['--vad','-vm',this.vad]:[])];
    // Generous: about 0.05 s of work per second of audio on a laptop, plus model load.
    const timeout=Math.round(20000+secondsOf(wav)*1000);
    return new Promise((resolve,reject)=>{
      this.run(this.executable,args,{windowsHide:true,timeout,maxBuffer:4<<20},(error,stdout)=>{
        fs.rmSync(file,{force:true});
        if(error)return reject(Object.assign(new Error(error.killed?'Speech on this computer took too long. Try a shorter turn.':'Speech on this computer failed. Your recording is kept for retry.'),{status:502}));
        resolve(cleanTranscript(stdout));
      });
    });
  }
}

module.exports={LocalTranscriber,secondsOf,cleanTranscript};
