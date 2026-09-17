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

// 收起 = 缩成贴着屏幕右缘的一条把手：让开地方，但健康色还在余光里。
// 折叠只是窗口尺寸，计时不受影响；下个番茄是新窗口，自然回到展开态。
function setCollapsed(collapsed) {
  document.body.dataset.collapsed = collapsed ? 'true' : 'false';
  window.api.cmd(collapsed ? 'collapseDue' : 'expandDue');
}

const isCollapsed = () => document.body.dataset.collapsed === 'true';

// 收起后怎么再打开：鼠标往右一甩，撞上贴着屏幕边缘的把手就展开，不用瞄准去点。
// 蹭出来的展开是「看一眼」，鼠标一走就缩回去；点「›」收起的那次不算，它得等人主动招呼。
const HOVER_IN_MS = 150; // 路过的鼠标不该把它掀开
const HOVER_OUT_MS = 400; // 手抖着出界一下不算走人
let peeking = false; // 这次展开是蹭出来的
let armed = false; // 鼠标离开过窗口才允许 hover 展开
let inTimer = null;
let outTimer = null;

// 鼠标在窗口里
function pointerHere() {
  clearTimeout(outTimer);
  outTimer = null;
  if (!armed || !isCollapsed() || inTimer) return;
  inTimer = setTimeout(() => {
    inTimer = null;
    if (!isCollapsed()) return;
    peeking = true;
    setCollapsed(false);
  }, HOVER_IN_MS);
}

// 鼠标离开窗口
function pointerGone() {
  clearTimeout(inTimer);
  inTimer = null;
  armed = true; // 走过一趟，下次蹭上来就是真的冲着它来的
  if (!peeking || outTimer) return;
  outTimer = setTimeout(() => {
    outTimer = null;
    if (!peeking) return;
    peeking = false;
    setCollapsed(true);
  }, HOVER_OUT_MS);
}

// 认 mousemove 而不只是 mouseenter：窗口在指针底下伸缩，enter/leave 会漏；
// 只要指针还在窗口上，mousemove 就一直报。离开窗口时 mouseout 的 relatedTarget 为空。
document.addEventListener('mousemove', pointerHere);
document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) pointerGone();
});

// 点「›」收起时指针正停在把手那片位置上，armed 置否，免得手一动又被自己掀开
$('btnCollapse').addEventListener('click', () => {
  clearTimeout(inTimer);
  clearTimeout(outTimer);
  inTimer = outTimer = null;
  peeking = false;
  armed = false;
  setCollapsed(true);
});
// 把手上的点击：hover 通常已经先展开了，这条留给键盘和手快的情况；明确点开的就不自己缩回去
$('btnExpand').addEventListener('click', () => {
  clearTimeout(inTimer);
  inTimer = null;
  peeking = false;
  setCollapsed(false);
});

// 铃声不归这里：这个窗口是到点现建的，起来时铃早该响过了，交给全程预建的遮罩播
window.api.bootstrap().then(({ state }) => render(state));
window.api.onState(render);
