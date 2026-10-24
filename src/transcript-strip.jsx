import React from 'react';

export function TranscriptStrip({preview,active,finalized,unsaved,onHistory}){
  if(!active&&!preview.text&&!finalized)return null;
  const unavailable=['unsupported','unavailable'].includes(preview.status);
  return <section className="transcript-strip" aria-label="Voice transcript">
    {(active||preview.text)&&<div className="transcript-provisional" data-testid="provisional-transcript">
      <strong>Provisional <span>Not saved</span></strong>
      <p aria-live="polite" aria-atomic="true">{preview.text|| (unavailable?'Live preview is unavailable here. Your finalized transcript will appear after you pause or stop.':preview.status==='checking'?'Checking on-device live preview...':'Your words will appear here when on-device recognition is available.')}</p>
      {preview.text&&<small>{unavailable?'Live preview stopped. ':''}Wording may change. Only finalized text creates ideas.</small>}
    </div>}
    {finalized&&<div className="transcript-final" data-testid="finalized-transcript">
      <strong>Latest finalized transcript <span>{unsaved?'Not saved':'Saved on this device'}</span></strong>
      <p aria-live="polite">{finalized.text}</p>
      <button onClick={onHistory}>Review or correct transcripts</button>
    </div>}
  </section>;
}
