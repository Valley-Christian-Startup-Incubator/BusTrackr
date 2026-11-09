import test from 'node:test';
import assert from 'node:assert/strict';
import {earlierDaySighting, observationAge, relativeObservationTime} from '../src/shuttle/observation';

const now = Date.parse('2026-11-02T23:30:00Z');
const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
test('observations age independently from timetable and turn red at ten minutes', () => {
  assert.deepEqual(observationAge(at(0), now), {kind: 'observed', minutes: 0, color: '#167248'});
  assert.deepEqual(observationAge(at(5), now), {kind: 'observed', minutes: 5, color: '#946200'});
  assert.deepEqual(observationAge(at(10), now), {kind: 'observed', minutes: 10, color: '#b3322b'});
  assert.deepEqual(observationAge(at(1441), now), {kind: 'observed', minutes: 1441, color: '#b3322b'});
  assert.equal(observationAge(at(9.99), now).kind, 'observed');
});
test('missing, invalid and future camera times never look like recent detections', () => {
  assert.deepEqual(observationAge(null, now), {kind: 'missing'});
  assert.deepEqual(observationAge(undefined, now), {kind: 'missing'});
  assert.deepEqual(observationAge('bad', now), {kind: 'missing'});
  assert.deepEqual(observationAge(at(-1), now), {kind: 'clock-error'});
});

test('relative sighting time uses readable units without changing recency', () => {
  for (const [minutes, value, unit, label] of [
    [0, '<1', 'minute', 'Less than a minute ago'],
    [1, '1', 'minute', '1 minute ago'],
    [59, '59', 'minutes', '59 minutes ago'],
    [60, '1', 'hour', '1 hour ago'],
    [120, '2', 'hours', '2 hours ago'],
    [1439, '23', 'hours', '23 hours ago'],
    [1440, '1', 'day', '1 day ago'],
    [12000, '8', 'days', '8 days ago'],
    [43200, '1', 'month', '1 month ago'],
    [525600, '1', 'year', '1 year ago'],
    [1051200, '2', 'years', '2 years ago'],
  ] as const) assert.deepEqual(relativeObservationTime(minutes), {value, unit, label});
  assert.deepEqual(observationAge(at(12000), now), {kind: 'observed', minutes: 12000, color: '#b3322b'});
});

test('sightings from an earlier Pacific day name the day instead of an age', () => {
  const monday = Date.parse('2026-11-09T23:35:00Z');
  assert.equal(earlierDaySighting('2026-11-09T16:00:00Z', monday), null);
  assert.equal(earlierDaySighting('2026-11-09T08:05:00Z', monday), null);
  assert.equal(earlierDaySighting('2026-11-09T07:55:00Z', monday), 'Last seen yesterday at 11:55 PM');
  assert.equal(earlierDaySighting('2026-11-06T22:31:21Z', monday), 'Last seen Friday at 2:31 PM');
  assert.equal(earlierDaySighting('2026-10-30T22:31:21Z', monday), 'Last seen Oct 30 at 3:31 PM');
  assert.equal(earlierDaySighting('2026-11-10T00:00:00Z', monday), null);
});
