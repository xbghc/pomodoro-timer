'use strict';
// Real Electron + preload + renderer + disk storage. Uses an isolated temporary data directory.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-smoke-'));
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });
fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify({ defaultTemplate: 'always', templates: { always: [{ start: '00:00', end: '23:59' }], off: [] } }));
fs.writeFileSync(path.join(dir, 'history.json'), 'legacy-data-must-stay-untouched');
let application;
(async () => {
  try {
    application = await electron.launch({ args: [root], env: { ...process.env, POMODORO_DATA_DIR: dir }, timeout: 60_000 });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.activity && !document.getElementById('main').hidden);
    await page.evaluate(() => window.activity.command('startWork'));
    const before = await page.evaluate(() => window.activity.bootstrap());
    await page.locator('#focus-hour').click();
    const focused = await page.evaluate(() => window.activity.bootstrap());
    assert.equal(focused.id, before.id);
    assert.ok(Math.abs(focused.reminderAt - focused.now - 60 * 60_000) < 2000);
    await page.locator('#break-twenty').click();
    await page.waitForFunction(async () => (await window.activity.bootstrap()).phase === 'break');
    await page.waitForTimeout(500);
    assert.ok(application.windows().length >= 2, 'a real break overlay should exist');
    // Shorten an already-created break so the test does not depend on cold renderer startup speed.
    await page.evaluate(() => window.activity.command('startBreak', 0.05));
    await page.waitForFunction(async () => (await window.activity.bootstrap()).phase === 'waiting', { timeout: 15_000 });
    await page.waitForTimeout(600);
    assert.equal((await page.evaluate(() => window.activity.bootstrap())).phase, 'waiting');
    await page.locator('#add-record').click();
    const inputs = await page.evaluate(() => ({ start: window.ActivityView.localInput(Date.now() - 2 * 3600_000), end: window.ActivityView.localInput(Date.now() - 3600_000) }));
    await page.locator('#record-form [name=startedAt]').fill(inputs.start);
    await page.locator('#record-form [name=endedAt]').fill(inputs.end);
    await page.locator('#record-form button[type=submit]').click();
    await page.waitForFunction(() => !document.getElementById('record-dialog').open);
    const saved = await page.evaluate(async () => { const state = await window.activity.bootstrap(); return window.activity.day(state.today); });
    assert.ok(saved.records.some((record) => record.type === 'break'));
    await page.screenshot({ path: path.join(results, 'activity-main.png'), fullPage: true });
    await page.locator('#template').selectOption('off');
    await page.waitForFunction(async () => (await window.activity.bootstrap()).todayTemplate === 'off');
    assert.equal(errors.length, 0, errors.join('\n'));
    await application.close(); application = null;
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'activity-records.json'), 'utf8'));
    assert.equal(records.length, 3, 'work, rest, and manually entered record are persisted');
    assert.equal(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'), 'legacy-data-must-stay-untouched');
    console.log('PASS: real Electron startup, preload IPC, continuous focus, break overlay, waiting, calendar CRUD, template selection, persistence, and legacy isolation');
  } finally {
    if (application) await application.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
