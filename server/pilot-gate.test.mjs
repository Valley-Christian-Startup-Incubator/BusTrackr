import test from 'node:test';
import assert from 'node:assert/strict';
import {signedOut} from '../src/pilotGate.ts';

const answering = status => async () => new Response('{}', {status});

test('only a 401 from the session check sends a visitor to the waitlist', async () => {
  assert.equal(await signedOut('/api/session', answering(401)), true);
  for (const status of [200, 404, 500, 503]) assert.equal(await signedOut('/api/session', answering(status)), false, `status ${status} keeps the map`);
  assert.equal(await signedOut('/api/session', async () => {throw new TypeError('Failed to fetch');}), false, 'an unreachable worker keeps the map');
});

test('the check asks the given endpoint without caching', async () => {
  const calls = [];
  await signedOut('https://bustrackr.example/api/session', async (url, options) => {calls.push({url, cache: options.cache}); return new Response('{}', {status: 200});});
  assert.deepEqual(calls, [{url: 'https://bustrackr.example/api/session', cache: 'no-store'}]);
});
