// Fetches local Whisper: whisper.cpp's command-line tool, the tiny English model (wake by name) and the
// base English model (speech-to-text on this computer), all pinned by SHA-256, into desktop/native/whisper. Re-running is cheap: files
// that are already there and verified are kept.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';

const OUT='desktop/native/whisper';
const RELEASE={url:'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',sha256:'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'};
// tiny.en confirms the wake name; base.en transcribes speech on this computer when no cloud key is used.
const MODELS=[
  {file:'ggml-tiny.en-q5_1.bin',url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin',sha256:'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b'},
  // Silero voice-activity detection: skips noise and silence so they never turn into words.
  {file:'ggml-silero-v5.1.2.bin',url:'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',sha256:'29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf'},
  {file:'ggml-base.en-q5_1.bin',url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin',sha256:'4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f'},
];
// Only what whisper-cli needs. ggml picks the fastest ggml-cpu-*.dll for the processor at run time.
const KEEP=name=>/^(whisper-cli\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cpu-[a-z0-9]+\.dll)$/i.test(name);
// whisper.cpp is built with Visual C++; ship its runtime next to it so clean machines need nothing installed.
const RUNTIME=['msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll','vcomp140.dll'];

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function download(url,expected){
  const response=await fetch(url,{signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha(bytes)!==expected)throw new Error(`Checksum did not match: ${url}`);
  return bytes;
}
function unzip(bytes){
  return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);
    const files=[];
    zip.on('entry',entry=>{
      const name=path.posix.basename(entry.fileName);
      if(!KEEP(name)){zip.readEntry();return;}
      zip.openReadStream(entry,(err,stream)=>{
        if(err)return reject(err);
        const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('end',()=>{files.push({name,bytes:Buffer.concat(chunks)});zip.readEntry();});stream.on('error',reject);
      });
    });
    zip.on('end',()=>resolve(files));zip.on('error',reject);zip.readEntry();
  }));
}

mkdirSync(OUT,{recursive:true});
const stamp=path.join(OUT,'.release');
if(!existsSync(path.join(OUT,'whisper-cli.exe'))||!existsSync(stamp)||readFileSync(stamp,'utf8')!==RELEASE.sha256){
  const files=await unzip(await download(RELEASE.url,RELEASE.sha256));
  if(!files.some(f=>f.name==='whisper-cli.exe'))throw new Error('whisper-cli.exe missing from the release.');
  for(const f of files)writeFileSync(path.join(OUT,f.name),f.bytes);
  writeFileSync(stamp,RELEASE.sha256);
}
for(const MODEL of MODELS){
  const modelPath=path.join(OUT,MODEL.file);
  if(!existsSync(modelPath)||sha(readFileSync(modelPath))!==MODEL.sha256)writeFileSync(modelPath,await download(MODEL.url,MODEL.sha256));
}
const system=path.join(process.env.WINDIR||'C:\\Windows','System32');
for(const dll of RUNTIME){
  const from=path.join(system,dll);
  if(!existsSync(from))throw new Error(`${dll} not found. Install the Microsoft Visual C++ Redistributable (x64) on the build machine.`);
  copyFileSync(from,path.join(OUT,dll));
}
console.log('Local Whisper check ready in '+OUT);
