import {test,expect} from '@playwright/test';

// First run: no onboarding record. Uses the plain Playwright page so the regression fixture doesn't skip setup.
test('first run: pick a look, name the assistant, skip the model, and land in a workspace that remembers both',async({page})=>{
  await page.goto('/');
  const setup=page.getByRole('dialog',{name:'Set up ThoughtSpace'});
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('heading',{name:'First, pick how it looks.'})).toBeVisible();
  await setup.getByRole('radio',{name:/Paper/}).click();
  await setup.getByRole('radio',{name:'Violet'}).click();
  await setup.getByRole('radio',{name:'Compact'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','paper');
  await expect(page.locator('html')).toHaveAttribute('data-mode','light');
  await expect(page.locator('html')).toHaveAttribute('data-accent','violet');
  await setup.getByRole('button',{name:/Continue/}).click();

  const nameField=setup.getByRole('textbox',{name:'Assistant name'});
  await nameField.fill('9 lives');
  await expect(setup.getByRole('alert')).toHaveText('Start the name with a letter.');
  await expect(setup.getByRole('button',{name:/Continue/})).toBeDisabled();
  await nameField.fill('Nova');
  await expect(setup.getByText(/You'll say/)).toContainText('“Nova”');
  await expect(setup.getByText(/Waking by name works in the Windows app/)).toBeVisible();
  await setup.getByRole('button',{name:/Continue/}).click();

  await expect(setup.getByRole('heading',{name:'Connect the model it thinks with.'})).toBeVisible();
  await expect(setup.getByRole('button',{name:/Use an API key or a local model/})).toBeVisible();
  await expect(setup.getByRole('button',{name:'Sign in with OpenRouter'})).toBeVisible();
  await setup.getByRole('button',{name:/open/i}).last().click();
  await expect(setup).toBeHidden();

  // The workspace uses the name everywhere the assistant is named.
  await page.getByRole('button',{name:'More tools'}).click();
  await expect(page.getByRole('button',{name:'Nova'})).toBeVisible();

  await page.reload();
  await expect(page.getByRole('dialog',{name:'Set up ThoughtSpace'})).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme','paper');
  await expect(page.locator('html')).toHaveAttribute('data-density','compact');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.onboarding.v1')));
  expect(saved.assistantName).toBe('Nova');expect(saved.completedAt).toBeTruthy();
});

test('Settings can change the look and rename the assistant after setup',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('thoughtspace.onboarding.v1'))localStorage.setItem('thoughtspace.onboarding.v1',JSON.stringify({completedAt:'2031-09-28T00:00:00.000Z',assistantName:'Atlas'}));});
  await page.goto('/');
  await page.getByRole('button',{name:'Privacy and settings'}).click();
  const settings=page.getByRole('dialog',{name:'Privacy and settings'});
  const bgBefore=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  await settings.getByRole('radio',{name:/Graphite/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','graphite');
  // The switch fades: mid-way the page is neither the old nor the new colour, then the fade class clears.
  await page.waitForTimeout(120);
  const bgMid=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  await expect(page.locator('html')).not.toHaveClass(/theme-switching/,{timeout:2000});
  const bgAfter=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  expect(bgMid).not.toBe(bgBefore);
  expect(bgMid).not.toBe(bgAfter);
  await settings.getByRole('textbox',{name:'Assistant name'}).fill('Ada');
  await settings.getByRole('button',{name:'Save name'}).click();
  await expect(settings.getByText('turn on Ada wake')).toBeVisible();
  await settings.getByRole('button',{name:'Close settings'}).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','graphite');
  expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.onboarding.v1')))).assistantName).toBe('Ada');
});

test('discussion requests carry the assistant name to the server',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('thoughtspace.onboarding.v1',JSON.stringify({completedAt:'2031-09-28T00:00:00.000Z',assistantName:'Nova'}));
    localStorage.setItem('thoughtspace.workspace.v1',JSON.stringify({version:1,cards:[],captures:[],groups:[],connections:[],messages:[],draft:'',voiceConfig:{service:'device',voice:'daniel'}}));
  });
  let body=null;
  await page.route('**/api/health**',route=>route.fulfill({json:{ready:true,provider:'Test',models:{chat:'x'}}}));
  await page.route('**/api/discuss',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{reply:'Hi, I am Nova.'}});});
  await page.goto('/?view=workbench');
  await page.getByRole('button',{name:/Discuss selected/}).click();
  await page.getByRole('textbox',{name:'Discuss selected ideas'}).fill('Who are you?');
  await page.getByRole('button',{name:'Send discussion'}).click();
  await expect(page.getByText('Hi, I am Nova.')).toBeVisible();
  expect(body.assistantName).toBe('Nova');
});

test('onboarding sign-in with OpenRouter opens the approval page and finishes connected',async({page,context})=>{
  const profiles=[{id:'svc-ollama',name:'llama3.1:8b · Ollama',provider:'ollama',providerLabel:'Ollama (on this computer)',model:'llama3.1:8b',active:true}];
  await page.route('**/api/health**',route=>route.fulfill({json:{ready:false,message:'Ollama is not running.'}}));
  await page.route('**/api/provider',route=>route.fulfill({json:{providers:[],profiles}}));
  await page.route('**/api/provider/signin',route=>route.fulfill({json:{id:'s1',authUrl:'https://openrouter.ai/auth?code_challenge=x',opened:false}}));
  let release;const approved=new Promise(r=>{release=r;});
  await page.route('**/api/provider/signin/wait',async route=>{await approved;await route.fulfill({json:{providers:[],profiles:[{...profiles[0],active:false},{id:'m-1',name:'openai/gpt-4o-mini · OpenRouter',provider:'openrouter',providerLabel:'OpenRouter (hundreds of models)',model:'openai/gpt-4o-mini',signedIn:true,active:true}],health:{ready:true,provider:'OpenRouter'},voice:{}}});});
  await context.route('https://openrouter.ai/**',route=>route.fulfill({body:'<title>OpenRouter</title>approve'}));
  await page.goto('/');
  const setup=page.getByRole('dialog',{name:'Set up ThoughtSpace'});
  await setup.getByRole('button',{name:/Continue/}).click();
  await setup.getByRole('button',{name:/Continue/}).click();
  const popup=context.waitForEvent('page');
  await setup.getByRole('button',{name:'Sign in with OpenRouter'}).click();
  const tab=await popup;await tab.waitForURL(/openrouter\.ai\/auth/);
  await expect(setup.getByRole('button',{name:/Waiting for you to approve/})).toBeVisible();
  release();
  await expect(setup.getByText('Connected to')).toContainText('openai/gpt-4o-mini · OpenRouter');
  await expect(setup.getByRole('button',{name:/Open ThoughtSpace/})).toBeVisible();
});
