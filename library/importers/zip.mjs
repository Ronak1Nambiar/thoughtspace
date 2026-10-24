import yauzl from 'yauzl';
import {createRequire} from 'node:module';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream';
const require=createRequire(import.meta.url);
const {parser}=require('stream-json');
const {streamArray}=require('stream-json/streamers/StreamArray');

export const MAX_ZIP_BYTES=2*1024**3;
const fail=message=>Object.assign(new Error(message),{status:400});
// Entries are streamed straight into the parser and never written to disk, so hostile paths cannot escape; they are still refused outright.
const unsafe=name=>name.includes('\\')||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').includes('..');

export async function openZip(file){
  if((await stat(file)).size>MAX_ZIP_BYTES)throw fail('This export is larger than 2 GB. Split it or contact support.');
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false},(error,zip)=>error?reject(fail('This file is not a readable zip export.')):resolve(zip)));
}
export async function listEntries(zip){
  return new Promise((resolve,reject)=>{const entries=[];zip.on('entry',entry=>{if(unsafe(entry.fileName)){zip.close();return reject(fail('This export contains unsafe file paths and was not opened.'));}entries.push(entry);zip.readEntry();});zip.on('end',()=>resolve(entries));zip.on('error',e=>reject(/relative path|absolute path|invalid characters/i.test(e.message)?fail('This export contains unsafe file paths and was not opened.'):fail('This zip export is damaged. Download it again.')));zip.readEntry();});
}
// Streams the top-level array of a JSON entry one element at a time (ChatGPT exports reach hundreds of MB).
export async function* jsonArrayEntry(file,basename){
  const zip=await openZip(file);
  try{
    const entries=await listEntries(zip);
    const entry=entries.filter(e=>path.posix.basename(e.fileName)===basename).sort((a,b)=>a.fileName.split('/').length-b.fileName.split('/').length)[0];
    if(!entry)throw fail(`This zip has no ${basename}. Choose the export file the service emailed you.`);
    const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,s)=>error?reject(error):resolve(s)));
    // pipeline (not pipe) carries a parse error in any stage through to the loop below instead of crashing the process.
    const items=pipeline(stream,parser(),streamArray(),()=>{});
    try{for await(const {value} of items)yield value;}
    catch(e){throw e.status?e:fail(`${basename} is not valid JSON. Request a fresh export and try again.`);}
  }finally{zip.close();}
}
