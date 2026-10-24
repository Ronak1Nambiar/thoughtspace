// How the app looks: theme, accent and text density. Saved per device and applied to <html>.
export const THEMES=Object.freeze([
  {id:'midnight',name:'Midnight',mode:'dark',blurb:'Calm dark workspace for long sessions.'},
  {id:'graphite',name:'Graphite',mode:'dark',blurb:'Neutral black, high contrast, no tint.'},
  {id:'paper',name:'Paper',mode:'light',blurb:'Warm light pages with serif headings.'},
  {id:'workbench',name:'Workbench',mode:'light',blurb:'Crisp, square, technical. Monospaced titles.'},
]);
export const ACCENTS=Object.freeze([
  {id:'teal',name:'Teal',dark:'#7fdcc8',light:'#0f7a68'},
  {id:'blue',name:'Blue',dark:'#8cb8ff',light:'#2459c9'},
  {id:'violet',name:'Violet',dark:'#b9a2ff',light:'#6b47d6'},
  {id:'amber',name:'Amber',dark:'#f2c46d',light:'#9a6400'},
  {id:'rose',name:'Rose',dark:'#ff9fb0',light:'#b8344f'},
  {id:'green',name:'Green',dark:'#a6d98a',light:'#3d7a1f'},
]);
export const DENSITIES=Object.freeze([{id:'comfortable',name:'Comfortable'},{id:'compact',name:'Compact'}]);
export const APPEARANCE_KEY='thoughtspace.appearance.v1';
export const DEFAULT_APPEARANCE=Object.freeze({theme:'midnight',accent:'teal',density:'comfortable'});
const pick=(list,id,fallback)=>list.some(item=>item.id===id)?id:fallback;

export function cleanAppearance(value){
  const v=value&&typeof value==='object'?value:{};
  return {theme:pick(THEMES,v.theme,DEFAULT_APPEARANCE.theme),accent:pick(ACCENTS,v.accent,DEFAULT_APPEARANCE.accent),density:pick(DENSITIES,v.density,DEFAULT_APPEARANCE.density)};
}
export function readAppearance(storage=globalThis.localStorage){
  try{const raw=storage?.getItem(APPEARANCE_KEY);return raw?{...cleanAppearance(JSON.parse(raw)),saved:true}:{...DEFAULT_APPEARANCE,saved:false};}
  catch{return {...DEFAULT_APPEARANCE,saved:false};}
}
export function saveAppearance(value,storage=globalThis.localStorage){
  const clean=cleanAppearance(value);
  try{storage?.setItem(APPEARANCE_KEY,JSON.stringify(clean));}catch{}
  return clean;
}
// Switching looks fades colours over THEME_FADE_MS instead of snapping. The first paint stays instant,
// and nothing fades when the look is unchanged or the system asks for reduced motion.
export const THEME_FADE_MS=360;
let fadeTimer;
function fadeColours(root){
  if(!root.classList||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  root.classList.add('theme-switching');
  clearTimeout(fadeTimer);
  fadeTimer=setTimeout(()=>root.classList.remove('theme-switching'),THEME_FADE_MS+60);
}
export function applyAppearance(value,root=globalThis.document?.documentElement){
  const clean=cleanAppearance(value);
  if(!root)return clean;
  const theme=THEMES.find(t=>t.id===clean.theme);
  const d=root.dataset;
  if(d.theme&&(d.theme!==clean.theme||d.accent!==clean.accent))fadeColours(root);
  root.dataset.theme=clean.theme;root.dataset.mode=theme.mode;root.dataset.accent=clean.accent;root.dataset.density=clean.density;
  const meta=globalThis.document?.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=getComputedStyle(root).getPropertyValue('--bg').trim()||meta.content;
  return clean;
}
