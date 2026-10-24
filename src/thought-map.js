import {normalize} from './core.js';

export const edgeKey = (a,b) => JSON.stringify([a,b].sort());
const stopWords = new Set('the and for with that this from have want need should could would about into also idea ideas thought thoughts build make create project something my our your their them they then there what when where which will can use using more some all just work'.split(' '));
const terms = card => new Set(normalize(card.title+' '+card.source).split(' ').filter(t=>t.length>3&&!stopWords.has(t)).map(t=>t.endsWith('s')&&!t.endsWith('ss')?t.slice(0,-1):t));
export const mapSignature = cards => JSON.stringify(cards.map(c=>[c.id,c.title,c.source]));
// The AI routes accept at most 200 thoughts. Larger maps send the ones that matter now: the given ids
// (selection or conversation focus) first, then the newest thoughts, then the newest items under them.
export const AI_CARD_LIMIT = 200;
export function cardsForAI(cards,first=[],limit=AI_CARD_LIMIT) {
  if(cards.length<=limit)return cards;
  const wanted=new Set(first),picked=cards.filter(c=>wanted.has(c.id)).slice(0,limit);
  const rest=cards.filter(c=>!wanted.has(c.id)),ordered=[...rest.filter(c=>c.parentId),...rest.filter(c=>!c.parentId)];
  const room=limit-picked.length;
  return room?[...picked,...ordered.slice(-room)]:picked;
}

// Suggestions use user wording only; assistant proposals never become evidence.
export function mapLinks(state) {
  const ids=new Set(state.cards.map(c=>c.id)), links=new Map(), dismissed=new Set(state.dismissedMapLinks||[]);
  const add=link=>{const key=edgeKey(...link.ids);if(link.ids[0]!==link.ids[1]&&link.ids.every(id=>ids.has(id))&&!dismissed.has(key))links.set(key,{...link,key});};
  const tokens=state.cards.map(terms), candidates=[];
  // Items hang off their parent; they never create word-overlap links of their own.
  for(let a=0;a<state.cards.length;a++)for(let b=a+1;b<state.cards.length;b++){
    if(state.cards[a].parentId||state.cards[b].parentId)continue;
    const shared=[...tokens[a]].filter(t=>tokens[b].has(t));
    const sameGroup=state.cards[a].groupId&&state.cards[a].groupId===state.cards[b].groupId;
    if(shared.length>=2||sameGroup)candidates.push({ids:[state.cards[a].id,state.cards[b].id],kind:'topic',reason:sameGroup?'In the same group':`Shared words: ${shared.slice(0,4).join(', ')}`,score:shared.length+(sameGroup?5:0)});
  }
  const degrees=new Map();
  for(const link of candidates.sort((a,b)=>b.score-a.score)){
    if(link.ids.some(id=>(degrees.get(id)||0)>=3)||dismissed.has(edgeKey(...link.ids)))continue;
    add(link);link.ids.forEach(id=>degrees.set(id,(degrees.get(id)||0)+1));
  }
  if(state.mapAnalysis?.signature===mapSignature(state.cards))for(const link of state.mapAnalysis.links||[])add({...link,kind:'ai'});
  for(const card of state.cards)if(card.parentId&&ids.has(card.parentId))links.set(edgeKey(card.parentId,card.id),{ids:[card.parentId,card.id],key:edgeKey(card.parentId,card.id),kind:card.suggested?'item suggested':'item',reason:card.suggested?'Suggested item (keep or remove it)':'Item under this thought'});
  for(const pair of state.connections){const key=edgeKey(...pair);if(pair.length===2&&pair.every(id=>ids.has(id)))links.set(key,{ids:pair,key,kind:'manual',reason:'Connection you confirmed'});}
  return [...links.values()];
}

// Breadth-first rings keep connected thoughts together without overlapping cards.
export function mapLayout(cards,links) {
  const adjacency=new Map(cards.map(c=>[c.id,[]]));
  for(const {ids:[a,b]} of links){adjacency.get(a)?.push(b);adjacency.get(b)?.push(a);}
  const positions={},seen=new Set(),components=[];
  for(const card of [...cards].sort((a,b)=>adjacency.get(b.id).length-adjacency.get(a.id).length)){
    if(seen.has(card.id))continue;
    let level=[card.id],radius=0;const points=[];seen.add(card.id);
    while(level.length){
      if(radius)radius=Math.max(radius,level.length*300/(2*Math.PI));
      const next=[];
      level.forEach((id,i)=>{const angle=i/level.length*Math.PI*2-Math.PI/2;points.push({id,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius});for(const neighbor of adjacency.get(id)){if(!seen.has(neighbor)){seen.add(neighbor);next.push(neighbor);}}});
      level=next;radius+=310;
    }
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
    components.push({points:points.map(p=>({...p,x:p.x-minX,y:p.y-minY})),width:Math.max(...points.map(p=>p.x))-minX+240,height:Math.max(...points.map(p=>p.y))-minY+110});
  }
  const rowWidth=Math.max(1000,Math.sqrt(components.reduce((sum,c)=>sum+(c.width+100)*(c.height+100),0))*1.4);
  let x=50,y=50,rowHeight=0;
  for(const component of components){if(x>50&&x+component.width>rowWidth){x=50;y+=rowHeight+120;rowHeight=0;}for(const point of component.points)positions[point.id]={x:x+point.x,y:y+point.y};x+=component.width+120;rowHeight=Math.max(rowHeight,component.height);}
  return positions;
}

// Bring 1–2 thoughts forward: their items and linked thoughts fan out around them so the whole topic is
// visible at once. Returns temporary positions only; nothing is saved and the map returns when focus ends.
// The fan is a wide ellipse because the map is wider than it is tall; two focuses sit side by side and fan apart.
export function focusLayout(focusIds,cards,links,positions){
  const known=new Set(cards.map(c=>c.id)),focus=[...new Set(focusIds)].filter(id=>known.has(id)&&positions[id]).slice(0,2);
  const placed={},visible=new Set(focus),neighbours=id=>[...cards.filter(c=>c.parentId===id).map(c=>c.id),...links.filter(l=>l.ids.includes(id)).map(l=>l.ids.find(x=>x!==id))];
  const at=id=>placed[id]||positions[id];
  if(focus.length===2){const a=positions[focus[0]];placed[focus[1]]={x:a.x+520,y:a.y};}
  focus.forEach((f,n)=>{
    const ring=[...new Set(neighbours(f))].filter(id=>known.has(id)&&!visible.has(id));
    const p=at(f),rx=Math.max(400,ring.length*95),ry=Math.max(190,ring.length*42);
    // One focus: all the way round. Two: the left one fans left, the right one fans right.
    const span=focus.length===2?Math.PI*0.9:2*Math.PI,start=focus.length===2?(n===0?Math.PI*0.55:-Math.PI*0.45):-Math.PI/2;
    ring.forEach((id,i)=>{
      const angle=start+(span<2*Math.PI?(ring.length===1?span/2:span*i/(ring.length-1)):span*i/ring.length);
      placed[id]={x:p.x+Math.cos(angle)*rx,y:p.y+Math.sin(angle)*ry};visible.add(id);
      // Items under items continue outward along the same direction.
      cards.filter(c=>c.parentId===id&&!visible.has(c.id)).forEach((c,k,all)=>{const a=angle+(k-(all.length-1)/2)*0.28;placed[c.id]={x:p.x+Math.cos(a)*(rx+280),y:p.y+Math.sin(a)*(ry+130)};visible.add(c.id);});
    });
  });
  return {positions:placed,visible,focus};
}
