import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

// Run against `npm run preview -- --port 4174` after building.
const url=process.env.STARTUP_URL||'http://localhost:4174/';
const browser=await (process.env.BROWSER==='firefox'?firefox:chromium).launch({
 headless:process.env.HEADED!=='1',
 ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),
});
const context=await browser.newContext({viewport:process.env.MOBILE==='1'?{width:390,height:844}:{width:1280,height:720}});
// The app opens in Simple mode; the 3D scene only loads in Map mode.
const mapMode=()=>localStorage.setItem('bustrackr.view.v1','map');
await context.addInitScript(mapMode);
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
// Scene files arrive with Vite's content hash in the name; record them by their source name.
const requested=new Set();page.on('request',request=>requested.add(new URL(request.url()).pathname.split('/').pop().replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/,'$1')));
let releaseGround;
const groundGate=new Promise(resolve=>{releaseGround=resolve;});
await page.route('**/assets/grass-detail-albedo-*.webp',async route=>{await groundGate;await route.continue();});
try {
 // Holding the first texture must not prevent all other assets starting.
 const groundRequest=page.waitForRequest('**/assets/grass-detail-albedo-*.webp');
 const busRequest=page.waitForRequest('**/assets/valley-bus-*.glb',{timeout:5000});
 // Attach the rejection handler before navigation; no unhandled timeout promises.
 const concurrent=Promise.all([groundRequest,busRequest]);
 try {await Promise.all([page.goto(url,{waitUntil:'domcontentloaded'}),concurrent]);}
 finally {releaseGround();}
 for(const name of ['grass-detail','shingles','stone','broadleaf']){
  assert(requested.has(`${name}-albedo.webp`),`${name} must start with the other assets`);
  assert(!requested.has(`${name}-albedo.png`),'Do not download source PNGs at runtime');
 }
 await page.waitForFunction(()=>JSON.parse(document.querySelector('.world')?.dataset.diagnostics||'{}').worldFirstRenderMs>0,null,{timeout:45000});
 await page.locator('.loading').waitFor({state:'hidden'});
 const diagnostics=()=>page.locator('.world').getAttribute('data-diagnostics').then(JSON.parse);
 const startup=await diagnostics();
 assert.equal(startup.aerialTextures,0);
 assert(startup.landscapePatches>0,'Modeled landscape must be present');
 for(const file of ['ground.jpg','campus.jpg','campus-bounds.json'])assert(!requested.has(file),`Aerial asset must not load: ${file}`);
 if(process.env.STARTUP_SCREENSHOT)await page.screenshot({path:process.env.STARTUP_SCREENSHOT});
 assert.equal(startup.reflections,'idle','Reflection bake must not block initial load');
 if(process.env.STARTUP_BUDGET_MS)assert(startup.worldFirstRenderMs<Number(process.env.STARTUP_BUDGET_MS),'Startup exceeded budget');
 console.log(`First frame: ${startup.worldFirstRenderMs} ms; stages: ${JSON.stringify(startup.startupStages)}`);
 await page.getByRole('button',{name:'Buildings',exact:true}).click();
 await page.getByRole('button',{name:'Conservatory',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('.world').dataset.diagnostics).reflections==='ready',null,{timeout:45000});
 for(const [name,mode] of [['Sports','facilities'],['Fehren','lot'],['Full route','overview'],['Ride along','follow'],['Inspect detailed bus','bus']]){
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(mode=>JSON.parse(document.querySelector('.world').dataset.diagnostics).mode===mode,mode);
 }
 await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('.world').dataset.diagnostics).paused);
 assert.deepEqual(errors,[]);
 await context.close();
 // A missing asset must show the existing retry UI instead of staying on the spinner.
 const failure=await browser.newPage();await failure.addInitScript(mapMode);
 await failure.route('**/assets/grass-detail-albedo-*.webp',route=>route.fulfill({status:503,body:'Unavailable'}));
 await failure.goto(url);
 await failure.getByText('Local scene could not load',{exact:true}).waitFor();
 assert.match(await failure.locator('.loading.error').innerText(),/grass-detail-albedo.webp.*HTTP 503/);
 await failure.getByRole('button',{name:'Reconnect'}).waitFor();
 await failure.close();
 const stalled=await browser.newPage();await stalled.addInitScript(mapMode);
 await stalled.route('**/assets/valley-bus-*.glb',()=>{});
 await stalled.goto(url,{waitUntil:'domcontentloaded'});
 await stalled.getByText('Local scene could not load',{exact:true}).waitFor({timeout:25000});
 assert.match(await stalled.locator('.loading.error').innerText(),/valley-bus.glb/);
 await stalled.close();
 console.log('Startup check passed: concurrent compressed assets, first frame, lazy reflections, navigation, pause, HTTP failure and stalled-request retry UI.');
} finally {releaseGround();await browser.close();}
