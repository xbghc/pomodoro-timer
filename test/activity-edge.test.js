'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityStore } = require('../src/main/activity-store');
const { ActivityService } = require('../src/main/activity-service');
function fixture(t, initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-edge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = initial;
  const store = new ActivityStore(dir), service = new ActivityService({ store, now: () => now });
  return { store, service, set: (at) => { now = at; service.tick(); } };
}
test('clock rollback pauses until automatic records can no longer overlap', (t) => {
  const at = (m) => new Date(2026, 9, 19, 10, m).getTime();
  const f = fixture(t, at(0)); f.service.tick();
  for (let m = 1; m <= 10; m++) f.set(at(m));
  f.set(at(5)); assert.equal(f.service.state().phase, 'waiting');
  assert.equal(f.service.state().clockBlockedUntil, at(10));
  assert.throws(() => f.service.command('startWork'), /backwards/);
  for (let m = 6; m <= 10; m++) f.set(at(m));
  assert.equal(f.service.state().startedAt, at(10));
  assert.equal(f.store.records()[0].endedAt, at(10));
});
test('manual out-of-hours work may cross midnight without a fabricated schedule boundary', (t) => {
  const start = new Date(2026, 9, 19, 23, 59).getTime();
  const f = fixture(t, start); f.service.command('startWork');
  const id = f.service.state().id;
  for (let i = 1; i <= 4; i++) f.set(start + i * 30_000);
  assert.equal(f.service.state().id, id); assert.equal(f.service.state().phase, 'work');
  assert.equal(f.service.state().boundaryAt, null); assert.equal(f.store.records().length, 0);
});
