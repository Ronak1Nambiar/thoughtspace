import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {version}=JSON.parse(await readFile('node_modules/electron/package.json','utf8'));
const artifact=`electron-v${version}-win32-x64.zip`;
const checksums=JSON.parse(await readFile('node_modules/electron/checksums.json','utf8'));
const url=`https://github.com/electron/electron/releases/download/v${version}/${artifact}`;
const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
if(!head.ok)throw new Error('Electron download failed: '+head.status);
const size=Number(head.headers.get('content-length')),chunkSize=4*1024*1024;
if(!size)throw new Error('Download size unavailable.');
const chunks=Array(Math.ceil(size/chunkSize));let next=0,completed=0;
await Promise.all(Array.from({length:6},async()=>{
  for(;;){
    const i=next++;if(i>=chunks.length)return;
    const start=i*chunkSize,end=Math.min(size-1,start+chunkSize-1);
    const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(45000)});
    if(response.status!==206)throw new Error('Range download failed: '+response.status);
    chunks[i]=Buffer.from(await response.arrayBuffer());
    if(chunks[i].length!==end-start+1)throw new Error('Incomplete Electron download.');
    completed++;if(completed%10===0)console.log(`Downloaded ${completed}/${chunks.length} parts`);
  }
}));
const bytes=Buffer.concat(chunks);
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==checksums[artifact])throw new Error('Electron checksum did not match.');
await mkdir('.desktop-cache',{recursive:true});
await writeFile('.desktop-cache/electron.zip',bytes);
console.log(JSON.stringify({artifact,bytes:bytes.length,checksumVerified:true}));
