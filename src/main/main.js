'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeTheme,
  ipcMain,
  screen,
  powerMonitor,
} = require('electron');
const path = require('path');
const crypto = require('crypto');
const { PomodoroTimer, DEFAULT_CONFIG } = require('./timer-core');
const { Store } = require('./store');

const DEFAULT_SETTINGS = {
  ...DEFAULT_CONFIG,
  soundOn: true,
  soundVolume: 0.6,
  theme: 'system', // system | dark | light
  autoStart: true,
};

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const store = new Store(app.getPath('userData'));
  let settings = store.loadSettings(DEFAULT_SETTINGS);

  // 循环计数按天恢复：跨天则清零
  const runtime = store.loadRuntime();
  const timer = new PomodoroTimer({
    config: pickTimerConfig(settings),
    cycleCount: runtime.date === localDate() ? runtime.cycleCount || 0 : 0,
  });

  let mainWindow = null;
  let tray = null;
  let overlays = [];
  let quitting = false;
  let lastCompletedId = null;
  let lastTrayMenuKey = '';

  // ---------- 计时事件 → 历史记录 ----------
  timer.on('work-completed', ({ startedAt, endedAt }) => {
    lastCompletedId = crypto.randomUUID();
    store.appendRecord({ id: lastCompletedId, startedAt, endedAt, status: 'completed', note: '' });
    saveRuntime();
    notifyHistoryChanged();
  });
  timer.on('work-extended', ({ endedAt }) => {
    if (lastCompletedId) {
      store.updateRecord(lastCompletedId, { endedAt });
      notifyHistoryChanged();
    }
  });
  timer.on('work-abandoned', ({ startedAt, endedAt }) => {
    store.appendRecord({ id: crypto.randomUUID(), startedAt, endedAt, status: 'abandoned', note: '' });
    saveRuntime();
    notifyHistoryChanged();
  });
  timer.on('break-over', () => {
    saveRuntime();
    sendAll('cue', { type: 'break-over' });
  });

  // ---------- IPC ----------
  ipcMain.handle('bootstrap', () => ({
    state: timer.getState(),
    settings,
    dark: nativeTheme.shouldUseDarkColors,
  }));

  const commands = {
    start: () => timer.startWork(),
    pause: () => timer.pause(),
    resume: () => timer.resume(),
    abandon: () => timer.abandon(),
    grace: () => timer.grace(),
    finishGrace: () => timer.finishGrace(),
    skipBreak: () => timer.skipBreak(),
    endFocus: () => timer.endFocus(),
  };
  ipcMain.handle('cmd', (_e, name) => {
    const fn = commands[name];
    if (!fn) return false;
    const ok = fn();
    saveRuntime();
    broadcast();
    return ok;
  });

  ipcMain.handle('get-history', () => store.loadHistory());

  ipcMain.handle('save-settings', (_e, patch) => {
    settings = sanitizeSettings({ ...settings, ...patch });
    store.saveSettings(settings);
    timer.setConfig(pickTimerConfig(settings));
    nativeTheme.themeSource = settings.theme;
    applyAutoStart();
    broadcast();
    return settings;
  });

  ipcMain.handle('save-note', (_e, text) => {
    if (!lastCompletedId || typeof text !== 'string' || !text.trim()) return false;
    const ok = store.updateRecord(lastCompletedId, { note: text.trim().slice(0, 500) });
    if (ok) notifyHistoryChanged();
    return ok;
  });

  // ---------- 生命周期 ----------
  app.on('second-instance', showMainWindow);
  app.on('window-all-closed', () => {
    /* 常驻托盘，不退出 */
  });
  app.on('before-quit', () => {
    quitting = true;
    closeOverlays();
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = settings.theme;
    applyAutoStart();
    createTray();
    createMainWindow(!process.argv.includes('--hidden'));

    setInterval(() => {
      timer.tick();
      broadcast();
    }, 500);
    powerMonitor.on('resume', () => {
      timer.tick();
      broadcast();
    });
    nativeTheme.on('updated', () => sendAll('theme', { dark: nativeTheme.shouldUseDarkColors }));
    screen.on('display-added', refreshOverlays);
    screen.on('display-removed', refreshOverlays);
  });

  // ---------- 窗口 ----------
  function createMainWindow(show) {
    mainWindow = new BrowserWindow({
      width: 440,
      height: 660,
      minWidth: 400,
      minHeight: 560,
      show,
      icon: assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));
    // 关闭 = 退到托盘继续计时
    mainWindow.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  }

  function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow(true);
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  }

  function createOverlays() {
    const primaryId = screen.getPrimaryDisplay().id;
    for (const display of screen.getAllDisplays()) {
      const primary = display.id === primaryId;
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: primary,
        show: false,
        backgroundColor: '#141420',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.removeMenu();
      win.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
        query: { mode: primary ? 'primary' : 'secondary' },
      });
      win.once('ready-to-show', () => {
        win.show();
        if (primary) win.focus();
      });
      overlays.push(win);
    }
  }

  function closeOverlays() {
    for (const w of overlays) if (!w.isDestroyed()) w.destroy();
    overlays = [];
  }

  function refreshOverlays() {
    if (overlays.length) {
      closeOverlays();
      ensureOverlays(timer.getState());
    }
  }

  // 遮罩窗口与状态对账：休息/等待开始 → 存在；其余 → 关闭
  function ensureOverlays(state) {
    const want = state.phase === 'break' || state.phase === 'breakOver';
    if (want && overlays.length === 0) createOverlays();
    else if (!want && overlays.length > 0) closeOverlays();
  }

  // ---------- 托盘 ----------
  function createTray() {
    try {
      tray = new Tray(assetPath(process.platform === 'win32' ? 'icon.ico' : 'tray.png'));
      tray.setToolTip('番茄钟');
      tray.on('click', showMainWindow);
      tray.on('double-click', showMainWindow);
    } catch {
      tray = null; // 无系统托盘的环境（如无桌面的 Linux）下降级运行
    }
  }

  function updateTray(state) {
    if (!tray) return;
    tray.setToolTip(trayTooltip(state));
    const key = `${state.phase}:${state.paused}:${state.graceActive}`;
    if (key === lastTrayMenuKey) return;
    lastTrayMenuKey = key;

    const items = [{ label: trayStatusLabel(state), enabled: false }, { type: 'separator' }];
    if (state.phase === 'idle' || state.phase === 'breakOver') {
      items.push({ label: '开始番茄', click: () => runCmd('start') });
    } else if (state.phase === 'work' && state.graceActive) {
      items.push({ label: '立即去休息', click: () => runCmd('finishGrace') });
    } else if (state.phase === 'work') {
      items.push(
        state.paused
          ? { label: '继续', click: () => runCmd('resume') }
          : { label: '暂停', click: () => runCmd('pause') }
      );
      items.push({ label: '放弃本番茄', click: () => runCmd('abandon') });
    } else if (state.phase === 'break') {
      items.push({ label: '跳过休息', click: () => runCmd('skipBreak') });
    }
    if (state.phase !== 'idle') {
      items.push({ label: '结束专注', click: () => runCmd('endFocus') });
    }
    items.push({ type: 'separator' });
    items.push({ label: '打开主窗口', click: showMainWindow });
    items.push({ label: '退出', click: () => app.quit() });
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  function runCmd(name) {
    commands[name]?.();
    saveRuntime();
    broadcast();
  }

  function trayStatusLabel(state) {
    switch (state.phase) {
      case 'work':
        if (state.graceActive) return `收尾中 ${fmt(state.remainingMs)}`;
        return state.paused ? `已暂停 ${fmt(state.remainingMs)}` : `专注中 ${fmt(state.remainingMs)}`;
      case 'break':
        return `${state.breakType === 'long' ? '长休息' : '休息'}中 ${fmt(state.remainingMs)}`;
      case 'breakOver':
        return '休息结束，等待开始';
      default:
        return '空闲';
    }
  }

  function trayTooltip(state) {
    return state.phase === 'idle' ? '番茄钟' : `番茄钟 — ${trayStatusLabel(state)}`;
  }

  // ---------- 广播 ----------
  function broadcast() {
    const state = timer.getState();
    ensureOverlays(state);
    sendAll('state', state);
    updateTray(state);
  }

  function sendAll(channel, payload) {
    for (const w of [mainWindow, ...overlays]) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  function notifyHistoryChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('history-changed');
  }

  // ---------- 杂项 ----------
  function saveRuntime() {
    store.saveRuntime({ date: localDate(), cycleCount: timer.cycleCount });
  }

  function applyAutoStart() {
    if (process.platform !== 'win32') return;
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, args: ['--hidden'] });
  }

  function pickTimerConfig(s) {
    return {
      workMin: s.workMin,
      shortMin: s.shortMin,
      longMin: s.longMin,
      longEvery: s.longEvery,
      graceMin: s.graceMin,
    };
  }

  function sanitizeSettings(s) {
    const num = (v, min, max, dflt) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
    };
    return {
      workMin: num(s.workMin, 1, 180, DEFAULT_SETTINGS.workMin),
      shortMin: num(s.shortMin, 1, 60, DEFAULT_SETTINGS.shortMin),
      longMin: num(s.longMin, 1, 120, DEFAULT_SETTINGS.longMin),
      longEvery: num(s.longEvery, 0, 12, DEFAULT_SETTINGS.longEvery),
      graceMin: num(s.graceMin, 1, 15, DEFAULT_SETTINGS.graceMin),
      soundOn: !!s.soundOn,
      soundVolume: Math.min(1, Math.max(0, Number(s.soundVolume) || 0)),
      theme: ['system', 'dark', 'light'].includes(s.theme) ? s.theme : 'system',
      autoStart: !!s.autoStart,
    };
  }

  function assetPath(name) {
    return path.join(__dirname, '../../assets', name);
  }

  function fmt(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
