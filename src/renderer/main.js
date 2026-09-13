// 主窗口的接线：状态/历史/设置的渲染都在 views/main-view.js（Storybook 复用同一份），
// 这里只保留本地状态、IPC 调用与事件绑定。
'use strict';

const $ = (id) => document.getElementById(id);
const root = document.body;
const V = MainView;

let settings = null;
let lastState = null;
let history = [];
let selDate = V.todayStr();

function render(state) {
  V.renderTimer(root, state, lastState);
  lastState = state;
}

// ---------- 历史 ----------

function refreshHistory() {
  window.api.getHistory().then((h) => {
    history = h;
    V.renderTodayLine(root, history);
    renderHistoryTab();
  });
}

function renderHistoryTab() {
  V.renderHistory(root, { history, date: selDate });
}

// ---------- 设置 ----------

function saveSettings(patch) {
  window.api.saveSettings(patch).then((s) => {
    settings = s;
    V.fillSettings(root, settings);
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
  numField('setAutoEnd', 'autoEndMin');
  const saveSchedule = () => saveSettings({ schedule: V.readSchedule(root) });
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

function bindUpdate() {
  $('btnUpdate').addEventListener('click', async () => {
    if (updateState.status === 'ready') {
      window.api.installUpdate();
      return;
    }
    updateState = await window.api.checkUpdate();
    V.renderUpdate(root, updateState);
  });
  window.api.onUpdate((u) => {
    updateState = u;
    V.renderUpdate(root, updateState);
  });
}

// ---------- 页签与按钮 ----------

function bindTabs() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => {
      V.activateTab(root, btn.dataset.tab);
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
    selDate = V.shiftDate(selDate, -1);
    renderHistoryTab();
  });
  $('dateNext').addEventListener('click', () => {
    if (selDate < V.todayStr()) {
      selDate = V.shiftDate(selDate, 1);
      renderHistoryTab();
    }
  });
  $('dateToday').addEventListener('click', () => {
    selDate = V.todayStr();
    renderHistoryTab();
  });
}

// ---------- 启动 ----------

V.buildDial(root);
bindTabs();
bindButtons();
bindUpdate();

window.api.bootstrap().then(({ state, settings: s, dark, version, update }) => {
  settings = s;
  V.applyTheme(root, dark);
  V.fillSettings(root, settings);
  bindSettings();
  render(state);
  refreshHistory();
  $('aboutVersion').textContent = `番茄钟 v${version}`;
  updateState = update;
  V.renderUpdate(root, updateState);
});

window.api.onState(render);
window.api.onTheme(({ dark }) => V.applyTheme(root, dark));
window.api.onHistoryChanged(refreshHistory);
