import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {chromium} from 'playwright';

const root = new URL('../', import.meta.url);
const tracker = await readFile(new URL('fixtures/umami-3.4.js', import.meta.url), 'utf8');
const origin = 'https://bustrackr.valleychristianai.com';
const mime = {html:'text/html', js:'text/javascript', css:'text/css', json:'application/json', svg:'image/svg+xml', glb:'model/gltf-binary', webp:'image/webp'};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path.startsWith('/BusTrackr/') ? 'dist/' + (path.slice(11) || 'index.html') : 'website/' + (path.slice(1) || 'index.html');
    const data = await readFile(new URL(file, root));
    res.writeHead(200, {'content-type': mime[file.split('.').pop()] || 'application/octet-stream'});res.end(data);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const local = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, args:['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
async function setup({blocked=false, delayed=false, storageBlocked=false, optedOut=false, notifications=false, failSubscription=false, cryptoFailure=false, collectionDelay=0, staleBootstrap=false, recorderDelayed=false, recorderBlocked=false, heroDelayed=false} = {}) {
  const context = await browser.newContext({viewport:{width:1280,height:900}, userAgent:'BusTrackrAnalyticsCheck/1'});
  const events = [], errors = [], subscriptions = [], recorders = [], heroRequests = [];
  if (cryptoFailure) await context.addInitScript(() => {Object.defineProperty(crypto,'randomUUID',{value:()=>{throw new Error('disabled');}});Object.defineProperty(crypto,'getRandomValues',{value:()=>{throw new Error('disabled');}});});
  if (optedOut) await context.addInitScript(() => localStorage.setItem('umami.disabled', '1'));
  if (notifications) await context.addInitScript(() => {
    class MockNotification {static permission='default';static async requestPermission(){this.permission='granted';return 'granted';}}
    Object.defineProperty(window, 'Notification', {value:MockNotification});
    Object.defineProperty(window, 'PushManager', {value:class {}});
    let subscribed=false;
    const subscription={toJSON:()=>({endpoint:'https://push.invalid/private-endpoint',keys:{auth:'private-secret'}}),unsubscribe:async()=>{subscribed=false;return true;}};
    const worker={pushManager:{getSubscription:async()=>subscribed?subscription:null,subscribe:async()=>{subscribed=true;return subscription;}}};
    Object.defineProperty(navigator, 'serviceWorker', {value:{register:async()=>worker,ready:Promise.resolve(worker),addEventListener(){}}});
  });
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  if (storageBlocked) await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {get(){throw new Error('storage blocked');}}));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'analytics.valleychristianai.com') {
      if (url.pathname === '/script.js') {
        if (blocked) return route.abort();
        if (delayed) await gate;
        return route.fulfill({contentType:'text/javascript', body:tracker});
      }
      if (url.pathname === '/recorder.js') {
        recorders.push(route.request().url());
        if (recorderBlocked) return route.abort();
        if (recorderDelayed) await gate;
        return route.fulfill({contentType:'text/javascript', body:'window.recorderLoaded=true;'});
      }
      if (collectionDelay) await new Promise(resolve=>setTimeout(resolve,collectionDelay));
      events.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json', body:'{"cache":"check"}'});
    }
    if (url.origin === origin) {
      if (heroDelayed && url.pathname === '/assets/scene-campus.png') {heroRequests.push(url.href);await gate;}
      if (staleBootstrap && url.pathname === '/BusTrackr/analytics.js' && !url.search) return route.fulfill({contentType:'text/javascript',body:'window.legacyAnalyticsBootstrap=true;'});
      if (/\/assets\/world-[^/]+\.js$/.test(url.pathname)) return route.fulfill({contentType:'text/javascript',body:`export function createWorld(host, notify) {notify({progress:[.9,.16,.44],distance:[2400,2400],fps:0,selected:0,loaded:true,pending:0,mode:'campus',speedMph:0,location:'SKYWAY CAMPUS'});return new Proxy({}, {get:(_target,key)=>key==='then'?undefined:()=>{}});}`});
      if (notifications && url.pathname.endsWith('/notifications/config')) return route.fulfill({contentType:'application/json',body:JSON.stringify({webPushPublicKey:'AQID'})});
      if (notifications && url.pathname.endsWith('/notifications/subscriptions')) {subscriptions.push(route.request().method());return route.fulfill({status:failSubscription?503:200,body:'{}'});}
      if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, body:'unavailable'});
      return route.fulfill({response:await route.fetch({url:local + url.pathname + url.search})});
    }
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({contentType:'text/css',body:''});
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror', e=>{errors.push(e.message);console.error('Browser error',e.message);});
  return {context,page,events,errors,release,subscriptions,recorders,heroRequests};
}
const pageviews = events => events.filter(e => e.type === 'event' && !e.payload.name);
const clicks = (events, control) => events.filter(e => e.payload.name === 'ui_click' && e.payload.data.control === control);
async function waitForCollection(predicate) {
  const deadline=Date.now()+10_000;
  while (!predicate()) {
    assert(Date.now()<deadline,'Expected analytics event did not reach the collector');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  await new Promise(resolve=>setTimeout(resolve,200));
}
async function audit(page) {
  assert.deepEqual(await page.locator('button,a,input[type=range],select').evaluateAll(elements=>elements.filter(e=>!e.hasAttribute('data-analytics')).map(e=>e.outerHTML)), [], 'All rendered controls have stable metadata');
}
try {
  const stalledHero=await setup({heroDelayed:true});
  try {
    await stalledHero.page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    await waitForCollection(()=>stalledHero.heroRequests.length===1&&stalledHero.recorders.length===1);
    await stalledHero.page.waitForFunction(()=>document.readyState==='complete',null,{timeout:5000});
    assert.equal(await stalledHero.page.locator('img[src="assets/scene-campus.png"]').evaluate(image=>image.complete),false,'Hero request remains pending after document completion');
    await stalledHero.page.locator('[data-analytics="nav_sightings"]').click();
    await waitForCollection(()=>clicks(stalledHero.events,'nav_sightings').length>=1);
    assert.equal(clicks(stalledHero.events,'nav_sightings').length,1,'Navigation remains usable while hero image is pending');
    assert.equal(new URL(stalledHero.page.url()).hash,'#sighting');
    assert.deepEqual(stalledHero.errors,[]);
  } finally {stalledHero.release();await stalledHero.context.unrouteAll({behavior:'wait'});await stalledHero.context.close();}
  const a=await setup();
  await a.page.goto(origin+'/?utm_source=instagram&utm_campaign=simple-bryan-story&secret=private#hidden');
  await a.page.waitForFunction(()=>!!window.umami);
  await waitForCollection(()=>pageviews(a.events).length>=1);
  assert.equal(pageviews(a.events).length,1);
  const id=pageviews(a.events)[0].payload.id;
  assert.match(id,/^[a-f0-9-]{36}$/);
  assert.match(pageviews(a.events)[0].payload.url,/utm_campaign=simple-bryan-story/);
  assert(!JSON.stringify(a.events).includes('private'));
  assert(!JSON.stringify(a.events).includes('hidden'));
  assert.equal(a.recorders.length,0,'Recorder skips unsanitized page URLs');
  for (const path of ['/support.html','/privacy.html','/BusTrackr/']) {
    const previous=pageviews(a.events).length;
    await a.page.goto(origin+path);await audit(a.page);
    await waitForCollection(()=>pageviews(a.events).length>previous);
    assert.equal(pageviews(a.events).at(-1).payload.id,id,'ID survives navigation');
  }
  const beforeReload=pageviews(a.events).length;
  await a.page.reload();await waitForCollection(()=>pageviews(a.events).length>beforeReload);
  assert.equal(pageviews(a.events).at(-1).payload.id,id,'ID survives reload');
  await a.page.locator('[data-analytics="feed_refresh"]').focus();await a.page.keyboard.press('Enter');
  await waitForCollection(()=>clicks(a.events,'feed_refresh').length>=1);assert.equal(clicks(a.events,'feed_refresh').length,1);
  assert.equal(a.recorders.length,4,'Each clean static or app document loads one recorder');
  console.log('Native identity and static pages passed.');
  const returning=await setup({staleBootstrap:true});await returning.page.goto(origin+'/BusTrackr/');
  await returning.page.locator('.simple-screen').waitFor();
  await waitForCollection(()=>pageviews(returning.events).length>=1);
  assert.equal(await returning.page.evaluate(()=>window.legacyAnalyticsBootstrap),undefined,'Returning browser does not reuse the cached pre-migration bootstrap');
  await returning.page.locator('[data-analytics="feed_refresh"]').click();
  await waitForCollection(()=>clicks(returning.events,'feed_refresh').length>=1);
  assert.deepEqual(returning.errors,[]);
  await a.page.locator('[data-analytics="mode_map"]').click();
  await a.page.locator('[data-analytics="about_open"]').waitFor().catch(async e=>{console.error(await a.page.locator('body').innerText());throw e;});await audit(a.page);
  await a.page.locator('[data-analytics="about_open"] svg').click();
  await a.page.getByRole('dialog').waitFor();await audit(a.page);
  await a.page.locator('[data-analytics="about_close"] svg').click();
  await a.page.locator('[data-analytics="view_buildings"]').waitFor({state:'visible'});
  await a.page.waitForFunction(()=>!document.querySelector('[data-analytics="view_buildings"]').disabled, null, {timeout:60000});
  await a.page.locator('[data-analytics="view_buildings"] svg').click();
  await a.page.locator('[data-analytics="view_quad"]').waitFor();await audit(a.page);
  await a.page.locator('[data-analytics="view_quad"]').click();
  await a.page.locator('[data-analytics="tracking_demo"]').click();
  await a.page.locator('[data-analytics="fleet_toggle"]').click();await audit(a.page);
  await a.page.locator('[data-analytics="trip_seek"]').evaluate(e=>{e.value='50';for(let i=0;i<5;i++)e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await waitForCollection(()=>clicks(a.events,'about_open').length>=1&&clicks(a.events,'view_quad').length>=1&&a.events.some(e=>e.payload.name==='ui_change'));
  assert.equal(clicks(a.events,'about_open').length,1,'Nested SVG emits once');
  assert.equal(clicks(a.events,'view_quad').length,1,'React stopPropagation does not suppress capture');
  assert.equal(a.events.filter(e=>e.payload.name==='ui_change').length,1,'Committed change emits once');
  assert.deepEqual(a.errors,[]);
  const sanitized=await a.page.evaluate(()=>window.busTrackrBeforeSend('event',{url:'https://example.com/path?utm_source='+ 'x'.repeat(500)+'&secret=private#hidden',referrer:'https://referrer.example/path?secret=private#hidden'}));
  assert.equal(new URL(sanitized.url).searchParams.get('utm_source').length,120);assert.equal(sanitized.referrer,'https://referrer.example/path');assert(!JSON.stringify(sanitized).includes('private'));assert(!JSON.stringify(sanitized).includes('hidden'));
  console.log('Dynamic map and exact event checks passed.');
  const coverage=await setup();await coverage.page.goto(origin+'/');
  const files=['website/index.html','website/support.html','website/privacy.html','src/main.tsx','src/MapApp.tsx','src/CameraPanel.tsx','src/WebNotifications.tsx'];
  const ids=new Set(['shuttle_1','shuttle_2','shuttle_3']);
  for(const file of files) for(const match of (await readFile(new URL(file,root),'utf8')).matchAll(/data-analytics="([^"]+)"/g)) ids.add(match[1]);
  await coverage.page.addScriptTag({content:await readFile(new URL('public/analytics.js',root),'utf8')});
  await coverage.page.evaluate(ids=>{for(const id of ids){const e=document.createElement(id==='trip_seek'?'input':'button');if(id==='trip_seek')e.type='range';e.dataset.analytics=id;document.body.append(e);e.dispatchEvent(new Event(id==='trip_seek'?'change':'click',{bubbles:true}));e.remove();}},[...ids]);
  await waitForCollection(()=>coverage.events.filter(e=>e.payload.name?.startsWith('ui_')).length>=ids.size);
  assert.deepEqual(coverage.events.filter(e=>e.payload.name?.startsWith('ui_')).map(e=>e.payload.data.control).sort(),[...ids].sort(),'Every source control is accepted exactly once, including duplicated bootstrap');
  assert.equal(coverage.recorders.length,1,'Duplicate bootstrap does not load a second recorder');
  const campaign=await setup();await campaign.page.goto(origin+'/?utm_source=instagram&utm_campaign=simple-bryan-story');await waitForCollection(()=>campaign.recorders.length>=1);
  assert.equal(campaign.recorders.length,1,'Clean campaign URLs enable recording');
  for (const suffix of ['?private=secret','#private','?utm_source='+ 'x'.repeat(121)]) {
    const unsafe=await setup();await unsafe.page.goto(origin+'/'+suffix);await waitForCollection(()=>pageviews(unsafe.events).length>=1);
    assert.equal(unsafe.recorders.length,0,'Recorder skips URLs that cannot be sent unchanged');
  }
  const noCrypto=await setup({cryptoFailure:true});await noCrypto.page.goto(origin+'/');await waitForCollection(()=>pageviews(noCrypto.events).length>=1);assert.deepEqual(noCrypto.errors,[]);assert.equal(pageviews(noCrypto.events).length,1);
  const b=await setup({collectionDelay:250});await b.page.goto(origin+'/');await waitForCollection(()=>pageviews(b.events).length>=1);
  assert.notEqual(pageviews(b.events)[0].payload.id,id,'Same UA different browser profile stays distinct');
  const c=await setup({storageBlocked:true});await c.page.goto(origin+'/');await waitForCollection(()=>pageviews(c.events).length>=1);
  assert.match(pageviews(c.events)[0].payload.id,/^[a-f0-9-]{36}$/);assert.deepEqual(c.errors,[]);
  const delayed=await setup({delayed:true});
  await delayed.page.goto(origin+'/',{waitUntil:'commit'});
  await delayed.page.waitForFunction(()=>!!window.BusTrackrAnalytics);
  await delayed.page.evaluate(()=>{for(let i=0;i<70;i++)document.querySelector('[data-analytics="nav_sightings"]').click();window.BusTrackrAnalytics.track('arbitrary_secret','sensitive');});
  delayed.release();await delayed.page.waitForLoadState('load');await waitForCollection(()=>clicks(delayed.events,'nav_sightings').length>=50);
  assert.equal(clicks(delayed.events,'nav_sightings').length,50,'FIFO is bounded to latest 50');
  assert(!JSON.stringify(delayed.events).includes('sensitive'));
  const blocked=await setup({blocked:true});await blocked.page.goto(origin+'/');
  await blocked.page.locator('[data-analytics="nav_support"]').click();assert.match(blocked.page.url(),/support.html$/);assert.deepEqual(blocked.errors,[]);assert.equal(blocked.recorders.length,0,'Failed tracker never starts recorder');
  for(const event of a.events.filter(e=>e.payload.name)) {
    assert(['ui_click','ui_change','app_view'].includes(event.payload.name));
    assert.deepEqual(Object.keys(event.payload.data).sort(),event.payload.name==='app_view'?['surface','value']:['control','surface']);
  }
  console.log('Registry, randomness, queue and fallback checks passed.');
  const delayedApp=await setup({delayed:true});await delayedApp.page.goto(origin+'/BusTrackr/',{waitUntil:'domcontentloaded'});
  await delayedApp.page.locator('.simple-screen').waitFor();await delayedApp.page.locator('[data-analytics="feed_refresh"]').click();assert.equal(delayedApp.events.length,0);delayedApp.release();await delayedApp.page.waitForLoadState('load');await waitForCollection(()=>clicks(delayedApp.events,'feed_refresh').length>=1&&delayedApp.events.some(e=>e.payload.name==='app_view'));assert.equal(clicks(delayedApp.events,'feed_refresh').length,1);assert.equal(delayedApp.events.filter(e=>e.payload.name==='app_view').length,1);
  const blockedApp=await setup({blocked:true});await blockedApp.page.goto(origin+'/BusTrackr/');await blockedApp.page.locator('.simple-screen').waitFor();await blockedApp.page.locator('[data-analytics="feed_refresh"]').click();assert.deepEqual(blockedApp.errors,[]);
  const delayedRecorder=await setup({recorderDelayed:true});await delayedRecorder.page.goto(origin+'/BusTrackr/',{waitUntil:'domcontentloaded'});
  await delayedRecorder.page.locator('.simple-screen').waitFor();await delayedRecorder.page.locator('[data-analytics="feed_refresh"]').click();
  await waitForCollection(()=>clicks(delayedRecorder.events,'feed_refresh').length>=1&&delayedRecorder.recorders.length>=1);
  assert.equal(await delayedRecorder.page.evaluate(()=>window.recorderLoaded),undefined,'App and tracking work before recorder loads');
  delayedRecorder.release();await delayedRecorder.page.waitForFunction(()=>window.recorderLoaded===true);assert.deepEqual(delayedRecorder.errors,[]);
  const blockedRecorder=await setup({recorderBlocked:true});await blockedRecorder.page.goto(origin+'/BusTrackr/');
  await blockedRecorder.page.locator('[data-analytics="feed_refresh"]').click();await waitForCollection(()=>clicks(blockedRecorder.events,'feed_refresh').length>=1);
  assert.deepEqual(blockedRecorder.errors,[],'Blocked recorder does not interrupt app or event tracking');
  const expired=await setup({delayed:true});await expired.page.clock.install();await expired.page.goto(origin+'/',{waitUntil:'commit'});await expired.page.waitForFunction(()=>!!window.BusTrackrAnalytics);
  await expired.page.locator('[data-analytics="nav_sightings"]').click();await expired.page.clock.fastForward(31_000);expired.release();await expired.page.waitForLoadState('load');await waitForCollection(()=>pageviews(expired.events).length>=1);await expired.page.waitForTimeout(50);
  assert.equal(clicks(expired.events,'nav_sightings').length,0,'Expired queue is discarded');
  await expired.page.locator('[data-analytics="nav_sightings"]').click();await waitForCollection(()=>clicks(expired.events,'nav_sightings').length>=1);assert.equal(clicks(expired.events,'nav_sightings').length,1,'Late tracker accepts future events');
  const marker=await setup();await marker.page.goto(origin+'/BusTrackr/?notification_open=1');await waitForCollection(()=>marker.events.some(e=>e.payload.name==='notification_open'));assert.equal(marker.events.filter(e=>e.payload.name==='notification_open').length,1);assert(!marker.page.url().includes('notification_open'));await marker.page.reload();await marker.page.waitForTimeout(50);assert.equal(marker.events.filter(e=>e.payload.name==='notification_open').length,1);
  await marker.page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'bustrackr_notification_open'},source:window})));await marker.page.waitForTimeout(50);assert.equal(marker.events.filter(e=>e.payload.name==='notification_open').length,1,'Window messages cannot impersonate worker opens');
  const opt=await setup({optedOut:true});await opt.page.goto(origin+'/');await opt.page.waitForTimeout(100);
  assert.equal(await opt.page.evaluate(()=>localStorage.getItem('bustrackr.analytics.browser.v1')),null);assert.equal(opt.events.length,0);assert.equal(opt.recorders.length,0,'Opt-out suppresses recorder');
  assert.equal(await opt.page.evaluate(()=>typeof window.BusTrackrAnalytics),'undefined');
  const notice=await setup({notifications:true});await notice.page.goto(origin+'/BusTrackr/');
  await notice.page.getByRole('button',{name:'Notify me',exact:true}).click();
  await notice.page.getByRole('button',{name:'Notifications on',exact:true}).waitFor();
  await notice.page.getByRole('button',{name:'Notifications on',exact:true}).click();
  await notice.page.getByRole('button',{name:'Notify me',exact:true}).waitFor();await waitForCollection(()=>notice.events.some(e=>e.payload.name==='notification_disabled'));
  assert.deepEqual(notice.subscriptions,['POST','DELETE']);
  assert.deepEqual(notice.events.filter(e=>e.payload.name?.startsWith('notification_')).map(e=>[e.payload.name,e.payload.data.value]),[['notification_permission','granted'],['notification_enabled',undefined],['notification_disabled',undefined]]);
  assert(!JSON.stringify(notice.events).includes('private-'));
  const failure=await setup({notifications:true,failSubscription:true});await failure.page.goto(origin+'/BusTrackr/');
  await failure.page.getByRole('button',{name:'Notify me',exact:true}).click();
  await failure.page.getByRole('button',{name:'Retry enabling',exact:true}).waitFor();await audit(failure.page);await waitForCollection(()=>failure.events.some(e=>e.payload.name==='notification_failure'));
  assert.equal(failure.events.filter(e=>e.payload.name==='notification_enabled').length,0);
  assert.equal(failure.events.find(e=>e.payload.name==='notification_failure').payload.data.value,'enable');
  const localhost=await browser.newPage();await localhost.goto(local+'/');
  assert.equal(await localhost.evaluate(()=>localStorage.getItem('bustrackr.analytics.browser.v1')),null);
  assert.equal(await localhost.evaluate(()=>typeof window.BusTrackrAnalytics),'undefined');
  assert.equal(await localhost.locator('script[src*="analytics.valleychristianai.com"]').count(),0,'Local development loads neither tracker nor recorder');
  const workerHandlers={};let signal,opened,focused=false;
  vm.runInNewContext(await readFile(new URL('public/notifications-sw.js',root),'utf8'),{URL,self:{addEventListener:(name,handler)=>workerHandlers[name]=handler,registration:{scope:origin+'/BusTrackr/'},clients:{matchAll:async()=>[{url:origin+'/BusTrackr/',postMessage:data=>signal=data,focus:async()=>{focused=true;}}],openWindow:async url=>{opened=url;}}}});
  let completed;workerHandlers.notificationclick({notification:{close(){}},waitUntil:promise=>{completed=promise;}});await completed;
  assert.equal(signal.type,'bustrackr_notification_open');assert(focused);assert.equal(opened,undefined);
  const closedMessageHandlers={};let focusedAfterMessageFailure=false;
  vm.runInNewContext(await readFile(new URL('public/notifications-sw.js',root),'utf8'),{URL,self:{addEventListener:(name,handler)=>closedMessageHandlers[name]=handler,registration:{scope:origin+'/BusTrackr/'},clients:{matchAll:async()=>[{url:origin+'/BusTrackr/',postMessage(){throw new Error('Client document was replaced');},focus:async()=>{focusedAfterMessageFailure=true;}}]}}});
  closedMessageHandlers.notificationclick({notification:{close(){}},waitUntil:promise=>{completed=promise;}});await completed;
  assert(focusedAfterMessageFailure,'Analytics message failure cannot prevent opening the app');
  const freshHandlers={};let shown;
  vm.runInNewContext(await readFile(new URL('public/notifications-sw.js',root),'utf8'),{URL,self:{addEventListener:(name,handler)=>freshHandlers[name]=handler,registration:{scope:origin+'/BusTrackr/',showNotification:async(title,options)=>{shown={title,options};}},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url;}}}});
  freshHandlers.notificationclick({notification:{close(){}},waitUntil:promise=>{completed=promise;}});await completed;assert.equal(opened,origin+'/BusTrackr/?notification_open=1');
  freshHandlers.push({data:{json:()=>({title:'Bus sighting',body:'New sighting',eventId:'event-1'})},waitUntil:promise=>{completed=promise;}});await completed;assert.equal(shown.title,'Bus sighting');assert.equal(shown.options.body,'New sighting');assert.equal(shown.options.tag,'event-1');assert.equal(shown.options.data.url,origin+'/BusTrackr/');
  console.log('Sitewide analytics passed. Native tracker identity, control coverage, dynamic map, single events, URL privacy, queue, blocked storage/tracker, localhost and notification focus verified.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
