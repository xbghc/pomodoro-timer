'use strict';

const $ = (id) => document.getElementById(id);

function fmt(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render(state) {
  // 预建期间（还在休息、小窗隐藏着）：按设置里的收尾时长把数字先摆好，
  // 否则点下「收尾」现身的那一刻会闪一下 HTML 里的占位值
  if (state.phase === 'break') {
    $('clock').textContent = fmt(state.config.graceMin * 60000);
    $('bar').style.width = '100%';
    return;
  }
  // 此外只服务收尾段，其他状态下窗口即将被主进程销毁
  if (state.phase !== 'work' || !state.graceActive) return;
  $('clock').textContent = fmt(state.remainingMs);
  const { remainingMs, phaseDurationMs } = state;
  $('bar').style.width = `${phaseDurationMs ? (remainingMs / phaseDurationMs) * 100 : 0}%`;
}

// 收尾提前收工：和主窗口 / 托盘的「立即去休息」是同一条命令
$('btnBreak').addEventListener('click', () => window.api.cmd('finishGrace'));

window.api.bootstrap().then(({ state }) => render(state));
window.api.onState(render);
