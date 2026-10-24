// The assistant's name (what the user calls it and says to wake it) and whether first-run setup is done.
export const PROFILE_KEY='thoughtspace.onboarding.v1';
export const DEFAULT_NAME='Atlas';
export const NAME_PATTERN=/^\p{L}[\p{L}' -]{0,23}$/u;

// Letters, spaces, hyphens and apostrophes, starting with a letter, up to 24 characters.
export function cleanName(value){
  const name=String(value??'').replace(/\s+/g,' ').trim();
  return NAME_PATTERN.test(name)?name:null;
}
export function nameProblem(value){
  const name=String(value??'').replace(/\s+/g,' ').trim();
  if(!name)return 'Give your assistant a name.';
  if(name.length>24)return 'Keep the name to 24 characters or fewer.';
  if(!/^\p{L}/u.test(name))return 'Start the name with a letter.';
  if(!NAME_PATTERN.test(name))return 'Use letters, spaces, hyphens or apostrophes only.';
  return '';
}
// Short names are easy for Windows to miss or mishear. Two or more syllables wake more reliably.
export function nameAdvice(name){
  const vowels=(String(name).toLowerCase().match(/[aeiouy]+/g)||[]).length;
  return vowels<2?`Short names are harder to hear. "Hey ${name}" will work better than "${name}" alone.`:'';
}
export function readProfile(storage=globalThis.localStorage){
  try{
    const raw=JSON.parse(storage?.getItem(PROFILE_KEY)||'null');
    return {completedAt:typeof raw?.completedAt==='string'?raw.completedAt:null,assistantName:cleanName(raw?.assistantName)||DEFAULT_NAME};
  }catch{return {completedAt:null,assistantName:DEFAULT_NAME};}
}
export function saveProfile(profile,storage=globalThis.localStorage){
  const clean={completedAt:profile.completedAt||null,assistantName:cleanName(profile.assistantName)||DEFAULT_NAME};
  try{storage?.setItem(PROFILE_KEY,JSON.stringify(clean));}catch{}
  return clean;
}
