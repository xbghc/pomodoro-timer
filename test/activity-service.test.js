'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityStore } = require('../src/main/activity-store');
const { ActivityService } = require('../src/main/activity-service');
const MIN = 60_000;
const at = (h, m = 0) => new Date(2026, 9, 19, h, m).getTime();
function fixture(t, initial = at(10)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ActivityStore(dir); let time = initial;
  const service = new ActivityService({ store, now: () => time });
  service.tick();
  return { service, store, now: () => time, jump: (ms) => { time += ms; }, advance: (ms) => {
    const target = time + ms;
    while (time < target) { time = Math.min(time + 30_000, target); service.tick(); }
  } };
}
test('mid-block startup starts at application launch, without backfilling', (t) => {
  const f = fixture(t, at(11, 30));
  assert.equal(f.service.state().startedAt, at(11, 30)); assert.deepEqual(f.store.records(), []);
});
test('break completion remains waiting within the same scheduled block', (t) => {
  const f = fixture(t); f.advance(10 * MIN); f.service.command('startBreak', 20); f.advance(30 * MIN);
  assert.equal(f.service.state().phase, 'waiting');
  assert.deepEqual(f.store.records().map((r) => [r.type, (r.endedAt - r.startedAt) / MIN]), [['work', 10], ['break', 20]]);
  f.service.command('startWork'); assert.equal(f.service.state().startedAt, at(10, 40));
});
test('fixed end stops the activity and next block starts automatically', (t) => {
  const f = fixture(t, at(11, 50)); f.service.command('focus', 60); f.advance(20 * MIN);
  assert.equal(f.service.state().phase, 'waiting'); assert.equal(f.store.records()[0].endedAt, at(12));
  f.advance(80 * MIN); assert.equal(f.service.state().phase, 'work'); assert.equal(f.service.state().startedAt, at(13, 30));
});
test('manual stop is not undone by the next heartbeat', (t) => {
  const f = fixture(t); f.advance(MIN); f.service.command('stop'); f.advance(10 * MIN);
  assert.equal(f.service.state().phase, 'waiting'); assert.equal(f.store.records().length, 1);
});
test('suspend and resume exclude offline time and do not split twice on duplicate resume', (t) => {
  const f = fixture(t); f.advance(10 * MIN); f.service.suspend(); f.jump(30 * MIN);
  f.service.tick(); assert.equal(f.store.records().length, 1); assert.equal(f.service.state().phase, 'waiting');
  f.service.resume(); const id = f.service.state().id; f.service.resume();
  assert.equal(f.service.state().id, id); assert.equal(f.service.state().startedAt, at(10, 40));
  assert.equal(f.store.records()[0].endedAt, at(10, 10));
});
test('long heartbeat gap starts a new activity only at the observed return time', (t) => {
  const f = fixture(t); f.advance(MIN); f.jump(10 * MIN); f.service.tick();
  assert.equal(f.store.records()[0].endedAt, at(10, 1)); assert.equal(f.service.state().startedAt, at(10, 11));
});
test('template replacement changes the cutoff without splitting continuous work', (t) => {
  const f = fixture(t); f.advance(10 * MIN);
  const config = f.store.schedule(); config.templates.extended = [{ start: '09:00', end: '13:00' }];
  fs.writeFileSync(f.store.schedulePath, JSON.stringify(config)); f.service.reloadSchedule();
  f.service.selectTodayTemplate('extended');
  assert.equal(f.service.state().startedAt, at(10)); assert.equal(f.service.state().boundaryAt, at(13));
  assert.equal(f.store.records().length, 0);
  f.service.selectTodayTemplate('off'); assert.equal(f.service.state().phase, 'waiting');
  assert.equal(f.store.records()[0].endedAt, at(10, 10));
  assert.equal(new ActivityStore(f.store.dir).preferences().dayTemplates['2026-10-19'], 'off');
});
test('invalid JSON reload keeps the last valid schedule and active record', (t) => {
  const f = fixture(t); const config = f.service.schedule;
  fs.writeFileSync(f.store.schedulePath, '{bad'); assert.throws(() => f.service.reloadSchedule());
  assert.equal(f.service.schedule, config); assert.equal(f.service.state().phase, 'work'); assert.equal(f.store.records().length, 0);
});
test('removed override template falls back safely on reload', (t) => {
  const f = fixture(t); f.service.selectTodayTemplate('off');
  const config = f.store.schedule(); delete config.templates.off; config.weekdays = {};
  fs.writeFileSync(f.store.schedulePath, JSON.stringify(config)); f.service.reloadSchedule();
  assert.equal(f.service.state().todayTemplate, 'workday');
});
test('fixed block start supersedes a manually started out-of-hours break', (t) => {
  const f = fixture(t, at(9, 50)); f.service.command('startBreak', 60); f.advance(10 * MIN);
  assert.equal(f.service.state().phase, 'work'); assert.equal(f.service.state().startedAt, at(10));
  assert.equal(f.store.records()[0].endedAt, at(10));
});
test('past record CRUD rejects future, overlapping, and ongoing intervals', (t) => {
  const f = fixture(t);
  const r = f.service.saveRecord({ type: 'work', startedAt: at(8), endedAt: at(9) });
  assert.throws(() => f.service.saveRecord({ type: 'break', startedAt: at(8, 30), endedAt: at(9, 30) }), /overlap/);
  assert.throws(() => f.service.saveRecord({ type: 'work', startedAt: at(9), endedAt: at(11) }), /future/);
  f.advance(10 * MIN);
  assert.throws(() => f.service.saveRecord({ type: 'work', startedAt: at(9), endedAt: at(10, 5) }), /ongoing/);
  f.service.saveRecord({ ...r, type: 'break' }); assert.equal(f.service.day('2026-10-19').records[0].type, 'break');
  f.service.deleteRecord(r.id); assert.deepEqual(f.store.records(), []);
  assert.throws(() => f.service.deleteRecord(r.id), /not found/);
});
test('changing defaults does not change the current reminder or permit editing future templates', (t) => {
  const f = fixture(t), reminderAt = f.service.state().reminderAt;
  f.service.savePreferences({ reminderMin: 60 }); assert.equal(f.service.state().reminderAt, reminderAt);
  assert.throws(() => f.service.savePreferences({ dayTemplates: { '2026-10-20': 'off' } }));
  assert.throws(() => f.service.savePreferences({ breakMin: -1 }));
});
test('restart after crash never extrapolates the checkpoint to the restart time', (t) => {
  const f = fixture(t); f.advance(10 * MIN); f.jump(40 * MIN);
  const restarted = new ActivityService({ store: new ActivityStore(f.store.dir), now: f.now }); restarted.tick();
  assert.equal(f.store.records()[0].endedAt, at(10, 10)); assert.equal(restarted.state().startedAt, at(10, 50));
});
