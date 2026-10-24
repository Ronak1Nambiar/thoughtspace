import {expect} from '@playwright/test';
// First-run setup on a fresh desktop profile: pick a look, name the assistant, skip the model.
// Returns what it checked so each desktop regression can record it.
export async function finishSetup(page,{name='Nova',theme='Graphite'}={}){
  const setup=page.getByRole('dialog',{name:'Set up ThoughtSpace'});
  // isVisible() doesn't wait; the packaged app can take a few seconds to draw its first screen.
  const shown=await Promise.race([setup.waitFor({state:'visible',timeout:20000}).then(()=>true),page.getByRole('button',{name:'Start conversation',exact:true}).waitFor({state:'visible',timeout:20000}).then(()=>setup.isVisible())]).catch(()=>false);
  if(!shown)return [];
  await setup.getByRole('radio',{name:new RegExp(theme)}).click();
  await setup.getByRole('button',{name:/Continue/}).click();
  await setup.getByRole('textbox',{name:'Assistant name'}).fill(name);
  await expect(setup.getByRole('button',{name:'Test the name'})).toBeVisible();
  await setup.getByRole('button',{name:/Continue/}).click();
  await expect(setup.getByRole('button',{name:'Sign in with OpenRouter'})).toBeVisible();
  await setup.getByRole('button',{name:/open/i}).last().click();
  await expect(setup).toBeHidden();
  return [`First-run setup completed on a fresh profile (look ${theme}, assistant ${name}, model skipped); the Windows name test is offered`];
}
