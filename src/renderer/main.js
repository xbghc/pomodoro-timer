'use strict';

const $ = (id) => document.getElementById(id);

// 表盘几何：60 分钟刻度盘（厨房计时器盘面）
const DIAL = { c: 130, tickOuter: 118, tickInner: 111, majorInner: 105, num: 93, arc: 125 };
const SVG_NS = 'http://www.w3.org/2000/svg';

function polar(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [DIAL.c + r * Math.cos(rad), DIAL.c + r * Math.sin(rad)];
}

function buildDial() {
  const ticks = $('dialTicks');
  for (let m = 0; m < 60; m++) {
    const deg = m * 6;
    const major = m % 5 === 0;
    const [x1, y1] = polar(major ? DIAL.majorInner : DIAL.tickInner, deg);
    const [x2, y2] = polar(DIAL.tickOuter, deg);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', `dial-tick${major ? ' major' : ''}`);
    ticks.appendChild(line);
  }
  const nums = $('dialNums');
  for (const n of [0, 10, 20, 30, 40, 50]) {
    const [x, y] = polar(DIAL.num, n * 6);
    const text = document.createElementNS(SVG_NS, 'text');
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

let settings = null;
let lastState = null;
let history = [];
let selDate = todayStr();

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

// ---------- 主题 ----------

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// ---------- 计时页渲染 ----------

function render(state) {
  const prevPhase = lastState?.phase;
  lastState = state;
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
  $('phaseLabel').textContent = label;
  $('subLabel').textContent = sub;
  // 拖过头了就把状态标签染红，和右下角小窗一个信号
  $('phaseLabel').dataset.overwork = phase === 'breakDue' ? state.overwork : 0;

  // 休息（含「该休息了」时预告的休息时长）只报分钟；工作/空闲仍是 mm:ss
  const restish = phase === 'break' || phase === 'breakDue';
  $('clockUnit').hidden = !restish;
  $('clock').textContent = restish
    ? String(mins(remainingMs))
    : phase === 'idle'
      ? `${config.workMin}:00`.padStart(5, '0')
      : fmt(remainingMs);

  const arc = $('dialArc');
  const displayMs = phase === 'idle' ? config.workMin * 60000 : remainingMs;
  const scaleMin = Math.max(60, Math.ceil((phase === 'idle' ? config.workMin * 60000 : phaseDurationMs) / 60000));
  arc.setAttribute('d', dialArcPath(displayMs, scaleMin));
  arc.classList.toggle('idle', phase === 'idle');
  arc.classList.toggle('rest', restish || phase === 'breakOver');
  document.querySelector('.dial-wrap').classList.toggle('paused', paused);

  renderDots($('dots'), state);

  // 规划区：空闲/等待开始 → 输入框（进入该状态时带入「下一步规划」）；专注中 → 只读展示
  const editable = phase === 'idle' || phase === 'breakOver';
  $('planInput').hidden = !editable;
  if (editable && phase !== prevPhase) $('planInput').value = state.pendingPlan || '';
  const showPlan = phase === 'work' && state.plan;
  $('planLine').hidden = !showPlan;
  $('planLine').textContent = showPlan ? `规划 · ${state.plan}` : '';

  $('btnStart').hidden = !(phase === 'idle' || phase === 'breakOver');
  $('btnPause').hidden = !(phase === 'work' && !paused);
  $('btnResume').hidden = !(phase === 'work' && paused);
  $('btnAbandon').hidden = phase !== 'work';
  $('btnStartBreak').hidden = phase !== 'breakDue';
  $('btnEndFocus').hidden = phase === 'idle';
}

function renderDots(el, state) {
  const n = state.config.longEvery;
  el.innerHTML = '';
  if (!n) return;
  const filled = Math.min(state.cycleCount, n);
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < filled ? ' filled' : '');
    el.appendChild(dot);
  }
}

// ---------- 历史 ----------

function refreshHistory() {
  window.api.getHistory().then((h) => {
    history = h;
    renderTodayLine();
    renderHistoryTab();
  });
}

