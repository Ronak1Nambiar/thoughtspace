import {_electron as electron,expect} from '@playwright/test';
import {finishSetup} from './desktop-setup.mjs';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chatgptConversations,makeZip} from '../tests/fixtures/library-fixtures.mjs';

// End-to-end Library check in the real desktop window: import a ChatGPT export, read it with a (fake) local model,
// see themed cards on the map, open the source conversation, and search. The fake Ollama keeps the run offline and repeatable.
const replies=body=>{
  const system=body.messages[0].content,text=body.messages[1].content;
  if(system.includes('Group the user'))return {assignments:JSON.parse(text).ideas.map(i=>({i:i.i,theme:'Garden'}))};
  if(text.includes('garden'))return {ideas:[{title:'Garden watering app',summary:'Waters each bed based on local weather.',kind:'project',quote:'build a garden planning app'},{title:'Tomatoes and peppers first',summary:'Start small with two crops.',kind:'decision',quote:'start with tomatoes and peppers only'}]};
  return {ideas:[]};
};
const ollama=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'fake-model'}]}));
  if(req.url==='/api/chat')return res.end(JSON.stringify({message:{content:JSON.stringify(replies(JSON.parse(raw)))}}));
  res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>ollama.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-library-test-'));
const env={...process.env,THOUGHTSPACE_USER_DATA:profile,THOUGHTSPACE_TEST_IMPORT:await makeZip({'conversations.json':chatgptConversations}),AI_ENABLED:'true',LLM_PROVIDER:'ollama',LOCAL_MODEL:'fake-model',OLLAMA_URL:`http://127.0.0.1:${ollama.address().port}`,GROQ_API_KEY:'',THOUGHTSPACE_GOOGLE_CLIENT_ID:''};
delete env.ELECTRON_RUN_AS_NODE;
const result={testKind:'desktop-library-end-to-end',profile,checks:[]};
let instance;
try{
  instance=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.')],env,timeout:30000});
  const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await finishSetup(page);
  await page.getByRole('button',{name:'Your Library',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Your Library'})).toBeVisible();
  await page.getByRole('button',{name:'Add ChatGPT export'}).click();
  await expect(page.getByText(/Last import: 2 new, 0 updated, 0 unchanged/)).toBeVisible({timeout:15000});
  await expect(page.getByText(/2 items ready to turn into ideas/)).toBeVisible();
  await expect(page.getByTestId('library-document')).toHaveCount(2);
  result.checks.push('Native import picker (stubbed) streams a ChatGPT export into the Library and lists both conversations');
  await expect(page.getByRole('combobox',{name:'Model for reading conversations'})).toContainText('fake-model');
  await expect(page.getByText(/Estimate: free/)).toBeVisible();
  await page.getByRole('button',{name:'Find my ideas'}).click();
  await expect(page.getByText(/Last reading: 2 items, 2 ideas found/)).toBeVisible({timeout:20000});
  result.checks.push('Local-model distillation runs as a background job and reports progress and results');
  await page.getByRole('button',{name:'Close Library',exact:true}).click();
  await expect(page.locator('[data-testid="map-thought"][data-origin="imported"]')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Garden',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Captured',exact:true}).click();await expect(page.getByTestId('map-thought')).toHaveCount(0);
  await page.getByRole('button',{name:'Imported',exact:true}).click();await expect(page.getByTestId('map-thought')).toHaveCount(2);
  result.checks.push('Imported ideas appear on the map grouped by theme, with Captured/Imported filters');
  await page.locator('[data-testid="map-thought"]',{hasText:'Garden watering app'}).click();await page.getByRole('button',{name:'Open notes'}).click();
  await expect(page.getByText(/Imported project · ChatGPT/)).toBeVisible();
  await page.getByTestId('card-sources').getByRole('button').first().click();
  await expect(page.getByRole('heading',{name:'Planning the garden app'})).toBeVisible();
  await expect(page.locator('.library-message mark').first()).toHaveText('build a garden planning app');
  result.checks.push('A card opens its source conversation with the quoted words highlighted');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('textbox',{name:'Search your Library'}).fill('capital');
  await expect(page.getByTestId('library-document')).toHaveCount(1);await expect(page.getByTestId('library-document')).toContainText('Capital of France');
  result.checks.push('Full-text search finds conversations that produced no ideas');
  await expect(page.getByTestId('connector-notion')).toContainText('Notion');
  await page.getByRole('textbox',{name:'Notion integration secret'}).fill('not-a-token');await page.getByTestId('connector-notion').getByRole('button',{name:'Connect'}).click();
  await expect(page.getByRole('alert')).toContainText('does not look like a Notion integration secret');
  await expect(page.getByTestId('connector-gdrive')).toContainText('THOUGHTSPACE_GOOGLE_CLIENT_ID');
  result.checks.push('Live connections list Notion (token) and Google Drive (needs OAuth client); a malformed token is refused before any network call');
  await page.screenshot({path:'artifacts/library-desktop.png'});
  await page.getByRole('button',{name:'Close Library',exact:true}).click();
  const cardsBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')).cards.length);
  await instance.close();instance=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.')],env,timeout:30000});
  const reopened=await instance.firstWindow();
  await expect(reopened.locator('[data-testid="map-thought"][data-origin="imported"]')).toHaveCount(2);
  expect(await reopened.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')).cards.length)).toBe(cardsBefore);
  result.checks.push('Relaunch keeps imported cards without duplicating them');
  expect(errors).toEqual([]);result.status='passed';
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;try{await (await instance?.firstWindow())?.screenshot({path:'artifacts/library-failure.png'});}catch{}}
finally{if(instance)await instance.close();ollama.close();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/library-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
