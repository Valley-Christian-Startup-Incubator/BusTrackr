import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {feedSchema, type RequestState} from '../src/shuttle/feed';
import {startFeedSession} from '../src/shuttle/poll';
import {sampleState} from '../src/shuttle/samples';

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for state');
    await delay(10);
  }
}
test('real HTTP polling retains observation on failure and cancellation prevents late commits', async t => {
  let fail = false;
  let slow = false;
  const sample = sampleState('estimated', Date.now());
  assert.equal(sample.kind, 'ready');
  const feed = sample.kind === 'ready' ? sample.feed : null;
  const server = createServer(async (_req, res) => {
    if (slow) await delay(100);
    res.writeHead(fail ? 503 : 200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(feed));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {server.closeAllConnections(); server.close();});
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/api/shuttle`;
  const states: RequestState[] = [];
  const stop = startFeedSession(endpoint, state => states.push(state), {pollMs: 20, timeoutMs: 200});
  t.after(stop);
  await until(() => states.some(state => state.kind === 'ready'));
  fail = true;
  await until(() => states.some(state => state.kind === 'failed'));
  const failure = states.at(-1);
  assert.equal(failure?.kind, 'failed');
  if (failure?.kind === 'failed') assert.equal(failure.feed?.latest?.checkpoint, 'BEI campus corner');
  stop();
  fail = false; slow = true;
  const late: RequestState[] = [];
  const cancel = startFeedSession(endpoint, state => late.push(state), {pollMs: 20, timeoutMs: 200});
  await delay(20); cancel(); await delay(150);
  assert.deepEqual(late.map(state => state.kind), ['loading']);
});
test('mobile schema accepts the actual sample worker API without mailbox credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bustrackr-native-contract-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const worker = spawn(process.execPath, ['server/index.mjs', '--sample'], {
    cwd: new URL('../../', import.meta.url),
    env: {...process.env, ALERT_PORT: String(address.port), ALERT_STATE_FILE: join(directory, 'sample.json')},
    stdio: 'ignore',
  });
  t.after(async () => {
    if (worker.exitCode === null) {worker.kill('SIGTERM'); await once(worker, 'exit');}
    await rm(directory, {recursive: true, force: true});
  });
  let payload: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {payload = await (await fetch(`http://127.0.0.1:${address.port}/api/shuttle`)).json(); break;}
    catch {await delay(50);}
  }
  const feed = feedSchema.parse(payload);
  assert.equal(feed.status, 'sample');
  assert.equal(feed.eventCount, 4);
  assert(feed.latest?.eventAt);
  assert.equal(feed.prediction.status, 'estimated');
});
