import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWaitlist, waitlistRoutes} from './waitlist.mjs';

function fakeResend(contacts = new Map()) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    calls.push({method: options.method, path, body, headers: options.headers});
    const [, , email, segments, segmentId] = path.split('/').map(decodeURIComponent);
    if (options.method === 'GET' && segments) return Response.json({data: [...contacts.get(email)].map(id => ({id}))});
    if (options.method === 'GET') return new Response('{}', {status: contacts.has(email) ? 200 : 404});
    if (path === '/contacts') contacts.set(body.email, new Set(body.segments.map(segment => segment.id)));
    if (segmentId) contacts.get(email).add(segmentId);
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
  assert.match(email.body.text, /^Thanks for signing up\.\n\n[^]*BEI at Valley Christian Schools$/);
  assert.match(email.body.html, /<p [^>]*>Thanks for signing up\.<\/p>/);
  const again = await join({email: 'parent@example.com'});
  assert.deepEqual(await again.json(), {joined: true, alreadyJoined: true});
  assert.equal(resend.calls.filter(call => call.path === '/emails').length, 1);
});

test('a contact from another mailing joins the waitlist and gets one confirmation', async t => {
  const resend = fakeResend(new Map([['parent@example.com', new Set(['internships'])]]));
  const join = await serve(t, createWaitlist({apiKey: 'key', segmentId: 'segment', from: 'pilot@example.com', fetchImpl: resend.fetchImpl}));
  assert.deepEqual(await (await join({email: 'parent@example.com'})).json(), {joined: true, alreadyJoined: false});
  assert.ok(resend.calls.some(call => call.method === 'POST' && call.path === '/contacts/parent%40example.com/segments/segment'));
  assert.deepEqual(await (await join({email: 'parent@example.com'})).json(), {joined: true, alreadyJoined: true});
  assert.equal(resend.calls.filter(call => call.path === '/emails').length, 1);
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
