import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  await page.route('**/api/health*',r=>r.fulfill({json:{ready:false,configured:false}}));
  await page.goto('http://localhost:3000');
  await page.screenshot({path:'artifacts/map-polish-empty.png',animations:'disabled'});
  await page.getByRole('button',{name:'An idea to explore',exact:true}).click();
  if(await page.getByLabel('Capture a thought',{exact:true}).inputValue()!=='I have an idea for ')throw Error('Starter did not fill draft');
  if(!await page.getByLabel('Capture a thought',{exact:true}).evaluate(el=>el===document.activeElement))throw Error('Starter did not focus composer');
  await page.getByLabel('Capture a thought',{exact:true}).fill('Collect garden rain water. Use garden water for vegetables. Design a reading nook.');
  await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();
  await page.getByTestId('map-thought').first().click();
  await page.screenshot({path:'artifacts/map-polish-populated.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/map-polish-mobile.png',animations:'disabled'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await page.screenshot({path:'artifacts/map-polish-mobile-empty.png',animations:'disabled'});
  console.log('Starter, focus, capture and screenshots complete.');
} finally {await browser.close();}
