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
  soundOn: false,
  soundVolume: 0.5,
  theme: 'dark',
  autoStart: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 开始番茄 → 专注中
  const overlayP1 = app.waitForEvent('window', { timeout: 30000 });
  await mainWin.click('#btnStart');
  await sleep(1500);
  await shot(mainWin, '02-main-work.png');

  // 到点 → 全屏休息遮罩
  const overlay1 = await overlayP1;
  await overlay1.waitForLoadState('domcontentloaded');
  await sleep(800);
  await shot(overlay1, '03-overlay-break.png');

  // 收尾推迟：遮罩关闭回到工作
  const overlayP2 = app.waitForEvent('window', { timeout: 30000 });
  await overlay1.click('#btnGrace');
  await sleep(800);
  await shot(mainWin, '04-main-grace.png');

  // 收尾结束 → 遮罩再次弹出（此时不应再有收尾按钮）
  const overlay2 = await overlayP2;
  await overlay2.waitForLoadState('domcontentloaded');
  await sleep(800);
  await shot(overlay2, '05-overlay-no-grace.png');

  // 速记（多行编辑框：Ctrl+回车保存）
  await overlay2.fill('#noteInput', '完成了番茄钟状态机和单元测试\n补充：修掉了类名冲突的布局问题');
  await overlay2.press('#noteInput', 'Control+Enter');
  await sleep(400);
  await shot(overlay2, '06-overlay-note-saved.png');

  // 休息结束 → 遮罩停留等手动开始
  await overlay2.waitForSelector('#btnStartNext:not([hidden])', { timeout: 30000 });
  await sleep(400);
  await shot(overlay2, '07-overlay-break-over.png');

  // 手动开始下一个番茄 → 遮罩关闭
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
