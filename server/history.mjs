import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, rmSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {recordAlert} from './alerts.mjs';

const schema = `
CREATE TABLE IF NOT EXISTS sightings (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  checkpoint TEXT, event_at TEXT, timestamp_source TEXT, received_at TEXT, reported_at TEXT, source TEXT, duplicate_of TEXT,
  collector_commit TEXT, collector_source TEXT, parser TEXT,
  message_id TEXT, body_sha256 TEXT,
  recorded_at TEXT NOT NULL,
  dashboard_sent_at TEXT
);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

const event = row => Object.fromEntries(Object.entries({
  id:row.id, checkpoint:row.checkpoint, eventAt:row.event_at, timestampSource:row.timestamp_source,
  receivedAt:row.received_at, reportedAt:row.reported_at, source:row.source, duplicateOf:row.duplicate_of ?? undefined,
}).filter(([, value]) => value !== undefined));
export const sighting = row => ({
  ...event(row),
  collector:row.parser ? {commit:row.collector_commit, source:row.collector_source, parser:row.parser} : null,
  input:{messageId:row.message_id, bodySha256:row.body_sha256},
  recordedAt:row.recorded_at, dashboardSentAt:row.dashboard_sent_at,
});

export function collectorSource(dir) {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).sort()) {
    hash.update(name).update('\0').update(readFileSync(join(dir, name))).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function openHistory(path, {collector = null, legacyPath = null, now = () => new Date()} = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; ${schema}`);
  const insertSighting = db.prepare(`INSERT INTO sightings (id, checkpoint, event_at, timestamp_source, received_at, reported_at, source, duplicate_of,
    collector_commit, collector_source, parser, message_id, body_sha256, recorded_at)
    VALUES (:id, :checkpoint, :eventAt, :timestampSource, :receivedAt, :reportedAt, :source, :duplicateOf,
    :commit, :collectorSource, :parser, :messageId, :bodySha256, :recordedAt)`);
  const insertReceipt = db.prepare('INSERT OR IGNORE INTO receipts (id, recorded_at) VALUES (?, ?)');
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {work(); db.exec('COMMIT');} catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  function insert(stored, provenance, recordedAt) {
    insertSighting.run({
      id:stored.id, checkpoint:stored.checkpoint ?? null, eventAt:stored.eventAt ?? null, timestampSource:stored.timestampSource ?? null,
      receivedAt:stored.receivedAt ?? null, reportedAt:stored.reportedAt ?? null, source:stored.source ?? null, duplicateOf:stored.duplicateOf ?? null,
      commit:provenance.collector?.commit ?? null, collectorSource:provenance.collector?.source ?? null, parser:provenance.collector?.parser ?? null,
      messageId:provenance.input?.messageId ?? null, bodySha256:provenance.input?.bodySha256 ?? null, recordedAt,
    });
  }

  // Imported once; the JSON file is left untouched as the pre-migration record.
  if (legacyPath && existsSync(legacyPath)) {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
    const events = legacy.events ?? (legacy.latest ? [legacy.latest] : []);
    const at = now().toISOString();
    transaction(() => {
      if (db.prepare("SELECT 1 FROM meta WHERE key = 'legacy_import'").get()) return;
      for (const stored of events) insert(stored, {}, at);
      for (const id of legacy.resendReceipts ?? []) insertReceipt.run(id, at);
      db.prepare("INSERT INTO meta (key, value) VALUES ('legacy_import', ?)").run(JSON.stringify({path:legacyPath, at, events:events.length}));
    });
  }

  const state = {events:[], latest:null};
  for (const row of db.prepare('SELECT * FROM sightings ORDER BY seq').all()) {
    const stored = event(row);
    state.events.push(stored);
    if (!state.latest || Date.parse(stored.eventAt || stored.receivedAt) > Date.parse(state.latest.eventAt || state.latest.receivedAt)) state.latest = stored;
  }

  return {
    state,
    hasReceipt:id => Boolean(db.prepare('SELECT 1 FROM receipts WHERE id = ?').get(id)),
    record(alert, receipt, cooldownSeconds) {
      const {input, ...parsed} = alert ?? {};
      const next = {events:[...state.events], latest:state.latest};
      const stored = alert ? recordAlert(next, parsed, cooldownSeconds) : false;
      const at = now().toISOString();
      transaction(() => {
        if (stored) insert(next.events.at(-1), {collector, input}, at);
        if (receipt) insertReceipt.run(receipt, at);
      });
      Object.assign(state, next);
      return stored;
    },
    unsent:() => db.prepare('SELECT * FROM sightings WHERE dashboard_sent_at IS NULL ORDER BY seq').all().map(sighting),
    markSent:id => db.prepare('UPDATE sightings SET dashboard_sent_at = ? WHERE id = ?').run(now().toISOString(), id),
    all:() => db.prepare('SELECT * FROM sightings ORDER BY seq').all().map(sighting),
    snapshot(dir, keep = 14) {
      mkdirSync(dir, {recursive:true});
      const file = join(dir, `sightings-${now().toISOString().slice(0, 10)}.sqlite`);
      if (existsSync(file)) return null;
      db.prepare('VACUUM INTO ?').run(file);
      const old = readdirSync(dir).filter(name => /^sightings-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().slice(0, -keep);
      for (const name of old) rmSync(join(dir, name));
      return file;
    },
    close:() => db.close(),
  };
}
