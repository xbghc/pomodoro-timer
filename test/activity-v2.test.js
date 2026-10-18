'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityTimer, MIN } = require('../src/main/activity-core');
const { ActivityStore } = require('../src/main/activity-store');
const { DEFAULT_SCHEDULE, validateSchedule, planForDate, windowAt, dayBounds } = require('../src/main/schedule-v2');
function clock() {
  let time = 1_000_000;
  const timer = new ActivityTimer({ now: () => time, workMin: 30 });
  const records = []; timer.on('record', (record) => records.push(record));
  return { timer, records, now: () => time, jump: (ms) => { time += ms; }, advance: (ms) => {
    const target = time + ms;
    while (time < target) { time = Math.min(time + 30_000, target); timer.tick(); }
  } };
}
function storeFor(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new ActivityStore(dir);
}
test('resetting the reminder at minute 20 keeps one continuous 80-minute record', () => {
  const c = clock(); c.timer.startWork(); const id = c.timer.id;
  c.advance(20 * MIN); c.timer.remindIn(60); c.advance(60 * MIN);
  assert.equal(c.timer.id, id); assert.equal(c.records.length, 0);
  assert.equal(c.timer.getState().reminderDue, true);
  c.timer.stop(); assert.equal(c.records.length, 1);
  assert.equal(c.records[0].endedAt - c.records[0].startedAt, 80 * MIN);
});
test('skipping a reminder delays it one hour without changing the activity', () => {
  const c = clock(); c.timer.startWork(); c.advance(30 * MIN);
  c.timer.skipReminder(); assert.equal(c.timer.reminderAt, c.now() + 60 * MIN);
  assert.equal(c.timer.reminderDue, false); assert.equal(c.records.length, 0);
});
test('fixed boundary wins over focus extension', () => {
  const c = clock(); c.timer.startWork({ boundaryAt: c.now() + 30 * MIN });
  c.advance(20 * MIN); c.timer.remindIn(60); c.advance(11 * MIN);
  assert.equal(c.timer.phase, 'waiting'); assert.equal(c.records[0].endedAt - c.records[0].startedAt, 30 * MIN);
});
test('break completion closes at deadline and waiting is uncounted', () => {
  const c = clock(); c.timer.startBreak({ minutes: 20 }); c.advance(30 * MIN);
  assert.equal(c.timer.phase, 'waiting'); assert.equal(c.records.length, 1);
  assert.equal(c.records[0].endedAt - c.records[0].startedAt, 20 * MIN);
});
test('earliest break deadline wins even if a tick crosses both deadlines', () => {
  const c = clock(); c.timer.startBreak({ minutes: 1, boundaryAt: c.now() + 90_000 });
  c.jump(100_000); assert.equal(c.timer.tick(), 'break-over');
  assert.equal(c.records[0].endedAt - c.records[0].startedAt, MIN);
});
test('changing a boundary does not permanently shorten the natural break deadline', () => {
  const c = clock(); c.timer.startBreak({ minutes: 20, boundaryAt: c.now() + 10 * MIN });
  c.advance(5 * MIN); c.timer.setBoundary(c.now() + 30 * MIN); c.advance(16 * MIN);
  assert.equal(c.records[0].endedAt - c.records[0].startedAt, 20 * MIN);
});
test('missed suspend event conservatively closes at the last observed tick', () => {
  const c = clock(); c.timer.startWork(); c.advance(30_000); c.jump(3 * MIN);
  assert.equal(c.timer.tick(), 'suspended'); assert.equal(c.timer.phase, 'waiting');
  assert.equal(c.records[0].endedAt - c.records[0].startedAt, 30_000);
});
test('invalid durations and boundaries do not mutate an active activity', () => {
  const c = clock(); c.timer.startWork(); const before = c.timer.getState();
  for (const value of [NaN, Infinity, 0, -1, '10', null, 1441]) {
    assert.equal(c.timer.remindIn(value), false); assert.equal(c.timer.startBreak({ minutes: value }), false);
  }
  assert.equal(c.timer.setBoundary(NaN), false); assert.deepEqual(c.timer.getState(), before);
});
test('timetable validation rejects inherited names, overlaps, and invalid weekday keys', () => {
  assert.equal(validateSchedule(DEFAULT_SCHEDULE), DEFAULT_SCHEDULE);
  assert.throws(() => validateSchedule({ templates: {}, defaultTemplate: 'toString' }));
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, weekdays: { '9': 'workday' } }));
  assert.throws(() => validateSchedule({ templates: { a: [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }, defaultTemplate: 'a' }));
  assert.equal(planForDate(DEFAULT_SCHEDULE, '2026-10-19', { '2026-10-19': 'off' }).blocks.length, 0);
  assert.equal(windowAt(DEFAULT_SCHEDULE, new Date(2026, 9, 19, 11)).endAt, new Date(2026, 9, 19, 12).getTime());
  assert.throws(() => dayBounds('2026-02-30'));
});
test('new storage never reads, converts, or deletes legacy files', (t) => {
  const store = storeFor(t);
  for (const name of ['history.json', 'settings.json', 'runtime.json']) fs.writeFileSync(path.join(store.dir, name), 'not even JSON');
  assert.deepEqual(store.records(), []); store.preferences(); store.recover();
  for (const name of ['history.json', 'settings.json', 'runtime.json']) assert.equal(fs.readFileSync(path.join(store.dir, name), 'utf8'), 'not even JSON');
});
test('record CRUD validates values and preserves stable IDs', (t) => {
  const store = storeFor(t), record = store.create({ type: 'work', startedAt: 1000, endedAt: 2000 });
  assert.throws(() => store.create(record)); store.update(record.id, { endedAt: 2500 });
  assert.equal(new ActivityStore(store.dir).records()[0].endedAt, 2500);
  assert.throws(() => store.create({ type: 'work', startedAt: '1', endedAt: 2 }));
  assert.equal(store.delete(record.id), true); assert.deepEqual(store.records(), []);
});
test('checkpoint recovery records observed time only and is idempotent', (t) => {
  const store = storeFor(t);
  store.checkpoint({ id: 'active', phase: 'work', startedAt: 1000 }, 4000);
  store.recover(); store.recover();
  assert.deepEqual(store.records(), [{ id: 'active', type: 'work', startedAt: 1000, endedAt: 4000 }]);
});
test('crash after closing a record does not duplicate or truncate it', (t) => {
  const store = storeFor(t);
  store.create({ id: 'active', type: 'work', startedAt: 1000, endedAt: 5000 });
  store.checkpoint({ id: 'active', phase: 'work', startedAt: 1000 }, 4000);
  store.recover(); assert.equal(store.records().length, 1); assert.equal(store.records()[0].endedAt, 5000);
});
test('corrupt history fails explicitly without overwriting the original', (t) => {
  const store = storeFor(t); fs.writeFileSync(store.recordsPath, '{broken');
  assert.throws(() => store.records()); assert.equal(fs.readFileSync(store.recordsPath, 'utf8'), '{broken');
});
