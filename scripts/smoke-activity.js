'use strict';
// Real Electron + preload + renderer + disk storage, always in an isolated data directory.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { waitFor } = require('./lib/wait-for');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-smoke-'));
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });
const schedulePath = path.join(dir, 'schedule.json');
// Manual work has no fixed deadline, so this test is not sensitive to midnight or 23:59.
// Automatic schedule boundaries are covered by the deterministic service tests.
const scheduleJSON = JSON.stringify({ defaultTemplate: 'manual', templates: { manual: [], off: [] } });
fs.writeFileSync(schedulePath, scheduleJSON);
fs.writeFileSync(path.join(dir, 'history.json'), 'legacy-data-must-stay-untouched');
let application, page;
const errors = [], logs = [];
async function launch() {
  application = await electron.launch({ args: [root], env: { ...process.env, POMODORO_DATA_DIR: dir }, timeout: 60_000 });
  application.process().stdout?.on('data', (data) => logs.push(String(data)));
  application.process().stderr?.on('data', (data) => logs.push(String(data)));
  application.on('window', (window) => window.on('pageerror', (error) => errors.push(error.message)));
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.waitForFunction(() => !!window.activity && !document.getElementById('main').hidden, undefined, { timeout: 15_000 });
}
async function waitState(accept, description) {
  return waitFor(async () => {
    const state = await page.evaluate(() => window.activity.bootstrap());
    assert.equal(state.failure, '', state.failure);
    return state;
  }, accept, { description });
}
async function readDay(key) { return page.evaluate((date) => window.activity.day(date), key); }
async function roleWindow(role) {
  return waitFor(async () => application.windows().find((window) => new URL(window.url()).searchParams.get('role') === role),
    Boolean, { description: `real ${role} window` });
}
(async () => {
  try {
    await launch();
    await page.evaluate(() => window.activity.command('startWork'));
    const before = await page.evaluate(() => window.activity.bootstrap());
    await page.locator('#focus-hour').click();
    const focused = await waitState((state) => state.reminderAt - state.now > 59 * 60_000, 'one-hour reminder');
    assert.equal(focused.id, before.id);
    assert.equal(focused.startedAt, before.startedAt);
    assert.ok(Math.abs(focused.reminderAt - focused.now - 60 * 60_000) < 2000);

    // Trigger and dismiss a real reminder; neither operation closes the working interval.
    await page.evaluate(() => window.activity.command('focus', 0.05));
    const dueState = await waitState((state) => state.reminderDue, 'work reminder to become due');
    assert.equal(dueState.phase, 'work');
    assert.equal(dueState.id, before.id);
    const due = await roleWindow('due');
    await due.locator('#due').waitFor({ state: 'visible' });
    await due.screenshot({ path: path.join(results, 'activity-reminder.png') });
    await due.locator('#due [data-command="skipReminder"]').click();
    const snoozed = await waitState((state) => !state.reminderDue && state.reminderAt - state.now > 59 * 60_000, 'reminder snooze');
    assert.equal(snoozed.id, before.id);
    assert.equal(snoozed.startedAt, before.startedAt);
    await waitFor(async () => due.isClosed(), Boolean, { description: 'dismissed reminder window to close' });

    await page.locator('#break-twenty').click();
    await waitState((state) => state.phase === 'break', 'rest to start');
    const overlay = await roleWindow('break');
    await overlay.locator('#rest').waitFor({ state: 'visible' });
    await overlay.screenshot({ path: path.join(results, 'activity-rest.png') });
    // Shorten an already-loaded break; keep the same activity ID and wait for actual completion.
    const resting = await page.evaluate(() => window.activity.bootstrap());
    const shortened = await page.evaluate(() => window.activity.command('startBreak', 0.05));
    assert.equal(shortened.id, resting.id);
    await waitState((state) => state.phase === 'waiting', 'rest completion');
    for (let i = 0; i < 3; i++) {
      await delay(250);
      assert.equal((await page.evaluate(() => window.activity.bootstrap())).phase, 'waiting');
    }
    assert.ok(!application.windows().includes(overlay), 'completed rest overlay must close');
    const actual = JSON.parse(fs.readFileSync(path.join(dir, 'activity-records.json'), 'utf8'));
    assert.deepEqual(actual.map((record) => record.type), ['work', 'break']);
    assert.equal(actual[0].id, before.id);
    assert.equal(actual[1].id, resting.id);
    assert.equal(actual[1].endedAt, shortened.breakEndsAt);

    // Exercise the calendar form, not only the record IPC methods.
    const inputs = await page.evaluate(() => ({ start: window.ActivityView.localInput(Date.now() - 2 * 3600_000), end: window.ActivityView.localInput(Date.now() - 3600_000) }));
    const date = inputs.start.slice(0, 10);
    await page.locator('#date').fill(date);
    await page.locator('#date').dispatchEvent('change');
    await page.locator('#add-record').click();
    await page.locator('#record-form [name=startedAt]').fill(inputs.start);
    await page.locator('#record-form [name=endedAt]').fill(inputs.end);
    await page.locator('#record-form button[type=submit]').click();
    await page.waitForFunction(() => !document.getElementById('record-dialog').open);
    const saved = await waitFor(() => readDay(date), (day) => day.records.some((record) => record.startedAt === new Date(inputs.start).getTime()), { description: 'calendar insertion' });
    const manual = saved.records.find((record) => record.startedAt === new Date(inputs.start).getTime());
    assert.equal(manual.type, 'work');
    assert.equal(manual.endedAt, new Date(inputs.end).getTime());
    await page.screenshot({ path: path.join(results, 'activity-main.png'), fullPage: true });
    // The manual record starts before this launch, so it is the first table row.
    await page.locator('#records tr').first().getByRole('button', { name: '编辑' }).click();
    await page.locator('#record-form [name=type]').selectOption('break');
    await page.locator('#record-form button[type=submit]').click();
    await page.waitForFunction(() => !document.getElementById('record-dialog').open);
    const edited = await waitFor(() => readDay(date), (day) => day.records.find((record) => record.id === manual.id)?.type === 'break', { description: 'calendar edit' });
    assert.deepEqual(edited.records.find((record) => record.id === manual.id), { ...manual, type: 'break' },
      'editing only the type must preserve both timestamps to the millisecond');
    await page.locator('#records tr').first().getByRole('button', { name: '编辑' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#delete-record').click();
    await page.waitForFunction(() => !document.getElementById('record-dialog').open);
    await waitFor(() => readDay(date), (day) => !day.records.some((record) => record.id === manual.id), { description: 'calendar deletion' });

    await page.locator('#template').selectOption('off');
    await waitState((state) => state.todayTemplate === 'off', 'template selection');
    // An invalid external edit is reported, not silently substituted or written back over the file.
    fs.writeFileSync(schedulePath, '{"templates":{}}');
    await page.locator('#reload-schedule').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#error').innerText(), /templates/);
    const unchanged = await page.evaluate(() => window.activity.bootstrap());
    assert.equal(unchanged.todayTemplate, 'off');
    assert.equal(unchanged.failure, '');
    assert.equal(unchanged.suspended, false);
    assert.equal(fs.readFileSync(schedulePath, 'utf8'), '{"templates":{}}');
    fs.writeFileSync(schedulePath, scheduleJSON);
    await page.locator('#reload-schedule').click();
    await page.locator('#error').waitFor({ state: 'hidden' });

    await application.close(); application = null;
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'activity-records.json'), 'utf8'));
    assert.deepEqual(records, actual, 'editing and deleting history must not rewrite automatically recorded intervals');
    assert.equal(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'), 'legacy-data-must-stay-untouched');
    await launch();
    const restarted = await waitState((state) => state.todayTemplate === 'off', 'persisted template after restart');
    assert.equal(restarted.phase, 'waiting');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'activity-records.json'), 'utf8')), records);
    assert.deepEqual(errors, []);
    console.log('PASS: Electron startup, continuous focus, reminder snooze, rest overlay, waiting, precise calendar CRUD, safe JSON reload, template selection, restart persistence, and legacy isolation');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(results, 'failure.png'), fullPage: true }).catch(() => {});
      const state = await page.evaluate(() => window.activity?.bootstrap()).catch(() => null);
      fs.writeFileSync(path.join(results, 'failure-state.json'), JSON.stringify({ state, errors }, null, 2));
    }
    throw error;
  } finally {
    if (application) await application.close();
    fs.writeFileSync(path.join(results, 'electron.log'), logs.join(''));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
