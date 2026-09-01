'use strict';

const $ = (id) => document.getElementById(id);

let settings = null;

// 分钟粒度、向上取整：这个窗口全程不读秒，数字最多每分钟跳一次
const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));

function render(state) {
  // 预建期间还在 work，先把文案按当下的工作时长摆好，免得现身那一刻闪一下占位值
  if (state.phase !== 'work' && state.phase !== 'breakDue') return;

  $('title').textContent = state.breakType === 'long' ? '该长休息了' : '该休息了';
  // breakDue 的 remainingMs 就是「现在去休息能休多久」（已按拖堂补过），预建期间只能先按短休息估
  const breakMs = state.phase === 'breakDue' ? state.remainingMs : state.config.shortMin * 60000;
  $('sub').textContent = `已连续工作 ${mins(state.workedMs)} 分钟 · 休息 ${mins(breakMs)} 分钟`;
  // 0 健康 / 1 接近健康上限 / 2 已超上限：拖得越久，整块挂件越红
  document.body.dataset.overwork = state.overwork;
}

$('btnBreak').addEventListener('click', () => window.api.cmd('startBreak'));

window.api.bootstrap().then(({ state, settings: s }) => {
  settings = s;
  render(state);
  warmAudio();
});

window.api.onState(render);

// 「该休息了」的铃声：这个小窗是此刻唯一露面的界面，铃声由它来播
window.api.onCue((cue) => {
  if (cue.type !== 'break-due' || !settings?.soundOn) return;
  playChime('work-end', settings.soundVolume);
});
