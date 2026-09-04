'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeTheme,
  ipcMain,
  screen,
  powerMonitor,
} = require('electron');
const path = require('path');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { PomodoroTimer, DEFAULT_CONFIG } = require('./timer-core');
const { Store } = require('./store');
const {
  DEFAULT_SCHEDULE,
  sanitizeSchedule,
  isWorkTime,
  currentBlock,
  currentBlockEnd,
  nextStartToday,
} = require('./schedule');

// 窗口提前预建的提前量：Windows 上新建 renderer 进程要数秒（进程冷启动 + Defender 扫描），
// 到点现建会黑屏卡住整块屏幕。只提前这么点是有意的 —— 工作全程挂着隐藏窗口会被系统换页出去，
// 到点还得换回来，等于白预建。番茄末段一并把「该休息了」小窗和遮罩都建好：
// 小窗到点即现身，遮罩则一路隐藏着等人点「去休息」。
const PREBUILD_MS = 30 * 1000;

// 「暂时让开」：休息中点一下，遮罩整体收起这么久，够去开个音乐 / 回条消息，到点自动盖回来。
// 不限次数、不补时长 —— 遮罩上本就摆着更省事的「跳过休息」，让开的摩擦反而更大，
// 没人会拿它绕过休息；花掉的是休息时间本身，倒计时照常走。
const AWAY_MS = 30 * 1000;

