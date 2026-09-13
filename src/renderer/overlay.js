// 全屏休息遮罩的接线：状态渲染交给 OverlayView，这里只管 IPC、复盘落库与按钮行为。
'use strict';

const $ = (id) => document.getElementById(id);
const body = document.body;

const mode = new URLSearchParams(location.search).get('mode') || 'primary';
body.classList.add(`mode-${mode}`);

let settings = null;
let dirty = false; // 有未保存的编辑
let everSaved = false; // 本次休息里保存过（此后允许保存空值 = 清空修正）

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
  OverlayView.setSaveLabel(body, true);
}

// 未保存的内容在任何离开动作前先落库
async function ensureReviewSaved() {
  if (dirty) await saveReview();
}

for (const id of ['noteInput', 'nextInput']) {
  $(id).addEventListener('input', () => {
    dirty = true;
    OverlayView.setSaveLabel(body, false);
    OverlayView.grow($(id));
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
  OverlayView.resetForm(body);
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

$('ovTip').textContent = OverlayView.randomTip();

// 这里可能跑在休息开始前很久（窗口预建、尚未显示，且要等人点「去休息」），
// 所以铃声和焦点都不在这里做，交给主进程在真正显示窗口时下发的 cue
window.api.bootstrap().then(({ state, settings: s, awayMs }) => {
  settings = s;
  if (awayMs) $('btnAway').textContent = `暂时让开 ${Math.round(awayMs / 1000)} 秒`;
  OverlayView.render(body, state);
  warmAudio();
});

window.api.onState((state) => OverlayView.render(body, state));
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
  // 遮罩全程预建，是到点那一刻唯一保证已就绪的 renderer，两声铃都归它播
  if (mode !== 'primary' || !settings?.soundOn) return;
  if (cue.type === 'break-due') playChime('work-end', settings.soundVolume);
  else if (cue.type === 'break-over') playChime('break-end', settings.soundVolume);
});
