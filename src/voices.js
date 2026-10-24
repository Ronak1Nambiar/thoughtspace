// Reply voices by speech service. Shared by the server (validation) and the voice pickers.
export const SPEECH_VOICES={groq:['autumn','diana','hannah','austin','daniel','troy'],openai:['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse']};
export const SERVICE_LABEL={groq:'Groq Orpheus',openai:'OpenAI',device:'Windows voice'};
export const voiceLabel=({service,voice})=>service==='device'?'Windows voice':voice[0].toUpperCase()+voice.slice(1);
// Which services this install can use right now.
export const availableVoices=voice=>[...(voice?.naturalSpeech?SPEECH_VOICES.groq.map(v=>({service:'groq',voice:v})):[]),...(voice?.openaiSpeech?SPEECH_VOICES.openai.map(v=>({service:'openai',voice:v})):[]),{service:'device',voice:'device'}];
