// 休息遮罩的纯视图层：只吃 (root, state)，不碰 window.api。
// root 即遮罩的 <body>（有 mode-* / over 等状态类挂在它身上）。
'use strict';

(function (global) {
  const q = (root, sel) => root.querySelector(sel);

  const TIPS = [
    '站起来，伸展一下背和肩颈',
    '眺望 6 米以外 20 秒，让眼睛歇歇',
    '去接杯水，顺便走两步',
    '做几次深呼吸，放松肩膀',
    '离开屏幕，活动一下手腕和脖子',
  ];

  // 休息全程只报分钟、向上取整：秒级跳动的大数字太抢眼，人盯着它就休息不下来
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

  function render(root, state) {
    const { phase, breakType, remainingMs, phaseDurationMs, cycleCount, config } = state;
    // 遮罩只服务 break / breakOver，其他状态下窗口即将被主进程销毁
    if (phase !== 'break' && phase !== 'breakOver') return;

    const isOver = phase === 'breakOver';
    root.classList.toggle('over', isOver);
    q(root, '#ovTitle').textContent = isOver ? '休息结束' : breakType === 'long' ? '长休息' : '短休息';
    // 休息结束后数字没有意义了，整块收掉，位置让给「开始下一个番茄」
    q(root, '#ovClock').hidden = isOver;
    if (!isOver) q(root, '#ovMin').textContent = mins(remainingMs);
    q(root, '#ovBar').style.width = `${isOver || !phaseDurationMs ? 0 : (remainingMs / phaseDurationMs) * 100}%`;
    if (isOver) q(root, '#ovTip').textContent = '休息好了？回到座位就开始吧';

    const dots = q(root, '#dots');
    dots.innerHTML = '';
    if (config.longEvery > 0) {
      const filled = Math.min(cycleCount, config.longEvery);
      for (let i = 0; i < config.longEvery; i++) {
        const dot = dots.ownerDocument.createElement('span');
        dot.className = 'dot' + (i < filled ? ' filled' : '');
        dots.appendChild(dot);
      }
    }

    q(root, '#btnStartNext').hidden = !isOver;
    q(root, '#btnSkip').hidden = phase !== 'break';

    // 写复盘时对照：本番茄开始时的规划
    q(root, '#ovPlan').textContent = state.plan ? `本次规划：${state.plan}` : '';
    q(root, '#ovPlan').hidden = !state.plan;
  }

  function randomTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  function setSaveLabel(root, saved) {
    const btn = q(root, '#noteSave');
    btn.textContent = saved ? '已保存 ✓' : '保存（Ctrl+回车）';
    btn.classList.toggle('saved', saved);
  }

  // 随内容自动增高（上限约 4 行，超出内部滚动）
  function grow(el) {
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight; // border-box 下 scrollHeight 不含边框
    el.style.height = `${Math.min(el.scrollHeight + border, 160)}px`;
  }

  // 窗口跨休息复用（预建、以及「暂时让开」时的收起再显示），每次显示都回到干净状态
  function resetForm(root, tip = randomTip()) {
    for (const id of ['#noteInput', '#nextInput']) {
      q(root, id).value = '';
      grow(q(root, id));
    }
    setSaveLabel(root, false);
    q(root, '#ovTip').textContent = tip;
  }

  global.OverlayView = { TIPS, render, randomTip, resetForm, setSaveLabel, grow, mins };
})(typeof window !== 'undefined' ? window : globalThis);