function renderTodayLine() {
  const n = history.filter((r) => r.status === 'completed' && localDateOf(r.startedAt) === todayStr()).length;
  $('todayLine').textContent = `今日完成 ${n} 个番茄`;
}

function renderHistoryTab() {
  $('dateLabel').textContent = `${selDate} ${weekday(selDate)}`;
  $('dateNext').disabled = selDate >= todayStr();

  const recs = history
    .filter((r) => localDateOf(r.startedAt) === selDate)
    .sort((a, b) => a.startedAt - b.startedAt);

  const done = recs.filter((r) => r.status === 'completed');
  const abandoned = recs.length - done.length;
  const focusMin = Math.round(done.reduce((sum, r) => sum + (r.endedAt - r.startedAt), 0) / 60000);
  $('daySummary').textContent = recs.length
    ? `完成 ${done.length} 个 · 放弃 ${abandoned} 个 · 专注约 ${focusMin} 分钟`
    : '';

  const list = $('recordList');
  list.innerHTML = '';
  for (const r of recs) {
    const li = document.createElement('li');

    const time = document.createElement('span');
    time.className = 'rec-time';
    time.textContent = `${fmtClock(r.startedAt)}–${fmtClock(r.endedAt)}`;

    const mark = document.createElement('span');
    const ok = r.status === 'completed';
    mark.className = `rec-badge ${ok ? 'done' : 'abandoned'}`;
    mark.textContent = ok ? '完' : '弃';
    mark.title = ok ? '完成' : '放弃';

    const texts = document.createElement('span');
    texts.className = 'rec-texts';
    if (r.plan) {
      const plan = document.createElement('span');
      plan.className = 'rec-plan';
      plan.textContent = r.plan;
      texts.appendChild(plan);
    }
    const note = document.createElement('span');
    note.className = 'rec-note' + (r.note ? '' : ' no-note');
    note.textContent = r.note || (r.plan ? '未复盘' : '未记录');
    texts.appendChild(note);

    li.append(time, mark, texts);
    list.appendChild(li);
  }
  $('emptyDay').hidden = recs.length > 0;
}

// ---------- 设置 ----------

function fillSettings() {
  $('setWork').value = settings.workMin;
  $('setShort').value = settings.shortMin;
  $('setLong').value = settings.longMin;
  $('setEvery').value = settings.longEvery;
  $('setHealth').value = settings.healthMaxMin;
  $('setSchedOn').checked = settings.schedule.enabled;
  settings.schedule.blocks.forEach((b, i) => {
    $(`schedStart${i}`).value = b.start;
    $(`schedEnd${i}`).value = b.end;
    $(`schedWork${i}`).value = b.workMin;
    $(`schedShort${i}`).value = b.shortMin;
    $(`schedLong${i}`).value = b.longMin;
    $(`schedEvery${i}`).value = b.longEvery;
  });
  $('setSound').checked = settings.soundOn;
  $('setVolume').value = Math.round(settings.soundVolume * 100);
  $('setTheme').value = settings.theme;
  $('setAutoStart').checked = settings.autoStart;
}

function saveSettings(patch) {
  window.api.saveSettings(patch).then((s) => {
    settings = s;
    fillSettings();
    if (lastState) render({ ...lastState, config: { ...lastState.config, ...s } });
  });
}

