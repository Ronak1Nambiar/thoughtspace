const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

// Automatic workspace snapshots in %APPDATA%\Thoughtspace\backups: one a day while the app runs, one on quit.
// Unchanged or unreadable workspaces are never written, so a damaged workspace cannot push good snapshots out.
const NAME=/^workspace-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json$/;
const stamp=now=>now.toISOString().replace(/\.\d{3}Z$/,'Z').replace(/:/g,'-');
function readable(raw){try{const data=JSON.parse(raw);return data?.version===1&&Array.isArray(data.cards)&&Array.isArray(data.captures)?data:null;}catch{return null;}}
class Backups{
  constructor({folder,keep=14}){this.folder=folder;this.keep=keep;}
  names(){try{return fs.readdirSync(this.folder).filter(n=>NAME.test(n)).sort().reverse();}catch{return [];}}
  list(){return this.names().map(name=>{const [,day,h,m,s]=NAME.exec(name),file=path.join(this.folder,name);let cards=null,size=0;try{size=fs.statSync(file).size;cards=readable(fs.readFileSync(file,'utf8'))?.cards.length??null;}catch{}return {name,date:`${day}T${h}:${m}:${s}Z`,size,cards};});}
  read(name){if(typeof name!=='string'||!NAME.test(name)||!this.names().includes(name))throw Object.assign(new Error('That backup is not available.'),{status:404});return fs.readFileSync(path.join(this.folder,name),'utf8');}
  // reason 'daily' writes only if nothing was saved today; 'quit' and 'manual' write whenever the workspace changed.
  save(raw,{reason='daily',now=new Date()}={}){
    if(typeof raw!=='string'||!readable(raw))return {saved:false,why:'unreadable'};
    const names=this.names(),latest=names[0];
    if(reason==='daily'&&latest&&NAME.exec(latest)[1]===now.toISOString().slice(0,10))return {saved:false,why:'today'};
    const hash=createHash('sha256').update(raw).digest('hex');
    if(latest){try{if(createHash('sha256').update(fs.readFileSync(path.join(this.folder,latest),'utf8')).digest('hex')===hash)return {saved:false,why:'unchanged'};}catch{}}
    fs.mkdirSync(this.folder,{recursive:true});
    const name=`workspace-${stamp(now)}.json`,file=path.join(this.folder,name),temp=file+'.tmp';
    fs.writeFileSync(temp,raw,{mode:0o600});fs.renameSync(temp,file);
    for(const old of this.names().slice(this.keep))fs.rmSync(path.join(this.folder,old),{force:true});
    return {saved:true,name};
  }
}
module.exports={Backups,readable};
