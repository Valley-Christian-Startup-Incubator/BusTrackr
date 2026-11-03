import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4174/BusTrackr/';
const now = Date.parse('2026-11-02T23:30:00Z');
const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 390, height: 844}});
const page = await context.newPage();
await page.clock.install({time: now});
await page.clock.pauseAt(now);
let minutes = 0;
let failed = false;
let missing = false;
const requests = [];
page.on('request', request => requests.push(request.url()));
await page.route('**/api/shuttle', async route => {
  if (failed) return route.fulfill({status: 503, body: '{}'});
  const stamp = new Date(now).toISOString();
  await route.fulfill({json: {
    status: 'connected', lastCheckedAt: stamp, eventCount: missing ? 0 : 2,
    latest: missing ? null : {checkpoint: 'BEI campus corner', eventAt: new Date(now - minutes * 60_000).toISOString(), receivedAt: stamp},
    prediction: {status: 'unconfigured', generatedAt: stamp, marker: null},
  }});
});
await page.route('**/api/notifications/config', route => route.fulfill({json: {webPushPublicKey: null, expo: false}}));
try {
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.getByTestId('observation-age').waitFor();
  assert.equal(await page.getByTestId('observation-age').textContent(), '<1');
  assert.equal(await page.getByTestId('observation-age').evaluate(node => getComputedStyle(node).color), 'rgb(22, 114, 72)');
  assert(!requests.some(value => /local-scene|world[-.]|three-/.test(value)), 'Simple mode must not request 3D code or assets');
  await mkdir('.audit/simple-mode', {recursive: true});
  await page.screenshot({path: '.audit/simple-mode/web-green.png', fullPage: true});
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.screenshot({path: `.audit/simple-mode/web-green-${width}.png`, fullPage: true});
  }
  await page.setViewportSize({width: 390, height: 844});
  for (const [age, color] of [[5, 'rgb(148, 98, 0)'], [10, 'rgb(179, 50, 43)']]) {
    minutes = age;
    await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
    await page.waitForFunction(value => document.querySelector('[data-testid="observation-age"]')?.textContent === String(value), age);
    assert.equal(await page.getByTestId('observation-age').evaluate(node => getComputedStyle(node).color), color);
  }
  for (const [elapsed, value, unit] of [[60, '1', 'hour'], [120, '2', 'hours'], [1440, '1', 'day'], [12000, '8', 'days']]) {
    minutes = elapsed;
    await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
    await page.waitForFunction(value => document.querySelector('[data-testid="observation-age"]')?.textContent === value, value);
    await page.getByText(`${unit} ago`, {exact: true}).waitFor();
  }
  await page.screenshot({path: '.audit/simple-mode/web-days.png', fullPage: true});
  minutes = 10;
  await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="observation-age"]')?.textContent === '10');
  await page.screenshot({path: '.audit/simple-mode/web-red.png', fullPage: true});
  failed = true;
  await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
  await page.getByText('Offline. A newer bus may have passed.').waitFor();
  assert.equal(await page.getByTestId('observation-age').textContent(), '10');
  assert.equal(await page.getByTestId('observation-age').evaluate(node => getComputedStyle(node).color), 'rgb(83, 100, 92)');
  failed = false;
  missing = true;
  await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
  await page.getByText('No bus detected yet').waitFor();
  missing = false;
  minutes = -1;
  await page.getByRole('button', {name: 'Refresh feed', exact: true}).click();
  await page.getByText('Camera clock is ahead').waitFor();
  assert.equal(await page.getByTestId('observation-age').count(), 0);
  await page.getByRole('button', {name: 'Map', exact: true}).click();
  await page.getByRole('button', {name: 'Simple', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('bustrackr.view.v1')), 'map');
  await page.getByRole('button', {name: 'Simple', exact: true}).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('bustrackr.view.v1')), 'simple');
  await page.reload({waitUntil: 'networkidle'});
  assert.equal(await page.locator('.world').count(), 0);
  assert.equal(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true, 'No horizontal overflow on phone');
  console.log('PASS simple web mode. Age colors, missing/future times, retained offline sighting, no initial 3D requests, toggle persistence and phone width.');
} finally {
  await browser.close();
}

