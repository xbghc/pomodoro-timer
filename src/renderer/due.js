'use strict';

const $ = (id) => document.getElementById(id);

// 分钟粒度、向上取整：这个窗口全程不读秒，数字最多每分钟跳一次
const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

function render(state) {
  // 这个窗口只在 breakDue 期间存在，其他状态下它即将被主进程销毁
  if (state.phase !== 'breakDue') return;

  $('title').textContent = state.breakType === 'long' ? '该长休息了' : '该休息了';
  // breakDue 的 remainingMs 就是「现在去休息能休多久」，已按拖堂补过，会随拖着不休息增长
  $('sub').textContent = `已工作 ${mins(state.workedMs)} 分钟 · 休息 ${mins(state.remainingMs)} 分钟`;
  // 0 健康 / 1 接近健康上限 / 2 已超上限：拖得越久，整块挂件越红
  document.body.dataset.overwork = state.overwork;
}

$('btnBreak').addEventListener('click', () => window.api.cmd('startBreak'));

// 收起 = 缩成右下角一个小把手：让开地方，但健康色还在余光里
// 折叠只是窗口尺寸，计时不受影响；下个番茄是新窗口，自然回到展开态
function setCollapsed(collapsed) {
  document.body.dataset.collapsed = collapsed ? 'true' : 'false';
  window.api.cmd(collapsed ? 'collapseDue' : 'expandDue');
}
$('btnCollapse').addEventListener('click', () => setCollapsed(true));
$('btnExpand').addEventListener('click', () => setCollapsed(false));

// 铃声不归这里：这个窗口是到点现建的，起来时铃早该响过了，交给全程预建的遮罩播
window.api.bootstrap().then(({ state }) => render(state));
window.api.onState(render);