function bindSettings() {
  const numField = (id, key) => {
    $(id).addEventListener('change', () => saveSettings({ [key]: Number($(id).value) }));
  };
  numField('setWork', 'workMin');
  numField('setShort', 'shortMin');
  numField('setLong', 'longMin');
  numField('setEvery', 'longEvery');
  numField('setHealth', 'healthMaxMin');
  const saveSchedule = () =>
    saveSettings({
      schedule: {
        enabled: $('setSchedOn').checked,
        blocks: [0, 1, 2].map((i) => ({
          start: $(`schedStart${i}`).value,
          end: $(`schedEnd${i}`).value,
          workMin: Number($(`schedWork${i}`).value),
          shortMin: Number($(`schedShort${i}`).value),
          longMin: Number($(`schedLong${i}`).value),
          longEvery: Number($(`schedEvery${i}`).value),
        })),
      },
    });
  $('setSchedOn').addEventListener('change', saveSchedule);
  for (let i = 0; i < 3; i++) {
    for (const f of ['Start', 'End', 'Work', 'Short', 'Long', 'Every']) {
      $(`sched${f}${i}`).addEventListener('change', saveSchedule);
    }
  }
  $('setSound').addEventListener('change', () => saveSettings({ soundOn: $('setSound').checked }));
  $('setVolume').addEventListener('change', () => saveSettings({ soundVolume: Number($('setVolume').value) / 100 }));
  $('btnTestSound').addEventListener('click', () => playChime('work-end', Number($('setVolume').value) / 100));
  $('setTheme').addEventListener('change', () => saveSettings({ theme: $('setTheme').value }));
  $('setAutoStart').addEventListener('change', () => saveSettings({ autoStart: $('setAutoStart').checked }));
}

// ---------- 更新 ----------

let updateState = { status: 'idle', version: '' };

function renderUpdate() {
  const { status, version } = updateState;
  const hint = $('updateStatus');
  const btn = $('btnUpdate');
  const TEXT = {
    dev: '开发模式不检查更新',
    idle: '',
    checking: '检查中…',
    none: '已是最新版本',
    downloading: version ? `发现 v${version}，后台下载中…` : '下载新版本中…',
    ready: `v${version} 已就绪`,
    error: '检查失败，将自动重试',
  };
  hint.textContent = TEXT[status] ?? '';
  hint.classList.toggle('ready', status === 'ready');
  btn.textContent = status === 'ready' ? '重启并更新' : '检查更新';
  btn.disabled = status === 'dev' || status === 'checking' || status === 'downloading';
}

function bindUpdate() {
  $('btnUpdate').addEventListener('click', async () => {
    if (updateState.status === 'ready') {
      window.api.installUpdate();
      return;
    }
    updateState = await window.api.checkUpdate();
    renderUpdate();
  });
  window.api.onUpdate((u) => {
    updateState = u;
    renderUpdate();
  });
}

// ---------- 页签与按钮 ----------

function bindTabs() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'history') renderHistoryTab();
    });
  }
}

function bindButtons() {
  $('btnStart').addEventListener('click', () => window.api.cmd('start', $('planInput').value));
  $('planInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') window.api.cmd('start', $('planInput').value);
  });
  $('btnPause').addEventListener('click', () => window.api.cmd('pause'));
  $('btnResume').addEventListener('click', () => window.api.cmd('resume'));
  $('btnAbandon').addEventListener('click', () => window.api.cmd('abandon'));
  $('btnStartBreak').addEventListener('click', () => window.api.cmd('startBreak'));
  $('btnEndFocus').addEventListener('click', () => window.api.cmd('endFocus'));

  $('datePrev').addEventListener('click', () => {
    selDate = shiftDate(selDate, -1);
    renderHistoryTab();
  });
  $('dateNext').addEventListener('click', () => {
    if (selDate < todayStr()) {
      selDate = shiftDate(selDate, 1);
      renderHistoryTab();
    }
  });
  $('dateToday').addEventListener('click', () => {
    selDate = todayStr();
    renderHistoryTab();
  });
}

// ---------- 启动 ----------

buildDial();
bindTabs();
bindButtons();
bindUpdate();

window.api.bootstrap().then(({ state, settings: s, dark, version, update }) => {
  settings = s;
  applyTheme(dark);
  fillSettings();
  bindSettings();
  render(state);
  refreshHistory();
  $('aboutVersion').textContent = `番茄钟 v${version}`;
  updateState = update;
  renderUpdate();
});

window.api.onState(render);
window.api.onTheme(({ dark }) => applyTheme(dark));
window.api.onHistoryChanged(refreshHistory);
