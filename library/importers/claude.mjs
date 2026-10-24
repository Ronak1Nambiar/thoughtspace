import {jsonArrayEntry} from './zip.mjs';
const textOf=m=>{const blocks=Array.isArray(m.content)?m.content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text):[];return (blocks.length?blocks.join('\n'):typeof m.text==='string'?m.text:'').trim();};

export function claudeConversation(c){
  const messages=(c.chat_messages||[]).map(m=>({role:m.sender==='human'?'user':m.sender==='assistant'?'assistant':null,text:textOf(m),createdAt:m.created_at??null})).filter(m=>m.role&&m.text);
  return {externalId:c.uuid,title:(c.name||messages[0]?.text||'Untitled conversation').slice(0,200),createdAt:c.created_at??null,updatedAt:c.updated_at??null,messages};
}
export async function* claudeExport(file){for await(const c of jsonArrayEntry(file,'conversations.json')){if(c?.uuid){const doc=claudeConversation(c);if(doc.messages.length)yield doc;}}}
