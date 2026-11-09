import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseAlert} from './alerts.mjs';
import {collectorSource, openHistory} from './history.mjs';
import {dashboardSync, umamiSink} from './dashboard.mjs';

const config = {sender:'avigilonalerts@vcs.net', subject:'', marker:'BEI Bus has arrived.', checkpoint:'BEI campus corner'};
const fixture = await readFile(new URL('./fixtures/avigilon-alert.eml', import.meta.url), 'utf8');
const collector = {commit:'abc1234', source:'0123456789abcdef', parser:'camera-email-v1'};
const legacyEvent = {id:'legacy-1', checkpoint:'BEI campus corner', eventAt:'2026-11-06T22:31:20.000Z', timestampSource:'camera',
  receivedAt:'2026-11-06T22:31:21.949Z', reportedAt:'2026-11-06T22:31:23.013Z', source:'camera-email'};

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bustrackr-history-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  return dir;
}

test('imports the legacy JSON history once and leaves the file untouched', async t => {
  const dir = await scratch(t), legacyPath = join(dir, 'alerts.json');
  const legacy = JSON.stringify({cursor:null, latest:legacyEvent, events:[legacyEvent], resendReceipts:['r1', 'r2']});
  await writeFile(legacyPath, legacy);
  for (let open = 0; open < 2; open++) {
    const history = openHistory(join(dir, 'alerts.sqlite'), {legacyPath, collector});
    assert.deepEqual(history.state.events, [legacyEvent]);
    assert.deepEqual(history.state.latest, legacyEvent);
    assert.equal(history.hasReceipt('r2'), true);
    assert.equal(history.all()[0].collector, null);
    history.close();
  }
  assert.equal(await readFile(legacyPath, 'utf8'), legacy);
});

test('stamps new sightings with the collector and raw email identity, and survives restart', async t => {
  const dir = await scratch(t), path = join(dir, 'alerts.sqlite');
  const history = openHistory(path, {collector});
  const alert = await parseAlert(fixture, config, new Date('2026-10-16T21:07:00Z'));
  assert.equal(history.record(alert, 'receipt-1', 30), true);
  assert.equal(history.record({...alert, id:'repeat'}, 'receipt-2', 30), true);
  assert.equal(history.record(alert, 'receipt-3', 30), false);
  assert.equal(history.state.events[0].input, undefined, 'public events carry no email identity');
  history.close();

  const reopened = openHistory(path, {collector:{...collector, commit:'def5678'}});
  const [first, repeat] = reopened.all();
  assert.deepEqual(first.collector, collector);
  assert.equal(first.input.messageId, alert.input.messageId);
  assert.equal(first.input.bodySha256, alert.input.bodySha256);
  assert.equal(repeat.duplicateOf, first.id);
  assert.equal(reopened.state.latest.id, first.id);
  assert.equal(['receipt-1', 'receipt-2', 'receipt-3'].every(reopened.hasReceipt), true);
});

test('takes one snapshot per day and keeps the newest ones', async t => {
  const dir = await scratch(t), backups = join(dir, 'backups');
  let day = 1;
  const history = openHistory(join(dir, 'alerts.sqlite'), {now:() => new Date(Date.UTC(2026, 10, day))});
  history.record(legacyEvent, null, 30);
  for (; day <= 4; day++) {
    assert.ok(history.snapshot(backups, 2));
    assert.equal(history.snapshot(backups, 2), null);
  }
  assert.deepEqual(await readdir(backups), ['sightings-2026-11-03.sqlite', 'sightings-2026-11-04.sqlite']);
  assert.deepEqual(openHistory(join(backups, 'sightings-2026-11-04.sqlite')).state.events, [legacyEvent]);
});

test('mirrors each sighting to Umami at its camera time and retries until accepted', async () => {
  const history = openHistory(':memory:', {collector});
  history.record(legacyEvent, null, 30);
  const requests = [];
  let reply = new Response('{"beep":"boop"}');
  const sync = dashboardSync(history, umamiSink({url:'https://analytics.example', website:'site-id', fetchImpl:async (url, init) => {
    requests.push({url:String(url), init});
    return reply;
  }}));
  await assert.rejects(sync());
  assert.equal(history.unsent().length, 1, 'a bot-filtered event stays queued');
  reply = new Response('{}');
  await sync();
  assert.equal(history.unsent().length, 0);
  const {url, init} = requests.at(-1), body = JSON.parse(init.body);
  assert.equal(url, 'https://analytics.example/api/send');
  assert.doesNotMatch(init.headers['User-Agent'], /bot|node|undici/i);
  assert.equal(body.payload.timestamp, Date.parse(legacyEvent.eventAt) / 1000);
  assert.deepEqual(body.payload.data, {checkpoint:'BEI campus corner', duplicate:false, delaySeconds:2, ...collector});
});

test('collector source changes when worker code changes', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'alerts.mjs'), 'a');
  await writeFile(join(dir, 'alerts.test.mjs'), 'ignored');
  const before = collectorSource(dir);
  await writeFile(join(dir, 'alerts.test.mjs'), 'still ignored');
  assert.equal(collectorSource(dir), before);
  await writeFile(join(dir, 'alerts.mjs'), 'b');
  assert.notEqual(collectorSource(dir), before);
});
