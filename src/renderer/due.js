// 「该休息了」小窗的接线：把主进程状态喂给 DueView，把点击回传给主进程。
// 渲染本身在 views/due-view.js（Storybook 复用同一份）。
'use strict';

const $ = (id) => document.getElementById(id);
const body = document.body;

$('btnBreak').addEventListener('click', () => window.api.cmd('startBreak'));

// 折叠只是窗口尺寸，计时不受影响；下个番茄是新窗口，自然回到展开态
function setCollapsed(collapsed) {
  DueView.setCollapsed(body, collapsed);
  window.api.cmd(collapsed ? 'collapseDue' : 'expandDue');
}
$('btnCollapse').addEventListener('click', () => setCollapsed(true));
$('btnExpand').addEventListener('click', () => setCollapsed(false));

// 铃声不归这里：这个窗口是到点现建的，起来时铃早该响过了，交给全程预建的遮罩播
window.api.bootstrap().then(({ state }) => DueView.render(body, state));
window.api.onState((state) => DueView.render(body, state));
