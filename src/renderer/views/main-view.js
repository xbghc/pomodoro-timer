// 主窗口的纯视图层：只吃 (root, 数据)，不碰 window.api、不留模块级状态。
// 抽出来是为了让 Storybook 用同一份渲染逻辑摆出各种状态，界面不会和真实应用走样。
// 以传统脚本加载（main.html 里排在 main.js 之前），所以整体包在 IIFE 里避免顶层重名。
'use strict';

(function (global) {
  const q = (root, sel) => root.querySelector(sel);

  // 表盘几何：60 分钟刻度盘（厨房计时器盘面）
  const DIAL = { c: 130, tickOuter: 118, tickInner: 111, majorInner: 105, num: 93, arc: 125 };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function polar(r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [DIAL.c + r * Math.cos(rad), DIAL.c + r * Math.sin(rad)];
  }

  function buildDial(root) {
    const doc = root.ownerDocument;
    const ticks = q(root, '#dialTicks');
    ticks.innerHTML = '';
    for (let m = 0; m < 60; m++) {
      const deg = m * 6;
      const major = m % 5 === 0;
      const [x1, y1] = polar(major ? DIAL.majorInner : DIAL.tickInner, deg);
      const [x2, y2] = polar(DIAL.tickOuter, deg);
      const line = doc.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('class', `dial-tick${major ? ' major' : ''}`);
      ticks.appendChild(line);
    }
    const nums = q(root, '#dialNums');
    nums.innerHTML = '';
    for (const n of [0, 10, 20, 30, 40, 50]) {
      const [x, y] = polar(DIAL.num, n * 6);
      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('class', 'dial-num');
      text.textContent = n;
      nums.appendChild(text);
    }
  }

  // 剩余分钟在 60 分制盘面上的弧线（时长超过 60 分钟时扩大量程）
  function dialArcPath(remainingMs, scaleMin) {
    const span = Math.min(359.99, ((remainingMs / 60000) / scaleMin) * 360);
    if (span < 0.2) return '';
    const [sx, sy] = polar(DIAL.arc, 0);
    const [ex, ey] = polar(DIAL.arc, span);
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${DIAL.arc} ${DIAL.arc} 0 ${span > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }

  // ---------- 工具 ----------

  function fmt(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // 休息相关的读数一律只报分钟、向上取整：跳秒的数字太抢眼，休息时不该盯着它
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

  function fmtClock(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayStr() {
    return dateStr(new Date());
  }

  function localDateOf(ts) {
    return dateStr(new Date(ts));
  }

  function shiftDate(str, delta) {
    const [y, m, d] = str.split('-').map(Number);
    return dateStr(new Date(y, m - 1, d + delta));
  }

  function weekday(str) {
    const [y, m, d] = str.split('-').map(Number);
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(y, m - 1, d).getDay()];
  }

  // ---------- 主题与页签 ----------

  function applyTheme(root, dark) {
    root.ownerDocument.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function activateTab(root, name) {
    root.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  }

  // ---------- 计时页 ----------

  // prevState 只用来判断「刚进入可编辑状态」，据此把下一步规划带进输入框
  function renderTimer(root, state, prevState) {
    const prevPhase = prevState?.phase;
    const { phase, paused, breakType, remainingMs, phaseDurationMs, cycleCount, config } = state;

    let label = '空闲';
    let sub = '';
    if (phase === 'idle' && state.schedule?.enabled) {
      const sc = state.schedule;
      if (sc.inWork) sub = `工作时段 · 至 ${sc.blockEnd}`;
      else if (sc.nextStart) sub = `下一时段 ${sc.nextStart} 自动开始`;
      else sub = '今日工作时段已结束';
    }
    if (phase === 'work') {
      label = paused ? '已暂停' : '专注中';
      sub = `第 ${Math.min(cycleCount + 1, 99)} 个番茄`;
    } else if (phase === 'breakDue') {
      label = '该休息了';
      sub = `已连续工作 ${mins(state.workedMs)} 分钟`;
    } else if (phase === 'break') {
      label = breakType === 'long' ? '长休息' : '短休息';
      sub = '正在休息';
    } else if (phase === 'breakOver') {
      label = '休息结束';
      sub = '等待开始下一个番茄';
    }
    q(root, '#phaseLabel').textContent = label;
    q(root, '#subLabel').textContent = sub;
    // 拖过头了就把状态标签染红，和右下角小窗一个信号
    q(root, '#phaseLabel').dataset.overwork = phase === 'breakDue' ? state.overwork : 0;

    // 休息（含「该休息了」时预告的休息时长）只报分钟；工作/空闲仍是 mm:ss
    const restish = phase === 'break' || phase === 'breakDue';
    q(root, '#clockUnit').hidden = !restish;
    q(root, '#clock').textContent = restish
      ? String(mins(remainingMs))
      : phase === 'idle'
        ? `${config.workMin}:00`.padStart(5, '0')
        : fmt(remainingMs);

    const arc = q(root, '#dialArc');
    const displayMs = phase === 'idle' ? config.workMin * 60000 : remainingMs;
    const scaleMin = Math.max(60, Math.ceil((phase === 'idle' ? config.workMin * 60000 : phaseDurationMs) / 60000));
    arc.setAttribute('d', dialArcPath(displayMs, scaleMin));
    arc.classList.toggle('idle', phase === 'idle');
    arc.classList.toggle('rest', restish || phase === 'breakOver');
    q(root, '.dial-wrap').classList.toggle('paused', paused);

    renderDots(q(root, '#dots'), state);

    // 规划区：空闲/等待开始 → 输入框（进入该状态时带入「下一步规划」）；专注中 → 只读展示
    const editable = phase === 'idle' || phase === 'breakOver';
    q(root, '#planInput').hidden = !editable;
    if (editable && phase !== prevPhase) q(root, '#planInput').value = state.pendingPlan || '';
    const showPlan = phase === 'work' && state.plan;
    q(root, '#planLine').hidden = !showPlan;
    q(root, '#planLine').textContent = showPlan ? `规划 · ${state.plan}` : '';

    q(root, '#btnStart').hidden = !(phase === 'idle' || phase === 'breakOver');
    q(root, '#btnPause').hidden = !(phase === 'work' && !paused);
    q(root, '#btnResume').hidden = !(phase === 'work' && paused);
    q(root, '#btnAbandon').hidden = phase !== 'work';
    q(root, '#btnStartBreak').hidden = phase !== 'breakDue';
    q(root, '#btnEndFocus').hidden = phase === 'idle';
  }

  function renderDots(el, state) {
    const n = state.config.longEvery;
    el.innerHTML = '';
    if (!n) return;
    const filled = Math.min(state.cycleCount, n);
    for (let i = 0; i < n; i++) {
      const dot = el.ownerDocument.createElement('span');
      dot.className = 'dot' + (i < filled ? ' filled' : '');
      el.appendChild(dot);
    }
  }

  // ---------- 历史 ----------

  function renderTodayLine(root, history, today = todayStr()) {
    const n = history.filter((r) => r.status === 'completed' && localDateOf(r.startedAt) === today).length;
    q(root, '#todayLine').textContent = `今日完成 ${n} 个番茄`;
  }

  function renderHistory(root, { history, date, today = todayStr() }) {
    const doc = root.ownerDocument;
    q(root, '#dateLabel').textContent = `${date} ${weekday(date)}`;
    q(root, '#dateNext').disabled = date >= today;

    const recs = history
      .filter((r) => localDateOf(r.startedAt) === date)
      .sort((a, b) => a.startedAt - b.startedAt);

    const done = recs.filter((r) => r.status === 'completed');
    const abandoned = recs.length - done.length;
    const focusMin = Math.round(done.reduce((sum, r) => sum + (r.endedAt - r.startedAt), 0) / 60000);
    q(root, '#daySummary').textContent = recs.length
      ? `完成 ${done.length} 个 · 放弃 ${abandoned} 个 · 专注约 ${focusMin} 分钟`
      : '';

    const list = q(root, '#recordList');
    list.innerHTML = '';
    for (const r of recs) {
      const li = doc.createElement('li');

      const time = doc.createElement('span');
      time.className = 'rec-time';
      time.textContent = `${fmtClock(r.startedAt)}–${fmtClock(r.endedAt)}`;

      const mark = doc.createElement('span');
      const ok = r.status === 'completed';
      mark.className = `rec-badge ${ok ? 'done' : 'abandoned'}`;
      mark.textContent = ok ? '完' : '弃';
      mark.title = ok ? '完成' : '放弃';

      const texts = doc.createElement('span');
      texts.className = 'rec-texts';
      if (r.plan) {
        const plan = doc.createElement('span');
        plan.className = 'rec-plan';
        plan.textContent = r.plan;
        texts.appendChild(plan);
      }
      const note = doc.createElement('span');
      note.className = 'rec-note' + (r.note ? '' : ' no-note');
      note.textContent = r.note || (r.plan ? '未复盘' : '未记录');
      texts.appendChild(note);

      li.append(time, mark, texts);
      list.appendChild(li);
    }
    q(root, '#emptyDay').hidden = recs.length > 0;
  }

  // ---------- 设置 ----------

  function fillSettings(root, settings) {
    q(root, '#setWork').value = settings.workMin;
    q(root, '#setShort').value = settings.shortMin;
    q(root, '#setLong').value = settings.longMin;
    q(root, '#setEvery').value = settings.longEvery;
    q(root, '#setHealth').value = settings.healthMaxMin;
    q(root, '#setAutoEnd').value = settings.autoEndMin;
    q(root, '#setSchedOn').checked = settings.schedule.enabled;
    settings.schedule.blocks.forEach((b, i) => {
      q(root, `#schedStart${i}`).value = b.start;
      q(root, `#schedEnd${i}`).value = b.end;
      q(root, `#schedWork${i}`).value = b.workMin;
      q(root, `#schedShort${i}`).value = b.shortMin;
      q(root, `#schedLong${i}`).value = b.longMin;
      q(root, `#schedEvery${i}`).value = b.longEvery;
    });
    q(root, '#setSound').checked = settings.soundOn;
    q(root, '#setVolume').value = Math.round(settings.soundVolume * 100);
    q(root, '#setTheme').value = settings.theme;
    q(root, '#setAutoStart').checked = settings.autoStart;
  }

  // 从设置页各控件读回一份完整的 settings 补丁里的 schedule 部分
  function readSchedule(root) {
    return {
      enabled: q(root, '#setSchedOn').checked,
      blocks: [0, 1, 2].map((i) => ({
        start: q(root, `#schedStart${i}`).value,
        end: q(root, `#schedEnd${i}`).value,
        workMin: Number(q(root, `#schedWork${i}`).value),
        shortMin: Number(q(root, `#schedShort${i}`).value),
        longMin: Number(q(root, `#schedLong${i}`).value),
        longEvery: Number(q(root, `#schedEvery${i}`).value),
      })),
    };
  }

  // ---------- 更新 ----------

  const UPDATE_TEXT = {
    dev: '开发模式不检查更新',
    idle: '',
    checking: '检查中…',
    none: '已是最新版本',
    downloading: '下载新版本中…',
    ready: '已就绪',
    error: '检查失败，将自动重试',
  };

  function renderUpdate(root, { status, version }) {
    const hint = q(root, '#updateStatus');
    const btn = q(root, '#btnUpdate');
    let text = UPDATE_TEXT[status] ?? '';
    if (status === 'downloading' && version) text = `发现 v${version}，后台下载中…`;
    if (status === 'ready') text = `v${version} 已就绪`;
    hint.textContent = text;
    hint.classList.toggle('ready', status === 'ready');
    btn.textContent = status === 'ready' ? '重启并更新' : '检查更新';
    btn.disabled = status === 'dev' || status === 'checking' || status === 'downloading';
  }

  global.MainView = {
    buildDial,
    renderTimer,
    renderHistory,
    renderTodayLine,
    fillSettings,
    readSchedule,
    renderUpdate,
    applyTheme,
    activateTab,
    fmt,
    mins,
    dateStr,
    todayStr,
    localDateOf,
    shiftDate,
    weekday,
  };
})(typeof window !== 'undefined' ? window : globalThis);
