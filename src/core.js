export const uid = () => crypto.randomUUID();
export const emptyWorkspace = () => ({version:1,cards:[],captures:[],groups:[],connections:[],messages:[],draft:''});
export const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// Older workspaces already retain the first excerpt in sourceHistory.
export const originalWording = card => card.originalSource ?? card.sourceHistory?.[0] ?? card.source;
export const aiSuggestionCount = card => card.notes.filter(note=>note.kind==='assistant').length;
export const summaryLabel = card => ({ai:'AI-assisted summary',local:'Summary from your words',user:'Your summary',manual:'Your summary'}[card.summaryOrigin]||'Idea summary');
export function captureText(state, text, id = uid()) {
  if (state.captures.some(c=>c.id===id)) return state;
  return {...state,captures:[...state.captures,{id,text,original:text,revisions:[],revision:0,status:'pending',createdAt:new Date().toISOString()}]};
}
export function correctCapture(state,id,text) {
  return {...state,captures:state.captures.map(c=>c.id===id?{...c,text,revisions:[...c.revisions,c.text],revision:c.revision+1,status:'pending',error:null}:c)};
}
export function applyExtraction(state,captureId,revision,ideas,{summaryOrigin='ai'}={}) {
  const capture=state.captures.find(c=>c.id===captureId);
  if(!capture || capture.revision!==revision || capture.status==='processed') return state;
  const cards=[...state.cards], seen=new Set();
  const proposalNotes=idea=>idea.engineering?[{id:`${captureId}-engineering-${revision}-${normalize(idea.source)}`,kind:"assistant",text:Object.entries(idea.engineering).map(([key,value])=>`${key[0].toUpperCase()+key.slice(1)}: ${value}`).join("\n\n"),engineering:idea.engineering,createdAt:new Date().toISOString()}]:[];
  for(const idea of ideas) {
    const key=normalize(idea.source);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    // Only deduplicate inside one source event. Identical words in a new capture may be intentional.
    const existing=cards.find(c=>c.captureId===captureId && (c.id===idea.existingId || normalize(c.source)===key));
    if(existing) {
      const index=cards.indexOf(existing);
      cards[index]={...existing,notes:[...existing.notes,...proposalNotes(idea).filter(n=>!existing.notes.some(old=>old.id===n.id))],originalSource:originalWording(existing),source:idea.source,sourceRevision:revision,sourceHistory:[...(existing.sourceHistory||[]),...(existing.source!==idea.source?[existing.source]:[])]};
    } else cards.push({id:uid(),captureId,origin:'captured',summaryOrigin,title:idea.title,source:idea.source,originalSource:idea.source,sourceRevision:revision,notes:proposalNotes(idea),history:[],priority:'Normal',kind:'idea',done:false,position:null,groupId:null,color:['sage','sand','lavender'][cards.length%3]});
  }
  return {...state,cards,captures:state.captures.map(c=>c.id===captureId?{...c,status:'processed',error:null}:c)};
}
export function addNote(state,ids,text,kind='manual',requestId=uid()) {
  return {...state,cards:state.cards.map(c=>ids.includes(c.id)&&!c.notes.some(n=>n.id===requestId)?{...c,notes:[...c.notes,{id:requestId,text,kind,createdAt:new Date().toISOString()}]}:c)};
}
export function localIdea(state,id) {
  const c=state.captures.find(c=>c.id===id);
  return applyExtraction(state,id,c.revision,[{title:c.text.slice(0,80),source:c.text}],{summaryOrigin:'manual'});
}
export function splitLocal(text){
  // Conservative clause boundaries; no semantic model or network call.
  return text.split(/(?<=[.!?])\s+|\n+|,?\s+and\s+(?=I\s+(?:also|should|need|want)\b)|,?\s+(?=I\s+also\b)/u).map(s=>s.trim()).filter(Boolean).map(source=>({title:source.replace(/^(?:and\s+)?I\s+(?:also\s+)?(?:have an idea for\s+|need to\s+|should\s+|want to\s+)?/i,'').replace(/[.!?]$/,'').replace(/^./,s=>s.toUpperCase()).slice(0,80),source}));
}
export function localExtract(state,id){
  const c=state.captures.find(c=>c.id===id);
  const existing=state.cards.filter(card=>card.captureId===id);
  // Corrections never create replacements for existing cards without explicit manual splitting.
  if(existing.length){return {...state,captures:state.captures.map(x=>x.id===id?{...x,status:'processed',error:null}:x)};}
  return applyExtraction(state,id,c.revision,splitLocal(c.text),{summaryOrigin:'local'});
}

