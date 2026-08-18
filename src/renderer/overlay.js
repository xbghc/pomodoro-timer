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

function fmt(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render(state) {
  const { phase, breakType, remainingMs, phaseDurationMs, cycleCount, graceUsed, config } = state;
  // 遮罩只服务 break / breakOver，其他状态下窗口即将被主进程销毁
  if (phase !== 'break' && phase !== 'breakOver') return;

  const isOver = phase === 'breakOver';
  document.body.classList.toggle('over', isOver);
  $('ovTitle').textContent = isOver ? '休息结束' : breakType === 'long' ? '长休息' : '短休息';
  $('ovClock').textContent = isOver ? '00:00' : fmt(remainingMs);
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
  $('btnGrace').hidden = !(phase === 'break' && !graceUsed);
  $('btnGrace').textContent = `再给 ${config.graceMin} 分钟收尾`;
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

$('btnStartNext').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('start');
});
$('btnGrace').addEventListener('click', async () => {
  await ensureReviewSaved();
  window.api.cmd('grace');
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

window.api.bootstrap().then(({ state, settings: s }) => {
  settings = s;
  render(state);
  // 番茄到点的提示音：遮罩弹出即休息开始（只有主屏播放，避免多屏叠音）
  if (mode === 'primary' && state.phase === 'break' && s.soundOn) {
    playChime('work-end', s.soundVolume);
  }
  if (mode === 'primary') $('noteInput').focus();
});

window.api.onState(render);
window.api.onCue((cue) => {
  if (cue.type === 'break-over' && mode === 'primary' && settings?.soundOn) {
    playChime('break-end', settings.soundVolume);
  }
});
