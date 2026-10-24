// Optional on-device captions. Never send preview audio to a browser cloud service.
// Only the separate Groq transcription path can persist text or extract ideas.
export class TranscriptPreview {
  constructor(onChange){this.onChange=onChange;this.text='';this.generation=0;}
  emit(status){this.onChange({text:this.text,status});}
  stop(){
    this.generation++;
    if(this.recognition){
      this.recognition.onresult=null;this.recognition.onerror=null;this.recognition.onend=null;
      try{this.recognition.abort();}catch{}
      this.recognition=null;
    }
  }
  clear(){this.stop();this.text='';this.emit('idle');}
  async start({reset=true}={}){
    this.stop();const generation=this.generation;
    if(reset)this.text='';
    this.emit('checking');
    const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
    try{
      if(!Recognition||typeof Recognition.available!=='function'){this.emit('unsupported');return;}
      const recognition=new Recognition();
      if(!('processLocally' in recognition)){this.emit('unsupported');return;}
      const lang=navigator.language||'en-US';
      const availability=await Recognition.available({langs:[lang],processLocally:true});
      if(generation!==this.generation)return;
      if(availability!=='available'){this.emit('unavailable');return;}
      recognition.processLocally=true;recognition.lang=lang;
      recognition.continuous=true;recognition.interimResults=true;
      const prefix=this.text;
      recognition.onresult=event=>{
        if(generation!==this.generation)return;
        // Results replace earlier hypotheses; never append the same result twice.
        const parts=Array.from(event.results,result=>result[0]?.transcript||'');
        this.text=[prefix,...parts].filter(Boolean).join(' ').trim();
        this.emit('listening');
      };
      recognition.onerror=()=>{if(generation===this.generation){this.stop();this.emit('unavailable');}};
      recognition.onend=()=>{if(generation===this.generation){this.stop();this.emit('unavailable');}};
      this.recognition=recognition;recognition.start();this.emit('listening');
    }catch{if(generation===this.generation){this.stop();this.emit('unavailable');}}
  }
}