// Imported ideas (from the Library) become cards grouped by theme. Cards stay small: the full conversation stays in the Library, found by docId.
// Re-importing is idempotent: known ideas keep the user's edits, positions and notes and only gain new sources.
export const IMPORT_MAP_LIMIT=300;
const importRank={project:0,decision:1,idea:2,question:3};
export function applyImport(state,{themes=[],ideas=[],docEdges=[]},{limit=IMPORT_MAP_LIMIT,themeIds=null}={}){
  const byImport=new Map(state.cards.filter(c=>c.importId).map(c=>[c.importId,c]));
  const wanted=ideas.filter(i=>!themeIds||themeIds.includes(i.themeId));
  const fresh=wanted.filter(i=>!byImport.has(i.id)).sort((a,b)=>b.sourceRefs.length-a.sourceRefs.length||(importRank[a.kind]??4)-(importRank[b.kind]??4));
  const room=Math.max(0,limit-state.cards.filter(c=>c.origin==='imported').length),added=fresh.slice(0,room);
  const groupId=themeId=>themeId?'theme-'+themeId:null,used=new Set(added.map(i=>i.themeId).filter(Boolean));
  const groups=[...state.groups,...themes.filter(t=>used.has(t.id)&&!state.groups.some(g=>g.id===groupId(t.id))).map(t=>({id:groupId(t.id),name:t.title,imported:true}))];
  const refreshed=state.cards.map(c=>{const idea=c.importId&&ideas.find(i=>i.id===c.importId);if(!idea)return c;const refs=[...c.sourceRefs,...idea.sourceRefs.filter(r=>!c.sourceRefs.some(o=>o.docId===r.docId))];return refs.length===c.sourceRefs.length?c:{...c,sourceRefs:refs};});
  const cards=[...refreshed,...added.map((idea,n)=>({id:uid(),importId:idea.id,captureId:null,origin:'imported',summaryOrigin:'ai',title:idea.title,source:idea.summary||idea.sourceRefs[0]?.quote||idea.title,originalSource:idea.sourceRefs[0]?.quote||idea.title,sourceRevision:0,sourceRefs:idea.sourceRefs,ideaKind:idea.kind,notes:[],history:[],priority:'Normal',kind:'idea',done:false,position:null,groupId:groupId(idea.themeId),color:['sage','sand','lavender'][(state.cards.length+n)%3]}))];
  // Notes that link to each other ([[wikilinks]]) connect their first ideas on the map.
  const firstCard=new Map();for(const c of cards)for(const r of c.sourceRefs||[])if(!firstCard.has(r.docId))firstCard.set(r.docId,c.id);
  const known=new Set(state.connections.map(p=>JSON.stringify([...p].sort())));const connections=[...state.connections];
  for(const [a,b] of docEdges){const pair=[firstCard.get(a),firstCard.get(b)];const key=JSON.stringify([...pair].sort());if(pair[0]&&pair[1]&&pair[0]!==pair[1]&&!known.has(key)){known.add(key);connections.push(pair);}}
  return {state:{...state,cards,groups,connections},added:added.length,remaining:fresh.length-added.length};
}

// Items are small child thoughts under a parent: the assistant's suggestions (dashed until kept) or the user's own.
// parentId is the live link; it follows the parent wherever it moves and survives edits.
export const childrenOf=(state,id)=>state.cards.filter(c=>c.parentId===id);
export function addItems(state,items,{origin='suggested',requestId=uid()}={}) {
  const cards=[...state.cards],added=[];
  items.forEach(({cardId,text},n)=>{
    const parent=cards.find(c=>c.id===cardId),title=String(text||'').replace(/\s+/g,' ').trim().slice(0,120);
    const id=`${requestId}-item-${n}`;
    if(!parent||!title||cards.some(c=>c.id===id||(c.parentId===cardId&&normalize(c.title)===normalize(title))))return;
    const item={id,parentId:cardId,origin,suggested:origin==='suggested',summaryOrigin:origin==='suggested'?'ai':'user',title,source:title,originalSource:title,sourceRevision:0,notes:[],history:[],priority:'Normal',kind:'item',done:false,position:null,groupId:null,color:parent.color};
    cards.push(item);added.push(item);
  });
  return {state:added.length?{...state,cards}:state,added};
}
export const keepItem=(state,id)=>({...state,cards:state.cards.map(c=>c.id===id?{...c,suggested:false}:c)});
// Removing an item removes the items under it too.
export function removeItem(state,id){
  const gone=new Set([id]);let grew=true;
  while(grew){grew=false;for(const c of state.cards)if(c.parentId&&gone.has(c.parentId)&&!gone.has(c.id)){gone.add(c.id);grew=true;}}
  const positions=Object.fromEntries(Object.entries(state.mapPositions||{}).filter(([k])=>!gone.has(k)));
  return {...state,cards:state.cards.filter(c=>!gone.has(c.id)),connections:state.connections.filter(p=>!p.some(x=>gone.has(x))),...(state.mapPositions?{mapPositions:positions}:{})};
}
