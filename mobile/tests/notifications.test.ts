import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationClient, type Registration} from '../src/notifications/client';

const endpoint = 'https://feed.example/api/shuttle';
function harness() {
  let stored: Registration | null = null;
  const calls: {url: string; method: string; body?: object}[] = [];
  let allowed = true, failingMethod = '', requests = 0;
  const client = createNotificationClient({
    read: async () => stored,
    write: async value => {stored = value;},
    fetch: (async (url, options) => {
      const method = options?.method || 'GET';
      calls.push({url: String(url), method, body: options?.body ? JSON.parse(String(options.body)) : undefined});
      return new Response(JSON.stringify({expo: true, webPushPublicKey: null}), {status: failingMethod === method ? 503 : 200});
    }) as typeof fetch,
    device: {
      unavailable: async () => null,
      permission: async request => {if (request) requests++; return allowed;},
      token: async () => 'ExponentPushToken[device]',
      uuid: () => String(calls.length),
    },
  });
  return {client, calls, stored: () => stored, requests: () => requests, allow: (value: boolean) => {allowed = value;}, fail: (method: string) => {failingMethod = method;}};
}
test('opening notification controls never requests permission or registers an unapproved device', async () => {
  const h = harness();
  assert.equal((await h.client.inspect(endpoint, false)).kind, 'disabled');
  assert.equal(h.requests(), 0);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal((await h.client.inspect(null, true)).kind, 'unavailable');
});
test('opt-in persists management credentials and confirms registration before enabled', async () => {
  const h = harness();
  assert.equal((await h.client.enable(endpoint)).kind, 'enabled');
  assert.equal(h.requests(), 1);
  const record = h.stored();
  assert.ok(record?.desired);
  assert.deepEqual(h.calls.at(-1)?.body, {id: record.id, secret: record.secret, target: {kind: 'expo', token: 'ExponentPushToken[device]'}});
  assert.equal((await h.client.inspect(endpoint, false)).kind, 'enabled');
  assert.equal(h.requests(), 1);
  assert.equal(h.stored()?.id, record.id);
});
test('failed registration cannot claim enabled and retry uses the same identity', async () => {
  const h = harness();
  h.fail('POST');
  assert.equal((await h.client.enable(endpoint)).kind, 'error');
  const id = h.stored()?.id;
  assert.ok(id);
  h.fail('');
  assert.equal((await h.client.inspect(endpoint, false)).kind, 'enabled');
  assert.equal(h.stored()?.id, id);
});
test('changing feed or selecting sample removes the old server subscription', async () => {
  const h = harness();
  await h.client.enable(endpoint);
  assert.equal((await h.client.inspect('https://other.example/api/shuttle', false)).kind, 'disabled');
  assert.equal(h.calls.find(call => call.method === 'DELETE')?.url, 'https://feed.example/api/notifications/subscriptions');
  assert.equal(h.stored()?.desired, false);
  await h.client.enable(endpoint);
  assert.equal((await h.client.inspect(null, true)).kind, 'unavailable');
  assert.equal(h.stored()?.desired, false);
});
test('permission revocation removes subscription and disable failure remains retryable', async () => {
  const h = harness();
  await h.client.enable(endpoint);
  h.allow(false);
  assert.equal((await h.client.inspect(endpoint, false)).kind, 'blocked');
  assert.equal(h.stored()?.desired, false);
  h.allow(true);
  await h.client.enable(endpoint);
  h.fail('DELETE');
  assert.equal((await h.client.disable()).kind, 'error');
  assert.equal(h.stored()?.desired, true);
  h.fail('');
  assert.equal((await h.client.disable()).kind, 'disabled');
  assert.equal(h.stored()?.desired, false);
});
test('a feed change cannot opt into a second server while old unsubscribe fails', async () => {
  const h = harness();
  await h.client.enable(endpoint);
  h.fail('DELETE');
  const before = h.calls.length;
  assert.equal((await h.client.enable('https://other.example/api/shuttle')).kind, 'error');
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.calls.at(-1)?.method, 'DELETE');
  assert.equal(h.requests(), 1);
  assert.equal(h.stored()?.endpoint, endpoint);
});

test('an availability error does not offer unsubscribe before any opt-in', async () => {
  const h = harness();
  h.fail('GET');
  const state = await h.client.inspect(endpoint, false);
  assert.equal(state.kind, 'error');
  assert.equal(state.canDisable, false);
});
