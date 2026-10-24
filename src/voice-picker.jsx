import React from 'react';
import {AudioLines} from 'lucide-react';
import {availableVoices,voiceLabel,SERVICE_LABEL} from './voices.js';

// Quick voice switch beside the conversation controls. Picking a voice says a short line in it.
export function VoicePicker({value,voiceStatus,onChange,disabled}){
  const options=availableVoices(voiceStatus);
  const current=`${value.service}:${value.service==='device'?'device':value.voice}`;
  // A saved voice whose service has no key right now still shows, so the picker never lies about the setting.
  if(!options.some(o=>`${o.service}:${o.voice}`===current))options.unshift({service:value.service,voice:value.service==='device'?'device':value.voice,missing:true});
  const groups=['groq','openai','device'].map(service=>[service,options.filter(o=>o.service===service)]).filter(([,list])=>list.length);
  return <label className="voice-picker" title="Reply voice">
    <AudioLines size={14} aria-hidden="true"/>
    <select aria-label="Reply voice" value={current} disabled={disabled} onChange={e=>{const [service,voice]=e.target.value.split(':');onChange({service,voice:service==='device'?value.voice:voice});}}>
      {groups.map(([service,list])=><optgroup key={service} label={SERVICE_LABEL[service]}>{list.map(o=><option key={o.service+o.voice} value={`${o.service}:${o.voice}`}>{voiceLabel(o)}{o.missing?' (needs a key)':''}</option>)}</optgroup>)}
    </select>
  </label>;
}
