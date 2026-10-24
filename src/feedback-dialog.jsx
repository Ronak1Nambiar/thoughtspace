import React,{useState} from 'react';
import {X,Copy,ArrowUpRight} from 'lucide-react';

const REPO='https://github.com/Ronak1Nambiar/thoughtspace';
// The five tester questions plus this device's usage numbers, editable before anything leaves the app.
// Copy works for anyone (text, DM, email); the GitHub route needs an account, so it is the second option.
export function FeedbackDialog({text,onClose}){
  const [draft,setDraft]=useState(text),[status,setStatus]=useState('');
  async function copy(){
    try{await navigator.clipboard.writeText(draft);setStatus('Copied. Paste it into a message to whoever sent you Thoughtspace.');}
    catch{setStatus('Could not copy. Select the text and press Ctrl+C.');}
  }
  function github(){
    if(window.thoughtspaceDesktop?.sendFeedback)void window.thoughtspaceDesktop.sendFeedback(draft);
    else window.open(REPO+'/issues/new?'+new URLSearchParams({title:'',body:draft.slice(0,6000),labels:'tester-feedback'}),'_blank','noreferrer');
  }
  return <div className="modal-backdrop"><section className="modal feedback-modal" role="dialog" aria-modal="true" aria-label="Send feedback">
    <button className="modal-close" aria-label="Close feedback" onClick={onClose}><X size={20}/></button>
    <span className="eyebrow">FEEDBACK</span><h2>Tell us how it went.</h2>
    <p>Answer under each question. The usage numbers at the bottom were counted on this device; edit or delete anything. Nothing is sent until you copy it or open it on GitHub.</p>
    <textarea aria-label="Feedback text" className="feedback-text" value={draft} onChange={e=>setDraft(e.target.value)} rows={18}/>
    <div className="feedback-actions"><button className="primary" onClick={()=>void copy()}><Copy size={14}/> Copy feedback</button><button onClick={github}><ArrowUpRight size={14}/> Open as a GitHub issue</button></div>
    <p className="helper" role="status">{status||'GitHub needs an account. Copying works anywhere.'}</p>
  </section></div>;
}
