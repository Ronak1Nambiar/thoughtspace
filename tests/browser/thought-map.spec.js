import {test,expect} from './fixtures.js';
const key='thoughtspace.workspace.v1';
async function capture(page,text){await page.getByLabel('Capture a thought',{exact:true}).fill(text);await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();}
test.beforeEach(async({page})=>{await page.route('**/api/health*',r=>r.fulfill({json:{ready:false,configured:false}}));});
test('starters preserve a draft, capture feedback clears, and reduced motion keeps the map still',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  const composer=page.getByLabel('Capture a thought',{exact:true});
  await page.getByRole('button',{name:'An idea to explore',exact:true}).click();
  await expect(composer).toHaveValue('I have an idea for ');await expect(composer).toBeFocused();
  await composer.fill('Collect garden water. Reuse garden water.');
  await page.getByRole('button',{name:'Something to make',exact:true}).click();
  await expect(composer).toHaveValue('Collect garden water. Reuse garden water.');
  const before=await page.locator('.thought-map').boundingBox();
  await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();
  await expect(page.locator('.map-arrival')).toHaveText('2 new thoughts added to your map');
  expect((await page.locator('.thought-map').boundingBox()).y).toBe(before.y);
  await expect(page.getByRole('button',{name:'An idea to explore',exact:true})).toHaveCount(0);
  await page.getByTestId('map-thought').first().click();
  await expect(page.locator('.map-thought.connected')).toHaveCount(2);
  expect(await page.getByTestId('map-thought').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('.map-arrival')).toHaveText('',{timeout:6000});
});
test('map is the default; capture, suggestions, removal, manual linking, notes and movement persist',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByRole('region',{name:'Thought map',exact:true})).toBeVisible();await expect(page.locator('.context-panel')).toHaveCount(0);
  await capture(page,'Collect garden rain water. Use garden water for vegetables. Write a novel.');
  await expect(page.getByTestId('map-thought')).toHaveCount(3);await expect(page.getByTestId('map-connection')).toHaveCount(1);
  const dragBox=await page.getByTestId('map-thought').first().boundingBox();
  await page.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);await page.mouse.down();await page.mouse.move(dragBox.x+dragBox.width/2+35,dragBox.y+dragBox.height/2+20,{steps:5});await page.mouse.up();
  expect(Object.keys((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).mapPositions)).toHaveLength(1);
  const transformBefore=await page.locator('.map-world').getAttribute('style'),mapBox=await page.locator('.thought-map').boundingBox();
  await page.mouse.move(mapBox.x+10,mapBox.y+80);await page.mouse.down();await page.mouse.move(mapBox.x+40,mapBox.y+95,{steps:3});await page.mouse.up();expect(await page.locator('.map-world').getAttribute('style')).not.toBe(transformBefore);
  await page.getByRole('button',{name:'Fit map',exact:true}).click();
  const first=page.getByTestId('map-thought').first();await first.click();await expect(page.getByRole('region',{name:'Thought connections'})).toContainText('Shared words');
  await page.getByRole('button',{name:/Keep connection:/}).click();await expect(page.locator('.map-lines path.manual')).toHaveCount(1);
  await page.getByRole('button',{name:/Remove connection:/}).click();await expect(page.getByTestId('map-connection')).toHaveCount(0);await page.reload();await expect(page.getByTestId('map-connection')).toHaveCount(0);
  await first.click();await page.getByTestId('map-thought').nth(1).click({modifiers:['Shift']});await page.getByRole('button',{name:'Connect selected',exact:true}).click();await expect(page.locator('.map-lines path.manual')).toHaveCount(1);
  await first.click();await first.press('ArrowRight');const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);expect(Object.keys(saved.mapPositions)).toHaveLength(1);expect(saved.cards.every(c=>c.position===null)).toBe(true);
  await page.getByRole('button',{name:'Open notes',exact:true}).click();await page.getByLabel('Add a note',{exact:true}).fill('Try a rain barrel');await page.getByRole('button',{name:'Save note to idea',exact:true}).click();await page.getByRole('button',{name:'Close notes panel'}).click();
  await page.getByLabel('Find an idea',{exact:true}).fill('novel');await expect(page.getByRole('status').filter({hasText:'1 matching thought'})).toBeVisible();await page.getByLabel('Find an idea',{exact:true}).fill('');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Fit map',exact:true}).click();await page.reload();
  expect((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).mapPositions).toEqual(saved.mapPositions);expect(errors).toEqual([]);
  await page.screenshot({path:'artifacts/thought-map-desktop.png'});
  await page.getByRole('button',{name:'More tools',exact:true}).click();await expect(page.getByTestId('idea-card')).toHaveCount(3);await page.getByRole('button',{name:'Back to map',exact:true}).click();await expect(page.getByTestId('map-thought')).toHaveCount(3);
});
test('AI connections are explained, saved, and stale responses do not overwrite a changed map',async({page})=>{
  await page.goto('/');await capture(page,'Collect rainwater. Grow vegetables.');
  await page.route('**/api/health*',r=>r.fulfill({json:{ready:true,configured:true}}));await page.reload();
  await page.route('**/api/connections',r=>{const {cards}=r.request().postDataJSON();return r.fulfill({json:{links:[{ids:cards.map(c=>c.id),reason:'Rainwater can irrigate the vegetables.'}]}});});
  await page.getByRole('button',{name:'Find deeper connections',exact:true}).click();await expect(page.locator('.map-lines path.ai')).toHaveCount(1);await page.getByTestId('map-thought').first().click();await expect(page.getByRole('region',{name:'Thought connections'})).toContainText('Rainwater can irrigate');await page.reload();await expect(page.locator('.map-lines path.ai')).toHaveCount(1);
  let release;await page.route('**/api/connections',async r=>{await new Promise(resolve=>release=resolve);const {cards}=r.request().postDataJSON();await r.fulfill({json:{links:[{ids:cards.map(c=>c.id),reason:'Old result'}]}});});
  await page.getByRole('button',{name:'Find deeper connections',exact:true}).click();await expect.poll(()=>!!release).toBe(true);await page.getByLabel('Capture a thought',{exact:true}).fill('Read a book');await page.getByRole('button',{name:/Save as one card/}).click();release();await expect(page.locator('.banner')).toContainText('thoughts changed');await expect(page.locator('.map-lines path.ai')).toHaveCount(0);
});
test('mobile keeps the map and capture visible without a permanent side panel',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await capture(page,'Plan garden water storage. Collect garden water.');await expect(page.getByTestId('map-thought')).toHaveCount(2);
  const map=await page.getByRole('region',{name:'Thought map',exact:true}).boundingBox();expect(map.height).toBeGreaterThan(240);await expect(page.getByLabel('Capture a thought',{exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByTestId('map-thought').first().click();await expect(page.getByRole('button',{name:'Open notes',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/thought-map-mobile.png'});
});
