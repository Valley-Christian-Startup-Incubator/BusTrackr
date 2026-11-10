import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {parseAlert, recordAlert} from './alerts.mjs';
const config = {sender:'avigilonalerts@vcs.net', subject:'', marker:'BEI Bus has arrived.', checkpoint:'BEI campus corner'};
const fixture = await readFile(new URL('./fixtures/avigilon-alert.eml', import.meta.url), 'utf8');
test('matches sender, subject and zone; preserves timestamps without retaining email content', async()=>{
  const received = new Date('2026-10-16T21:07:00Z');
  const alert = await parseAlert(fixture, config, received);
  assert.equal(alert.checkpoint, 'BEI campus corner');
  assert.equal(alert.eventAt, '2026-10-16T21:06:43.000Z');
  assert.equal(alert.reportedAt, '2026-10-16T21:07:00.000Z');
  assert.equal(alert.receivedAt, received.toISOString());
  assert.equal(alert.subject, undefined);
  for (const [before, after] of [['Avigilonalerts@vcs.net','stranger@example.invalid'], ['BEI Bus has arrived.','Motion detected.'], ['(PDT)','(PST)']]) {
    assert.equal(await parseAlert(fixture.replace(before, after), config), null);
  }
  assert.equal(await parseAlert('x'.repeat(2_000_001), config), null);
});
test('deduplicates retries and prevents older deliveries replacing latest', async()=>{
  const state = {events:[], latest:null};
  {
    const alert = await parseAlert(fixture, config);
    assert.equal(recordAlert(state, alert), true);
    assert.equal(recordAlert(state, {...alert, receivedAt:new Date(Date.now()+1000).toISOString()}), false);
    assert.equal(recordAlert(state, {...alert, id:'older', eventAt:'2020-01-01T00:00:00Z', receivedAt:'2020-01-01T00:00:00Z'}), true);
    assert.equal(state.latest.id, alert.id);
    assert.equal(recordAlert(state, {...alert,id:'repeat-notification'}), true);
    assert.equal(state.events.at(-1).duplicateOf,alert.id);
    assert.equal(state.events.length,3);
  }
});
test('records the raw email identity without keeping its content', async()=>{
  const alert = await parseAlert(fixture, config, new Date('2026-10-16T21:07:00Z'));
  assert.match(alert.input.messageId, /@/);
  assert.match(alert.input.bodySha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(alert).includes('BEI Bus has arrived'), false);
});
test('sample email reaches actual HTTP API and persists across restart', async()=>{
  const dir = await mkdtemp(join(tmpdir(), 'bustrackr-api-'));
  const socket = createServer();
  await new Promise(resolve=>socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  let child;
  async function start() {
    child = spawn(process.execPath, ['server/index.mjs','--sample'], {env:{...process.env, ALERT_PORT:String(port), ALERT_STATE_FILE:join(dir,'state.json')}, stdio:'pipe'});
    for (let attempt=0; attempt<100; attempt++) {
      if (child.exitCode !== null) throw new Error('Sample worker exited');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/detections/latest`);
        const result = await response.json();
        if (result.latest && result.lastCheckedAt) return result;
      } catch {}
      await delay(50);
    }
    throw new Error('API did not become ready');
  }
  async function stop() { if (child && child.exitCode === null) { const done = new Promise(resolve=>child.once('exit', resolve)); child.kill('SIGTERM'); await done; } }
  try {
    const first = await start();
    assert.equal(first.status, 'sample'); assert.equal(first.eventCount,4); assert.equal(first.prediction.status,'estimated'); assert.equal(first.prediction.model,'learned-runs-v1'); assert.ok(first.prediction.marker.progress>0);
    const tracking=await (await fetch(`http://127.0.0.1:${port}/api/shuttle`)).json(); assert.equal(tracking.prediction.anchor,'camera');
    assert.equal(first.status, 'sample'); assert.equal(first.latest.checkpoint, 'BEI campus corner');
    assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
    await stop();
    const second = await start();
    assert.deepEqual(second.latest, first.latest);
  } finally { await stop(); await rm(dir, {recursive:true, force:true}); }
});
