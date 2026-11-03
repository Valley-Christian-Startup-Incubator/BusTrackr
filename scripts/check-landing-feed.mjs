import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const origin = 'http://bustrackr.test';
const start = new Date();
let requests = 0, completed = 0, available = false;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfinished', request => {if (new URL(request.url()).pathname === '/api/shuttle') completed++;});
await page.clock.install({time:start});
await page.addInitScript(() => {
  window.feedTestHidden = false;
  Object.defineProperty(document, 'hidden', {get:() => window.feedTestHidden});
});
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/api/shuttle') {
    requests++;
    return route.fulfill(available ? {json:{status:'connected',eventCount:1,lastCheckedAt:start.toISOString(),latest:{checkpoint:'TEST CHECKPOINT',eventAt:start.toISOString()},prediction:{status:'estimated'}}} : {status:503,body:'unavailable'});
  }
  try {
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(new URL('../website/'+path, import.meta.url));
    const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    return route.fulfill({body,contentType});
  } catch {return route.fulfill({status:404,body:''});}
});
const observe = () => new Promise(resolve => setTimeout(resolve,200));
async function waitForState(count, pattern) {
  const deadline = Date.now()+10_000;
  while (requests < count || completed < count || !pattern.test(await page.locator('#feed-state').innerText())) {
    assert(Date.now() < deadline, `Expected ${count} completed feed requests and ${pattern}`);
    await new Promise(resolve => setTimeout(resolve,10));
  }
  await observe();
  assert.equal(requests,count,'Feed requests do not duplicate after the expected state');
  assert.match(await page.locator('#feed-state').innerText(),pattern);
}
try {
  await page.goto(origin+'/');await waitForState(1,/^Checking…$/);
  assert.equal(requests,1);
  assert.equal(await page.locator('#feed-state').innerText(),'Checking…','One transient failure preserves the checking state');
  available = true;await page.clock.runFor(2000);await waitForState(2,/^Connected/);
  assert.equal(requests,2,'Failed first request retries after two seconds');
  assert.match(await page.locator('#feed-state').innerText(),/^Connected/);
  assert.match(await page.locator('#sighting-place').innerText(),/TEST CHECKPOINT/);
  available = false;await page.clock.runFor(30000);await waitForState(3,/Last reached .*Retrying/);
  assert.equal(requests,3,'Successful request schedules the next refresh');
  assert.match(await page.locator('#feed-state').innerText(),/Last reached .*Retrying/);
  assert.match(await page.locator('#sighting-place').innerText(),/TEST CHECKPOINT/,'Transient failures retain the last camera sighting');
  await page.evaluate(() => {window.feedTestHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.runFor(60000);await observe();
  assert.equal(requests,3,'Hidden page pauses scheduled polling');
  available = true;
  await page.evaluate(() => {window.feedTestHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await waitForState(4,/^Connected/);
  assert.equal(requests,4,'Returning to the page refreshes immediately');
  assert.match(await page.locator('#feed-state').innerText(),/^Connected/);
  assert.deepEqual(errors,[]);
  console.log('Landing feed passed. Retry recovery, visible refresh, retained sighting and hidden-page pause verified.');
} finally {await browser.close();}
