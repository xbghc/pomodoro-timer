'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityStore } = require('../src/main/activity-store');
const { startDesktop } = require('../src/main/activity-desktop');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-desktop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = new Date(2026, 9, 19, 10).getTime();
  const windows = [], handlers = new Map(), notices = [], intervals = new Map();
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' };
      this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn; };
      this.webContents.session = { setPermissionRequestHandler: () => {} };
      this.messages = []; this.webContents.send = (...args) => this.messages.push(args); windows.push(this);
    }
    loadFile(file, options) { this.role = options.query.role; this.webContents.mainFrame.url = pathToFileURL(file).href + '?role=' + this.role; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; this.inactive = true; }
    hide() { this.visible = false; }
    focus() {}
    restore() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  class Tray extends EventEmitter {
    setToolTip() {} setContextMenu(menu) { this.menu = menu; } destroy() {}
  }
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; }
    show() { notices.push(this.options); }
  }
  const app = new EventEmitter(); app.isPackaged = false; app.getPath = () => dir;
  app.getVersion = () => '2.0.0-dev'; app.setLoginItemSettings = () => {}; app.quit = () => app.emit('before-quit');
  const screen = new EventEmitter();
  const displays = [0, 1].map((id) => ({ id, bounds: { x: id * 1000, y: 0, width: 1000, height: 800 }, workArea: { x: id * 1000, y: 0, width: 1000, height: 760 } }));
  screen.getAllDisplays = () => displays; screen.getCursorScreenPoint = () => ({ x: 0, y: 0 }); screen.getDisplayNearestPoint = () => displays[0];
  const powerMonitor = new EventEmitter(), nativeTheme = new EventEmitter(); nativeTheme.shouldUseDarkColors = false;
  const electron = { app, screen, powerMonitor, nativeTheme, BrowserWindow: Window, Tray, Notification,
    Menu: { buildFromTemplate: (template) => template }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    shell: { openPath: async () => '' }, dialog: { showErrorBox: () => {} } };
  const timers = { setInterval: (fn) => { const id = Symbol(); intervals.set(id, fn); return id; }, clearInterval: (id) => intervals.delete(id) };
  const desktop = startDesktop(electron, { store: new ActivityStore(dir), now: () => time, timers });
  const main = windows.find((win) => win.role === 'main'); main.emit('ready-to-show');
  async function request(operation, args = [], win = main, frame = win.webContents.mainFrame) {
    return handlers.get('activity:request')({ sender: win.webContents, senderFrame: frame }, operation, ...args);
  }
  function advance(ms) {
    const target = time + ms;
    while (time < target) { time = Math.min(time + 30_000, target); for (const fn of intervals.values()) fn(); }
  }
  return { desktop, request, advance, main, windows, notices, electron, intervals };
}
test('desktop starts the schedule, shows main only after ready, and uses sandboxed IPC', async (t) => {
  const f = fixture(t); assert.equal(f.desktop.service.state().phase, 'work'); assert.equal(f.main.visible, true);
  assert.deepEqual(f.main.openHandler(), { action: 'deny' });
  assert.equal(f.main.options.webPreferences.sandbox, true); assert.equal(f.main.options.webPreferences.nodeIntegration, false);
  assert.equal((await f.request('bootstrap')).ok, true);
  assert.equal((await f.request('bootstrap', [], f.main, { url: f.main.webContents.mainFrame.url })).ok, false);
});
test('reminder window does not steal focus and closing it snoozes rather than stops', async (t) => {
  const f = fixture(t); f.advance(50 * 60_000);
  const due = f.windows.find((win) => win.role === 'due'); assert.ok(due); assert.equal(due.visible, false);
  due.emit('ready-to-show'); assert.equal(due.inactive, true);
  assert.equal((await f.request('day', ['2026-10-19'], due)).ok, false);
  let prevented = false; due.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.desktop.service.state().phase, 'work');
  assert.equal(f.desktop.service.state().reminderDue, false); assert.equal(due.destroyed, true);
});
test('break covers each display; away keeps counting and break completion leaves waiting', async (t) => {
  const f = fixture(t); f.advance(60_000);
  assert.equal((await f.request('command', ['startBreak', 2])).ok, true);
  const overlays = f.windows.filter((win) => win.role === 'break'); assert.equal(overlays.length, 2);
  overlays.forEach((win) => win.emit('ready-to-show')); assert.ok(overlays.every((win) => win.visible));
  await f.request('command', ['away'], overlays[0]); assert.ok(overlays.every((win) => !win.visible));
  f.advance(30_000); assert.ok(overlays.every((win) => win.visible));
  f.advance(90_000); assert.equal(f.desktop.service.state().phase, 'waiting'); assert.ok(overlays.every((win) => win.destroyed));
  assert.ok(f.notices.some((notice) => notice.title === '休息结束'));
});
test('main close hides the window but quitting closes and persists the activity', (t) => {
  const f = fixture(t); f.advance(60_000); let prevented = false;
  f.main.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.main.visible, false); assert.equal(f.desktop.service.state().phase, 'work');
  f.electron.app.emit('before-quit'); assert.equal(f.intervals.size, 0); assert.equal(f.main.destroyed, true);
  assert.equal(f.desktop.service.store.records().length, 1);
});
test('power callbacks close the active interval and resume from current time', (t) => {
  const f = fixture(t); f.advance(60_000); f.electron.powerMonitor.emit('suspend'); f.advance(5 * 60_000);
  assert.equal(f.desktop.service.state().phase, 'waiting'); assert.equal(f.desktop.service.store.records()[0].endedAt - f.desktop.service.store.records()[0].startedAt, 60_000);
  f.electron.powerMonitor.emit('resume'); assert.equal(f.desktop.service.state().phase, 'work'); assert.equal(f.desktop.service.state().elapsedMs, 0);
});
