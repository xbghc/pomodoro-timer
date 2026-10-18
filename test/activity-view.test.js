'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/renderer/activity-view');
const MIN = 60_000;
test('calendar totals include actual work and rest only, not plans or waiting', () => {
  const day = { startAt: 0, endAt: 100 * MIN, plan: [{ startAt: 0, endAt: 100 * MIN }], records: [
    { id: 'a', type: 'work', startedAt: 0, endedAt: 45 * MIN },
    { id: 'b', type: 'break', startedAt: 45 * MIN, endedAt: 65 * MIN },
  ] };
  const state = { id: 'c', phase: 'work', startedAt: 70 * MIN, now: 90 * MIN, boundaryAt: 100 * MIN };
  assert.deepEqual(view.totals(day, state), { work: 65 * MIN, break: 20 * MIN });
  assert.deepEqual(view.totals(day, { phase: 'waiting', startedAt: null }), { work: 45 * MIN, break: 20 * MIN });
});
test('cross-midnight records are clipped to the viewed day', () => {
  const day = { startAt: 100 * MIN, endAt: 200 * MIN, records: [
    { type: 'work', startedAt: 90 * MIN, endedAt: 120 * MIN },
    { type: 'break', startedAt: 190 * MIN, endedAt: 220 * MIN },
  ] };
  assert.deepEqual(view.totals(day), { work: 20 * MIN, break: 10 * MIN });
});
test('ongoing break display stops at its actual deadline', () => {
  const state = { id: 'active', phase: 'break', startedAt: 10 * MIN, now: 40 * MIN, breakEndsAt: 30 * MIN, boundaryAt: 50 * MIN };
  assert.equal(view.activeRecord(state, { startAt: 0, endAt: 100 * MIN }).endedAt, 30 * MIN);
  assert.equal(view.activeRecord({ ...state, suspended: true }, { startAt: 0, endAt: 100 * MIN }), null);
});
test('duration, clock, and local datetime formatting are deterministic', () => {
  assert.equal(view.duration(80 * MIN), '1 小时 20 分钟'); assert.equal(view.clock(80 * MIN), '01:20:00');
  assert.equal(view.clock(-100), '00:00');
  const date = new Date(2026, 9, 19, 10, 20, 30, 250);
  assert.equal(view.localInput(date.getTime()), '2026-10-19T10:20:30.250');
});
