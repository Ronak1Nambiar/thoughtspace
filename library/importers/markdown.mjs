import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const MAX_NOTE_BYTES=2*1024*1024;
const skipDir=name=>name.startsWith('.')||name==='node_modules';

export function markdownNote(relative,raw,{createdAt=null,updatedAt=null}={}){
  const body=raw.replace(/^\uFEFF/,'').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,'').trim();
  const heading=body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const links=[...new Set([...body.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]]*)?\]\]/g)].map(m=>m[1].trim().toLowerCase()).filter(Boolean))];
  return {externalId:relative,title:(heading||path.posix.basename(relative,'.md')).slice(0,200),createdAt,updatedAt,links,messages:body?[{role:'note',text:body}]:[]};
}
// Walks an Obsidian vault or any folder of notes. Hidden folders (.obsidian, .git, .trash) are skipped.
export async function* markdownFolder(root){
  async function* walk(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){if(!skipDir(entry.name))yield* walk(full);continue;}
      if(!entry.isFile()||!/\.md$/i.test(entry.name))continue;
      const info=await stat(full);if(info.size>MAX_NOTE_BYTES)continue;
      const doc=markdownNote(path.relative(root,full).split(path.sep).join('/'),await readFile(full,'utf8'),{createdAt:info.birthtime.toISOString(),updatedAt:info.mtime.toISOString()});
      if(doc.messages.length)yield doc;
    }
  }
  yield* walk(root);
}
