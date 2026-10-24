import {loopbackAuthorize} from './oauth.mjs';

// Google Drive connector: Google Docs, Markdown and text files. Needs a Google Cloud OAuth client of type "Desktop app";
// its id (and the non-confidential desktop secret) come from THOUGHTSPACE_GOOGLE_CLIENT_ID / THOUGHTSPACE_GOOGLE_CLIENT_SECRET.
// drive.readonly is a restricted scope: fine for up to 100 test users, but a public release needs Google's review or a switch to drive.file + Picker.
const DRIVE='https://www.googleapis.com/drive/v3',TOKEN='https://oauth2.googleapis.com/token';
export const GDRIVE_SCOPE='https://www.googleapis.com/auth/drive.readonly';
const MIME_DOC='application/vnd.google-apps.document',TEXT_MIMES=['text/markdown','text/plain','text/x-markdown'],MAX_BYTES=2*1024*1024;
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const supported=file=>file&&(file.mimeType===MIME_DOC||TEXT_MIMES.includes(file.mimeType)||/\.(md|txt)$/i.test(file.name||''));
const client=env=>({id:env.THOUGHTSPACE_GOOGLE_CLIENT_ID||'',secret:env.THOUGHTSPACE_GOOGLE_CLIENT_SECRET||''});

async function tokenRequest(body,fetcher){
  const response=await fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString(),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw fail(data.error==='invalid_grant'?'Google access was revoked or expired. Connect Google Drive again; your Library is unchanged.':`Google sign-in failed (${response.status}).`,response.status===400?401:502);
  return data;
}
const withExpiry=(data,previous={})=>({...previous,access_token:data.access_token,refresh_token:data.refresh_token||previous.refresh_token,expires_at:Date.now()+((data.expires_in||3600)-60)*1000});

export const gdrive={
  id:'gdrive',label:'Google Drive',auth:'oauth',
  available:(env=process.env)=>!!client(env).id,
  unavailableHelp:'Google Drive needs a Google Cloud OAuth client. Set THOUGHTSPACE_GOOGLE_CLIENT_ID (and _SECRET) before starting Thoughtspace.',
  async connect({open,env=process.env,fetcher=fetch,authorize=loopbackAuthorize}){
    const {id,secret}=client(env);if(!id)throw fail(this.unavailableHelp,503);
    const {code,verifier,redirectUri}=await authorize({authUrl:'https://accounts.google.com/o/oauth2/v2/auth',params:{client_id:id,scope:GDRIVE_SCOPE,access_type:'offline',prompt:'consent'},open});
    const credentials=withExpiry(await tokenRequest({code,code_verifier:verifier,redirect_uri:redirectUri,client_id:id,...(secret?{client_secret:secret}:{}),grant_type:'authorization_code'},fetcher));
    if(!credentials.refresh_token)throw fail('Google did not grant offline access. Try connecting again.');
    const about=await (await fetcher(`${DRIVE}/about?fields=user(emailAddress)`,{headers:{Authorization:`Bearer ${credentials.access_token}`}})).json().catch(()=>({}));
    return {credentials,account:about.user?.emailAddress||'Google Drive'};
  },
  // First sync lists every supported file; later syncs follow Drive's change feed from the saved page token.
  async *changes({credentials,cursor=null},{fetcher=fetch,env=process.env}={}){
    let creds=credentials;
    const token=async()=>{if(Date.now()<creds.expires_at)return creds.access_token;const {id,secret}=client(env);creds=withExpiry(await tokenRequest({refresh_token:creds.refresh_token,client_id:id,...(secret?{client_secret:secret}:{}),grant_type:'refresh_token'},fetcher),creds);return creds.access_token;};
    const get=async(path,raw=false)=>{
      const response=await fetcher(DRIVE+path,{headers:{Authorization:`Bearer ${await token()}`},signal:AbortSignal.timeout(60000)});
      if(response.status===401)throw fail('Google Drive rejected the saved sign-in. Connect again; your Library is unchanged.',401);
      if(response.status===403||response.status===404)return null;
      if(!response.ok)throw fail(`Google Drive request failed (${response.status}). Sync again later.`);
      return raw?response.text():response.json();
    };
    const documentFor=async file=>{
      if(Number(file.size)>MAX_BYTES)return null;
      const text=await get(file.mimeType===MIME_DOC?`/files/${file.id}/export?mimeType=text/plain`:`/files/${file.id}?alt=media`,true);
      return text?.trim()?{externalId:file.id,title:(file.name||'Untitled').replace(/\.(md|txt)$/i,'').slice(0,200),createdAt:file.createdTime,updatedAt:file.modifiedTime,messages:[{role:'note',text:text.slice(0,MAX_BYTES)}]}:null;
    };
    const fields='id,name,mimeType,createdTime,modifiedTime,size,trashed';
    if(!cursor){
      const start=(await get('/changes/startPageToken')).startPageToken;
      const q=encodeURIComponent(`trashed=false and (mimeType='${MIME_DOC}' or ${TEXT_MIMES.map(m=>`mimeType='${m}'`).join(' or ')})`);
      let page;
      do{
        page=await get(`/files?q=${q}&pageSize=100&fields=nextPageToken,files(${fields})${page?.nextPageToken?'&pageToken='+page.nextPageToken:''}`);
        for(const file of page?.files||[]){const document=await documentFor(file);if(document)yield {document};}
      }while(page?.nextPageToken);
      yield {cursor:start,credentials:creds};return;
    }
    let pageToken=cursor,next=null;
    while(pageToken){
      const page=await get(`/changes?pageToken=${encodeURIComponent(pageToken)}&pageSize=100&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(${fields}))`);
      if(!page)throw fail('Google Drive could not continue from the last sync. Disconnect and connect again to start fresh.');
      for(const change of page.changes||[]){
        if(change.removed||change.file?.trashed){yield {removed:[change.fileId]};continue;}
        if(supported(change.file)){const document=await documentFor(change.file);if(document)yield {document};}
      }
      pageToken=page.nextPageToken||null;next=page.newStartPageToken||next;
    }
    yield {cursor:next||cursor,credentials:creds};
  },
};