const notificationBrowser = await chromium.launch();
const notificationContext = await notificationBrowser.newContext();
const notificationPage = await notificationContext.newPage();
const registrations = [];
let rejectRegistration = true;
await notificationPage.addInitScript(() => {
  window.__pushEvents = [];
  window.__unsubscribeFailures = 0;
  const makeSubscription = () => ({toJSON: () => ({endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription', keys: {p256dh: 'test-public', auth: 'test-auth'}}), unsubscribe: async () => {
    if (window.__unsubscribeFailures > 0) {window.__unsubscribeFailures--; throw new Error('Browser unsubscribe failed');}
    subscription = null;
    return true;
  }});
  let subscription = localStorage.getItem('bustrackr.web-notifications.v1') ? makeSubscription() : null;
  const worker = {pushManager: {
    getSubscription: async () => subscription,
    subscribe: async () => {
      subscription = makeSubscription();
      return subscription;
    },
  }};
  Object.defineProperty(navigator, 'serviceWorker', {value: {register: async () => {window.__pushEvents.push('register'); return worker;}, ready: Promise.resolve(worker)}});
  Object.defineProperty(window, 'PushManager', {value: function PushManager() {}});
  class TestNotification {
    static permission = 'default';
    static async requestPermission() {window.__pushEvents.push('permission'); TestNotification.permission = 'granted'; return 'granted';}
  }
  Object.defineProperty(window, 'Notification', {value: TestNotification});
});
await notificationPage.route('**/api/shuttle', route => route.fulfill({json: {
  status: 'connected', lastCheckedAt: new Date().toISOString(), latest: null, eventCount: 0,
  prediction: {status: 'unconfigured', generatedAt: new Date().toISOString(), marker: null},
}}));
await notificationPage.route('**/api/notifications/config', route => route.fulfill({json: {webPushPublicKey: Buffer.alloc(65, 1).toString('base64url'), expo: false}}));
await notificationPage.route('**/api/notifications/subscriptions', route => {
  registrations.push({method: route.request().method(), body: route.request().postDataJSON()});
  return route.fulfill({status: rejectRegistration ? 503 : 200, json: {ok: !rejectRegistration}});
});
try {
  await notificationPage.goto(url, {waitUntil: 'networkidle'});
  assert.equal(await notificationPage.evaluate(() => Notification.permission), 'default', 'Opening the page must not ask permission');
  await notificationPage.getByRole('button', {name: 'Notify me', exact: true}).click();
  await notificationPage.getByText('Could not save notification preferences. Please try again.').waitFor();
  assert.equal(await notificationPage.getByRole('button', {name: 'Notifications on', exact: true}).count(), 0, 'Failed backend registration must stay off');
  assert.equal(await notificationPage.getByRole('button', {name: 'Cancel notification setup', exact: true}).count(), 1, 'An uncertain opt-in can always be cancelled');
  rejectRegistration = false;
  await notificationPage.getByRole('button', {name: 'Retry enabling', exact: true}).click();
  await notificationPage.getByRole('button', {name: 'Notifications on', exact: true}).waitFor();
  assert.equal(registrations[0].body.id, registrations[1].body.id, 'Retries reuse the installation identity');
  assert.equal(registrations[0].body.secret, registrations[1].body.secret, 'Retries retain management capability');
  assert.equal(registrations[1].body.target.kind, 'web');
  const events = await notificationPage.evaluate(() => window.__pushEvents);
  assert.deepEqual(events.slice(-2), ['permission', 'register'], 'Permission is requested before asynchronous worker registration');
  await notificationPage.evaluate(() => {window.__unsubscribeFailures = 1;});
  await notificationPage.getByRole('button', {name: 'Notifications on', exact: true}).click();
  await notificationPage.getByRole('button', {name: 'Finish turning off', exact: true}).waitFor();
  assert.equal(await notificationPage.evaluate(() => JSON.parse(localStorage.getItem('bustrackr.web-notifications.v1')).enabled), false);
  const postsBeforeReload = registrations.filter(item => item.method === 'POST').length;
  await notificationPage.reload({waitUntil: 'networkidle'});
  await notificationPage.getByRole('button', {name: 'Finish turning off', exact: true}).waitFor();
  assert.equal(registrations.filter(item => item.method === 'POST').length, postsBeforeReload, 'Reload must not resurrect an opt-out after browser cleanup failed');
  await notificationPage.getByRole('button', {name: 'Finish turning off', exact: true}).click();
  await notificationPage.getByText('Notifications are off.').waitFor();
  assert.equal(registrations[2].method, 'DELETE');
  assert.equal(registrations[2].body.id, registrations[1].body.id);
  assert.equal(await notificationPage.evaluate(() => localStorage.getItem('bustrackr.web-notifications.v1')), null);
  await notificationPage.getByRole('button', {name: 'Notify me', exact: true}).click();
  await notificationPage.getByRole('button', {name: 'Notifications on', exact: true}).waitFor();
  const postsBeforeModeChange = registrations.filter(item => item.method === 'POST').length;
  await notificationPage.getByRole('button', {name: 'Map', exact: true}).click();
  await notificationPage.getByRole('button', {name: 'Simple', exact: true}).click();
  await notificationPage.getByRole('button', {name: 'Notifications on', exact: true}).waitFor();
  assert.equal(registrations.filter(item => item.method === 'POST').length, postsBeforeModeChange, 'View changes must not register the device again');
  console.log('PASS web notification controls. Gesture-bound permission, failed registration retry, stable identity, unsubscribe recovery, opt-out survives reload and one notification owner across views. Real push delivery still requires a configured provider.');
} finally {
  await notificationBrowser.close();
}
