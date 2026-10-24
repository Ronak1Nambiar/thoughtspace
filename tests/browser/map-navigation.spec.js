import {test,expect} from './fixtures.js';
async function capture(page,text){await page.getByLabel('Capture a thought',{exact:true}).fill(text);await page.getByRole('button',{name:'Capture and extract ideas',exact:true}).click();}
const zoomOf=page=>page.locator('.map-world').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
const offsetOf=page=>page.locator('.map-world').evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return {x:m.e,y:m.f};});
test.beforeEach(async({page})=>{await page.route('**/api/health*',r=>r.fulfill({json:{ready:false,configured:false}}));});

test('mouse wheel and pinch zoom toward the cursor, two-finger swipe pans, keys and buttons zoom and fit',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await capture(page,'Collect garden rain water. Use garden water for vegetables. Write a novel.');
  await expect(page.getByTestId('map-thought')).toHaveCount(3);
  const box=await page.locator('.thought-map').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  const start=await zoomOf(page);

  // A mouse wheel notch (line mode is what most mice send on Windows) zooms in.
  await page.locator('.thought-map').dispatchEvent('wheel',{deltaY:-3,deltaMode:1,clientX:box.x+box.width/2,clientY:box.y+box.height/2});
  await expect.poll(()=>zoomOf(page)).toBeGreaterThan(start);
  // Touchpad pinch arrives as ctrl+wheel with small pixel deltas.
  const afterWheel=await zoomOf(page);
  await page.locator('.thought-map').dispatchEvent('wheel',{deltaY:20,deltaMode:0,ctrlKey:true,clientX:box.x+100,clientY:box.y+100});
  await expect.poll(()=>zoomOf(page)).toBeLessThan(afterWheel);
  // Two-finger swipe pans without zooming.
  const zoomBefore=await zoomOf(page),before=await offsetOf(page);
  await page.locator('.thought-map').dispatchEvent('wheel',{deltaX:30,deltaY:12.5,deltaMode:0,clientX:box.x+200,clientY:box.y+200});
  const panned=await offsetOf(page);
  expect(panned.x).toBeCloseTo(before.x-30,0);expect(panned.y).toBeCloseTo(before.y-12.5,0);
  expect(await zoomOf(page)).toBeCloseTo(zoomBefore,5);

  // Keyboard: + zooms in, 1 is actual size, arrows pan, 0 fits.
  await page.locator('.thought-map').click({position:{x:20,y:box.height-20}});
  await page.keyboard.press('Equal');
  await expect.poll(()=>zoomOf(page)).toBeGreaterThan(zoomBefore);
  await page.keyboard.press('Digit1');
  await expect.poll(()=>zoomOf(page)).toBeCloseTo(1,5);
  await expect(page.locator('.map-zoom-level')).toHaveText('100%');
  const beforeArrow=await offsetOf(page);
  await page.keyboard.press('ArrowLeft');
  expect((await offsetOf(page)).x).toBeCloseTo(beforeArrow.x+80,0);
  await page.keyboard.press('Digit0');
  // Typing in the composer never moves the map.
  const composer=page.getByLabel('Capture a thought',{exact:true});
  await composer.click();const typedFrom=await zoomOf(page);
  await page.keyboard.type('+-0');
  await expect(composer).toHaveValue('+-0');
  expect(await zoomOf(page)).toBeCloseTo(typedFrom,5);

  // The Fit button fits instead of throwing.
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.getByRole('button',{name:'Fit map',exact:true}).click();
  await expect.poll(()=>zoomOf(page)).toBeCloseTo(typedFrom,2);

  // Double-click on empty map zooms in; double-click on a thought still opens it.
  const fitted=await zoomOf(page);
  await page.locator('.thought-map').dblclick({position:{x:30,y:60}});
  await expect.poll(()=>zoomOf(page)).toBeGreaterThan(fitted);
  await page.getByTestId('map-thought').first().dblclick();
  await expect(page.locator('.context-panel')).toBeVisible();
  expect(errors).toEqual([]);
});
