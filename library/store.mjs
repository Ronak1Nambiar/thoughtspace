import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

// The Library holds everything imported from outside ThoughtSpace. Map cards stay small in the workspace and point here by document id.
export const SOURCE_KINDS=['chatgpt','claude','markdown','notion','gdrive'];
const MIGRATIONS=[
  `create table sources(id text primary key,kind text not null,label text not null,cursor text,added_at text not null,last_sync_at text);
   create table documents(id text primary key,source_id text not null references sources(id) on delete cascade,external_id text not null,title text not null,created_at text,updated_at text,content_hash text not null,status text not null default 'new',distilled_at text,links text,unique(source_id,external_id));
   create table messages(doc_id text not null references documents(id) on delete cascade,idx integer not null,role text not null,text text not null,created_at text,primary key(doc_id,idx));
   create virtual table docs_fts using fts5(doc_id unindexed,title,body,tokenize='unicode61 remove_diacritics 2');
   create table themes(id text primary key,title text not null);
   create table ideas(id text primary key,doc_id text not null references documents(id) on delete cascade,title text not null,summary text not null,kind text not null,quote text not null,theme_id text references themes(id) on delete set null,merged_into text);
   create table jobs(id text primary key,kind text not null,state text not null,done integer not null default 0,total integer not null default 0,ideas_found integer not null default 0,current_title text,error text,options_json text not null,created_at text not null,updated_at text not null);
   create index documents_status on documents(status);create index ideas_doc on ideas(doc_id);`,
];
const now=()=>new Date().toISOString();
export const contentHash=doc=>createHash('sha256').update(JSON.stringify([doc.title,doc.messages.map(m=>[m.role,m.text])])).digest('hex');
// FTS5 treats punctuation as syntax; quote every term so user searches can never raise a query error.
export const ftsQuery=q=>String(q).split(/\s+/).map(t=>t.replace(/"/g,'').trim()).filter(Boolean).slice(0,12).map(t=>`"${t}"*`).join(' ');

export function openLibrary(file){
  if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('pragma journal_mode=wal;pragma foreign_keys=on;create table if not exists schema_version(version integer not null)');
  const version=db.prepare('select version from schema_version').get()?.version??0;
  for(let v=version;v<MIGRATIONS.length;v++){db.exec('begin');try{db.exec(MIGRATIONS[v]);db.exec(v===0?'insert into schema_version values(1)':`update schema_version set version=${v+1}`);db.exec('commit');}catch(e){db.exec('rollback');throw e;}}
  const tx=fn=>{db.exec('begin');try{const result=fn();db.exec('commit');return result;}catch(e){db.exec('rollback');throw e;}};
  const q=sql=>db.prepare(sql);
  const lib={
    db,close:()=>db.close(),
    addSource({kind,label}){if(!SOURCE_KINDS.includes(kind))throw Object.assign(new Error('Unsupported source.'),{status:400});const id=randomUUID();q('insert into sources(id,kind,label,added_at) values(?,?,?,?)').run(id,kind,String(label).slice(0,200),now());return id;},
    source:id=>q('select * from sources where id=?').get(id),
    sources:()=>q(`select s.*,count(d.id) documents,sum(d.status='distilled') distilled,sum(d.status='new') pending from sources s left join documents d on d.source_id=s.id and d.status!='removed' group by s.id order by s.added_at`).all(),
    touchSource(id,cursor){q('update sources set last_sync_at=?,cursor=coalesce(?,cursor) where id=?').run(now(),cursor??null,id);},
    removeSource(id){tx(()=>{q('delete from docs_fts where doc_id in (select id from documents where source_id=?)').run(id);q('delete from sources where id=?').run(id);});},
    // Returns 'added', 'changed' or 'unchanged'. Only added and changed documents are (re)distilled.
    upsertDocument(sourceId,doc){
      const hash=contentHash(doc),existing=q('select id,content_hash,status from documents where source_id=? and external_id=?').get(sourceId,String(doc.externalId));
      if(existing&&existing.content_hash===hash&&existing.status!=='removed')return {id:existing.id,result:'unchanged'};
      const id=existing?.id??randomUUID();
      tx(()=>{
        if(existing){q('delete from messages where doc_id=?').run(id);q('delete from docs_fts where doc_id=?').run(id);q('delete from ideas where doc_id=?').run(id);q(`update documents set title=?,created_at=?,updated_at=?,content_hash=?,status='new',distilled_at=null,links=? where id=?`).run(doc.title,doc.createdAt??null,doc.updatedAt??null,hash,doc.links?JSON.stringify(doc.links):null,id);}
        else q('insert into documents(id,source_id,external_id,title,created_at,updated_at,content_hash,links) values(?,?,?,?,?,?,?,?)').run(id,sourceId,String(doc.externalId),doc.title,doc.createdAt??null,doc.updatedAt??null,hash,doc.links?JSON.stringify(doc.links):null);
        const insert=q('insert into messages(doc_id,idx,role,text,created_at) values(?,?,?,?,?)');doc.messages.forEach((m,i)=>insert.run(id,i,m.role,m.text,m.createdAt??null));
        q('insert into docs_fts(doc_id,title,body) values(?,?,?)').run(id,doc.title,doc.messages.map(m=>m.text).join('\n'));
      });
      return {id,result:existing?'changed':'added'};
    },
    markRemoved(sourceId,externalIds){const s=q(`update documents set status='removed' where source_id=? and external_id=?`);for(const e of externalIds)s.run(sourceId,String(e));},
    document(id){const doc=q('select d.*,s.kind source_kind,s.label source_label from documents d join sources s on s.id=d.source_id where d.id=?').get(id);if(!doc)return null;return {...doc,links:doc.links?JSON.parse(doc.links):[],messages:q('select role,text,created_at from messages where doc_id=? order by idx').all(id),ideas:q('select id,title,summary,kind,quote,theme_id from ideas where doc_id=? and merged_into is null').all(id)};},
    documents({sourceId=null,limit=50,offset=0}={}){return q(`select d.id,d.title,d.created_at,d.updated_at,d.status,s.kind source_kind from documents d join sources s on s.id=d.source_id where d.status!='removed' and (?1 is null or d.source_id=?1) order by coalesce(d.updated_at,d.created_at) desc limit ?2 offset ?3`).all(sourceId,Math.min(limit,200),offset);},
    search(text,{sourceId=null,limit=50}={}){const match=ftsQuery(text);if(!match)return [];return q(`select d.id,d.title,d.created_at,d.updated_at,d.status,s.kind source_kind,snippet(docs_fts,2,'[',']','…',16) snippet from docs_fts f join documents d on d.id=f.doc_id join sources s on s.id=d.source_id where docs_fts match ?1 and d.status!='removed' and (?2 is null or d.source_id=?2) order by rank limit ?3`).all(match,sourceId,Math.min(limit,200));},
    pending:(limit=1)=>q(`select id from documents where status='new' order by coalesce(updated_at,created_at) desc limit ?`).all(limit).map(r=>r.id),
    pendingCount:()=>q(`select count(*) n from documents where status='new'`).get().n,
    pendingText:()=>q(`select coalesce(sum(length(m.text)),0) n from messages m join documents d on d.id=m.doc_id where d.status='new'`).get().n,
    finishDocument(id,status,ideas=[]){tx(()=>{const insert=q('insert into ideas(id,doc_id,title,summary,kind,quote) values(?,?,?,?,?,?)');for(const i of ideas)insert.run(randomUUID(),id,i.title,i.summary,i.kind,i.quote);q('update documents set status=?,distilled_at=? where id=?').run(status,now(),id);});},
    unthemedIdeas:()=>q('select id,title,summary from ideas where theme_id is null and merged_into is null order by rowid').all(),
    themes:()=>q('select id,title from themes').all(),
    applyThemes(assignments,merges=[]){tx(()=>{
      const themes=new Map(q('select title,id from themes').all().map(t=>[t.title.toLowerCase(),t.id]));
      for(const {ideaId,theme} of assignments){const key=theme.toLowerCase();if(!themes.has(key)){const id=randomUUID();q('insert into themes(id,title) values(?,?)').run(id,theme.slice(0,80));themes.set(key,id);}q('update ideas set theme_id=? where id=?').run(themes.get(key),ideaId);}
      // A merge target must itself be unmerged and must not already absorb others into a chain.
      for(const {from,into} of merges)if(from!==into)q(`update ideas set merged_into=?1 where id=?2 and merged_into is null and (select merged_into from ideas where id=?1) is null and not exists(select 1 from ideas where merged_into=?2)`).run(into,from);
    });},
    // Everything the map needs, kept compact: the workspace lives in localStorage, so quotes are trimmed and full text stays here.
    mapExport(){
      const ideas=q(`select i.id,i.title,i.summary,i.kind,substr(i.quote,1,300) quote,i.theme_id themeId,i.doc_id docId,s.kind sourceKind from ideas i join documents d on d.id=i.doc_id join sources s on s.id=d.source_id where i.merged_into is null and d.status!='removed'`).all();
      const merged=q(`select i.merged_into ideaId,i.doc_id docId,substr(i.quote,1,300) quote,s.kind sourceKind from ideas i join documents d on d.id=i.doc_id join sources s on s.id=d.source_id where i.merged_into is not null and d.status!='removed'`).all();
      const byId=new Map(ideas.map(i=>[i.id,{...i,sourceRefs:[{docId:i.docId,quote:i.quote,sourceKind:i.sourceKind}]}]));
      for(const m of merged)byId.get(m.ideaId)?.sourceRefs.push({docId:m.docId,quote:m.quote,sourceKind:m.sourceKind});
      // Wikilinks name notes by title or file name; resolve them to document pairs inside the same source.
      const docs=q(`select id,source_id,title,external_id,links from documents where status!='removed' and source_id in (select source_id from documents where links is not null)`).all();
      const names=new Map();for(const d of docs)for(const name of [d.title.toLowerCase(),d.external_id.toLowerCase().replace(/\.md$/,''),d.external_id.toLowerCase().replace(/\.md$/,'').split('/').pop()])names.set(d.source_id+'\u0000'+name,d.id);
      const docEdges=[];for(const d of docs)for(const link of d.links?JSON.parse(d.links):[]){const target=names.get(d.source_id+'\u0000'+link);if(target&&target!==d.id)docEdges.push([d.id,target]);}
      return {themes:q('select id,title from themes').all(),ideas:[...byId.values()].map(i=>({...i,docId:i.docId})).map(({quote,sourceKind,...rest})=>rest),docEdges};
    },
    createJob(kind,options){const id=randomUUID();q('insert into jobs(id,kind,state,options_json,created_at,updated_at) values(?,?,?,?,?,?)').run(id,kind,'queued',JSON.stringify(options||{}),now(),now());return id;},
    updateJob(id,fields){const keys=Object.keys(fields).filter(k=>['state','done','total','ideas_found','current_title','error'].includes(k));if(keys.length)q(`update jobs set ${keys.map(k=>k+'=?').join(',')},updated_at=? where id=?`).run(...keys.map(k=>fields[k]??null),now(),id);},
    job(id){const j=q('select * from jobs where id=?').get(id);return j&&{...j,options:JSON.parse(j.options_json)};},
    latestJob(){const j=q('select * from jobs order by created_at desc,rowid desc limit 1').get();return j&&{...j,options:JSON.parse(j.options_json)};},
    activeJob(){const j=q(`select * from jobs where state in ('queued','running','paused') order by created_at desc limit 1`).get();return j&&{...j,options:JSON.parse(j.options_json)};},
  };
  return lib;
}
