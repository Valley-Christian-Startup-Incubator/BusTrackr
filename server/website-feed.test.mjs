import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../website/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const flush = () => new Promise(resolve => setImmediate(resolve));
const payload = () => ({status: 'connected', eventCount: 1, lastCheckedAt: new Date().toISOString(), latest: {checkpoint: 'Campus corner', eventAt: new Date().toISOString()}, prediction: {status: 'unconfigured'}});
function harness(respond) {
  const nodes = new Map();
  const timers = new Map();
  const events = new Map();
  let timerId = 0;
  const document = {hidden: false, visibilityState: 'visible', getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', hidden: true, disabled: false, addEventListener() {}});
    return nodes.get(id);
  }, addEventListener(name, callback) {events.set(name, callback);}};
  const context = {document, navigator: {onLine: true}, fetch: respond, AbortController, Date, console,
    setTimeout(callback, delay) {timers.set(++timerId, {callback, delay}); return timerId;},
    clearTimeout(id) {timers.delete(id);},
    addEventListener(name, callback) {events.set(name, callback);}};
  context.window = context;
  vm.runInNewContext(script, context);
  return {nodes, events, document, timers, navigator: context.navigator, async next() {
    await flush();
    const next = [...timers].sort((a,b) => a[1].delay - b[1].delay)[0];
    assert.ok(next, 'Feed must schedule another request after a temporary failure');
    timers.delete(next[0]); next[1].callback(); await flush();
  }};
}

test('homepage recovers from a temporary feed failure without a reload', async () => {
  let requests = 0;
  const page = harness(async () => ++requests === 1 ? {ok: false} : {ok: true, json: async () => payload()});
  await flush();
  assert.equal(page.nodes.get('feed-state').textContent, 'Checking…');
  await page.next();
  assert.equal(requests, 2);
  assert.match(page.nodes.get('feed-state').textContent, /^Connected/);
  assert.notEqual(page.nodes.get('sighting-time').textContent, 'Unavailable');
});

test('later failures keep the last real sighting and turn off estimates', async () => {
  let fail = false;
  const page = harness(async () => {
    if (fail) throw new Error('Network interrupted');
    return {ok: true, json: async () => payload()};
  });
  await flush();
  const time = page.nodes.get('sighting-time').textContent;
  fail = true;
  await page.next();
  assert.equal(page.nodes.get('sighting-time').textContent, time);
  assert.match(page.nodes.get('sighting-place').textContent, /Campus corner/);
  assert.equal(page.nodes.get('feed-estimate').textContent, 'Off: feed unavailable');
  assert.match(page.nodes.get('feed-state').textContent, /Retrying/);
  fail = false;
  await page.next();
  assert.match(page.nodes.get('feed-state').textContent, /^Connected/);
});

test('reconnect refreshes immediately and hidden pages stop polling', async () => {
  let requests = 0;
  const page = harness(async () => {requests++; return {ok: true, json: async () => payload()};});
  await flush();
  page.events.get('online')();
  await flush();
  assert.equal(requests, 2);
  page.document.hidden = true;
  page.events.get('visibilitychange')();
  await flush();
  assert.equal(page.timers.size, 0);
  page.events.get('online')();
  await flush();
  assert.equal(requests, 2);
  page.document.hidden = false;
  page.events.get('visibilitychange')();
  await flush();
  assert.equal(requests, 3);
});

test('offline pages wait for reconnection and iOS history restores refresh', async () => {
  let requests = 0;
  const page = harness(async () => {requests++; return {ok: true, json: async () => payload()};});
  await flush();
  page.navigator.onLine = false;
  await page.next();
  assert.equal(requests, 1);
  assert.match(page.nodes.get('feed-state').textContent, /offline/);
  assert.equal(page.timers.size, 0);
  page.navigator.onLine = true;
  page.events.get('online')();
  await flush();
  assert.equal(requests, 2);
  page.events.get('pageshow')({persisted: true});
  await flush();
  assert.equal(requests, 3);
});

test('sustained failure reports automatic retries and later recovers', async () => {
  let healthy = false;
  const page = harness(async () => healthy ? {ok: true, json: async () => payload()} : {ok: false});
  await flush();
  await page.next();
  assert.match(page.nodes.get('feed-state').textContent, /Not responding. Retrying/);
  assert.equal(page.nodes.get('feed-estimate').textContent, 'Off: feed unavailable');
  healthy = true;
  await page.next();
  assert.match(page.nodes.get('feed-state').textContent, /^Connected/);
});

test('a timed-out request releases the next retry', async () => {
  let requests = 0;
  const page = harness(async (_url, {signal}) => {
    if (++requests === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Timed out'))));
    return {ok: true, json: async () => payload()};
  });
  await page.next();
  await page.next();
  assert.equal(requests, 2);
  assert.match(page.nodes.get('feed-state').textContent, /^Connected/);
});
