'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ActivityStore } = require('./activity-store');
const { ActivityService } = require('./activity-service');

function startDesktop(electron, { store, now = Date.now, timers = globalThis, updater = null, followDesktop = () => {} } = {}) {
  const { app, BrowserWindow, Tray, Menu, Notification, nativeTheme, ipcMain, screen, powerMonitor, shell, dialog } = electron;
  const service = new ActivityService({ store: store || new ActivityStore(app.getPath('userData')), now });
  const html = path.join(__dirname, '../renderer/activity.html');
  const htmlURL = pathToFileURL(html).href;
  const windows = new Map(), ready = new Set(), overlays = new Map();
  let quitting = false, mainWindow, dueWindow, awayUntil = 0, lastTrayKey = '', failure = '';
  let update = { status: app.isPackaged ? 'idle' : 'dev', version: '' };
  let mainRequested = !process.argv.includes('--hidden');
  const tray = new Tray(path.join(__dirname, '../../assets/tray.png'));
  const alive = (win) => win && !win.isDestroyed();
  const state = () => ({ ...service.state(), dark: nativeTheme.shouldUseDarkColors,
    version: app.getVersion(), update, failure, awayUntil });
  const notify = (title, body) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: !service.preferences.soundOn });
    notification.on('click', showMain);
    notification.show();
  };
  function showMain() {
    mainRequested = true;
    if (alive(mainWindow) && ready.has(mainWindow)) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); mainWindow.focus();
    }
  }
  function makeWindow(role, options) {
    const win = new BrowserWindow({ show: false, backgroundColor: '#15181c', autoHideMenuBar: true,
      ...options, webPreferences: { preload: path.join(__dirname, 'activity-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    windows.set(win, role);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.once('ready-to-show', () => { ready.add(win); if (role === 'main' && mainRequested) showMain(); syncWindows(); });
    win.on('closed', () => { windows.delete(win); ready.delete(win); });
    win.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      if (role === 'main') { mainRequested = false; win.hide(); }
      else if (role === 'due') safely(() => service.command('skipReminder'));
      else { awayUntil = now() + 30_000; syncWindows(); }
    });
    win.on('session-end', () => safely(() => service.suspend()));
    win.loadFile(html, { query: { role } }).catch((error) => report(error));
    return win;
  }
  function destroy(win) { if (alive(win)) win.destroy(); }
  function syncWindows() {
    if (quitting) return;
    const s = service.state();
    if (s.phase === 'work' && s.reminderDue && !service.suspended) {
      if (!alive(dueWindow)) {
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        dueWindow = makeWindow('due', { width: 390, height: 280, x: area.x + area.width - 406, y: area.y + area.height - 296,
          frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true });
        dueWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      if (ready.has(dueWindow)) { followDesktop(dueWindow); if (!dueWindow.isVisible()) dueWindow.showInactive(); }
    } else { destroy(dueWindow); dueWindow = null; }
    if (s.phase === 'break' && !service.suspended) {
      for (const display of screen.getAllDisplays()) {
        if (!overlays.has(display.id)) {
          const win = makeWindow('break', { ...display.bounds, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true });
          win.setAlwaysOnTop(true, 'screen-saver');
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          overlays.set(display.id, win);
        }
      }
      for (const win of overlays.values()) {
        if (awayUntil > now()) win.hide();
        else if (ready.has(win)) { followDesktop(win); if (!win.isVisible()) win.showInactive(); }
      }
    } else {
      for (const win of overlays.values()) destroy(win);
      overlays.clear(); awayUntil = 0;
    }
  }
  function broadcast() {
    syncWindows();
    const s = state();
    for (const win of windows.keys()) if (ready.has(win)) win.webContents.send('activity:state', s);
    tray.setToolTip(`番茄钟 · ${{ work: '工作中', break: '休息中', waiting: '等待' }[s.phase]}`);
    const key = [s.phase, s.reminderDue, update.status].join(':');
    if (key !== lastTrayKey) {
      lastTrayKey = key;
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开番茄钟', click: showMain },
        { label: '开始工作', click: () => safely(() => service.command('startWork')) },
        { label: '开始休息', click: () => safely(() => service.command('startBreak')) },
        { label: '一小时后再提醒', enabled: s.phase === 'work', click: () => safely(() => service.command('skipReminder')) },
        { label: '结束当前活动', enabled: s.phase !== 'waiting', click: () => safely(() => service.command('stop')) },
        { type: 'separator' },
        { label: '重启并更新', enabled: update.status === 'ready', click: installUpdate },
        { label: '退出', click: () => app.quit() },
      ]));
    }
  }
  function report(error) {
    failure = error.message || String(error);
    console.error(error);
    // Stop scheduling after a persistence failure rather than silently lose recorded time.
    service.suspended = true;
    notify('番茄钟已暂停', failure);
    broadcast();
  }
  function safely(fn) { try { fn(); broadcast(); } catch (error) { report(error); } }
  function applyPreferences() {
    nativeTheme.themeSource = service.preferences.theme;
    if (process.platform === 'win32' || process.platform === 'darwin') app.setLoginItemSettings({
      openAtLogin: service.preferences.autoStart, path: process.execPath, args: ['--hidden'],
    });
  }
  async function checkUpdate() {
    if (!updater || !app.isPackaged || ['checking', 'downloading', 'ready'].includes(update.status)) return update;
    try { await updater.checkForUpdates(); } catch (error) { update = { ...update, status: 'error' }; }
    return update;
  }
  function installUpdate() {
    if (update.status !== 'ready' || !updater) return false;
    service.close(); updater.quitAndInstall(true, true); return true;
  }
  const mainOnly = new Set(['day', 'saveRecord', 'deleteRecord', 'selectTodayTemplate', 'reloadSchedule', 'openSchedule', 'savePreferences', 'checkUpdate', 'installUpdate']);
  ipcMain.handle('activity:request', async (event, operation, ...args) => {
    try {
      const win = [...windows.keys()].find((item) => item.webContents === event.sender);
      const frame = event.senderFrame;
      if (!win || !frame || frame !== event.sender.mainFrame || frame.url.split('?')[0] !== htmlURL) throw new Error('Untrusted IPC sender');
      if (mainOnly.has(operation) && windows.get(win) !== 'main') throw new Error('Operation requires the main window');
      let value;
      switch (operation) {
        case 'bootstrap': value = state(); break;
        case 'command':
          if (args[0] === 'showMain') { showMain(); value = true; }
          else if (args[0] === 'away') { awayUntil = now() + 30_000; value = true; }
          else value = service.command(...args);
          break;
        case 'day': value = service.day(...args); break;
        case 'saveRecord': value = service.saveRecord(...args); break;
        case 'deleteRecord': value = service.deleteRecord(...args); break;
        case 'selectTodayTemplate': value = service.selectTodayTemplate(...args); break;
        case 'reloadSchedule': value = service.reloadSchedule(); break;
        case 'savePreferences': value = service.savePreferences(...args); applyPreferences(); break;
        case 'openSchedule': {
          const error = await shell.openPath(service.store.schedulePath);
          if (error) throw new Error(error);
          value = true; break;
        }
        case 'checkUpdate': value = await checkUpdate(); break;
        case 'installUpdate': value = installUpdate(); break;
        default: throw new Error('Unknown operation');
      }
      broadcast(); return { ok: true, value };
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
  });
  service.on('break-due', () => notify('该休息了', '工作仍在继续记录。可以开始休息，或一小时后再提醒。'));
  service.on('break-over', () => notify('休息结束', '现在处于等待状态。准备好后手动开始工作。'));
  service.on('boundary', () => notify('工作时段结束', '当前活动已结束，等待时间不计入统计。'));
  mainWindow = makeWindow('main', { width: 1100, height: 820, minWidth: 760, minHeight: 600, title: '番茄钟' });
  tray.on('click', showMain);
  app.on('second-instance', showMain); app.on('activate', showMain);
  app.on('window-all-closed', () => {});
  powerMonitor.on('suspend', () => safely(() => service.suspend()));
  powerMonitor.on('resume', () => safely(() => service.resume()));
  powerMonitor.on('shutdown', () => safely(() => service.suspend()));
  nativeTheme.on('updated', broadcast);
  const refreshDisplays = () => { for (const win of overlays.values()) destroy(win); overlays.clear(); destroy(dueWindow); dueWindow = null; broadcast(); };
  screen.on('display-added', refreshDisplays); screen.on('display-removed', refreshDisplays); screen.on('display-metrics-changed', refreshDisplays);
  applyPreferences(); service.tick(); broadcast();
  const heartbeat = timers.setInterval(() => safely(() => service.tick()), 500);
  let updateInterval;
  if (updater && app.isPackaged) {
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
    for (const [event, status] of Object.entries({ 'checking-for-update': 'checking', 'update-available': 'downloading', 'update-not-available': 'none', 'update-downloaded': 'ready', error: 'error' })) {
      updater.on(event, (info) => { update = { status, version: info?.version || update.version }; broadcast(); });
    }
    checkUpdate(); updateInterval = timers.setInterval(checkUpdate, 4 * 60 * 60 * 1000);
  }
  app.on('before-quit', () => {
    quitting = true; timers.clearInterval(heartbeat); if (updateInterval) timers.clearInterval(updateInterval);
    try { service.close(); } catch (error) { dialog.showErrorBox('无法保存活动记录', error.message); }
    for (const win of windows.keys()) destroy(win);
    tray.destroy();
  });
  return { service, state, windows, broadcast };
}
module.exports = { startDesktop };
