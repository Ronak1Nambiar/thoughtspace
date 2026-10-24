// Second stage of wake by name. Windows' recognizer flags anything that might be the name; a small
// Whisper model on this computer then listens to just those few seconds and confirms the name was
// really said. Nothing leaves the computer. The clip is written to a private temporary file for
// whisper-cli and deleted as soon as it has been read.
const {execFile}=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const MODEL='ggml-tiny.en-q5_1.bin';
const CUES=new Set(['hey','hi','hello','ok','okay','yo']);
// Close forms of the default name that speech models write instead.
const ALIASES={atlas:['atlas','atless','atlus','atlis','atlass']};

function distance(a,b){
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const next=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]!==b[j-1]));prev=next;}}
  return row[b.length];
}
const words=text=>(String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').match(/[a-z']+/g)||[]).map(w=>w.replace(/'s$/,'').replace(/'/g,'')).filter(Boolean);
const sameWord=(heard,wanted)=>distance(heard,wanted)<=(wanted.length>=5?1:0);
function nameForms(name){const key=words(name).join(' ');return (ALIASES[key]||[key]).map(form=>form.split(' '));}

// The name has to be said as a call: right after a greeting ("hey Nova") or as the last thing said.
// That keeps "the atlas is on the shelf" or "Atlas and I went home" from waking it.
function heardWake(text,name){
  const said=words(text);
  for(const form of nameForms(name)){
    if(!form[0])continue;
    for(let i=0;i+form.length<=said.length;i++){
      if(!form.every((w,k)=>sameWord(said[i+k],w)))continue;
      if((i>0&&CUES.has(said[i-1]))||i+form.length===said.length)return true;
    }
  }
  return false;
}

class WakeCheck {
  constructor({folder,tempDir,run=execFile,threads=Math.max(2,Math.min(4,Math.floor((os.cpus()?.length||4)/2)))}){
    Object.assign(this,{folder,tempDir,run,threads});
    this.executable=path.join(folder,'whisper-cli.exe');this.model=path.join(folder,MODEL);
  }
  available(){return fs.existsSync(this.executable)&&fs.existsSync(this.model);}
  // Leftovers from a crash are removed when the app starts.
  clean(){try{for(const f of fs.readdirSync(this.tempDir))if(f.startsWith('wake-')&&f.endsWith('.wav'))fs.rmSync(path.join(this.tempDir,f),{force:true});}catch{}}
  transcribe(wav,name){
    fs.mkdirSync(this.tempDir,{recursive:true});
    const file=path.join(this.tempDir,`wake-${crypto.randomBytes(8).toString('hex')}.wav`);
    fs.writeFileSync(file,wav,{mode:0o600});
    const args=['-m',this.model,'-f',file,'-l','en','-t',String(this.threads),'-ng','-nt','-np','--temperature','0','--temperature-inc','0','--prompt',`${name} is the assistant's name.`];
    return new Promise(resolve=>{
      this.run(this.executable,args,{windowsHide:true,timeout:15000,maxBuffer:1<<20},(error,stdout)=>{
        fs.rmSync(file,{force:true});
        resolve(error?null:String(stdout||'').trim());
      });
    });
  }
  async check(wav,name){
    const text=await this.transcribe(wav,name);
    return {ok:text!==null&&heardWake(text,name),text};
  }
}

module.exports={WakeCheck,heardWake};
