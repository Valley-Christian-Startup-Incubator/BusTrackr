import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAccounts, sessionRoutes} from './accounts.mjs';
import {createMailer} from './email.mjs';

const site = 'https://bustrackr.example';
function fakeResend(status = 200) {
  const sent = [];
  const fetchImpl = async (url, options) => {sent.push({url, body: JSON.parse(options.body)}); return new Response('{}', {status});};
  return {sent, mailer: createMailer({apiKey: 'key', from: 'BusTrackr <pilot@example.com>', fetchImpl})};
}

async function pilot(t, {members = ['rider@example.com'], resendStatus, sample = false, mailer: withMailer = true} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bustrackr-accounts-'));
  const clock = {now: Date.parse('2026-11-09T15:00:00Z')};
  const path = join(dir, 'accounts.sqlite');
  const accounts = openAccounts(path, {now: () => new Date(clock.now)});
  for (const email of members) accounts.approve(email);
  const resend = fakeResend(resendStatus);
  const routes = sessionRoutes({accounts: sample ? null : accounts, mailer: withMailer ? resend.mailer : null, siteUrl: new URL(site), sample, allowedOrigins: [site]});
  const server = createServer(async (req, res) => {if (!await routes(req, res)) {res.writeHead(404); res.end();}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); accounts.close(); await rm(dir, {recursive: true, force: true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, {cookie, ...options} = {}) => fetch(base + path, {redirect: 'manual', ...options, headers: {...options.headers, ...(cookie ? {Cookie: cookie} : {})}});
  return {
    clock, path, sent: resend.sent, call,
    link: (email, headers = {}) => call('/api/session/link', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify({email})}),
    verify: url => call(new URL(url).pathname + new URL(url).search),
    session: cookie => call('/api/session', {cookie}),
  };
}
const linkIn = email => email.text.match(/https:\/\/\S+/)[0];

test('a pilot member signs in from the emailed link, stays signed in, and signs out', async t => {
  const app = await pilot(t);
  const response = await app.link('  Rider@Example.com ', {Origin: site});
  assert.equal(response.status, 200);
  assert.equal(app.sent.length, 1);
  const [email] = app.sent;
  assert.deepEqual(email.body.to, ['rider@example.com']);
  assert.equal(email.body.from, 'BusTrackr <pilot@example.com>');
  const url = linkIn(email.body);
  assert.match(url, /^https:\/\/bustrackr\.example\/api\/session\/verify\?token=[\w-]{43}$/);
  assert(email.body.html.includes(url.replace('&', '&#38;')), 'the HTML part carries the same link');

  const verified = await app.verify(url);
  assert.equal(verified.status, 303);
  assert.equal(verified.headers.get('location'), '/app');
  const cookie = verified.headers.get('set-cookie');
  assert.match(cookie, /^bt_session=[\w-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=7776000$/);
  const session = cookie.split(';')[0];
  assert.deepEqual(await (await app.session(session)).json(), {email: 'rider@example.com'});
  assert.equal((await app.session()).status, 401);
  assert.equal((await app.session('bt_session=' + 'x'.repeat(43))).status, 401);

  const logout = await app.call('/api/session/logout', {method: 'POST', cookie: session, headers: {Origin: site}});
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /^bt_session=; .*Max-Age=0$/);
  assert.equal((await app.session(session)).status, 401, 'the old cookie no longer works after logout');

  const stored = await readFile(app.path);
  assert(!stored.includes(new URL(url).searchParams.get('token')) && !stored.includes(session.split('=')[1]), 'only token hashes are stored');
});

test('a sign-in link works once, even when clicked twice at the same time', async t => {
  const app = await pilot(t);
  await app.link('rider@example.com');
  const url = linkIn(app.sent[0].body);
  const clicks = await Promise.all([app.verify(url), app.verify(url)]);
  assert.deepEqual(clicks.map(click => click.headers.get('location')).sort(), ['/app', '/signin?error=expired']);
  assert.equal(clicks.filter(click => click.headers.get('set-cookie')).length, 1);
  assert.equal((await app.verify(url)).headers.get('location'), '/signin?error=expired');
});

test('links expire after 15 minutes and sessions after 90 days', async t => {
  const app = await pilot(t);
  await app.link('rider@example.com');
  app.clock.now += 15 * 60_000;
  const late = await app.verify(linkIn(app.sent[0].body));
  assert.equal(late.headers.get('location'), '/signin?error=expired');
  assert.equal(late.headers.get('set-cookie'), null);

  await app.link('rider@example.com');
  app.clock.now += 14 * 60_000;
  const session = (await app.verify(linkIn(app.sent[1].body))).headers.get('set-cookie').split(';')[0];
  app.clock.now += 90 * 86_400_000 - 1;
  assert.equal((await app.session(session)).status, 200);
  app.clock.now += 1;
  assert.equal((await app.session(session)).status, 401);
});

test('people outside the pilot are pointed to the waitlist and get no email', async t => {
  const app = await pilot(t);
  const response = await app.link('stranger@example.com');
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Join the waitlist/);
  assert.equal((await app.link('not an email')).status, 400);
  assert.equal((await app.link('rider@example.com', {Origin: 'https://evil.example'})).status, 403);
  assert.equal(app.sent.length, 0);
  for (let n = 0; n < 3; n++) assert.equal((await app.link('rider@example.com')).status, 200);
  assert.equal((await app.link('rider@example.com')).status, 429, 'five requests per network per ten minutes');
  assert.equal((await app.call('/api/session/link')).status, 404);
});

test('sign-in reports when it cannot work instead of pretending', async t => {
  assert.equal((await (await pilot(t, {mailer: false})).link('rider@example.com')).status, 503);
  assert.equal((await (await pilot(t, {resendStatus: 500})).link('rider@example.com')).status, 503);
  const sample = await pilot(t, {sample: true});
  const response = await sample.session();
  assert.equal(response.status, 200, 'sample mode treats everyone as signed in');
  assert.deepEqual(await response.json(), {email: null, sample: true});
});
