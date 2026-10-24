import {test,expect,record} from './fixtures.js';

test('captured ideas and AI suggestions stay visibly distinct across conversation, notes, and reopening',async({page})=>{
  await page.route('**/api/health*',r=>r.fulfill({json:{configured:true,ready:true,provider:'Groq'}}));
  await page.route('**/api/extract',r=>r.fulfill({json:{ideas:[{title:'Customer dashboard',source:'I want a customer dashboard.'}]}}));
  await page.route('**/api/discuss',r=>r.fulfill({json:{reply:'Consider an onboarding checklist as a possible next step.'}}));
  await page.goto('/?view=workbench');
  await page.getByRole('textbox',{name:'Capture a thought',exact:true}).fill('I want a customer dashboard.');
  await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();
  const card=page.getByTestId('idea-card'),row=page.getByTestId('inbox-idea');
  await expect(card).toContainText('CAPTURED IDEA');


  await card.click();await page.getByRole('button',{name:'Notes',exact:true}).click();
  await page.getByRole('textbox',{name:'Add a note',exact:true}).fill('Keep the first version simple.');
  await page.getByRole('button',{name:'Save note to idea',exact:true}).click();
  await page.getByRole('button',{name:'Discuss selected',exact:false}).click();
  await page.getByRole('textbox',{name:'Discuss selected ideas',exact:true}).fill('Suggest a next step');
  await page.getByRole('button',{name:'Send discussion',exact:true}).click();
  await expect(page.locator('.message.assistant')).toContainText('AI suggestion');
  await expect(page.locator('.message.assistant')).toContainText('Consider an onboarding checklist');
  await expect(page.locator('.message.assistant')).toContainText('AI suggestion');
  await expect(card).toHaveCount(1);await expect(card).toContainText('I want a customer dashboard.');
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('.attached-note[data-origin="ai"]')).toContainText('AI suggestion');
  await expect(page.locator('.attached-note[data-origin="user"]')).toContainText('Your note');
  await expect(page.locator('.attached-note[data-origin="user"]')).toContainText('Keep the first version simple.');
  await page.getByRole('textbox',{name:'Title for Customer dashboard',exact:true}).fill('My onboarding dashboard');
  await expect(page.locator('.detail-origin')).toContainText('Your summary');await expect(card).toContainText('CAPTURED IDEA');
  await expect(page.locator('.attached-note[data-origin="ai"]')).toContainText('AI suggestion');
  await page.screenshot({path:'artifacts/idea-origin.png',fullPage:true});
  await page.reload();await card.click();await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(card).toContainText('CAPTURED IDEA');
  await expect(page.locator('.attached-note[data-origin="ai"]')).toContainText('Consider an onboarding checklist');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('thoughtspace.workspace.v1')));
  expect(saved.cards).toHaveLength(1);expect(saved.cards[0].origin).toBe('captured');expect(saved.cards[0].summaryOrigin).toBe('user');
  expect(saved.cards[0].notes.map(n=>n.kind)).toEqual(['manual','assistant']);
});
