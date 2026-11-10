import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backtest, estimate, learn, scheduledTime} from './estimator.mjs';
import {cameraTimestamp, parseAlert} from './alerts.mjs';

const checkpoint = 'BEI campus corner';
let serial = 0;
const sighting = (date, time, extra = {}) => {
  const at = new Date(scheduledTime(date, time.slice(0,5)) + Number(time.slice(6) || 0)*1000).toISOString();
  return {id:`s${serial++}`, checkpoint, eventAt:at, receivedAt:at, ...extra};
};
const pacific = (date, time) => new Date(scheduledTime(date, time));
const minutesBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b))/60_000;
// Two school weeks starting Monday 2026-10-19: ~3:10 PM Monday to Thursday, ~2:25 PM Friday.
function twoWeeks() {
  const events = [];
  for (const week of ['2026-10-19', '2026-10-26']) {
    const start = Date.parse(`${week}T12:00:00Z`);
    for (let d = 0; d < 5; d++) {
      const date = new Date(start + d*86_400_000).toISOString().slice(0,10);
      events.push(d === 4 ? sighting(date, `14:2${d}:10`) : sighting(date, `15:1${d}:30`));
    }
  }
  return events;
}

test('Pacific calendar conversion and camera timestamp validation', ()=>{
  assert.equal(new Date(scheduledTime('2026-10-16','14:00')).toISOString(),'2026-10-16T21:00:00.000Z');
  assert.equal(new Date(scheduledTime('2026-12-16','14:00')).toISOString(),'2026-12-16T22:00:00.000Z');
  assert.equal(scheduledTime('2026-03-08','02:30'),null);
  assert.equal(scheduledTime('2026-11-01','01:30'),null);
  assert.equal(cameraTimestamp('[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.'),'2026-10-16T21:06:43.000Z');
  for (const text of ['[2026-Feb-30 02:06:43 PM (PST)] BEI Bus has arrived.','[2026-Oct-16 02:06:43 PM (PST)] BEI Bus has arrived.','[2026-Oct-16 00:06:43 PM (PDT)] BEI Bus has arrived.']) assert.equal(cameraTimestamp(text),null);
});

test('HTML-only camera messages work and malformed/future events do not', async()=>{
  const config = {sender:'avigilonalerts@vcs.net', marker:'BEI Bus has arrived.', checkpoint};
  const raw = 'From: Avigilonalerts@vcs.net\r\nContent-Type: text/html\r\n\r\n<p>[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.</p>';
  assert.ok(await parseAlert(raw, config, new Date('2026-10-16T21:07:00Z')));
  assert.equal(await parseAlert(raw, config, new Date('2026-10-16T20:00:00Z')), null);
});

test('stays quiet until a pass has been seen on two days', ()=>{
  assert.equal(estimate([], {checkpoint, now:pacific('2026-11-02','08:00')}).status, 'unconfigured');
  const one = [sighting('2026-10-30','14:35:43')];
  const result = estimate(one, {checkpoint, now:pacific('2026-11-02','08:00')});
  assert.equal(result.status, 'unconfigured');
  assert.equal(result.learned.noise, 1);
});

test('learns weekday and Friday passes from history and predicts the next one', ()=>{
  const events = twoWeeks();
  const monday = estimate(events, {checkpoint, now:pacific('2026-11-02','08:00')});
  assert.equal(monday.status, 'scheduled');
  assert.ok(minutesBetween(monday.nextCrossingAt, pacific('2026-11-02','15:11').toISOString()) < 3, monday.nextCrossingAt);
  assert.ok(Date.parse(monday.window[0]) < Date.parse(monday.nextCrossingAt) && Date.parse(monday.nextCrossingAt) < Date.parse(monday.window[1]));
  const friday = estimate(events, {checkpoint, now:pacific('2026-11-06','08:00')});
  assert.ok(minutesBetween(friday.nextCrossingAt, pacific('2026-11-06','14:24').toISOString()) < 3, friday.nextCrossingAt);
  const saturday = estimate(events, {checkpoint, now:pacific('2026-11-07','08:00')});
  assert.equal(serviceDateOf(saturday.nextCrossingAt), '2026-11-09', 'weekends never had a bus, so the next pass is Monday');
});
const serviceDateOf = at => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date(at));

test('stray triggers, duplicates and late mail do not move the prediction', ()=>{
  const clean = estimate(twoWeeks(), {checkpoint, now:pacific('2026-11-02','08:00')});
  const noisy = [...twoWeeks(),
    sighting('2026-10-27','09:45:03'),
    sighting('2026-10-28','15:12:50', {duplicateOf:'s0'}),
    sighting('2026-10-29','15:29:00'),
    sighting('2026-11-02','07:55:00', {receivedAt:pacific('2026-11-02','09:00').toISOString()}),
    {...sighting('2026-10-28','15:10:00'), checkpoint:'Somewhere else'},
  ];
  const result = estimate(noisy, {checkpoint, now:pacific('2026-11-02','08:00')});
  assert.ok(minutesBetween(result.nextCrossingAt, clean.nextCrossingAt) < 1.5, `${result.nextCrossingAt} vs ${clean.nextCrossingAt}`);
  assert.equal(learn(noisy, {checkpoint, now:pacific('2026-11-02','08:00')}).runs.length, learn(twoWeeks(), {checkpoint, now:pacific('2026-11-02','08:00')}).runs.length);
});

test('follows a schedule change as recent days outweigh old ones', ()=>{
  const events = [];
  for (let d = 0; d < 42; d++) {
    const date = new Date(Date.parse('2026-09-21T12:00:00Z') + d*86_400_000).toISOString().slice(0,10);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    events.push(sighting(date, d < 21 ? '15:10:00' : '15:40:00'));
  }
  const result = estimate(events, {checkpoint, now:pacific('2026-11-02','08:00')});
  assert.ok(minutesBetween(result.nextCrossingAt, pacific('2026-11-02','15:40').toISOString()) < 2, result.nextCrossingAt);
});

test('a configured trip length turns a sighting into a moving map position', ()=>{
  const trip = {durationSeconds:600, direction:'outbound', checkpointProgress:0};
  const today = sighting('2026-11-02','15:11:00');
  const events = [...twoWeeks(), today];
  const result = estimate(events, {checkpoint, trip, now:pacific('2026-11-02','15:15')});
  assert.equal(result.status, 'estimated');
  assert.equal(result.anchor, 'camera');
  assert.equal(result.eventId, today.id);
  assert.equal(result.marker.progress, .4);
  const later = estimate(events, {checkpoint, trip, now:pacific('2026-11-02','15:17')});
  assert.ok(later.marker.progress > result.marker.progress);
  const twice = estimate([...events, sighting('2026-11-02','15:13:00')], {checkpoint, trip, now:pacific('2026-11-02','15:15')});
  assert.equal(twice.status, 'ambiguous');
  assert.equal(estimate(events, {checkpoint, now:pacific('2026-11-02','15:15')}).marker, null, 'no trip length, no position');
});

test('backtest replays each past day using only earlier sightings', ()=>{
  const score = backtest(twoWeeks(), {checkpoint, now:pacific('2026-11-02','08:00')});
  assert.ok(score.days >= 5, JSON.stringify(score));
  assert.ok(score.hits >= 4, JSON.stringify(score));
  assert.ok(score.meanErrorMinutes < 5, JSON.stringify(score));
  assert.equal(backtest([], {checkpoint}).days, 0);
});
