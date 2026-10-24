// Notion connector. Works with an internal integration token today (the user shares pages with the integration);
// one-click OAuth needs a hosted token exchange because Notion requires a client secret (see docs/YOUR-DATA.md).
const API='https://api.notion.com/v1',VERSION='2022-06-28',MAX_DEPTH=3,MIN_GAP_MS=340;
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const TEXT_BLOCKS=['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','to_do','toggle','quote','callout','code'];
const prefix={heading_1:'# ',heading_2:'## ',heading_3:'### ',bulleted_list_item:'- ',numbered_list_item:'1. ',quote:'> '};

// One client per sync: spaces requests under Notion's ~3 per second limit and honours Retry-After on 429.
export function notionClient(token,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))){
  let last=0;
  return async function call(path,{method='GET',body}={}){
    for(let attempt=0;;attempt++){
      const gap=last+MIN_GAP_MS-Date.now();if(gap>0)await wait(gap);last=Date.now();
      const response=await fetcher(API+path,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':VERSION,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
      if(response.status===429&&attempt<4){await wait(Math.min(30,Number(response.headers.get('retry-after'))||2)*1000);continue;}
      if(response.status===401)throw fail('Notion rejected the integration token. Paste a new one; your Library is unchanged.',401);
      if(!response.ok)throw fail(`Notion request failed (${response.status}). Your Library is unchanged; sync again later.`);
      return response.json();
    }
  };
}
const plain=rich=>(rich||[]).map(t=>t.plain_text||'').join('');
export const pageTitle=page=>plain(Object.values(page.properties||{}).find(p=>p?.type==='title')?.title)||'Untitled page';
export function blockText(block){
  const value=block[block.type];if(!TEXT_BLOCKS.includes(block.type)||!value)return '';
  const text=plain(value.rich_text);if(!text)return '';
  return block.type==='to_do'?`[${value.checked?'x':' '}] ${text}`:(prefix[block.type]||'')+text;
}
async function pageBody(call,id,depth=0){
  const lines=[];let cursor;
  do{
    const page=await call(`/blocks/${id}/children?page_size=100${cursor?'&start_cursor='+cursor:''}`);
    for(const block of page.results||[]){const text=blockText(block);if(text)lines.push(text);if(block.has_children&&depth<MAX_DEPTH&&block.type!=='child_page')lines.push(...await pageBody(call,block.id,depth+1));}
    cursor=page.has_more?page.next_cursor:null;
  }while(cursor);
  return lines;
}

export const notion={
  id:'notion',label:'Notion',auth:'token',
  tokenHelp:'Create an internal integration at notion.so/my-integrations, copy its secret, then share the pages you want (••• → Connections) with it.',
  async verify({token},fetcher=fetch){
    if(typeof token!=='string'||!/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(token.trim()))throw fail('That does not look like a Notion integration secret (it starts with ntn_ or secret_).',400);
    const me=await notionClient(token.trim(),fetcher)('/users/me');
    return {credentials:{token:token.trim()},account:me.bot?.workspace_name||me.name||'Notion workspace'};
  },
  // Newest edits first, so an incremental sync stops as soon as it reaches pages older than the saved cursor.
  async *changes({credentials,cursor=null},{fetcher=fetch,wait}={}){
    const call=notionClient(credentials.token,fetcher,wait);let next,newest=cursor;
    do{
      const page=await call('/search',{method:'POST',body:{filter:{property:'object',value:'page'},sort:{direction:'descending',timestamp:'last_edited_time'},page_size:100,...(next?{start_cursor:next}:{})}});
      let reachedOld=false;
      for(const result of page.results||[]){
        if(cursor&&result.last_edited_time<=cursor){reachedOld=true;break;}
        if(!newest||result.last_edited_time>newest)newest=result.last_edited_time;
        if(result.archived||result.in_trash){yield {removed:[result.id]};continue;}
        const body=(await pageBody(call,result.id)).join('\n');
        yield {document:{externalId:result.id,title:pageTitle(result).slice(0,200),createdAt:result.created_time,updatedAt:result.last_edited_time,messages:body.trim()?[{role:'note',text:body}]:[]}};
      }
      next=!reachedOld&&page.has_more?page.next_cursor:null;
    }while(next);
    yield {cursor:newest};
  },
};
