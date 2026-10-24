import {test as base,expect} from '@playwright/test';
export const test=base.extend({
  page:async({page},use)=>{
    // Existing device-voice regressions deliberately exercise the explicit
    // device option. Natural voice has its own network/playback tests.
    await page.addInitScript(()=>{
      const key='thoughtspace.workspace.v1',saved=localStorage.getItem(key);
      // Regression tests start in the workspace; onboarding has its own spec.
      if(!localStorage.getItem('thoughtspace.onboarding.v1'))localStorage.setItem('thoughtspace.onboarding.v1',JSON.stringify({completedAt:'2031-09-28T00:00:00.000Z',assistantName:'Atlas'}));
      if(!saved)localStorage.setItem(key,JSON.stringify({version:1,cards:[],captures:[],groups:[],connections:[],messages:[],draft:'',voiceConfig:{service:'device',voice:'daniel'}}));
    });
    await use(page);
  }
});
export {expect};
export async function record(page){
  await page.getByRole('button',{name:'Privacy and settings',exact:true}).click();
  await page.getByRole('button',{name:'Start recording',exact:true}).click();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
}
