// 番茄钟状态机（纯逻辑，无 Electron 依赖，时钟可注入以便测试）
//
// 状态流转：
//   idle ──startWork──▶ work ──到点──▶ break ──到点──▶ breakOver ──startWork──▶ work …
//                        │                │
//                        │ pause/resume   │ grace()：回到 work 收尾 graceMin 分钟（每番茄一次），
//                        │ abandon ▶ idle │           结束后重新进入同类型完整休息
//                        │                │ skipBreak()：直接开始下一个番茄
//                        └── endFocus() 从任意状态回 idle（工作中未完成则记为放弃）
//
// 事件（EventEmitter）：
//   work-completed {startedAt, endedAt}   到点完成一个番茄（收尾推迟不会重复触发）
//   work-extended  {endedAt}              收尾段结束，修正上一条记录的结束时间
//   work-abandoned {startedAt, endedAt}   放弃/工作中结束专注
//   break-started  {breakType, graceReturn}
//   break-over     {breakType}
'use strict';

const { EventEmitter } = require('events');

const MIN = 60 * 1000;

const DEFAULT_CONFIG = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4, // 每完成 N 个番茄进入长休息；0 = 不用长休息
  graceMin: 3, // 「再给 N 分钟收尾」
};

class PomodoroTimer extends EventEmitter {
  constructor({ config = {}, now = Date.now, cycleCount = 0 } = {}) {
    super();
    this.now = now;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.phase = 'idle'; // idle | work | break | breakOver
    this.breakType = null; // short | long
    this.endsAt = 0;
    this.phaseDurationMs = 0;
    this.paused = false;
    this.pausedRemaining = 0;
    this.graceUsed = false;
    this.graceActive = false;
    this.pendingBreakType = null;
    this.cycleCount = cycleCount; // 自上次长休息以来完成的番茄数
    this.workStartedAt = 0;
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
  }

  setCycleCount(n) {
    this.cycleCount = n;
  }

  getState() {
    let remainingMs = 0;
    if (this.phase === 'work' || this.phase === 'break') {
      remainingMs = this.paused ? this.pausedRemaining : Math.max(0, this.endsAt - this.now());
    }
    return {
      phase: this.phase,
      breakType: this.breakType,
      paused: this.paused,
      remainingMs,
      phaseDurationMs: this.phaseDurationMs,
      graceUsed: this.graceUsed,
      graceActive: this.graceActive,
      cycleCount: this.cycleCount,
      workStartedAt: this.workStartedAt,
      config: { ...this.config },
    };
  }

  // idle / breakOver → 开始一个新番茄
  startWork() {
    if (this.phase !== 'idle' && this.phase !== 'breakOver') return false;
    this.phase = 'work';
    this.breakType = null;
    this.workStartedAt = this.now();
    this.phaseDurationMs = this.config.workMin * MIN;
    this.endsAt = this.workStartedAt + this.phaseDurationMs;
    this.paused = false;
    this.graceUsed = false;
    this.graceActive = false;
    return true;
  }

  pause() {
    if (this.phase !== 'work' || this.paused || this.graceActive) return false;
    this.pausedRemaining = Math.max(0, this.endsAt - this.now());
    this.paused = true;
    return true;
  }

  resume() {
    if (this.phase !== 'work' || !this.paused) return false;
    this.endsAt = this.now() + this.pausedRemaining;
    this.paused = false;
    return true;
  }

  // 放弃当前番茄（不计入完成）
  abandon() {
    if (this.phase !== 'work' || this.graceActive) return false;
    this.emit('work-abandoned', { startedAt: this.workStartedAt, endedAt: this.now() });
    this._toIdle(false);
    return true;
  }

  // 休息刚开始时「再给 N 分钟收尾」：回到工作，结束后重新进入完整休息
  grace() {
    if (this.phase !== 'break' || this.graceUsed) return false;
    this.graceUsed = true;
    this.graceActive = true;
    this.pendingBreakType = this.breakType;
    this.phase = 'work';
    this.breakType = null;
    this.phaseDurationMs = this.config.graceMin * MIN;
    this.endsAt = this.now() + this.phaseDurationMs;
    this.paused = false;
    return true;
  }

  // 收尾段提前结束，立即去休息
  finishGrace() {
    if (this.phase !== 'work' || !this.graceActive) return false;
    this.emit('work-extended', { endedAt: this.now() });
    this._enterBreak(this.pendingBreakType, true);
    return true;
  }

  // 跳过休息，直接开始下一个番茄
  skipBreak() {
    if (this.phase !== 'break') return false;
    if (this.breakType === 'long') this.cycleCount = 0;
    this.phase = 'breakOver';
    return this.startWork();
  }

  // 结束专注：回到 idle，循环计数清零
  endFocus() {
    if (this.phase === 'idle') return false;
    if (this.phase === 'work') {
      if (this.graceActive) {
        this.emit('work-extended', { endedAt: this.now() });
      } else {
        this.emit('work-abandoned', { startedAt: this.workStartedAt, endedAt: this.now() });
      }
    }
    this._toIdle(true);
    return true;
  }

  // 由宿主定期调用（以及系统唤醒后立即调用）
  tick() {
    if (this.paused) return;
    const now = this.now();
    if (this.phase === 'work' && now >= this.endsAt) {
      if (this.graceActive) {
        this.emit('work-extended', { endedAt: this.endsAt });
        this._enterBreak(this.pendingBreakType, true);
      } else {
        this.emit('work-completed', { startedAt: this.workStartedAt, endedAt: this.endsAt });
        this.cycleCount += 1;
        const { longEvery } = this.config;
        const type = longEvery > 0 && this.cycleCount % longEvery === 0 ? 'long' : 'short';
        this._enterBreak(type, false);
      }
    } else if (this.phase === 'break' && now >= this.endsAt) {
      this.phase = 'breakOver';
      if (this.breakType === 'long') this.cycleCount = 0;
      this.emit('break-over', { breakType: this.breakType });
    }
  }

  _enterBreak(type, graceReturn) {
    this.phase = 'break';
    this.breakType = type;
    this.graceActive = false;
    this.pendingBreakType = null;
    this.paused = false;
    this.phaseDurationMs = (type === 'long' ? this.config.longMin : this.config.shortMin) * MIN;
    this.endsAt = this.now() + this.phaseDurationMs;
    this.emit('break-started', { breakType: type, graceReturn });
  }

  _toIdle(resetCycle) {
    this.phase = 'idle';
    this.breakType = null;
    this.paused = false;
    this.graceActive = false;
    this.pendingBreakType = null;
    if (resetCycle) this.cycleCount = 0;
  }
}

module.exports = { PomodoroTimer, DEFAULT_CONFIG };
