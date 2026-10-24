import {randomUUID} from 'node:crypto';
// Bring-your-own-model: every chat provider Thoughtspace can reason with.
// kind 'openai' covers any OpenAI-compatible /chat/completions API.
export const PROVIDERS=Object.freeze({
  ollama:{label:'Ollama (on this computer)',kind:'ollama',needsKey:false,baseUrl:'http://127.0.0.1:11434',model:'llama3.1:8b'},
  openai:{label:'OpenAI (ChatGPT models)',kind:'openai',needsKey:true,baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini',tokenParam:'max_completion_tokens',noTemperature:true,keyUrl:'https://platform.openai.com/api-keys'},
  anthropic:{label:'Anthropic (Claude)',kind:'anthropic',needsKey:true,baseUrl:'https://api.anthropic.com/v1',model:'claude-sonnet-5',keyUrl:'https://console.anthropic.com/settings/keys'},
  gemini:{label:'Google Gemini',kind:'openai',needsKey:true,baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',model:'gemini-2.5-flash',keyUrl:'https://aistudio.google.com/apikey'},
  groq:{label:'Groq',kind:'openai',needsKey:true,baseUrl:'https://api.groq.com/openai/v1',model:'openai/gpt-oss-120b',keyUrl:'https://console.groq.com/keys'},
  openrouter:{label:'OpenRouter (hundreds of models)',kind:'openai',needsKey:true,baseUrl:'https://openrouter.ai/api/v1',model:'openai/gpt-4o-mini',keyUrl:'https://openrouter.ai/keys'},
  custom:{label:'Custom OpenAI-compatible server',kind:'openai',needsKey:false,baseUrl:'',model:''},
});
const ENV_KEYS={openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY',groq:'GROQ_API_KEY',openrouter:'OPENROUTER_API_KEY',custom:'CUSTOM_API_KEY'};
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const trimUrl=url=>String(url||'').trim().replace(/\/+$/,'');

// Build the starting configuration from environment variables (the pre-1.6 way), so .env files keep working.
export function configFromEnv(env=process.env){
  const provider=(env.LLM_PROVIDER||'groq').toLowerCase();
  const config={enabled:env.AI_ENABLED==='true',provider:PROVIDERS[provider]?provider:'groq',models:{},baseUrls:{},keys:{}};
  for(const [id,name] of Object.entries(ENV_KEYS))if(env[name])config.keys[id]=env[name];
  if(env.LOCAL_MODEL)config.models.ollama=env.LOCAL_MODEL;
  if(env.OLLAMA_URL)config.baseUrls.ollama=env.OLLAMA_URL;
  if(env.CUSTOM_BASE_URL)config.baseUrls.custom=env.CUSTOM_BASE_URL;
  if(env.CHAT_MODEL&&config.provider!=='ollama')config.models[config.provider]=env.CHAT_MODEL;
  return config;
}
// Saved models ("profiles"): each is a named choice of service + model (+ its own address and key). One is active.
// Service-wide keys, models and addresses stay as the fallback, so configurations from 1.7 and earlier keep working.
export const MAX_PROFILES=30;
const PROFILE_ID=/^[a-z0-9-]{1,40}$/i;
const serviceName=id=>PROVIDERS[id].label.split(' (')[0];
export const profileName=(provider,model)=>`${model||PROVIDERS[provider].model||'model'} · ${serviceName(provider)}`.slice(0,60);
const validUrl=url=>!url||/^https?:\/\/[^\s]+$/.test(url);
function cleanProfile(p){
  if(!p||typeof p!=='object'||!PROFILE_ID.test(p.id||'')||!PROVIDERS[p.provider])return null;
  const model=typeof p.model==='string'?p.model.trim().slice(0,200):'',baseUrl=['ollama','custom'].includes(p.provider)&&typeof p.baseUrl==='string'&&validUrl(trimUrl(p.baseUrl))?trimUrl(p.baseUrl):'';
  return {id:p.id,name:(typeof p.name==='string'&&p.name.trim()?p.name.trim():profileName(p.provider,model)).slice(0,60),provider:p.provider,model,...(baseUrl?{baseUrl}:{}),...(p.signedIn===true&&p.provider==='openrouter'?{signedIn:true}:{})};
}
// Upgrade path: the current service becomes the active saved model, plus one entry per other service with a saved key.
function seedProfiles(c){
  const entry=id=>({id:'svc-'+id,name:profileName(id,c.models[id]),provider:id,model:c.models[id]||PROVIDERS[id].model,...(c.baseUrls[id]?{baseUrl:c.baseUrls[id]}:{})});
  return [entry(c.provider),...Object.keys(c.keys).filter(id=>id!==c.provider&&PROVIDERS[id]).map(entry)];
}
export function normalizeConfig(config={}){
  const provider=PROVIDERS[config.provider]?config.provider:'ollama';
  const pick=(value,allowed)=>Object.fromEntries(Object.entries(value||{}).filter(([id,v])=>allowed(id)&&typeof v==='string'&&v.trim()).map(([id,v])=>[id,v.trim()]));
  const base={enabled:config.enabled!==false,provider,models:pick(config.models,id=>id in PROVIDERS),baseUrls:pick(config.baseUrls,id=>['ollama','custom'].includes(id)),keys:pick(config.keys,id=>id in ENV_KEYS)};
  const seen=new Set();
  let profiles=(Array.isArray(config.profiles)?config.profiles:[]).map(cleanProfile).filter(p=>p&&!seen.has(p.id)&&seen.add(p.id)).slice(0,MAX_PROFILES);
  // Seeded = the user never saved a model; the app is on its built-in default, not a choice they made.
  const seeded=!profiles.length&&!Object.keys(base.keys||{}).length;
  if(!profiles.length)profiles=seedProfiles(base);
  const active=profiles.find(p=>p.id===config.active)||profiles.find(p=>p.id==='svc-'+provider)||profiles.find(p=>p.provider===provider)||profiles[0];
  const ids=new Set(profiles.map(p=>p.id));
  // Keys only for services that use them; a key for a profile that no longer exists is dropped.
  const profileKeys=pick(config.profileKeys,id=>ids.has(id)&&profiles.find(p=>p.id===id).provider in ENV_KEYS);
  return {...base,provider:active.provider,profiles,active:active.id,profileKeys,...(seeded?{seeded:true}:{})};
}
// The key a service would use: its own saved key, otherwise the key of a saved model on that service (so voice can use it too).
export function serviceKey(config,id){return config.keys?.[id]||(config.profiles||[]).filter(p=>p.provider===id).map(p=>config.profileKeys?.[p.id]).find(Boolean)||'';}
export function providerById(config,id){
  const spec=PROVIDERS[id];if(!spec)throw fail('Choose one of the listed providers.',400);
  return {id,...spec,model:config.models?.[id]||spec.model,baseUrl:trimUrl(config.baseUrls?.[id]||spec.baseUrl),apiKey:serviceKey(config,id)};
}
export function activeProvider(config){
  const profile=config.profiles?.find(p=>p.id===config.active);
  if(!profile)return providerById(config,config.provider);
  const service=providerById(config,profile.provider);
  return {...service,model:profile.model||service.model,baseUrl:profile.baseUrl?trimUrl(profile.baseUrl):service.baseUrl,apiKey:config.profileKeys?.[profile.id]||config.keys?.[profile.provider]||service.apiKey,profileId:profile.id,profileName:profile.name};
}
// Rough list prices (US$ per million tokens, input/output) for each provider's default model; only used to show an estimate before bulk imports.
export const PRICES=Object.freeze({ollama:[0,0],openai:[0.15,0.6],anthropic:[3,15],gemini:[0.3,2.5],groq:[0.15,0.6],openrouter:[0.15,0.6]});
export function estimateCost(p,inputChars,outputChars=inputChars*0.08){
  if(p.kind==='ollama')return {usd:0,known:true};
  const price=p.model===PROVIDERS[p.id]?.model?PRICES[p.id]:null;if(!price)return {usd:null,known:false};
  return {usd:Math.round((inputChars/4*price[0]+outputChars/4*price[1])/1e6*100)/100,known:true};
}
// What the renderer may see: never a key, only whether one is saved and its last four characters.
export function publicConfig(config){
  const keyFor=p=>config.profileKeys?.[p.id]||config.keys?.[p.provider]||'';
  return {enabled:config.enabled,provider:config.provider,active:config.active||null,
    profiles:(config.profiles||[]).map(p=>({id:p.id,name:p.name,provider:p.provider,providerLabel:PROVIDERS[p.provider].label,model:p.model||PROVIDERS[p.provider].model,baseUrl:p.baseUrl||null,needsKey:PROVIDERS[p.provider].needsKey,usesKey:p.provider in ENV_KEYS,hasKey:!!keyFor(p),ownKey:!!config.profileKeys?.[p.id],keyHint:keyFor(p)?'••••'+keyFor(p).slice(-4):null,signedIn:!!p.signedIn,active:p.id===config.active})),
    providers:Object.entries(PROVIDERS).map(([id,spec])=>({
    id,label:spec.label,needsKey:spec.needsKey,keyUrl:spec.keyUrl||null,model:config.models?.[id]||spec.model,defaultModel:spec.model,
    baseUrl:id in {ollama:1,custom:1}?(config.baseUrls?.[id]||spec.baseUrl):null,hasKey:!!config.keys?.[id],keyHint:config.keys?.[id]?'••••'+config.keys[id].slice(-4):null}))};
}
function checkKey(provider,key){if(!(provider in ENV_KEYS))throw fail('This provider does not use an API key.',400);if(key.length>500)throw fail('API key is too long.',400);}
// Saved-model actions: activate, saveProfile (add or edit; activate:true also switches to it) and deleteProfile.
function applyProfileAction(next,update){
  const find=id=>next.profiles.find(p=>p.id===id);
  if(update.action==='activate'){const p=find(update.id);if(!p)throw fail('That model is no longer saved.',404);next.active=p.id;next.provider=p.provider;next.enabled=true;return next;}
  if(update.action==='deleteProfile'){
    const p=find(update.id);if(!p)throw fail('That model is no longer saved.',404);
    if(p.id===next.active)throw fail('Switch to another model before deleting this one.',400);
    next.profiles=next.profiles.filter(x=>x.id!==p.id);delete next.profileKeys[p.id];return next;
  }
  if(update.action!=='saveProfile')throw fail('Unknown settings action.',400);
  const input=update.profile||{},existing=input.id?find(input.id):null;
  if(input.id&&!existing)throw fail('That model is no longer saved.',404);
  if(!PROVIDERS[input.provider])throw fail('Choose one of the listed services.',400);
  const model=typeof input.model==='string'?input.model.trim():'',name=typeof input.name==='string'?input.name.trim():'',baseUrl=trimUrl(input.baseUrl);
  if(!model)throw fail('Enter the model name, for example gpt-4o-mini or llama3.2.',400);
  if(model.length>200)throw fail('Model name is too long.',400);
  if(name.length>60)throw fail('Keep the name under 60 characters.',400);
  if(!validUrl(baseUrl))throw fail('Server address must start with http:// or https://.',400);
  if(input.provider==='custom'&&!baseUrl)throw fail('Enter the address of your OpenAI-compatible server, ending in /v1.',400);
  if(!existing&&next.profiles.length>=MAX_PROFILES)throw fail(`You can save up to ${MAX_PROFILES} models. Delete one first.`,400);
  const id=existing?.id||'m-'+randomUUID().slice(0,8);
  const newKey=typeof input.apiKey==='string'&&input.apiKey.trim();
  const signedIn=update.signedIn===true||(!!existing?.signedIn&&existing.provider===input.provider&&!newKey&&input.clearKey!==true);
  const profile=cleanProfile({id,name:name||profileName(input.provider,model),provider:input.provider,model,baseUrl:['ollama','custom'].includes(input.provider)?baseUrl:'',signedIn});
  // A key belongs to one service: changing the service drops the old one unless a new key is given.
  if(existing&&existing.provider!==input.provider)delete next.profileKeys[id];
  if(typeof input.apiKey==='string'&&input.apiKey.trim()){checkKey(input.provider,input.apiKey.trim());next.profileKeys[id]=input.apiKey.trim();}
  if(input.clearKey===true)delete next.profileKeys[id];
  next.profiles=existing?next.profiles.map(p=>p.id===id?profile:p):[...next.profiles,profile];
  if(update.activate||next.active===id){next.active=id;next.provider=profile.provider;if(update.activate)next.enabled=true;}
  return next;
}
// Apply a settings change from the UI. An empty apiKey leaves the saved key alone; clearKey removes it.
// Without an action this is the 1.6 form: it edits the service's saved model (or the active one) and switches to it.
export function applyUpdate(config,update={}){
  const next=structuredClone(normalizeConfig(config));
  if(update.action)return applyProfileAction(next,update);
  if(update.provider!==undefined){if(!PROVIDERS[update.provider])throw fail('Choose one of the listed providers.',400);next.provider=update.provider;}
  if(typeof update.enabled==='boolean')next.enabled=update.enabled;
  const id=next.provider;
  if(typeof update.model==='string'){if(update.model.length>200)throw fail('Model name is too long.',400);if(update.model.trim())next.models[id]=update.model.trim();else delete next.models[id];}
  if(typeof update.baseUrl==='string'&&['ollama','custom'].includes(id)){
    const url=trimUrl(update.baseUrl);
    if(url&&!/^https?:\/\/[^\s]+$/.test(url))throw fail('Server address must start with http:// or https://.',400);
    if(url)next.baseUrls[id]=url;else delete next.baseUrls[id];
  }
  if(typeof update.apiKey==='string'&&update.apiKey.trim()){if(!(id in ENV_KEYS))throw fail('This provider does not use an API key.',400);if(update.apiKey.length>500)throw fail('API key is too long.',400);next.keys[id]=update.apiKey.trim();}
  if(update.clearKey===true)delete next.keys[id];
  // Keep the saved-models list in step with the legacy form.
  const target=update.provider!==undefined?next.profiles.find(p=>p.id==='svc-'+id)||null:next.profiles.find(p=>p.id===next.active);
  const same=target&&target.provider===id;
  const profile={id:target?.id||'svc-'+id,name:same?target.name:profileName(id,next.models[id]),provider:id,model:same&&update.model===undefined?target.model:next.models[id]||PROVIDERS[id].model};
  const url=same&&update.baseUrl===undefined?target.baseUrl:next.baseUrls[id];if(url)profile.baseUrl=url;
  next.profiles=target?next.profiles.map(p=>p.id===target.id?profile:p):[...next.profiles,profile].slice(-MAX_PROFILES);
  next.active=profile.id;next.provider=id;
  return next;
}

function openAiHeaders(p){return {'Content-Type':'application/json',...(p.apiKey?{Authorization:`Bearer ${p.apiKey}`}:{}),...(p.id==='openrouter'?{'HTTP-Referer':'https://ronak1nambiar.github.io/thoughtspace','X-Title':'Thoughtspace'}:{})};}
function errorFor(p,status,detail=''){
  if(status===401||status===403)return fail(`${p.label} rejected the API key. Update it in workspace settings; your capture is saved.`);
  if(status===404)return fail(`${p.label} does not recognise model "${p.model}". Check the model name in workspace settings; your capture is saved.`);
  if(status===402)return fail(`${p.label} says the account is out of credit. Add credit there, or pick a free model in workspace settings; your capture is saved.`);
  if(status===429)return fail(`${p.label} is busy or rate limited. Retry later; your capture is saved.`);
  if(status===400&&/context|too long|too many tokens|maximum.*tokens/i.test(detail))return fail(`This conversation is longer than ${p.model} can read at once. Start a new conversation or pick a model with a larger context; your capture is saved.`);
  if(status>=500)return fail(`${p.label} is having problems right now (${status}). Retry in a minute; your capture is saved.`);
  return fail(`${p.label} request failed (${status}). ${detail.slice(0,180)} Your saved work is available.`.replace(/\s+/g,' '));
}
// Anthropic requires alternating roles starting with user; merge neighbours with the same role.
function alternate(messages){
  const out=[];for(const m of messages){if(out.length&&out.at(-1).role===m.role)out.at(-1).content+='\n\n'+m.content;else out.push({role:m.role,content:m.content});}
  if(out[0]?.role!=='user')out.unshift({role:'user',content:'(conversation continues)'});return out;
}
export function parseJsonReply(text){
  try{return JSON.parse(text);}catch{}
  const fenced=/```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];if(fenced){try{return JSON.parse(fenced);}catch{}}
  const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start>=0&&end>start){try{return JSON.parse(text.slice(start,end+1));}catch{}}
  throw fail('The model did not return valid JSON. Your transcript is saved; retry, or choose a stronger model in workspace settings.');
}

// fetch throws (rather than returning a status) when the service can't be reached or times out; say which in plain words.
function unreachable(p,error,signal){
  if(signal?.aborted&&error?.name!=='TimeoutError')return error;
  if(error?.name==='TimeoutError')return fail(`${p.kind==='ollama'?'Your local model':p.label} took too long to answer. Retry, or pick a faster model; your capture is saved.`,504);
  return fail(p.kind==='ollama'?`Cannot reach Ollama at ${p.baseUrl}. Start Ollama and retry; your capture is saved.`:p.id==='custom'?`Cannot reach your server at ${p.baseUrl}. Check that it is running and the address is right; your capture is saved.`:`Cannot reach ${p.label}. Check your internet connection and retry; your capture is saved.`,503);
}
export async function chatWith(p,messages,{signal,json=false,maxTokens=json?8000:2200,timeout}={},fetcher=fetch){
  const send=(url,init)=>fetcher(url,init).catch(error=>{throw unreachable(p,error,signal);});
  if(p.needsKey&&!p.apiKey)throw fail(`${p.label} needs an API key. Add one in workspace settings; your local work is safe.`,503);
  if(p.id==='custom'&&!p.baseUrl)throw fail('Enter the address of your OpenAI-compatible server in workspace settings.',503);
  if(!p.model)throw fail('Choose a model in workspace settings.',503);
  const abort=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(timeout||(p.kind==='ollama'?Number(process.env.LOCAL_TIMEOUT||180000):90000))]);
  if(p.kind==='ollama'){
    const response=await send(`${p.baseUrl}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:p.model,messages,stream:false,format:json?'json':undefined,options:{temperature:0.2,num_ctx:Number(process.env.LOCAL_CONTEXT||8192)}}),signal:abort});
    if(!response.ok){const detail=await response.text().catch(()=> '');if(response.status===404&&/not found|pull/i.test(detail))throw fail(`Ollama does not have ${p.model}. Run "ollama pull ${p.model}" or pick another model; your capture is saved.`);throw fail(`Local model request failed (${response.status}). ${detail.slice(0,180)}`);}
    return (await response.json()).message?.content||'';
  }
  if(p.kind==='anthropic'){
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')+(json?'\n\nRespond with only the JSON object, no prose and no code fences.':'');
    const response=await send(`${p.baseUrl}/messages`,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':p.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:p.model,max_tokens:maxTokens,system,messages:alternate(messages.filter(m=>m.role!=='system'))}),signal:abort});
    if(!response.ok){const detail=await response.text().catch(()=> '');throw errorFor(p,response.status,detail);}
    const data=await response.json();return (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  }
  const body={model:p.model,messages,[p.tokenParam||'max_tokens']:maxTokens,...(p.noTemperature?{}:{temperature:0.2}),...(json?{response_format:{type:'json_object'}}:{})};
  let response=await send(`${p.baseUrl}/chat/completions`,{method:'POST',headers:openAiHeaders(p),body:JSON.stringify(body),signal:abort});
  // Compatible servers differ on optional parameters; retry once with only the essentials.
  if(response.status===400||response.status===422)response=await send(`${p.baseUrl}/chat/completions`,{method:'POST',headers:openAiHeaders(p),body:JSON.stringify({model:p.model,messages}),signal:abort});
  if(!response.ok){
    const error=await response.json().catch(()=>({}));
    if(error.error?.code==='model_terms_required')throw fail('This model needs your Groq organization administrator to accept its terms. Your capture is saved.',424);
    throw errorFor(p,response.status,error.error?.message||'');
  }
  const data=await response.json();return data.choices?.[0]?.message?.content||'';
}

// Connection check for workspace settings. Returns the provider's model list when it offers one.
export async function inspectChatProvider(config,fetcher=fetch){
  const p=activeProvider(config),base={provider:p.label,providerId:p.id,configured:false,models:{chat:p.model},available:[]};
  if(!config.enabled)return {...base,ready:false,message:'AI is turned off. Local capture is available.'};
  if(p.needsKey&&!p.apiKey)return {...base,ready:false,message:`Add your ${p.label} API key to start. Local capture is available.`};
  if(p.id==='custom'&&!p.baseUrl)return {...base,ready:false,message:'Enter your server address to start. Local capture is available.'};
  base.configured=true;
  try{
    const [url,headers]=p.kind==='ollama'?[`${p.baseUrl}/api/tags`,{}]:p.kind==='anthropic'?[`${p.baseUrl}/models?limit=100`,{'x-api-key':p.apiKey,'anthropic-version':'2023-06-01'}]:[`${p.baseUrl}/models`,openAiHeaders(p)];
    const response=await fetcher(url,{headers,signal:AbortSignal.timeout(p.kind==='ollama'?3000:8000)});
    if(!response.ok)return {...base,ready:false,message:response.status===401||response.status===403?`${p.label} rejected the API key. Update it and retry.`:p.kind==='ollama'?'The local model service is unavailable. Start Ollama and retry.':`${p.label} is unavailable (${response.status}). Local capture is available.`};
    const data=await response.json();
    const available=(p.kind==='ollama'?(data.models||[]).map(m=>m.name):(data.data||[]).map(m=>String(m.id).replace(/^models\//,''))).filter(Boolean).slice(0,300);
    const present=!available.length||available.includes(p.model)||available.includes(`${p.model}:latest`);
    if(p.kind==='ollama'&&!present&&config.seeded)return {...base,available,ready:false,unset:true,message:`No model connected yet. Sign in with OpenRouter, add an API key, or pull ${p.model} in Ollama.`};
    if(p.kind==='ollama'&&!present)return {...base,available,ready:false,message:`Pull ${p.model} in Ollama before starting local inference.`};
    return {...base,available,ready:true,message:present?`${p.label} is connected. Thinking with ${p.model}.`:`${p.label} is connected, but it does not list "${p.model}". Pick a model from the list if requests fail.`};
  }catch{return {...base,ready:false,...(config.seeded?{unset:true}:{}),message:config.seeded?'No model connected yet. Sign in with OpenRouter or add an API key from the model button. Typed thoughts still save.':p.kind==='ollama'?'Cannot reach Ollama. Start the local model service; local capture remains available.':`Cannot reach ${p.label}. Check your connection; local capture remains available.`};}
}
