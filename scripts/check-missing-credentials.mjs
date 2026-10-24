import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Control-flow test only. This is not a microphone or live-provider test.
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({provider:'Groq',configured:false,ready:false,message:'Missing server credential'}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const output='artifacts/missing-credentials-results.json';
  const child=spawn(process.execPath,['scripts/verify-live.mjs'],{env:{...process.env,VERIFY_BASE_URL:`http://127.0.0.1:${server.address().port}`,VERIFY_RESULT_PATH:output},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.resume();child.stderr.resume();
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  assert.equal(code,2);
  const result=JSON.parse(await readFile(output,'utf8'));
  assert.equal(result.status,'blocked');assert.match(result.error,/credentials are missing/);assert.match(result.voiceAcceptance,/NOT VERIFIED/);
  console.log('PASS missing-credential branch reports BLOCKED and does not claim voice acceptance');
}finally{server.close();}
