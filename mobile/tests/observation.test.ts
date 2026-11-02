import test from 'node:test';
import assert from 'node:assert/strict';
import {observationAge} from '../src/shuttle/observation';

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
