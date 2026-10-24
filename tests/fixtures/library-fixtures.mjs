import yazl from 'yazl';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Small synthetic exports in the real services' shapes. Built at test time so no binary fixtures live in the repo.
export const chatgptConversations=[
  {id:'c1',conversation_id:'c1',title:'Planning the garden app',create_time:1726000000,update_time:1726000500,current_node:'n5',mapping:{
    root:{id:'root',message:null,parent:null,children:['n1']},
    n1:{id:'n1',parent:'root',children:['n2'],message:{author:{role:'system'},content:{content_type:'text',parts:['You are ChatGPT']},metadata:{is_visually_hidden_from_conversation:true}}},
    n2:{id:'n2',parent:'n1',children:['n3a','n3'],message:{author:{role:'user'},create_time:1726000010,content:{content_type:'text',parts:['I want to build a garden planning app that tells me when to water each bed based on local weather.']}}},
    n3a:{id:'n3a',parent:'n2',children:[],message:{author:{role:'assistant'},content:{content_type:'text',parts:['An abandoned branch reply.']}}},
    n3:{id:'n3',parent:'n2',children:['n4'],message:{author:{role:'assistant'},content:{content_type:'text',parts:['That sounds useful. You could use a weather API.']}}},
    n4:{id:'n4',parent:'n3',children:['n5'],message:{author:{role:'tool'},content:{content_type:'code',text:'search()'}}},
    n5:{id:'n5',parent:'n4',children:[],message:{author:{role:'user'},create_time:1726000400,content:{content_type:'multimodal_text',parts:[{asset_pointer:'file-1'},'I decided to start with tomatoes and peppers only, and ship it as a phone app first.']}}},
  }},
  {id:'c2',title:'Capital of France',create_time:1726100000,update_time:1726100001,current_node:'m2',mapping:{
    m1:{id:'m1',parent:null,children:['m2'],message:{author:{role:'user'},content:{content_type:'text',parts:['capital of france?']}}},
    m2:{id:'m2',parent:'m1',children:[],message:{author:{role:'assistant'},content:{content_type:'text',parts:['Paris.']}}},
  }},
];
export const claudeConversations=[
  {uuid:'k1',name:'Robotics club budget',created_at:'2026-09-01T10:00:00Z',updated_at:'2026-09-01T11:00:00Z',chat_messages:[
    {sender:'human',text:'',content:[{type:'text',text:'Our robotics club needs a budget plan for the spring competition, around 2000 dollars for parts and travel.'}],created_at:'2026-09-01T10:00:00Z'},
    {sender:'assistant',text:'Here is a draft budget.',content:[{type:'text',text:'Here is a draft budget.'}]},
    {sender:'human',text:'Question for later: should we apply for the community makers grant to cover the travel costs?'},
  ]},
];
export async function makeZip(entries){
  const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-fixture-')),file=path.join(dir,'export.zip'),zip=new yazl.ZipFile();
  for(const [name,value] of Object.entries(entries))zip.addBuffer(Buffer.from(typeof value==='string'?value:JSON.stringify(value)),name);
  zip.end();await new Promise((resolve,reject)=>zip.outputStream.pipe(createWriteStream(file)).on('close',resolve).on('error',reject));
  return file;
}
// yazl refuses to write path traversal, so the hostile name is patched into the finished bytes (local header and central directory).
export async function makeTraversalZip(){
  const {readFile,writeFile}=await import('node:fs/promises');
  const file=await makeZip({'xx/evil/conversations.json':[]});
  await writeFile(file,Buffer.from((await readFile(file)).toString('latin1').replaceAll('xx/evil/','../evil/'),'latin1'));
  return file;
}
export async function makeVault(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-vault-'));
  await mkdir(path.join(dir,'Projects'),{recursive:true});await mkdir(path.join(dir,'.obsidian'),{recursive:true});
  await writeFile(path.join(dir,'.obsidian','workspace.md'),'# should be skipped');
  await writeFile(path.join(dir,'Projects','Solar bike.md'),'---\ntags: [project]\n---\n# Solar bike\nI am building an electric bike charged by a small solar panel on the rear rack. It links to [[Budget|my budget]] and [[Parts list#Motors]].');
  await writeFile(path.join(dir,'Budget.md'),'Spending cap for hobby projects is 300 dollars a month. The solar bike takes most of it until spring, then the budget resets.');
  await writeFile(path.join(dir,'empty.md'),'---\ntitle: x\n---\n');
  return dir;
}
