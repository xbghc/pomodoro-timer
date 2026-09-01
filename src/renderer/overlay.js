'use strict';

const $ = (id) => document.getElementById(id);

const TIPS = [
  '站起来，伸展一下背和肩颈',
  '眺望 6 米以外 20 秒，让眼睛歇歇',
  '去接杯水，顺便走两步',
  '做几次深呼吸，放松肩膀',
  '离开屏幕，活动一下手腕和脖子',
];

const mode = new URLSearchParams(location.search).get('mode') || 'primary';
document.body.classList.add(`mode-${mode}`);

let settings = null;
let dirty = false; // 有未保存的编辑
let everSaved = false; // 本次休息里保存过（此后允许保存空值 = 清空修正）

// 休息全程只报分钟、向上取整：秒级跳动的大数字太抢眼，人盯着它就休息不下来
const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

function render(state) {
  const { phase, breakType, remainingMs, phaseDurationMs, cycleCount, config } = state;
  // 遮罩只服务 break / breakOver，其他状态下窗口即将被主进程销毁
  if (phase !== 'break' && phase !== 'breakOver') return;

  const isOver = phase === 'breakOver';
  document.body.classList.toggle('over', isOver);
  $('ovTitle').textContent = isOver ? '休息结束' : breakType === 'long' ? '长休息' : '短休息';
  // 休息结束后数字没有意义了，整块收掉，位置让给「开始下一个番茄」
  $('ovClock').hidden = isOver;
  if (!isOver) $('ovMin').textContent = mins(remainingMs);
  $('ovBar').style.width = `${isOver || !phaseDurationMs ? 0 : (remainingMs / phaseDurationMs) * 100}%`;
  $('ovTip').textContent = isOver ? '休息好了？回到座位就开始吧' : $('ovTip').textContent;

  const dots = $('dots');
  dots.innerHTML = '';
  if (config.longEvery > 0) {
    const filled = Math.min(cycleCount, config.longEvery);
    for (let i = 0; i < config.longEvery; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i < filled ? ' filled' : '');
      dots.appendChild(dot);
    }
  }

  $('btnStartNext').hidden = !isOver;
  $('btnSkip').hidden = phase !== 'break';

  // 写复盘时对照：本番茄开始时的规划
  $('ovPlan').textContent = state.plan ? `本次规划：${state.plan}` : '';
  $('ovPlan').hidden = !state.plan;
}

// 保存两个区域：复盘挂到刚完成的番茄，下一步规划留给下个番茄
async function saveReview() {
  const note = $('noteInput').value.trim();
  const next = $('nextInput').value.trim();
  if (!note && !next && !everSaved) {
    dirty = false;
    return;
  }
  await window.api.saveReview({ note, next });
  everSaved = true;
  dirty = false;
  markSaved();
}

// 未保存的内容在任何离开动作前先落库
async function ensureReviewSaved() {
  if (dirty) await saveReview();
}

function markSaved() {
  $('noteSave').textContent = '已保存 ✓';
  $('noteSave').classList.add('saved');
}

// 随内容自动增高（上限约 4 行，超出内部滚动）
function grow(el) {
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight; // border-box 下 scrollHeight 不含边框
  el.style.height = `${Math.min(el.scrollHeight + border, 160)}px`;
}

for (const id of ['noteInput', 'nextInput']) {
  $(id).addEventListener('input', () => {
    dirty = true;
    $('noteSave').textContent = '保存（Ctrl+回车）';
    $('noteSave').classList.remove('saved');
    grow($(id));
  });
  $(id).addEventListener('keydown', (e) => {
    // 多行编辑：回车换行，Ctrl/Cmd+回车保存
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveReview();
    }
  });
}
$('noteSave').addEventListener('click', saveReview);

// 窗口跨休息复用（预建、以及「暂时让开」时的收起再显示），每次显示都回到干净状态
function resetForm() {
  dirty = false;
  everSaved = false;
  for (const id of ['noteInput', 'nextInput']) {
    $(id).value = '';
    grow($(id));
  }
  $('noteSave').textContent = '保存（Ctrl+回车）';
  $('noteSave').classList.remove('saved');
  $('ovTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  if (mode === 'primary') $('noteInput').focus();
}

$('btnStartNext').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('start');
});
// 要去开个音乐 / 回条消息：遮罩整体收起一小会儿，到点自动盖回来，休息倒计时照常走
$('btnAway').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('away');
});
$('btnSkip').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('skipBreak');
});
$('btnEnd').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('endFocus');
});

$('ovTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

// 这里可能跑在休息开始前很久（窗口预建、尚未显示，且要等人点「去休息」），
// 所以铃声和焦点都不在这里做，交给主进程在真正显示窗口时下发的 cue
window.api.bootstrap().then(({ state, settings: s, awayMs }) => {
  settings = s;
  if (awayMs) $('btnAway').textContent = `暂时让开 ${Math.round(awayMs / 1000)} 秒`;
  render(state);
  warmAudio();
});

window.api.onState(render);
// 提示音只有主屏播，避免多屏叠音
window.api.onCue((cue) => {
  if (cue.type === 'shown') {
    resetForm();
    return;
  }
  // 让开结束盖回来：还是同一次休息，复盘内容不能清，只把光标要回来
  if (cue.type === 'back') {
    if (mode === 'primary') $('noteInput').focus();
    return;
  }
  // 「该休息了」那声归右下角小窗播（那时遮罩还藏着）；这里只管休息结束
  if (mode !== 'primary' || !settings?.soundOn) return;
  if (cue.type === 'break-over') playChime('break-end', settings.soundVolume);
});
