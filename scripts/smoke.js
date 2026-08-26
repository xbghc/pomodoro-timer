// 冒烟测试：xvfb 下启动应用，驱动完整番茄流程并逐步截图
// 用法：xvfb-run -a node scripts/smoke.js [截图输出目录]
'use strict';

const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'smoke-shots');
// dev 模式下 userData = ~/.config/<package.json name>
const USER_DATA = path.join(os.homedir(), '.config', 'pomodoro-timer');

// 加速时钟：工作 5.4s / 休息 5.4s / 收尾 3.6s，每 2 个长休息
const FAST_SETTINGS = {
  workMin: 0.09,
  shortMin: 0.09,
  longMin: 0.12,
  longEvery: 2,
  graceMin: 0.06,
  soundOn: true, // 铃声改由 cue 驱动后需要真的走一遍这条路；无音频设备的异常由探针吞掉
  soundVolume: 0.5,
  theme: 'dark',
  autoStart: false,
  // 关闭工作时段模式：避免真实时刻触发自动开始/自动收工，干扰流程断言
  schedule: { enabled: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 隐藏窗口里 rAF 会被节流，waitForFunction 不可靠；改用 CDP 直通的 evaluate 轮询
async function waitFor(fn, desc, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return;
    await sleep(200);
  }
  throw new Error(`等待超时：${desc}`);
}

// X11 下隐藏窗口的 document.visibilityState 照样报 visible，只能问主进程。
// 按 title 认遮罩：closable/frame 这些窗口属性在 Linux 上没实现，问了也是默认值。
const OVERLAY_TITLE = '休息一下'; // overlay.html 的 <title>
const overlayVisible = () =>
  app.evaluate(
    ({ BrowserWindow }, title) =>
      BrowserWindow.getAllWindows().some((w) => w.getTitle() === title && w.isVisible()),
    OVERLAY_TITLE
  );

// 遮罩改为提前预建后，铃声不再由 bootstrap 时的 phase 决定，而是主进程下发 cue。
// 探针挂在 playChime 上，验证「该休息了」「休息结束」两声都真的响过。
async function installChimeProbe(page) {
  await page.evaluate(() => {
    window.__chimes = [];
    const real = window.playChime;
    window.playChime = (kind, vol) => {
      window.__chimes.push(kind);
      try {
        return real(kind, vol);
      } catch {
        /* xvfb 下没有音频设备，只验证到「铃声被触发」为止 */
      }
    };
  });
}

const chimes = (page) => page.evaluate(() => window.__chimes || []);

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log('✓', msg);
}

let app = null;

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('📸', name);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify(FAST_SETTINGS));

  app = await _electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox', '--disable-gpu'],
  });
  app.process().stdout.on('data', (d) => process.stdout.write(`[electron] ${d}`));
  app.process().stderr.on('data', (d) => process.stderr.write(`[electron] ${d}`));

  const mainWin = await app.firstWindow();
  await mainWin.waitForLoadState('domcontentloaded');
  await mainWin.waitForFunction(() => document.getElementById('clock').textContent.length >= 4);
  await sleep(400);
  await shot(mainWin, '01-main-idle.png');

  // 填写规划并开始番茄 → 专注中（表盘下方显示规划）
  // 此处 window 事件等到的是「预建」的遮罩窗口，不是弹出：加速时长下整个工作段都在预建阈值内
  const overlayP1 = app.waitForEvent('window', { timeout: 30000 });
  await mainWin.fill('#planInput', '实现工作时段调度');
  await mainWin.click('#btnStart');

  const overlay1 = await overlayP1;
  await overlay1.waitForLoadState('domcontentloaded');
  await installChimeProbe(overlay1);
  // 预建的核心约定：窗口已经建好、页面已加载，但还没占住屏幕
  assert(!(await overlayVisible()), '专注中：遮罩窗口已预建但保持隐藏');
  await sleep(1200);
  await shot(mainWin, '02-main-work.png');

  // 到点 → 遮罩显示（同一个预建窗口，不再新建）
  await waitFor(overlayVisible, '遮罩显示');
  await sleep(800);
  await shot(overlay1, '03-overlay-break.png');
  assert((await chimes(overlay1)).includes('work-end'), '进入休息时「该休息了」铃声已响');

  // 收尾推迟：遮罩收起回到工作，但窗口留着复用
  await overlay1.click('#btnGrace');
  await waitFor(async () => !(await overlayVisible()), '遮罩收起');
  assert(!overlay1.isClosed(), '收尾推迟后遮罩窗口被复用而非销毁');
  await shot(mainWin, '04-main-grace.png');

  // 收尾结束 → 同一窗口再次显示（此时不应再有收尾按钮）
  const overlay2 = overlay1;
  await waitFor(overlayVisible, '遮罩再次显示');
  await sleep(800);
  await shot(overlay2, '05-overlay-no-grace.png');
  assert(
    await overlay2.evaluate(() => document.getElementById('btnGrace').hidden),
    '第二次休息不再提供收尾按钮'
  );
  assert(
    await overlay2.evaluate(() => document.getElementById('noteInput').value === ''),
    '窗口复用后复盘表单已重置'
  );

  // 复盘 + 下一步规划（Ctrl+回车保存）
  await overlay2.fill('#noteInput', '完成了番茄钟状态机和单元测试\n补充：修掉了类名冲突的布局问题');
  await overlay2.fill('#nextInput', '给设置页补工作时段的界面');
  await overlay2.press('#nextInput', 'Control+Enter');
  await sleep(400);
  await shot(overlay2, '06-overlay-note-saved.png');

  // 休息结束 → 遮罩停留等手动开始
  await overlay2.waitForSelector('#btnStartNext:not([hidden])', { timeout: 30000 });
  await sleep(400);
  await shot(overlay2, '07-overlay-break-over.png');
  assert((await chimes(overlay2)).includes('break-end'), '休息结束时「休息结束」铃声已响');

  // 手动开始下一个番茄 → 遮罩关闭，「下一步规划」自动带入为本番茄规划
  await overlay2.click('#btnStartNext');
  await sleep(1200);
  await shot(mainWin, '08-main-work2.png');

  // 结束专注（第 2 个番茄记为放弃）→ 历史页应有 1 完成 + 1 放弃
  await mainWin.click('#btnEndFocus');
  await sleep(600);
  await mainWin.click('[data-tab="history"]');
  await sleep(600);
  await shot(mainWin, '09-history.png');

  await mainWin.click('[data-tab="settings"]');
  await sleep(400);
  await shot(mainWin, '10-settings.png');

  // 切浅色主题验证配色变量
  await mainWin.selectOption('#setTheme', 'light');
  await sleep(600);
  await shot(mainWin, '11-settings-light.png');
  await mainWin.click('[data-tab="history"]');
  await sleep(400);
  await shot(mainWin, '12-history-light.png');

  await app.close();
  console.log('完成，截图在:', OUT);
}

// 兜底看门狗：无论卡在哪一步，2 分钟后强制退出，避免残留 Electron 进程挂死终端
const watchdog = setTimeout(() => {
  console.error('冒烟测试超时（120s），强制退出');
  process.exit(2);
}, 120000);
watchdog.unref?.();

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('冒烟测试失败:', e);
    if (app) await app.close().catch(() => {});
    process.exit(1);
  });
