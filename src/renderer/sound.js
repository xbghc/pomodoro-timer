// WebAudio 合成的柔和双音铃声，不依赖音频素材文件
'use strict';

let _audioCtx = null;

function _ctx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

// 预热音频上下文：遮罩提前预建时调用，免得铃声首播时才现建 AudioContext
function warmAudio() {
  try {
    _ctx();
  } catch {
    /* 无音频设备的环境下静默降级 */
  }
}

// kind: 'work-end'（下行，该休息了）| 'break-end'（上行，休息结束）
// volume: 0..1
function playChime(kind, volume = 0.6) {
  if (volume <= 0) return;
  const ctx = _ctx();
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + 0.03;
  const notes =
    kind === 'break-end'
      ? [
          { f: 523.25, at: 0, d: 0.9 },
          { f: 783.99, at: 0.18, d: 1.5 },
        ]
      : [
          { f: 880, at: 0, d: 1.0 },
          { f: 659.25, at: 0.22, d: 1.6 },
        ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.f;
    const peak = 0.28 * volume;
    gain.gain.setValueAtTime(0, t + n.at);
    gain.gain.linearRampToValueAtTime(peak, t + n.at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + n.at + n.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + n.at);
    osc.stop(t + n.at + n.d + 0.05);
  }
}
