// Acoustic check of the wake listener with a custom name, using Windows speech synthesis for the audio.
// Usage: node scripts/verify-wake-name.mjs [Name]   (default Nova). Needs npm run build:wake first.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const name=process.argv[2]||'Nova';
const exe=path.resolve('desktop/native/WakeListener.exe');
const dir=mkdtempSync(path.join(tmpdir(),'wake-name-'));
const say=(text,file)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=-1; $s.SetOutputToWaveFile('${file}'); $s.Speak('${text.replace(/'/g,"''")}'); $s.Dispose()`],{windowsHide:true});
const run=(file,extra=[])=>execFileSync(exe,['--phrases',`${name}|Hey ${name}`,'--wave',file,...extra],{encoding:'utf8',windowsHide:true,timeout:30000})
  .trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);

const cases=[
  {text:name,expect:true},{text:`Hey ${name}`,expect:true},
  {text:'Hello there',expect:false},{text:'Pass me the hammer',expect:false},
  {text:'I would like a ham sandwich',expect:false},{text:'Let us review the proposal and the dashboard at the meeting',expect:false},
];
let failed=0;const results=[];
try{
  for(const [i,c] of cases.entries()){
    const file=path.join(dir,`case-${i}.wav`);say(c.text,file);
    const events=run(file),hit=events.some(e=>e.type==='detected');
    const ok=hit===c.expect;if(!ok)failed++;
    results.push({text:c.text,expected:c.expect?'wake':'ignore',got:hit?'wake':'ignore',ok});
  }
  // Calibration mode reports each match with its confidence instead of exiting.
  const file=path.join(dir,'calibrate.wav');say(`${name}. ${name}. ${name}.`,file);
  const heard=run(file,['--calibrate']).filter(e=>e.type==='heard');
  results.push({text:`${name} ×3 (calibrate)`,expected:'3 heard',got:`${heard.length} heard (${heard.map(h=>h.confidence).join(', ')})`,ok:heard.length>=2});
  if(heard.length<2)failed++;
}finally{rmSync(dir,{recursive:true,force:true});}
console.table(results);
writeFileSync('artifacts/wake-name-results.json',JSON.stringify({name,results,at:new Date().toISOString()},null,2));
if(failed){console.error(`${failed} wake-name check(s) failed.`);process.exit(1);}
console.log(`Wake name "${name}" passed all checks.`);
