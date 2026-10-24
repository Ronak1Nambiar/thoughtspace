import {jsonArrayEntry} from './zip.mjs';
const iso=seconds=>typeof seconds==='number'?new Date(seconds*1000).toISOString():null;
const textOf=message=>{const c=message?.content;if(!c)return '';if(['text','multimodal_text'].includes(c.content_type))return (c.parts||[]).filter(p=>typeof p==='string').join('\n').trim();return '';};

// Converts one ChatGPT conversation. Edited prompts create branches; only the branch the user last saw (current_node) is kept.
export function chatgptConversation(c){
  const mapping=c.mapping||{},messages=[],seen=new Set();
  for(let node=mapping[c.current_node];node&&!seen.has(node.id);node=mapping[node.parent]){
    seen.add(node.id);const m=node.message,role=m?.author?.role;
    if(!['user','assistant'].includes(role)||m.metadata?.is_visually_hidden_from_conversation)continue;
    const text=textOf(m);if(text)messages.push({role,text,createdAt:iso(m.create_time)});
  }
  messages.reverse();
  return {externalId:c.conversation_id||c.id||`${c.title}-${c.create_time}`,title:(c.title||messages[0]?.text||'Untitled conversation').slice(0,200),createdAt:iso(c.create_time),updatedAt:iso(c.update_time),messages};
}
export async function* chatgptExport(file){for await(const c of jsonArrayEntry(file,'conversations.json')){if(c&&typeof c==='object'){const doc=chatgptConversation(c);if(doc.messages.length)yield doc;}}}
