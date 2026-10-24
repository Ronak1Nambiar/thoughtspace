import {test,expect} from './fixtures.js';
import {normalizeConfig,applyUpdate,publicConfig,activeProvider} from '../../llm-providers.mjs';

// The provider API is served by the real settings logic in-process, so the UI is tested against true behaviour without real keys.
async function modelApi(page,{testReady=()=>true}={}){
  let config=normalizeConfig({enabled:true,provider:'ollama',models:{ollama:'llama3.1:8b'},baseUrls:{},keys:{groq:'gsk_secret_1234'}});
  const health=()=>{const p=activeProvider(config);return {provider:p.label,providerId:p.id,configured:true,ready:true,models:{chat:p.model},available:[],message:`${p.label} is connected. Thinking with ${p.model}.`};};
  const state={tests:0,get config(){return config;}};
  await page.route('**/api/health*',r=>r.fulfill({json:health()}));
  await page.route('**/api/provider/test',async r=>{state.tests++;const body=r.request().postDataJSON();try{applyUpdate(config,{action:'saveProfile',profile:body.profile,activate:true});}catch(e){return r.fulfill({status:400,json:{error:e.message}});}
    const ready=testReady(body.profile);r.fulfill({json:{ready,message:ready?'Connected.':'Cannot reach your server. Check the address.',available:['qwen3-8b','llama3.2']}});});
  await page.route('**/api/provider',async r=>{
    if(r.request().method()==='GET')return r.fulfill({json:{...publicConfig(config),voice:{}}});
    try{config=applyUpdate(config,r.request().postDataJSON());r.fulfill({json:{...publicConfig(config),voice:{},health:health()}});}catch(e){r.fulfill({status:e.status||500,json:{error:e.message}});}
  });
  return state;
}

test('header switcher lists saved models, switches instantly and never shows a key',async({page})=>{
  await modelApi(page);await page.goto('/');
  const pill=page.getByRole('button',{name:/AI model: llama3.1:8b · Ollama/});await expect(pill).toBeVisible();
  await pill.click();
  const options=page.getByRole('listbox',{name:'Your models'}).getByRole('option');
  await expect(options).toHaveCount(2);await expect(options.nth(0)).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('option',{name:/openai\/gpt-oss-120b · Groq/})).toBeFocused({timeout:1000}).catch(()=>{});
  expect(await page.content()).not.toContain('gsk_secret_1234');
  await page.keyboard.press('Escape');await expect(options).toHaveCount(0);
  await pill.click();await page.getByRole('option',{name:/openai\/gpt-oss-120b · Groq/}).click();
  await expect(page.getByRole('button',{name:/AI model: openai\/gpt-oss-120b · Groq/})).toBeVisible();
  await expect(page.locator('.banner[role=status]')).toContainText('Now thinking with openai/gpt-oss-120b · Groq');
});
test('add your model: a failed test offers Save anyway, the new model becomes current, and settings manage the list',async({page})=>{
  const api=await modelApi(page,{testReady:p=>p.baseUrl!=='http://localhost:9999/v1'});await page.goto('/');
  await page.getByRole('button',{name:/AI model:/}).click();await page.getByRole('button',{name:'Add your model…'}).click();
  const form=page.getByRole('dialog',{name:'Add your model'});
  await form.getByRole('combobox',{name:'Service'}).selectOption('custom');
  await form.getByRole('combobox',{name:'Model',exact:true}).fill('qwen3-8b');
  await form.getByRole('button',{name:'Test and add'}).click();
  await expect(form.getByRole('alert')).toContainText('address of your OpenAI-compatible server');await expect(form.getByRole('button',{name:'Save anyway'})).toHaveCount(0);
  await form.getByRole('textbox',{name:'Server address'}).fill('http://localhost:9999/v1');
  await form.getByRole('textbox',{name:'API key'}).fill('lm-private-key-7777');
  await form.getByRole('textbox',{name:'Name'}).fill('LM Studio');
  await form.getByRole('button',{name:'Test and add'}).click();
  await expect(form.getByRole('alert')).toContainText('Cannot reach your server');
  await form.getByRole('button',{name:'Save anyway'}).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('button',{name:/AI model: LM Studio/})).toBeVisible();
  expect(api.config.profileKeys[api.config.active]).toBe('lm-private-key-7777');expect(await page.content()).not.toContain('lm-private-key-7777');
  await page.getByRole('button',{name:/AI model:/}).click();await page.getByRole('button',{name:'Manage models'}).click();
  const rows=page.getByTestId('model-row');await expect(rows).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Delete LM Studio'})).toBeDisabled();
  await expect(rows.filter({hasText:'LM Studio'})).toContainText('key ••••7777');
  await rows.filter({hasText:'Groq'}).getByRole('button',{name:'Use'}).click();
  await expect(rows.filter({hasText:'Groq'})).toContainText('CURRENT');
  await page.getByRole('button',{name:'Delete LM Studio'}).click();await expect(rows).toHaveCount(2);
  await expect(page.getByText('Model removed. Its key was deleted from this computer.')).toBeVisible();
  expect(Object.keys(api.config.profileKeys)).toEqual([]);
  await rows.filter({hasText:'Ollama'}).getByRole('button',{name:'Edit'}).click();
  const edit=page.getByRole('dialog',{name:'Edit model'});await edit.getByRole('combobox',{name:'Model',exact:true}).fill('llama3.2');await edit.getByRole('button',{name:'Test and save'}).click();
  await expect(rows.filter({hasText:'llama3.2'})).toBeVisible();await expect(rows.filter({hasText:'Groq'})).toContainText('CURRENT');
});
