import {loopbackAuthorize} from './connectors/oauth.mjs';

// Sign in to a model service with an account instead of pasting a key.
// OpenRouter is the one service that officially supports this for third-party apps (OAuth PKCE):
// one sign-in gives access to Claude, GPT, Gemini, Llama and more, billed to the user's OpenRouter account.
// ChatGPT and Claude subscription logins are not offered: neither OpenAI nor Anthropic allows third-party apps to use them.
const fail=(message,status=502)=>Object.assign(new Error(message),{status});

export const SIGNIN_PROVIDERS=Object.freeze({
  openrouter:{
    label:'OpenRouter',
    async signIn({open,fetcher=fetch,authorize=loopbackAuthorize,timeoutMs}){
      const {code,verifier}=await authorize({authUrl:'https://openrouter.ai/auth',params:{key_label:'ThoughtSpace'},open,style:'openrouter',timeoutMs});
      const response=await fetcher('https://openrouter.ai/api/v1/auth/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,code_verifier:verifier,code_challenge_method:'S256'}),signal:AbortSignal.timeout(30000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||typeof data.key!=='string'||!data.key.trim())throw fail(`OpenRouter did not finish the sign-in (${response.status}). Nothing was connected; try again.`);
      return {key:data.key.trim()};
    },
  },
});

// One sign-in at a time per server. start() returns the link to open; wait() resolves once the user finishes in the browser.
export function signInSessions({providers=SIGNIN_PROVIDERS,now=Date.now}={}){
  const sessions=new Map();
  return {
    async start(providerId){
      const provider=providers[providerId];
      if(!provider)throw fail('Sign-in is only available for OpenRouter. Other services use an API key.',400);
      for(const [id,s] of sessions)if(now()-s.startedAt>6*60*1000)sessions.delete(id);
      const id=Math.random().toString(36).slice(2,12);
      let resolveUrl;const url=new Promise(resolve=>{resolveUrl=resolve;});
      const result=provider.signIn({open:link=>{resolveUrl(link);}}).finally(()=>setTimeout(()=>sessions.delete(id),60000).unref?.());
      result.catch(()=>{});
      sessions.set(id,{providerId,result,startedAt:now()});
      const authUrl=await Promise.race([url,result.then(()=>null)]);
      if(!authUrl)throw fail('Sign-in could not start. Try again.');
      return {id,authUrl};
    },
    async wait(id){
      const session=sessions.get(id);
      if(!session)throw fail('That sign-in has expired. Start again.',404);
      return {providerId:session.providerId,...await session.result};
    },
  };
}