const DEFAULT_SETTINGS = {
  ...DEFAULT_CONFIG,
  soundOn: true,
  soundVolume: 0.6,
  theme: 'system', // system | dark | light
  autoStart: true,
  schedule: DEFAULT_SCHEDULE, // 工作时段模式（工作场景定制）
};

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const store = new Store(app.getPath('userData'));
  // 时长等字段沿用「读取宽容」策略（冒烟测试依赖小数加速时长），
  // 仅 schedule 启动即归一化：老版本升级缺字段或手改损坏时回到安全结构
  let settings = store.loadSettings(DEFAULT_SETTINGS);
  settings.schedule = sanitizeSchedule(settings.schedule);

  // 循环计数按天恢复：跨天则清零
  const runtime = store.loadRuntime();
  const timer = new PomodoroTimer({
    config: configForNow(),
    cycleCount: runtime.date === localDate() ? runtime.cycleCount || 0 : 0,
  });
  // 规划流转：pendingPlan 是「下一步规划」（休息时写下，重启保留），
  // 任何入口开始番茄时被消费为该番茄的 currentPlan，随完成/放弃写入历史
  let currentPlan = '';
  let pendingPlan = typeof runtime.pendingPlan === 'string' ? runtime.pendingPlan : '';

  let mainWindow = null;
  let tray = null;
  let overlays = [];
  let dueWindow = null; // 「该休息了」小窗（右下角挂件）
  let dueReveal = null; // 小窗的 showInactive()；非 null 即表示 ready-to-show 已触发
  let dueShown = false; // 小窗已显示；预建完成但番茄还没到点时为 false
  let overlaysShown = false; // 遮罩已显示；预建完成但未到点时为 false
  const overlayReveal = new Map(); // win → reveal()；有 key 即表示该窗口 ready-to-show 已触发
  let pendingBreakCue = false; // 番茄已到点但小窗还没就绪，铃声待补发
  let awayUntil = 0; // 「暂时让开」的到期时刻（0 = 不在让开中）；期间遮罩全部收起
  let quitting = false;
  let lastCompletedId = null;
  let lastTrayMenuKey = '';
  let wasInWork = null; // 上一 tick 是否处于工作时段（null = 尚未采样，避免启动瞬间误触发）
  // dev(未打包)| idle | checking | none(已最新)| downloading | ready | error
  let updateInfo = { status: app.isPackaged ? 'idle' : 'dev', version: '' };

  // ---------- 计时事件 → 历史记录 ----------
  timer.on('work-completed', ({ startedAt, endedAt }) => {
    lastCompletedId = crypto.randomUUID();
    store.appendRecord({
      id: lastCompletedId,
      startedAt,
      endedAt,
      status: 'completed',
      plan: currentPlan,
      note: '',
    });
    saveRuntime();
    notifyHistoryChanged();
  });
  timer.on('work-abandoned', ({ startedAt, endedAt }) => {
    store.appendRecord({
      id: crypto.randomUUID(),
      startedAt,
      endedAt,
      status: 'abandoned',
      plan: currentPlan,
      note: '',
    });
    saveRuntime();
    notifyHistoryChanged();
  });
  // 「该休息了」的铃声：窗口都是提前预建的，renderer 不能靠 bootstrap 时的 phase 判断
  // （那时还是 work），改由主进程在番茄到点时下发
  timer.on('break-due', () => {
    pendingBreakCue = true;
    flushBreakCue();
  });
  timer.on('break-over', () => {
    saveRuntime();
    sendAll('cue', { type: 'break-over' });
  });
  // 自动收摊：窗口会跟着状态一起消失，不吭声的话人回来只会以为程序崩了
  timer.on('auto-ended', ({ workedMs, inWork }) => {
    saveRuntime();
    notifyAutoEnded(workedMs, inWork);
  });

  // ---------- IPC ----------
  ipcMain.handle('bootstrap', () => ({
    state: fullState(),
    settings,
    dark: nativeTheme.shouldUseDarkColors,
    version: app.getVersion(),
    update: updateInfo,
    awayMs: AWAY_MS,
  }));

  // 新番茄的规划：主窗口传入输入框文本（可为空），其余入口（托盘/遮罩/自动开始）带入 pendingPlan
  function consumePlan(explicit) {
    currentPlan = (typeof explicit === 'string' ? explicit : pendingPlan).trim().slice(0, 500);
    pendingPlan = '';
  }

  // 当下开始一个番茄该用的节奏：时段内用该段参数，段外/模式关闭用全局「时长」设置。
  // 番茄开始时快照，进行中不再改（拖堂跨出时段也保持原节奏）。
  function configForNow() {
    const sch = settings.schedule;
    if (sch.enabled) {
      const b = currentBlock(sch.blocks, new Date());
      if (b) {
        return {
          workMin: b.workMin,
          shortMin: b.shortMin,
          longMin: b.longMin,
          longEvery: b.longEvery,
          // 健康上限和自动收摊是身体的事，不随时段变
          healthMaxMin: settings.healthMaxMin,
          autoEndMin: settings.autoEndMin,
        };
      }
    }
    return pickTimerConfig(settings);
  }

  const commands = {
    start: (arg) => {
      if (timer.phase === 'idle' || timer.phase === 'breakOver') timer.setConfig(configForNow());
      const ok = timer.startWork();
      if (ok) consumePlan(arg);
      return ok;
    },
    pause: () => timer.pause(),
    resume: () => timer.resume(),
    abandon: () => timer.abandon(),
    // 「该休息了」→ 真正进入休息（休息时长按实际工作时长在状态机里算好）
    startBreak: () => timer.startBreak(),
    skipBreak: () => {
      if (timer.phase === 'break' || timer.phase === 'breakDue') timer.setConfig(configForNow());
      const ok = timer.skipBreak();
      if (ok) consumePlan();
      return ok;
    },
    endFocus: () => timer.endFocus(),
    // 只动遮罩、不动计时的窗口命令
    away: () => startAway(),
    endAway: () => endAway(),
  };
  ipcMain.handle('cmd', (_e, name, arg) => {
    const fn = commands[name];
    if (!fn) return false;
    const ok = fn(arg);
    saveRuntime();
    broadcast();
    return ok;
  });

  ipcMain.handle('get-history', () => store.loadHistory());

  ipcMain.handle('save-settings', (_e, patch) => {
    settings = sanitizeSettings({ ...settings, ...patch });
    store.saveSettings(settings);
    // 节奏参数在番茄开始时快照：进行中不打扰，空闲/等待开始时立即生效
    if (timer.phase === 'idle' || timer.phase === 'breakOver') timer.setConfig(configForNow());
    nativeTheme.themeSource = settings.theme;
    applyAutoStart();
    broadcast();
    return settings;
  });

  // 复盘 note 挂到刚完成的番茄；下一步规划 next 存入 pendingPlan（可清空）
  ipcMain.handle('save-review', (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const note = typeof p.note === 'string' ? p.note.trim().slice(0, 500) : '';
    const next = typeof p.next === 'string' ? p.next.trim().slice(0, 500) : '';
    let ok = false;
    if (note && lastCompletedId) {
      ok = store.updateRecord(lastCompletedId, { note });
      if (ok) notifyHistoryChanged();
    }
    pendingPlan = next;
    saveRuntime();
    broadcast();
    return ok || !!next;
  });

  ipcMain.handle('check-update', () => {
    checkForUpdates();
    return updateInfo;
  });

  ipcMain.handle('install-update', () => {
    if (updateInfo.status !== 'ready') return false;
    // 静默安装并重启；before-quit 会置 quitting，绕过关闭即隐藏的拦截
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });

  // ---------- 生命周期 ----------
  app.on('second-instance', showMainWindow);
  app.on('window-all-closed', () => {
    /* 常驻托盘，不退出 */
  });
  app.on('before-quit', () => {
    quitting = true;
    closeOverlays();
    closeDueWindow();
  });

  app.whenReady().then(() => {
    // Windows 系统通知的归属标识（与 electron-builder 的 appId 一致）
    app.setAppUserModelId('com.ghm.pomodoro-timer');
    nativeTheme.themeSource = settings.theme;
    applyAutoStart();
    createTray();
    createMainWindow(!process.argv.includes('--hidden'));
    setupUpdater();

    const tickAll = () => {
      timer.tick();
      applySchedule();
      // 空闲/等待开始时跟随当前时段的节奏（表盘时长预览与下次开始都用它）
      if (timer.phase === 'idle' || timer.phase === 'breakOver') timer.setConfig(configForNow());
      broadcast();
    };
    setInterval(tickAll, 500);
    powerMonitor.on('resume', tickAll);
    nativeTheme.on('updated', () => {
      sendAll('theme', { dark: nativeTheme.shouldUseDarkColors });
      updateTitleBar();
    });
    screen.on('display-added', refreshWindows);
    screen.on('display-removed', refreshWindows);
  });

  // ---------- 自动更新 ----------
  // 检查/下载全程静默；下载完成后只在设置页和托盘露出「重启并更新」，
  // 不弹窗打断计时。用户从托盘退出时也会顺手装上（autoInstallOnAppQuit）。
  function setupUpdater() {
    if (!app.isPackaged) return; // 开发模式没有 app-update.yml，跳过
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => setUpdateStatus('checking'));
    autoUpdater.on('update-available', (info) => setUpdateStatus('downloading', info.version));
    autoUpdater.on('update-not-available', () => setUpdateStatus('none'));
    autoUpdater.on('update-downloaded', (info) => setUpdateStatus('ready', info.version));
    autoUpdater.on('error', (err) => {
      // 网络不通/GitHub 访问失败是常态，静默降级，下个周期再试
      console.error('检查更新失败:', err?.message || err);
      if (updateInfo.status !== 'ready') setUpdateStatus('error');
    });
    setTimeout(checkForUpdates, 10 * 1000); // 避开启动高峰
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
  }

  function checkForUpdates() {
    if (!app.isPackaged) return;
    if (updateInfo.status === 'downloading' || updateInfo.status === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => {});
  }

  function setUpdateStatus(status, version) {
    updateInfo = { status, version: version || updateInfo.version };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', updateInfo);
    }
    updateTray(timer.getState());
  }

  // ---------- 窗口 ----------
  // 标题栏融入应用主题：隐藏系统标题栏，保留原生窗口按钮（仅 Windows）
  function titleBarColors() {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      color: dark ? '#141210' : '#fafaf7',
      symbolColor: dark ? '#efebe3' : '#201e1b',
      height: 40,
    };
  }

  function createMainWindow(show) {
    mainWindow = new BrowserWindow({
      width: 440,
      height: 660,
      minWidth: 400,
      minHeight: 560,
      show,
      icon: assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      autoHideMenuBar: true,
      ...(process.platform === 'win32' && {
        titleBarStyle: 'hidden',
        titleBarOverlay: titleBarColors(),
      }),
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

  // 不用 fullscreen:true —— Windows 只为「前台」全屏窗口隐藏任务栏，
  // 通知/输入法等抢走前台的瞬间任务栏会浮回遮罩之上（底部露一条）；
  // 改为铺满屏幕 bounds 的置顶无边框窗口，并周期重申 z-order（见 assertOverlaysOnTop）
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
        thickFrame: false, // 去掉 Windows DWM 给无边框窗口画的 1px 顶部白线（顺带去阴影/动画）
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: primary,
        show: false,
        backgroundColor: '#141210',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.removeMenu();
      win.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
        query: { mode: primary ? 'primary' : 'secondary' },
      });

      // fresh = 全新一次休息展示（复盘表单要清空）；从「暂时让开」盖回来时为 false
      const reveal = (fresh) => {
        if (win.isDestroyed()) return;
        win.webContents.send('state', fullState()); // 预建期间页面停在占位内容，先喂真实状态
        win.show();
        win.setBounds(display.bounds); // 混合 DPI 下再钉一次，防缩放舍入差一条
        if (primary) win.focus();
        win.webContents.send('cue', { type: fresh ? 'shown' : 'back' });
      };
      win.once('ready-to-show', () => {
        overlayReveal.set(win, reveal);
        // 到点时预建还没完成：宁可遮罩晚半秒弹出，也不要拿纯色板黑屏占住整块屏幕
        if (overlaysShown) reveal(true);
      });
      overlays.push(win);
    }
  }

  // 任务栏也是置顶窗口，和遮罩在同一层竞争 z-order（谁后浮谁在上）。
  // 遮罩存在期间每次广播重申一次置顶，被顶掉最多半秒内自愈。不动焦点，不影响输入。
  function assertOverlaysOnTop() {
    if (!overlaysShown) return; // 预建期间窗口是隐藏的，不参与 z-order 竞争
    for (const w of overlays) {
      if (!w.isDestroyed()) {
        w.setAlwaysOnTop(true, 'screen-saver');
        w.moveTop();
      }
    }
  }

  // 每次广播都会走到这里：让开未到期就原样挡住，到期（或被「立即回到休息」提前置为到期）
  // 才恢复显示，且带 fresh=false —— 同一次休息的复盘内容不能被清掉
  function showOverlays() {
    if (awayUntil > Date.now()) return;
    const backFromAway = awayUntil > 0;
    awayUntil = 0;
    if (overlaysShown) return;
    overlaysShown = true;
    for (const win of overlays) {
      const reveal = overlayReveal.get(win);
      if (reveal) reveal(!backFromAway); // 尚未就绪的窗口由它自己的 ready-to-show 接手
    }
  }

  // 休息中「暂时让开」：遮罩全部收起，AWAY_MS 后由下一次广播自动盖回
  function startAway() {
    if (!overlaysShown) return false;
    awayUntil = Date.now() + AWAY_MS;
    hideOverlays();
    return true;
  }

  // 提前结束让开：置为「刚好到期」，交给广播走和自然到期完全相同的恢复路径
  function endAway() {
    if (awayUntil <= Date.now()) return false;
    awayUntil = Date.now();
    return true;
  }

  const isAway = () => awayUntil > Date.now();

  // 「暂时让开」用：遮罩收起但窗口留着，之后再 show，省掉第二次冷启动
  function hideOverlays() {
    overlaysShown = false;
    for (const w of overlays) if (!w.isDestroyed()) w.hide();
  }

  function closeOverlays() {
    for (const w of overlays) if (!w.isDestroyed()) w.destroy();
    overlays = [];
    overlayReveal.clear();
    overlaysShown = false;
  }

  // 铃声得有个加载完的 renderer 才播得出，而「该休息了」这一声归小窗播。
  // 预建正常时它早就绪，直接就发；没赶上就等它 ready-to-show 时补发。
  function flushBreakCue() {
    if (!pendingBreakCue) return;
    if (!dueReveal) return;
    pendingBreakCue = false;
    sendAll('cue', { type: 'break-due' });
  }

  function refreshWindows() {
    const state = timer.getState();
    if (overlays.length) {
      closeOverlays();
      ensureOverlays(state);
    }
    if (dueWindow) {
      closeDueWindow(); // 右下角是按 workArea 算的，显示器一变就得重算
      ensureDueWindow(state);
    }
  }

  // 遮罩窗口与状态对账（三态）：
  //   休息 / 等待开始      → 窗口存在且显示
  //   工作末段 / 该休息了  → 窗口存在但隐藏（预建）
  //   其余                 → 关闭
  // breakDue 全程保持预建：那声「去休息」是点了就要盖上的，没有提前量可用。
  // 代价是人一直拖着不休息时，隐藏窗口可能被系统换页出去 —— 顶多慢半拍，比黑屏强。
  function ensureOverlays(state) {
    const show = state.phase === 'break' || state.phase === 'breakOver';
    if (!show) awayUntil = 0; // 跳过休息 / 结束专注：让开随休息一起作废
    const prebuild =
      state.phase === 'breakDue' ||
      (state.phase === 'work' && !state.paused && state.remainingMs <= PREBUILD_MS);

    if (!show && !prebuild) {
      if (overlays.length > 0) closeOverlays();
      return;
    }
    if (overlays.length === 0) createOverlays();
    if (show) showOverlays();
    else if (overlaysShown) hideOverlays();
  }

  // ---------- 「该休息了」小窗 ----------
  // 番茄到点不再直接盖遮罩：右下角挂个不抢焦点的小挂件说一声「该休息了」，
  // 点了才进休息。人正打字打到一半时，糊脸的全屏遮罩只会招人烦，反而被跳过。
  //
  // 与遮罩同样的三态对账，预建时机也一样（番茄末段 PREBUILD_MS）。
  function ensureDueWindow(state) {
    const show = state.phase === 'breakDue';
    const prebuild = state.phase === 'work' && !state.paused && state.remainingMs <= PREBUILD_MS;

    if (!show && !prebuild) {
      closeDueWindow();
      return;
    }
    if (!dueWindow) createDueWindow();
    if (show) showDueWindow();
    else if (dueShown) hideDueWindow();
  }

  function showDueWindow() {
    if (dueShown) return;
    dueShown = true;
    if (dueReveal) dueReveal(); // 还没就绪的窗口由它自己的 ready-to-show 接手
  }

  function hideDueWindow() {
    dueShown = false;
    if (dueWindow && !dueWindow.isDestroyed()) dueWindow.hide();
  }

  function createDueWindow() {
    const wa = screen.getPrimaryDisplay().workArea; // 用 workArea 而非 bounds：贴右下角但不压任务栏
    const width = 268;
    const height = 62;
    const margin = 16;
    const win = new BrowserWindow({
      x: wa.x + wa.width - width - margin,
      y: wa.y + wa.height - height - margin,
      width,
      height,
      frame: false,
      thickFrame: false, // 同遮罩：去掉 DWM 给无边框窗口画的 1px 白线
      alwaysOnTop: true, // 默认 floating 层即可，不用遮罩那种 screen-saver 级别
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      backgroundColor: '#141210',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    dueWindow = win;
    win.removeMenu();
    win.loadFile(path.join(__dirname, '../renderer/due.html'));

    const reveal = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('state', fullState()); // 预建期间页面停在预填值，先喂真实状态
      win.showInactive(); // 不抢焦点：人正打着字，光标不能被挂件夺走
    };
    win.once('ready-to-show', () => {
      dueReveal = reveal;
      // 预建没赶上（番茄短到还没建完就到点）：就绪即显示
      if (dueShown) reveal();
      flushBreakCue(); // 铃声归这个窗口播，就绪后补上
    });
  }

  function closeDueWindow() {
    if (dueWindow && !dueWindow.isDestroyed()) dueWindow.destroy();
    dueWindow = null;
    dueReveal = null;
    dueShown = false;
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
    const updateReady = updateInfo.status === 'ready';
    const away = isAway();
    const key = `${state.phase}:${state.paused}:${state.overwork}:${updateReady}:${state.schedule?.nextStart}:${away}`;
    if (key === lastTrayMenuKey) return;
    lastTrayMenuKey = key;

    const items = [{ label: trayStatusLabel(state), enabled: false }, { type: 'separator' }];
    if (away) items.push({ label: '立即回到休息', click: () => runCmd('endAway') });
    if (state.phase === 'idle' || state.phase === 'breakOver') {
      items.push({ label: '开始番茄', click: () => runCmd('start') });
    } else if (state.phase === 'work') {
      items.push(
        state.paused
          ? { label: '继续', click: () => runCmd('resume') }
          : { label: '暂停', click: () => runCmd('pause') }
      );
      items.push({ label: '放弃本番茄', click: () => runCmd('abandon') });
    } else if (state.phase === 'breakDue') {
      items.push({ label: '去休息', click: () => runCmd('startBreak') });
      items.push({ label: '跳过休息', click: () => runCmd('skipBreak') });
    } else if (state.phase === 'break') {
      items.push({ label: '跳过休息', click: () => runCmd('skipBreak') });
    }
    if (state.phase !== 'idle') {
      items.push({ label: '结束专注', click: () => runCmd('endFocus') });
    }
    items.push({ type: 'separator' });
    if (updateReady) {
      items.push({
        label: `更新到 v${updateInfo.version}（重启生效）`,
        click: () => setImmediate(() => autoUpdater.quitAndInstall(true, true)),
      });
    }
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
    if (isAway()) return '暂时让开中';
    switch (state.phase) {
      case 'work':
        return state.paused ? `已暂停 ${fmt(state.remainingMs)}` : `专注中 ${fmt(state.remainingMs)}`;
      case 'breakDue': {
        const warn = state.overwork === 2 ? '（已超健康上限）' : '';
        return `该休息了 · 已连续工作 ${mins(state.workedMs)} 分钟${warn}`;
      }
      case 'break':
        // 休息中一律按分钟报，跳秒的数字在托盘上一样惹眼
        return `${state.breakType === 'long' ? '长休息' : '休息'}中 还剩 ${mins(state.remainingMs)} 分钟`;
      case 'breakOver':
        return '休息结束，等待开始';
      default: {
        const sc = state.schedule;
        if (sc?.enabled && !sc.inWork && sc.nextStart) return `空闲 · ${sc.nextStart} 自动开始`;
        return '空闲';
      }
    }
  }

  function trayTooltip(state) {
    if (isAway()) {
      return `番茄钟 — 暂时让开，${Math.ceil((awayUntil - Date.now()) / 1000)} 秒后回到休息`;
    }
    return state.phase === 'idle' ? '番茄钟' : `番茄钟 — ${trayStatusLabel(state)}`;
  }

  // ---------- 工作时段调度 ----------
  // 时钟跨入某段起点且空闲 → 自动开始番茄；时段外「休息结束」不再等待开始 → 直接收为空闲。
  // 进行中的番茄/休息跨过段终点不打断，自然走完。手动操作不受时段限制。
  function applySchedule() {
    const sch = settings.schedule;
    if (!sch.enabled) {
      wasInWork = null;
      return;
    }
    const inWork = isWorkTime(sch.blocks, new Date());
    if (wasInWork === false && inWork && timer.phase === 'idle') {
      timer.setConfig(configForNow());
      if (timer.startWork()) {
        consumePlan();
        saveRuntime();
      }
    } else if (wasInWork === null && inWork && timer.phase === 'idle') {
      // 启动（或刚打开时段开关）时已在时段内：不悄悄开始番茄，
      // 发系统通知提醒，把「开工」的决定权留给用户
      notifyInWork();
    }
    if (!inWork && timer.phase === 'breakOver') {
      timer.endFocus();
      saveRuntime();
    }
    wasInWork = inWork;
  }

  function notifyInWork() {
    if (!Notification.isSupported()) return;
    const end = currentBlockEnd(settings.schedule.blocks, new Date());
    const n = new Notification({
      title: '现在是工作时段',
      body: `本时段至 ${end} 结束，点击打开番茄钟开始一个番茄`,
      icon: assetPath('icon.png'),
    });
    n.on('click', showMainWindow);
    n.show();
  }

  function notifyAutoEnded(workedMs, inWork) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: '已自动结束专注',
      body: inWork
        ? `连续工作 ${mins(workedMs)} 分钟，本番茄记为放弃。去歇会儿吧`
        : `连续工作 ${mins(workedMs)} 分钟还没去休息，已回到空闲。去歇会儿吧`,
      icon: assetPath('icon.png'),
    });
    n.on('click', showMainWindow);
    n.show();
  }

  // 计时器状态附加工作时段与规划信息，供渲染层与托盘展示
  function fullState() {
    const state = timer.getState();
    state.plan = currentPlan;
    state.pendingPlan = pendingPlan;
    const sch = settings.schedule;
    const now = new Date();
    state.schedule = sch.enabled
      ? {
          enabled: true,
          inWork: isWorkTime(sch.blocks, now),
          blockEnd: currentBlockEnd(sch.blocks, now),
          nextStart: nextStartToday(sch.blocks, now),
        }
      : { enabled: false, inWork: false, blockEnd: null, nextStart: null };
    return state;
  }

  // ---------- 广播 ----------
  function broadcast() {
    const state = fullState();
    ensureOverlays(state);
    ensureDueWindow(state);
    assertOverlaysOnTop();
    sendAll('state', state);
    updateTray(state);
  }

  function sendAll(channel, payload) {
    for (const w of [mainWindow, dueWindow, ...overlays]) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  function notifyHistoryChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('history-changed');
  }

  // ---------- 杂项 ----------
  function saveRuntime() {
    store.saveRuntime({ date: localDate(), cycleCount: timer.cycleCount, pendingPlan });
  }

  function applyAutoStart() {
    if (process.platform !== 'win32') return;
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, args: ['--hidden'] });
  }

  function updateTitleBar() {
    if (process.platform !== 'win32') return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(titleBarColors());
    }
  }

  function pickTimerConfig(s) {
    return {
      workMin: s.workMin,
      shortMin: s.shortMin,
      longMin: s.longMin,
      longEvery: s.longEvery,
      healthMaxMin: s.healthMaxMin,
      autoEndMin: s.autoEndMin,
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
      healthMaxMin: num(s.healthMaxMin, 20, 240, DEFAULT_SETTINGS.healthMaxMin),
      autoEndMin: num(s.autoEndMin, 0, 480, DEFAULT_SETTINGS.autoEndMin),
      soundOn: !!s.soundOn,
      soundVolume: Math.min(1, Math.max(0, Number(s.soundVolume) || 0)),
      theme: ['system', 'dark', 'light'].includes(s.theme) ? s.theme : 'system',
      autoStart: !!s.autoStart,
      schedule: sanitizeSchedule(s.schedule),
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

  // 分钟粒度、向上取整：休息相关的读数一律用它，不给跳秒的数字
  function mins(ms) {
    return Math.max(1, Math.ceil(ms / 60000));
  }

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
