// Local usage numbers for feedback. They stay on this device and are only shown inside the feedback text,
// which the user reads and edits before sending it anywhere. Nothing is sent automatically (no telemetry).
export const USAGE_KEY='thoughtspace.usage.v1';
const MAX_DAYS=120;
const day=now=>now.toISOString().slice(0,10);
export function readUsage(){try{const u=JSON.parse(localStorage.getItem(USAGE_KEY)||'null');return Array.isArray(u?.days)?u:{days:[]};}catch{return {days:[]};}}
export function recordOpen(usage,now=new Date()){
  const today=day(now),days=(usage?.days||[]).filter(d=>typeof d==='string');
  if(days.includes(today))return usage;
  return {...usage,firstOpened:usage?.firstOpened||today,days:[...days,today].slice(-MAX_DAYS)};
}
export function saveUsage(usage){try{localStorage.setItem(USAGE_KEY,JSON.stringify(usage));}catch{}return usage;}
// Counts from the workspace itself, so they are always current and need no extra bookkeeping.
export function usageNumbers(usage,state,health,now=new Date()){
  const cards=state?.cards||[],days=usage?.days||[];
  const first=usage?.firstOpened,age=first?Math.floor((Date.parse(day(now))-Date.parse(first))/864e5):0;
  return {
    daysOpened:days.length,
    daysSinceFirstOpen:age,
    returnedAfterWeekOne:days.some(d=>first&&Date.parse(d)-Date.parse(first)>=7*864e5),
    thoughts:cards.filter(c=>c.kind!=='item'&&c.origin!=='imported').length,
    keptItems:cards.filter(c=>c.kind==='item'&&!c.suggested).length,
    importedIdeas:cards.filter(c=>c.origin==='imported').length,
    conversations:(state?.messages||[]).filter(m=>m.role==='user').length,
    modelConnected:Boolean(health?.ready??health?.configured),
    provider:health?.provider||'none',
  };
}
export function usageLines(n){
  return [
    `Days opened: ${n.daysOpened} (first opened ${n.daysSinceFirstOpen} ${n.daysSinceFirstOpen===1?'day':'days'} ago${n.returnedAfterWeekOne?', came back after week one':''})`,
    `Thoughts captured: ${n.thoughts} · kept items: ${n.keptItems} · imported ideas: ${n.importedIdeas}`,
    `Messages to the assistant: ${n.conversations}`,
    `Model connected: ${n.modelConnected?'yes':'no'} · provider: ${n.provider}`,
  ];
}
// The same five questions as the GitHub "Tester feedback" form, so answers line up wherever they are sent.
export const FEEDBACK_QUESTIONS=[
  'Did you get it installed and connected to a model? (yes without trouble / yes but it took effort / no, I got stuck)',
  'Where did you get stuck or confused, if anywhere?',
  'What was the most useful or surprising moment?',
  'Would you open it again tomorrow without being asked? (yes / maybe / no)',
  'If you could change one thing, what would it be?',
];
export function feedbackText(numbers,about=''){
  return [...FEEDBACK_QUESTIONS.flatMap((q,i)=>[`${i+1}. ${q}`,'','']),'--- Your usage (counted on this device, edit or delete anything) ---',...usageLines(numbers),...(about?[about]:[])].join('\n');
}
