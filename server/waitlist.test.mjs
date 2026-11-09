import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWaitlist, waitlistRoutes} from './waitlist.mjs';

function fakeResend(existing = new Set()) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    calls.push({method: options.method, path, body, headers: options.headers});
    if (options.method === 'GET') return new Response('{}', {status: existing.has(decodeURIComponent(path.split('/')[2])) ? 200 : 404});
    if (path === '/contacts') existing.add(body.email);
    return new Response('{}', {status: 201});
  };
  return {calls, fetchImpl};
}

async function serve(t, waitlist, options) {
  const routes = waitlistRoutes(waitlist, options);
  const server = createServer(async (req, res) => {if (!await routes(req, res)) {res.writeHead(404); res.end();}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/waitlist`, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body),
  });
}

test('a new signup joins the segment and gets exactly one confirmation', async t => {
  const resend = fakeResend();
  const join = await serve(t, createWaitlist({apiKey: 'key', segmentId: 'segment', from: 'BusTrackr <pilot@example.com>', fetchImpl: resend.fetchImpl}));
  assert.equal((await join({email: '  Parent@Example.com '})).status, 200);
  assert.deepEqual(resend.calls.find(call => call.path === '/contacts').body, {email: 'parent@example.com', segments: [{id: 'segment'}]});
  const email = resend.calls.find(call => call.path === '/emails');
  assert.deepEqual(email.body.to, ['parent@example.com']);
  assert.equal(email.headers['Idempotency-Key'], 'waitlist/parent@example.com');
  assert.equal((await join({email: 'parent@example.com'})).status, 200);
  assert.equal(resend.calls.filter(call => call.path === '/emails').length, 1);
  assert.equal(resend.calls.at(-1).path, '/contacts/parent%40example.com/segments/segment');
});

test('the waitlist rejects bad input, bots, foreign origins and floods', async t => {
  const resend = fakeResend();
  const join = await serve(t, createWaitlist({apiKey: 'key', segmentId: 'segment', from: 'pilot@example.com', fetchImpl: resend.fetchImpl}), {allowedOrigins: ['https://bustrackr.example']});
  assert.equal((await join({email: 'not an email'})).status, 400);
  assert.equal((await join({email: 'bot@example.com', website: 'https://spam.example'})).status, 200);
  assert.equal((await join({email: 'a@example.com'}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal(resend.calls.length, 0);
  assert.equal((await join({email: 'b@example.com'}, {Origin: 'https://bustrackr.example'})).status, 200);
  assert.equal((await join({email: 'c@example.com'})).status, 200);
  assert.equal((await join({email: 'd@example.com'})).status, 200);
  assert.equal((await join({email: 'e@example.com'})).status, 429);
});

test('an unconfigured or failing waitlist says so instead of pretending', async t => {
  assert.equal((await (await serve(t, null))({email: 'a@example.com'})).status, 503);
  const down = createWaitlist({apiKey: 'key', segmentId: 'segment', from: 'pilot@example.com', fetchImpl: async () => new Response('{}', {status: 500})});
  assert.equal((await (await serve(t, down))({email: 'a@example.com'})).status, 503);
});
