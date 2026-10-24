import React,{useMemo,useRef,useState,useEffect} from 'react';
import {Plus,Minus,Maximize,Link2,X,Check,FileText,ArrowUpRight,LoaderCircle,ListPlus,Trash2} from 'lucide-react';
import {mapLinks,mapLayout,focusLayout} from './thought-map.js';
import './thought-map.css';

const MIN_ZOOM=.08,MAX_ZOOM=3;

export function ThoughtMap({state,selection,search,onSelect,onClear,onOpen,onMove,onConfirm,onDismiss,onAnalyze,analyzing,aiAvailable,onStarter,assistantName="Atlas",focus=[],onClearFocus=()=>{},onKeepItem,onRemoveItem,onAddItem,onDelete}){
  const links=useMemo(()=>mapLinks(state),[state.cards,state.connections,state.groups,state.dismissedMapLinks,state.mapAnalysis]);
  const layout=useMemo(()=>mapLayout(state.cards,links),[state.cards,links]);
  const base={...layout,...state.mapPositions};
  const focusKey=focus.join('|');
  const focused=useMemo(()=>focus.length?focusLayout(focus,state.cards,links,base):null,[focusKey,state.cards,links,layout,state.mapPositions]);
  const positions=focused?{...base,...focused.positions}:base;
  const [gliding,setGliding]=useState(false),[itemDraft,setItemDraft]=useState(''),[confirmDelete,setConfirmDelete]=useState(null);
  useEffect(()=>{if(!confirmDelete)return;const timer=setTimeout(()=>setConfirmDelete(null),4000);return()=>clearTimeout(timer);},[confirmDelete]);
  const container=useRef(null),gesture=useRef(null);
  const [size,setSize]=useState({width:900,height:550}),[camera,setCamera]=useState({x:0,y:0,zoom:1}),[moving,setMoving]=useState(null);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(container.current);return()=>observer.disconnect();},[]);
  function fit(ids=state.cards.map(c=>c.id),maxZoom=1.1){const points=ids.map(id=>positions[id]).filter(Boolean);if(!points.length)return;const minX=Math.min(...points.map(p=>p.x))-50,minY=Math.min(...points.map(p=>p.y))-50,maxX=Math.max(...points.map(p=>p.x))+290,maxY=Math.max(...points.map(p=>p.y))+160;const zoom=Math.min(maxZoom,size.width/(maxX-minX),size.height/(maxY-minY));setCamera({zoom,x:(size.width-(maxX-minX)*zoom)/2-minX*zoom,y:(size.height-(maxY-minY)*zoom)/2-minY*zoom});}
  const linkSignature=links.map(link=>link.key).join('|');
  useEffect(()=>{if(!focused)fit();},[state.cards.length,size.width,size.height,linkSignature]);
  // Glide to the thoughts being talked about; glide back out when focus ends.
  useEffect(()=>{setGliding(true);if(focused)fit([...focused.visible],1);else fit();const timer=setTimeout(()=>setGliding(false),750);return()=>clearTimeout(timer);},[focusKey,focused?.visible.size]);
  function zoomAt(factor,cx=size.width/2,cy=size.height/2){setGliding(false);setCamera(c=>{const zoom=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,c.zoom*factor)),ratio=zoom/c.zoom;return {zoom,x:cx-(cx-c.x)*ratio,y:cy-(cy-c.y)*ratio};});}
  const zoomBy=factor=>zoomAt(factor);
  const panBy=(dx,dy)=>{setGliding(false);setCamera(c=>({...c,x:c.x+dx,y:c.y+dy}));};
  // Mouse wheel zooms toward the cursor. Touchpad: pinch (sent as ctrl+wheel) zooms, two-finger swipe pans.
  // Panels on the map keep their own scrolling.
  const wheelRef=useRef(null);wheelRef.current=event=>{
    if(event.target.closest?.('.map-inspector,.map-hint,.map-controls,input,textarea,select'))return;
    event.preventDefault();
    const box=container.current.getBoundingClientRect(),cx=event.clientX-box.left,cy=event.clientY-box.top;
    const scale=event.deltaMode===1?16:event.deltaMode===2?box.height:1,dx=event.deltaX*scale,dy=event.deltaY*scale;
    const mouseWheel=event.deltaMode!==0||(!event.deltaX&&Math.abs(dy)>=50&&Number.isInteger(dy));
    if(event.ctrlKey||event.metaKey||(mouseWheel&&!event.shiftKey))zoomAt(Math.exp(-Math.max(-60,Math.min(60,dy))*(event.ctrlKey&&!mouseWheel?.012:.0025)),cx,cy);
    else if(event.shiftKey&&!dx)panBy(-dy,0);
    else panBy(-dx,-dy);
  };
  useEffect(()=>{const el=container.current,handler=e=>wheelRef.current(e);el.addEventListener('wheel',handler,{passive:false});return()=>el.removeEventListener('wheel',handler);},[]);
  // Keyboard on the map: + and - zoom, 0 fits, 1 is actual size, arrows pan (Shift: faster), Escape clears.
  const keyRef=useRef(null);keyRef.current=event=>{
    if(event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented)return;
    const target=event.target;if(target.closest?.('input,textarea,select,[contenteditable="true"],[aria-modal="true"]')||document.querySelector('[aria-modal="true"]'))return;
    // A focused thought uses the arrows to move itself.
    if(event.key.startsWith('Arrow')&&target.closest?.('.map-thought'))return;
    const step=event.shiftKey?240:80,actions={'+':()=>zoomBy(1.2),'=':()=>zoomBy(1.2),'-':()=>zoomBy(1/1.2),'_':()=>zoomBy(1/1.2),'0':()=>fit(),'1':()=>zoomAt(1/camera.zoom),ArrowLeft:()=>panBy(step,0),ArrowRight:()=>panBy(-step,0),ArrowUp:()=>panBy(0,step),ArrowDown:()=>panBy(0,-step),Escape:()=>{if(selection.length)onClear();else if(focus.length)onClearFocus();}};
    const action=actions[event.key];if(!action)return;
    event.preventDefault();action();
  };
  useEffect(()=>{const handler=e=>keyRef.current(e);window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  // Two fingers on a touch screen pinch to zoom and drag to pan.
  const touches=useRef(new Map()),pinch=useRef(null);
  function pinchStart(event){
    if(event.pointerType!=='touch')return false;
    touches.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(touches.current.size!==2)return false;
    const [a,b]=[...touches.current.values()];gesture.current=null;setMoving(null);
    pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y)||1,mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},camera};return true;
  }
  function pinchMove(event){
    if(!touches.current.has(event.pointerId))return false;
    touches.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const p=pinch.current;if(!p||touches.current.size<2)return false;
    const [a,b]=[...touches.current.values()],box=container.current.getBoundingClientRect();
    const zoom=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,p.camera.zoom*Math.hypot(a.x-b.x,a.y-b.y)/p.distance)),ratio=zoom/p.camera.zoom;
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},ox=p.mid.x-box.left,oy=p.mid.y-box.top;
    setCamera({zoom,x:ox-(ox-p.camera.x)*ratio+(mid.x-p.mid.x),y:oy-(oy-p.camera.y)*ratio+(mid.y-p.mid.y)});return true;
  }
  function pinchEnd(event){touches.current.delete(event.pointerId);if(touches.current.size<2&&pinch.current){pinch.current=null;return true;}return false;}
  function start(event,id){if(pinchStart(event)||pinch.current)return;const middle=event.button===1;if(middle)id=undefined;if((event.button!==0&&!middle)||(!id&&!middle&&event.target.closest('button,input,form')))return;setGliding(false);event.preventDefault();event.stopPropagation();container.current.setPointerCapture(event.pointerId);gesture.current={id,x:event.clientX,y:event.clientY,camera,position:id?positions[id]:null,shiftKey:event.shiftKey};}
  function move(event){if(pinchMove(event))return;const g=gesture.current;if(!g)return;const dx=event.clientX-g.x,dy=event.clientY-g.y;if(g.id)setMoving({id:g.id,x:g.position.x+dx/camera.zoom,y:g.position.y+dy/camera.zoom});else setCamera({...g.camera,x:g.camera.x+dx,y:g.camera.y+dy});}
  function end(event,cancelled=false){if(pinchEnd(event))return;const g=gesture.current;if(!g)return;gesture.current=null;const moved=Math.hypot(event.clientX-g.x,event.clientY-g.y)>4;if(!cancelled){if(g.id&&moved){onMove(g.id,{x:g.position.x+(event.clientX-g.x)/g.camera.zoom,y:g.position.y+(event.clientY-g.y)/g.camera.zoom});if(focused)onClearFocus();}else if(g.id)onSelect({shiftKey:g.shiftKey},g.id);else if(!moved){onClear();onClearFocus();}}setMoving(null);}
  const point=id=>moving?.id===id?moving:positions[id];
  const query=search.trim().toLowerCase(),matches=new Set(state.cards.filter(c=>(c.title+' '+c.source).toLowerCase().includes(query)).map(c=>c.id));
  const selectedLinks=links.filter(l=>l.ids.some(id=>selection.includes(id)));
  const neighbors=new Set(selectedLinks.flatMap(link=>link.ids));
  const previousIds=useRef(new Set(state.cards.map(card=>card.id)));
  const [arrival,setArrival]=useState('');
  useEffect(()=>{
    const fresh=state.cards.filter(card=>!previousIds.current.has(card.id)),items=fresh.filter(c=>c.parentId).length,added=fresh.length-items;
    previousIds.current=new Set(state.cards.map(card=>card.id));
    if(!fresh.length)return;
    setArrival(added?`${added===1?'1 new thought':`${added} new thoughts`} added to your map`:`${items===1?'1 item':`${items} items`} added${fresh.some(c=>c.suggested)?' · keep the ones you want':''}`);
  },[state.cards]);
  useEffect(()=>{if(!arrival)return;const timer=setTimeout(()=>setArrival(''),4000);return()=>clearTimeout(timer);},[arrival]);
  const childCount=id=>state.cards.filter(c=>c.parentId===id).length;
  // Everything under a thought, every level down: what Delete removes with it.
  const allItems=id=>{let n=0,level=[id];while(level.length){level=state.cards.filter(c=>level.includes(c.parentId)).map(c=>c.id);n+=level.length;}return n;};
  const one=selection.length===1?state.cards.find(c=>c.id===selection[0]):null;
  function submitItem(event){event.preventDefault();const text=itemDraft.trim();if(!text||!one)return;onAddItem?.(one.id,text);setItemDraft('');}
  return <div className={`thought-map ${focused?'focusing':''} ${gliding?'gliding':''}`} ref={container} role="region" aria-label="Thought map" onPointerDown={e=>start(e)} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onDoubleClick={e=>{const hit=document.elementFromPoint(e.clientX,e.clientY)||e.target,thought=hit.closest('.map-thought');if(thought){if(e.target!==thought)onOpen(thought.dataset.ideaId);return;}if(hit.closest('button,input,form,.map-inspector,.map-controls,.map-hint,.map-starters'))return;const box=container.current.getBoundingClientRect();zoomAt(1.6,e.clientX-box.left,e.clientY-box.top);}}>
    <div className="map-world" style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}>
      <svg className="map-lines" aria-hidden="true">{links.map(link=>{const a=point(link.ids[0]),b=point(link.ids[1]);if(!a||!b)return null;return <path data-testid="map-connection" key={link.key} className={`${link.kind} ${selection.some(id=>link.ids.includes(id))||focused&&link.ids.some(id=>focused.focus.includes(id))?'highlighted':''} ${focused&&!link.ids.every(id=>focused.visible.has(id))?'dimmed':''}`} d={`M ${a.x+120} ${a.y+50} Q ${(a.x+b.x)/2+150} ${(a.y+b.y)/2+20} ${b.x+120} ${b.y+50}`}><title>{link.reason}</title></path>;})}</svg>
      {state.cards.map((card,index)=><button key={card.id} data-testid="map-thought" data-idea-id={card.id} data-origin={card.origin==='imported'?'imported':'captured'} className={`map-thought ${card.color} ${card.parentId?'item':''} ${card.suggested?'suggested':''} ${focused?.focus.includes(card.id)?'focused':''} ${selection.includes(card.id)?'selected':''} ${neighbors.has(card.id)?'connected':''} ${query&&!matches.has(card.id)||focused&&!focused.visible.has(card.id)?'dimmed':''}`} style={{left:point(card.id).x,top:point(card.id).y,'--arrival-delay':`${Math.min(index,6)*35}ms`}} onPointerDown={e=>start(e,card.id)} onClick={e=>{if(e.detail===0)onSelect(e,card.id);}} onDoubleClick={()=>onOpen(card.id)} onKeyDown={e=>{if(e.key.startsWith('Arrow')){e.preventDefault();const p=point(card.id),step=e.shiftKey?40:10;onMove(card.id,{x:p.x+({ArrowRight:step,ArrowLeft:-step}[e.key]||0),y:p.y+({ArrowDown:step,ArrowUp:-step}[e.key]||0)});}}} aria-label={card.title} aria-pressed={selection.includes(card.id)}><span className="map-node-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span className="map-node-dot"/><strong>{card.title}</strong>{!card.parentId&&<span className="map-excerpt">{card.source}</span>}{card.suggested&&<span className="map-item-tag">Suggested</span>}{childCount(card.id)>0&&<span className="map-item-count">{childCount(card.id)} {childCount(card.id)===1?'item':'items'}</span>}</button>)}
    </div>
    {!state.cards.length&&<div className="map-empty">
      <svg className="map-seed" viewBox="0 0 220 100" aria-hidden="true"><path d="M42 64 Q85 65 110 32 T184 56"/><path d="M110 32 Q125 70 153 83"/><circle cx="42" cy="64" r="7"/><circle cx="110" cy="32" r="11"/><circle cx="184" cy="56" r="6"/><circle cx="153" cy="83" r="4"/></svg>
      <span className="map-empty-kicker">A little room to think</span><h2>Start with a spark.</h2><p>An idea, a question, something on your mind.<br/>Give it a place. See where it leads.</p>
      <div className="map-starters" onPointerDown={e=>e.stopPropagation()}>{[{label:'An idea to explore',draft:'I have an idea for '},{label:'A question to untangle',draft:'I wonder how '},{label:'Something to make',draft:'I want to build '}].map(({label,draft})=><button key={label} onClick={()=>onStarter(draft)}>{label}<ArrowUpRight size={13}/></button>)}</div>
      <span className="map-empty-footnote">Write below, or start a conversation with {assistantName}.</span>
    </div>}
    <div className={`map-arrival ${arrival?'visible':''}`} role="status" aria-live="polite" aria-atomic="true">{arrival&&<><Check size={14}/>{arrival}</>}</div>
    {query&&<div className="map-search-count" role="status">{matches.size} matching {matches.size===1?'thought':'thoughts'}</div>}
    <div className="map-controls" onPointerDown={e=>e.stopPropagation()}><span>{state.cards.length} {state.cards.length===1?'thought':'thoughts'} · {links.length} {links.length===1?'link':'links'}</span><button aria-label="Zoom out" onClick={()=>zoomBy(.8)}><Minus size={16}/></button><button aria-label="Fit map" title="Fit map (0)" onClick={()=>fit()}><Maximize size={16}/></button><button className="map-zoom-level" aria-label="Zoom level, click for actual size" title="Actual size (1)" onClick={()=>zoomAt(1/camera.zoom)}>{Math.round(camera.zoom*100)}%</button><button aria-label="Zoom in" onClick={()=>zoomBy(1.25)}><Plus size={16}/></button></div>
    {selection.length>0&&<section className="map-inspector" aria-label="Thought connections" onPointerDown={e=>e.stopPropagation()}><div className="map-inspector-heading"><strong>{selection.length===1?state.cards.find(c=>c.id===selection[0])?.title:`${selection.length} thoughts selected`}</strong><button aria-label="Clear selection" onClick={onClear}><X size={15}/></button></div><button onClick={()=>onOpen(selection[0])}><FileText size={14}/> Open notes</button>{one?.suggested&&<div className="map-item-actions"><button className="keep" onClick={()=>onKeepItem?.(one.id)}><Check size={14}/> Keep item</button><button onClick={()=>onRemoveItem?.(one.id)}><X size={14}/> Remove</button></div>}{one?.parentId&&!one.suggested&&<button onClick={()=>onRemoveItem?.(one.id)}><Trash2 size={14}/> Remove item</button>}{one&&!one.parentId&&onDelete&&<button className={`map-delete ${confirmDelete===one.id?'confirming':''}`} onClick={()=>{if(confirmDelete===one.id){setConfirmDelete(null);onDelete(one.id);}else setConfirmDelete(one.id);}}><Trash2 size={14}/> {confirmDelete===one.id?`Click again to delete${allItems(one.id)?` it and ${allItems(one.id)} ${allItems(one.id)===1?'item':'items'}`:''}`:'Delete thought'}</button>}{one&&<form className="map-item-add" onSubmit={submitItem}><input aria-label={`Add an item under ${one.title}`} value={itemDraft} maxLength={120} placeholder="Add an item…" onChange={e=>setItemDraft(e.target.value)} onKeyDown={e=>e.stopPropagation()}/><button type="submit" aria-label="Add item" disabled={!itemDraft.trim()}><ListPlus size={14}/></button></form>}{selectedLinks.map(link=><div className="map-link-detail" key={link.key}><div><strong>{link.ids.map(id=>state.cards.find(c=>c.id===id)?.title).join(' ↔ ')}</strong><p>{link.kind==='ai'?'AI suggestion · ':link.kind==='topic'?'Suggested · ':''}{link.reason}</p></div>{!link.kind.startsWith('item')&&link.kind!=='manual'&&<button aria-label={`Keep connection: ${link.reason}`} onClick={()=>onConfirm(link.ids)}><Check size={14}/></button>}{!link.kind.startsWith('item')&&<button aria-label={`Remove connection: ${link.reason}`} onClick={()=>onDismiss(link.ids)}><X size={14}/></button>}</div>)}{!selectedLinks.length&&<p>No connections yet. Shift-click another thought to connect it.</p>}{selection.length===2&&<button onClick={()=>onConfirm(selection)}><Plus size={14}/> Connect selected</button>}</section>}
    {state.cards.length>0&&<div className="map-hint" onPointerDown={e=>e.stopPropagation()}><span>Dashed links are suggestions</span><button disabled={!aiAvailable||analyzing||state.cards.length<2} title={!aiAvailable?'Connect an AI provider in settings to explore deeper connections':state.cards.length<2?'Add another thought to explore connections':undefined} onClick={onAnalyze}>{analyzing?<LoaderCircle size={13} className="spin"/>:<Link2 size={13}/>} {analyzing?'Finding connections…':'Find deeper connections'}</button></div>}
  </div>;
}
