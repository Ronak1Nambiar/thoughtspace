// Recorded audio (webm/opus) → 16 kHz mono 16-bit WAV, which every speech-to-text engine accepts and
// on-device whisper.cpp requires. Decoding and resampling happen in the browser; nothing is uploaded.
export const SAMPLE_RATE=16000;

export function encodeWav(samples,sampleRate=SAMPLE_RATE){
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');
  text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);}
  return new Blob([buffer],{type:'audio/wav'});
}

export async function toWav16k(blob,host=globalThis){
  if(blob.type==='audio/wav')return blob;
  const Context=host.AudioContext||host.webkitAudioContext,Offline=host.OfflineAudioContext;
  if(!Context||!Offline)return blob;
  const context=new Context();
  try{
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    const length=Math.max(1,Math.ceil(decoded.duration*SAMPLE_RATE));
    // Rendering through a mono 16 kHz offline context mixes the channels down and resamples in one step.
    const offline=new Offline(1,length,SAMPLE_RATE),source=offline.createBufferSource();
    source.buffer=decoded;source.connect(offline.destination);source.start();
    const rendered=await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  }finally{void context.close?.();}
}
