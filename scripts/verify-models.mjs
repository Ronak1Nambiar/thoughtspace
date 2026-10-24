import {_electron as electron,expect} from '@playwright/test';
import {finishSetup} from './desktop-setup.mjs';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// End-to-end model switching in the real desktop window, against a fake Ollama with two models:
// add "Fast local" through the form, switch in the header, check Atlas's request uses it, and relaunch.
const used=[];
const ollama=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'fake-model'},{name:'fake-small'}]}));
  if(req.url==='/api/chat'){const body=JSON.parse(raw);used.push(body.model);return res.end(JSON.stringify({message:{content:`Reply from ${body.model}.`}}));}
  res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>ollama.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-models-test-'));
const env={...process.env,THOUGHTSPACE_USER_DATA:profile,AI_ENABLED:'true',LLM_PROVIDER:'ollama',LOCAL_MODEL:'fake-model',OLLAMA_URL:`http://127.0.0.1:${ollama.address().port}`,GROQ_API_KEY:''};
delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({executablePath:process.env.DESKTOP_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DESKTOP_EXE?[]:[path.resolve('.')],env,timeout:30000});
const result={testKind:process.env.DESKTOP_EXE?'packaged-model-switching':'desktop-model-switching',profile,checks:[]};
let instance;
try{
  instance=await launch();const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await finishSetup(page);
  await expect(page.getByRole('button',{name:/AI model: fake-model · Ollama/})).toBeVisible();
  await page.getByRole('button',{name:/AI model:/}).click();await page.getByRole('button',{name:'Add your model…'}).click();
  const form=page.getByRole('dialog',{name:'Add your model'});
  await form.getByRole('combobox',{name:'Model',exact:true}).fill('fake-small');await form.getByRole('textbox',{name:'Name'}).fill('Fast local');
  await form.getByRole('button',{name:'Test and add'}).click();
  await expect(page.getByRole('button',{name:/AI model: Fast local/})).toBeVisible();
  result.checks.push('Add your model tests the connection, saves the model and switches to it');
  await page.getByRole('button',{name:'Discuss selected',exact:false}).click();
  await page.getByRole('textbox',{name:'Discuss selected ideas',exact:true}).fill('Which model are you?');
  await page.getByRole('button',{name:'Send discussion',exact:true}).click();
  await expect(page.getByText('Reply from fake-small.')).toBeVisible({timeout:15000});
  if(used.at(-1)!=='fake-small')throw new Error('Atlas used '+used.at(-1));
  result.checks.push('Atlas thinks with the model chosen in the header');
  await page.getByRole('button',{name:/AI model:/}).click();await page.getByRole('option',{name:/fake-model · Ollama/}).click();
  await expect(page.getByRole('button',{name:/AI model: fake-model · Ollama/})).toBeVisible();
  await page.getByRole('button',{name:/AI model:/}).click();await page.getByRole('option',{name:/Fast local/}).click();
  await expect(page.getByRole('button',{name:/AI model: Fast local/})).toBeVisible();
  result.checks.push('Switching back and forth from the header is instant');
  const saved=JSON.parse(await readFile(path.join(profile,'provider-config.json'),'utf8'));
  if(saved.version!==2||!saved.profiles.some(p=>p.name==='Fast local')||!saved.active)throw new Error('Saved models were not written: '+JSON.stringify(Object.keys(saved)));
  await page.screenshot({path:'artifacts/model-switcher-desktop.png'});
  await instance.close();instance=await launch();const reopened=await instance.firstWindow();
  await expect(reopened.getByRole('button',{name:/AI model: Fast local/})).toBeVisible();
  result.checks.push('Saved models and the current choice survive a relaunch (settings file stays version 2)');
  if(errors.length)throw new Error(errors.join('; '));result.status='passed';
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;try{await (await instance?.firstWindow())?.screenshot({path:'artifacts/models-failure.png'});}catch{}}
finally{if(instance)await instance.close();ollama.close();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/models-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
