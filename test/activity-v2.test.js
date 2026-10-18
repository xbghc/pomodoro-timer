'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityTimer, MIN } = require('../src/main/activity-core');
const { ActivityStore } = require('../src/main/activity-store');
const { DEFAULT_SCHEDULE, validateSchedule, planForDate, windowAt } = require('../src/main/schedule-v2');

function advance(clock, setTime, current, durationMs) {
  const target = current + durationMs;
  for (let at = current + 30_000; at < target; at += 30_000) {
    setTime(at);
    clock.tick();
  }
  setTime(target);
  clock.tick();
}

test('reminders do not split continuous work intervals', () => {
  let time = 1_000_000;
  const clock = new ActivityTimer({ now: () => time, workMin: 30 });
  const records = [];
  clock.on('record', (r) => records.push(r));
  clock.startWork();
  advance(clock, (v) => { time = v; }, time, 20 * MIN);
  clock.remindIn(60);
  advance(clock, (v) => { time = v; }, time, 60 * MIN);
  assert.equal(clock.getState().phase, 'work');
  assert.equal(clock.getState().reminderDue, true);
  assert.equal(records.length, 0);
  advance(clock, (v) => { time = v; }, time, 10 * MIN);
  clock.startBreak({ minutes: 20 });
  assert.equal(records.length, 1);
  assert.equal(records[0].endedAt - records[0].startedAt, 90 * MIN);
});

test('skipping reminders defers by an hour without changing activity', () => {
  let time = 1000;
  const clock = new ActivityTimer({ now: () => time, workMin: 30 });
  clock.startWork();
  advance(clock, (v) => { time = v; }, time, 30 * MIN);
  assert.equal(clock.getState().reminderDue, true);
  clock.skipReminder();
  assert.equal(clock.getState().reminderAt, time + 60 * MIN);
  assert.equal(clock.getState().phase, 'work');
});

test('fixed schedule boundary takes priority over manual focus extension', () => {
  let time = 1000;
  const clock = new ActivityTimer({ now: () => time });
  const records = [];
  clock.on('record', (r) => records.push(r));
  clock.startWork({ boundaryAt: time + 30 * MIN });
  advance(clock, (v) => { time = v; }, time, 20 * MIN);
  clock.remindIn(60);
  advance(clock, (v) => { time = v; }, time, 11 * MIN);
  assert.equal(clock.getState().phase, 'waiting');
  assert.equal(records[0].endedAt - records[0].startedAt, 30 * MIN);
});

test('break completion ends at deadline and leaves waiting uncounted', () => {
  let time = 1000;
  const clock = new ActivityTimer({ now: () => time });
  const records = [];
  clock.on('record', (r) => records.push(r));
  clock.startBreak({ minutes: 20 });
  time += 30 * MIN;
  clock.tick();
  assert.equal(clock.getState().phase, 'waiting');
  assert.equal(records[0].endedAt - records[0].startedAt, 20 * MIN);
});

test('power gap excludes the suspended interval', () => {
  let time = 1000;
  const clock = new ActivityTimer({ now: () => time });
  const records = [];
  clock.on('record', (r) => records.push(r));
  clock.startWork();
  time += 30_000; clock.tick();
  time += 3 * MIN; clock.tick();
  assert.equal(clock.getState().phase, 'waiting');
  assert.equal(records[0].endedAt - records[0].startedAt, 30_000);
});

test('validates timetable and allows weekday template selection', () => {
  assert.equal(validateSchedule(DEFAULT_SCHEDULE), DEFAULT_SCHEDULE);
  const day = new Date(2026, 9, 19, 11, 0);
  assert.equal(planForDate(DEFAULT_SCHEDULE, '2026-10-19').name, 'workday');
  assert.equal(planForDate(DEFAULT_SCHEDULE, '2026-10-19', { '2026-10-19': 'off' }).blocks.length, 0);
  assert.equal(windowAt(DEFAULT_SCHEDULE, day).endAt, new Date(2026, 9, 19, 12, 0).getTime());
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE,
    templates: { ...DEFAULT_SCHEDULE.templates,
      overlapping: [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }] } }));
});

test('new record store does not consume old data; CRUD persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-v2-'));
  try {
    fs.writeFileSync(path.join(dir, 'history.json'), '[{"status":"completed"}]');
    const store = new ActivityStore(dir);
    assert.deepEqual(store.records(), []);
    const record = store.create({ type: 'work', startedAt: 1000, endedAt: 2000 });
    assert.equal(store.records().length, 1);
    store.update(record.id, { endedAt: 2500 });
    assert.equal(new ActivityStore(dir).records()[0].endedAt, 2500);
    assert.equal(store.delete(record.id), true);
    assert.equal(store.records().length, 0);
    assert.throws(() => store.create({ type: 'work', startedAt: 10, endedAt: 5 }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
