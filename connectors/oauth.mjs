import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';

// OAuth for a desktop app (RFC 8252): the system browser signs in, and a one-shot listener on 127.0.0.1 receives the code.
// PKCE and a random state protect the exchange; the listener closes after one answer or five minutes.
const b64url=buffer=>buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const page=message=>`<!doctype html><meta charset="utf-8"><title>Thoughtspace</title><body style="font:16px system-ui;background:#101419;color:#dce3e9;display:grid;place-items:center;height:90vh"><p>${message}</p></body>`;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

// style 'openrouter': OpenRouter's variant (callback_url, no state echo). The state goes in the callback path instead,
// so a stray request to the listener still can't complete the sign-in.
export async function loopbackAuthorize({authUrl,params,open,timeoutMs=300000,style='oauth2'}){
  const verifier=b64url(randomBytes(48)),state=b64url(randomBytes(24));
  const challenge=b64url(createHash('sha256').update(verifier).digest());
  let settle;const result=new Promise((resolve,reject)=>{settle={resolve,reject};});
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const expected=style==='openrouter'?'/callback/'+state:'/callback';
    if(url.pathname!==expected){res.writeHead(404);return res.end();}
    const error=url.searchParams.get('error'),code=url.searchParams.get('code');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    if(style!=='openrouter'&&url.searchParams.get('state')!==state){res.end(page('This sign-in link is not the one Thoughtspace opened. Close this tab and try again.'));return;}
    if(error||!code){res.end(page('Sign-in was cancelled. You can close this tab.'));settle.reject(fail('Sign-in was cancelled. Nothing was connected.'));return;}
    res.end(page('Connected. You can close this tab and return to Thoughtspace.'));settle.resolve(code);
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).on('error',reject));
  const port=server.address().port;
  const redirectUri=style==='openrouter'?`http://localhost:${port}/callback/${state}`:`http://127.0.0.1:${port}/callback`;
  const query=style==='openrouter'?{...params,callback_url:redirectUri,code_challenge:challenge,code_challenge_method:'S256'}:{...params,redirect_uri:redirectUri,response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256'};
  const url=new URL(authUrl);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
  const timer=setTimeout(()=>settle.reject(fail('Sign-in took longer than five minutes. Try connecting again.',408)),timeoutMs);
  try{await open(url.toString());const code=await result;return {code,verifier,redirectUri};}
  finally{clearTimeout(timer);server.close();}
}
