// 「该休息了」小窗的纯视图层：只吃 (root, state)，不碰 window.api。
// root 即小窗的 <body>，健康色与折叠态都靠它身上的 data-* 切换。
'use strict';

(function (global) {
  const q = (root, sel) => root.querySelector(sel);

  // 分钟粒度、向上取整：这个窗口全程不读秒，数字最多每分钟跳一次
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

  function render(root, state) {
    // 这个窗口只在 breakDue 期间存在，其他状态下它即将被主进程销毁
    if (state.phase !== 'breakDue') return;

    q(root, '#title').textContent = state.breakType === 'long' ? '该长休息了' : '该休息了';
    // breakDue 的 remainingMs 就是「现在去休息能休多久」，已按拖堂补过，会随拖着不休息增长
    q(root, '#sub').textContent = `已工作 ${mins(state.workedMs)} 分钟 · 休息 ${mins(state.remainingMs)} 分钟`;
    // 0 健康 / 1 接近健康上限 / 2 已超上限：拖得越久，整块挂件越红
    root.dataset.overwork = state.overwork;
  }

  // 收起 = 缩成右下角一个小把手：让开地方，但健康色还在余光里
  function setCollapsed(root, collapsed) {
    root.dataset.collapsed = collapsed ? 'true' : 'false';
  }

  global.DueView = { render, setCollapsed, mins };
})(typeof window !== 'undefined' ? window : globalThis);
