'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityStore } = require('../src/main/activity-store');
const { ActivityService } = require('../src/main/activity-service');
const MIN = 60_000;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-integrity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = new Date(2026, 9, 19, 10, 30).getTime();
  const store = new ActivityStore(dir);
  fs.writeFileSync(store.schedulePath, JSON.stringify({ defaultTemplate: 'off', templates: {
    off: [], workday: [{ start: '10:00', end: '12:00' }],
  } }));
  const service = new ActivityService({ store, now: () => time });
  service.tick();
  return { store, service, now: () => time, setTime: (value) => { time = value; } };
}
test('manual insertion also blocks recording after wall-clock rollback', (t) => {
  const f = fixture(t), end = f.now();
  f.service.saveRecord({ type: 'work', startedAt: end - 30 * MIN, endedAt: end });
  f.setTime(end - 10 * MIN);
  f.service.tick();
  assert.equal(f.service.state().clockBlockedUntil, end);
  assert.throws(() => f.service.command('startWork'), /clock moved backwards/);
  assert.throws(() => f.service.command('startBreak'), /clock moved backwards/);
  f.service.selectTodayTemplate('workday');
  assert.equal(f.service.state().phase, 'waiting', 'schedule changes must respect manual history too');
  f.setTime(end);
  f.service.tick();
  assert.equal(f.service.state().phase, 'work');
  assert.equal(f.service.state().startedAt, end);
});
test('extending a manual record updates the no-overlap boundary', (t) => {
  const f = fixture(t), end = f.now();
  const record = f.service.saveRecord({ type: 'work', startedAt: end - 30 * MIN, endedAt: end - 20 * MIN });
  f.service.saveRecord({ ...record, endedAt: end });
  f.setTime(end - 5 * MIN);
  assert.equal(f.service.tick().clockBlockedUntil, end);
  assert.throws(() => f.service.command('startWork'), /clock moved backwards/);
});
test('shortening or deleting history recomputes the blocked-until time', (t) => {
  const f = fixture(t), end = f.now();
  const older = f.service.saveRecord({ type: 'work', startedAt: end - 60 * MIN, endedAt: end - 40 * MIN });
  const latest = f.service.saveRecord({ type: 'break', startedAt: end - 30 * MIN, endedAt: end });
  f.service.saveRecord({ ...latest, endedAt: end - 10 * MIN });
  f.setTime(end - 20 * MIN);
  assert.equal(f.service.tick().clockBlockedUntil, end - 10 * MIN);
  f.service.deleteRecord(latest.id);
  assert.equal(f.service.state().clockBlockedUntil, null);
  assert.equal(f.service.notBefore, older.endedAt);
  f.service.deleteRecord(older.id);
  assert.equal(f.service.notBefore, 0);
  f.service.command('startWork');
  assert.equal(f.service.state().startedAt, f.now());
});
test('editing history cannot bypass suspension or overwrite a recovery checkpoint', (t) => {
  const f = fixture(t), end = f.now();
  const record = f.service.saveRecord({ type: 'work', startedAt: end - 30 * MIN, endedAt: end - 20 * MIN });
  f.service.suspend();
  const before = Object.fromEntries(fs.readdirSync(f.store.dir).map((name) => [name, fs.readFileSync(path.join(f.store.dir, name), 'utf8')]));
  for (const mutate of [
    () => f.service.reloadSchedule(),
    () => f.service.selectTodayTemplate('workday'),
    () => f.service.savePreferences({ theme: 'dark' }),
    () => f.service.saveRecord({ ...record, type: 'break' }),
    () => f.service.deleteRecord(record.id),
  ]) assert.throws(mutate, /suspended/);
  assert.equal(f.service.state().phase, 'waiting');
  assert.equal(f.service.state().suspended, true);
  const after = Object.fromEntries(fs.readdirSync(f.store.dir).map((name) => [name, fs.readFileSync(path.join(f.store.dir, name), 'utf8')]));
  assert.deepEqual(after, before);
  assert.equal(f.service.day('2026-10-19').records.length, 1, 'history remains readable while paused');
  f.service.resume();
  assert.equal(f.service.state().suspended, false);
  f.service.selectTodayTemplate('workday');
  assert.equal(f.service.state().phase, 'work');
});
test('calendar edit roundtrip preserves seconds, milliseconds, and stable record IDs', (t) => {
  const { localInput } = require('../src/renderer/activity-view');
  const f = fixture(t), end = f.now();
  const record = f.service.saveRecord({ type: 'work', startedAt: end - 10_123, endedAt: end - 7_019 });
  const values = { id: record.id, type: 'break', startedAt: new Date(localInput(record.startedAt)).getTime(),
    endedAt: new Date(localInput(record.endedAt)).getTime() };
  assert.deepEqual(f.service.saveRecord(values), { ...record, type: 'break' });
  assert.deepEqual(f.store.records(), [{ ...record, type: 'break' }]);
});
