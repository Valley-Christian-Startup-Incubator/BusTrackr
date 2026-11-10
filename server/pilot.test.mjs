import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAccounts} from './accounts.mjs';
import {pilot} from './pilot.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bustrackr-pilot-'));
  const clock = {now: Date.parse('2026-11-09T15:00:00Z')};
  const accounts = openAccounts(join(dir, 'accounts.sqlite'), {now: () => new Date(clock.now)});
  t.after(async () => {accounts.close(); await rm(dir, {recursive: true, force: true});});
  const sent = [], lines = [];
  const mailer = async (to, email) => {sent.push({to, ...email});};
  const run = (...args) => pilot(args, {accounts, mailer, siteUrl: new URL('https://bustrackr.example'), log: line => lines.push(line)});
  return {accounts, clock, sent, lines, run};
}
const loginIn = email => new URL(email.text.match(/https:\/\/\S+verify\S+/)[0]).searchParams.get('token');

test('approving someone sends one invite whose button signs them in', async t => {
  const app = await setup(t);
  await app.run('approve', 'New.Rider@Example.com');
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].to, 'new.rider@example.com');
  assert.equal(app.sent[0].subject, "You're in the BusTrackr pilot");
  assert.match(app.sent[0].html, /<a href="https:\/\/bustrackr\.example\/api\/session\/verify\?token=[\w-]{43}"/);
  assert.match(app.sent[0].text, /sign in at https:\/\/bustrackr\.example\/signin/);

  await app.run('approve', 'new.rider@example.com');
  assert.equal(app.sent.length, 1, 're-approving without --resend sends nothing');
  assert.match(app.lines.at(-1), /already in the pilot/);

  app.clock.now += 7 * 86_400_000 - 1;
  const session = app.accounts.signIn(loginIn(app.sent[0]));
  assert.equal(app.accounts.sessionEmail(session), 'new.rider@example.com', 'the invite link works for 7 days');
});

test('--resend sends a fresh invite, and a failed send is retried by the next approve', async t => {
  const app = await setup(t);
  await app.run('approve', 'rider@example.com');
  await app.run('approve', 'rider@example.com', '--resend');
  assert.equal(app.sent.length, 2);
  assert.notEqual(loginIn(app.sent[0]), loginIn(app.sent[1]));

  const failing = pilot(['approve', 'late@example.com'], {accounts: app.accounts, mailer: async () => {throw new Error('Resend request failed');}, siteUrl: new URL('https://bustrackr.example'), log: () => {}});
  await assert.rejects(failing, /Resend request failed/);
  await app.run('approve', 'late@example.com');
  assert.deepEqual(app.sent.map(email => email.to), ['rider@example.com', 'rider@example.com', 'late@example.com']);
});

test('removing a member signs them out and voids their unused links', async t => {
  const app = await setup(t);
  await app.run('approve', 'rider@example.com', '--resend');
  await app.run('approve', 'rider@example.com', '--resend');
  const session = app.accounts.signIn(loginIn(app.sent[0]));
  await app.run('list');
  assert.match(app.lines.at(-1), /^rider@example\.com  approved 2026-11-09T15:00:00\.000Z  invited 2026-11-09T15:00:00\.000Z  1 active session\(s\)$/);

  await app.run('remove', 'rider@example.com');
  assert.equal(app.accounts.sessionEmail(session), null);
  await app.run('approve', 'rider@example.com');
  assert.equal(app.accounts.signIn(loginIn(app.sent[1])), null, 'an invite sent before removal stays dead after re-approval');
  await app.run('remove', 'nobody@example.com');
  assert.equal(app.lines.at(-1), 'nobody@example.com is not in the pilot.');
  await assert.rejects(app.run('approve', 'not an email'), /Usage/);
});
