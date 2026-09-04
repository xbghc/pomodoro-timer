// 番茄钟状态机（纯逻辑，无 Electron 依赖，时钟可注入以便测试）
//
// 状态流转：
//   idle ──startWork──▶ work ──到点──▶ breakDue ──startBreak──▶ break ──到点──▶ breakOver ──startWork──▶ work …
//                        │               │                        │                 │
//                        │ pause/resume  │ 无限期等人来点，        │ skipBreak()     └─ startWork()
//                        │ abandon ▶idle │ 不会自己进休息          │
//                        │               └ skipBreak()：直接开始下一个番茄
//                        └── endFocus() 从任意状态回 idle（工作中未完成则记为放弃）
//
// 「不强制休息」的设计要点：番茄到点只落到 breakDue（该休息了），要不要休息由人决定。
// 拖着不去休息的那段时间照样算工作，会按比例把欠的休息补进 break 时长（见 _breakMs）。
// 但不强制不等于放任：连续工作超过 autoEndMin 就自动收摊回 idle（见 _checkAutoEnd）。
//
// 事件（EventEmitter）：
//   work-completed {startedAt, endedAt}   到点完成一个番茄
//   work-abandoned {startedAt, endedAt}   放弃/工作中结束专注/自动收摊时番茄没走完
//   break-due      {breakType}            该休息了，等人点「去休息」
//   break-started  {breakType, durationMs}
//   break-over     {breakType}
//   auto-ended     {workedMs, inWork}     连续工作超上限，已自动结束专注
'use strict';

const { EventEmitter } = require('events');

const MIN = 60 * 1000;

// 拖堂补偿的封顶倍数：挂机一下午回来，也不该换到一个荒唐的长休息
const MAX_BREAK_SCALE = 2;
// 「接近健康上限」的黄灯阈值（占健康上限的比例）
const WARN_RATIO = 0.8;

const DEFAULT_CONFIG = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4, // 每完成 N 个番茄进入长休息；0 = 不用长休息
  healthMaxMin: 50, // 连续工作的健康上限（分钟）：超过就把「该休息了」的提醒变红
  autoEndMin: 120, // 连续工作超过它就自动结束专注回到空闲；0 = 关闭
};

class PomodoroTimer extends EventEmitter {
  constructor({ config = {}, now = Date.now, cycleCount = 0 } = {}) {
    super();
    this.now = now;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.phase = 'idle'; // idle | work | breakDue | break | breakOver
    this.breakType = null; // short | long
    this.endsAt = 0;
    this.phaseDurationMs = 0;
    this.paused = false;
    this.pausedRemaining = 0;
    this.pausedAt = 0;
    this.pausedTotalMs = 0; // 本轮番茄累计暂停时长，从「实际工作时间」里扣掉
    this.cycleCount = cycleCount; // 自上次长休息以来完成的番茄数
    this.workStartedAt = 0;
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
  }

  setCycleCount(n) {
    this.cycleCount = n;
  }

  // 本轮番茄真正在工作的时长（扣掉暂停）。到点后进入 breakDue 仍继续累加：
  // 拖着不去休息的那段，人还在用眼用脑，算作工作。
  workedMs() {
    if (this.phase !== 'work' && this.phase !== 'breakDue') return 0;
    const until = this.paused ? this.pausedAt : this.now();
    return Math.max(0, until - this.workStartedAt - this.pausedTotalMs);
  }

  // 计划本身就长过健康上限时以计划为准 —— 用户自己设的 50 分钟番茄不该一开工就报警
  healthMaxMs() {
    return Math.max(this.config.healthMaxMin, this.config.workMin) * MIN;
  }

  // 0 健康 / 1 接近健康上限 / 2 已超健康上限（界面据此变色）
  overworkLevel() {
    const worked = this.workedMs();
    const max = this.healthMaxMs();
    if (worked > max) return 2;
    if (worked > max * WARN_RATIO) return 1;
    return 0;
  }

  getState() {
    let remainingMs = 0;
    let phaseDurationMs = this.phaseDurationMs;
    if (this.phase === 'work' || this.phase === 'break') {
      remainingMs = this.paused ? this.pausedRemaining : Math.max(0, this.endsAt - this.now());
    } else if (this.phase === 'breakDue') {
      // 还没进休息：把「现在去休息能休多久」当作剩余时间给界面，拖得越久这个数越大
      phaseDurationMs = this._breakMs(this.breakType);
      remainingMs = phaseDurationMs;
    }
    return {
      phase: this.phase,
      breakType: this.breakType,
      paused: this.paused,
      remainingMs,
      phaseDurationMs,
      workedMs: this.workedMs(),
      overwork: this.overworkLevel(),
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
    this.pausedAt = 0;
    this.pausedTotalMs = 0;
    return true;
  }

  pause() {
    if (this.phase !== 'work' || this.paused) return false;
    this.pausedRemaining = Math.max(0, this.endsAt - this.now());
    this.pausedAt = this.now();
    this.paused = true;
    return true;
  }

  resume() {
    if (this.phase !== 'work' || !this.paused) return false;
    this.pausedTotalMs += Math.max(0, this.now() - this.pausedAt);
    this.endsAt = this.now() + this.pausedRemaining;
    this.paused = false;
    return true;
  }

  // 放弃当前番茄（不计入完成）
  abandon() {
    if (this.phase !== 'work') return false;
    this.emit('work-abandoned', { startedAt: this.workStartedAt, endedAt: this.now() });
    this._toIdle(false);
    return true;
  }

  // 「该休息了」小窗/托盘上点「去休息」：这才真正进入休息
  startBreak() {
    if (this.phase !== 'breakDue') return false;
    this._enterBreak(this.breakType);
    return true;
  }

  // 跳过休息，直接开始下一个番茄（该休息了 / 休息中都可用）
  skipBreak() {
    if (this.phase !== 'breakDue' && this.phase !== 'break') return false;
    if (this.breakType === 'long') this.cycleCount = 0;
    this.phase = 'breakOver';
    return this.startWork();
  }

  // 结束专注：回到 idle，循环计数清零
  endFocus() {
    if (this.phase === 'idle') return false;
    if (this.phase === 'work') {
      this.emit('work-abandoned', { startedAt: this.workStartedAt, endedAt: this.now() });
    }
    this._toIdle(true);
    return true;
  }

  // 由宿主定期调用（以及系统唤醒后立即调用）
  tick() {
    if (this.paused) return;
    const now = this.now();
    if (this.phase === 'work' && now >= this.endsAt) {
      this.emit('work-completed', { startedAt: this.workStartedAt, endedAt: this.endsAt });
      this.cycleCount += 1;
      const { longEvery } = this.config;
      const type = longEvery > 0 && this.cycleCount % longEvery === 0 ? 'long' : 'short';
      this._enterBreakDue(type);
    } else if (this.phase === 'break' && now >= this.endsAt) {
      this.phase = 'breakOver';
      if (this.breakType === 'long') this.cycleCount = 0;
      this.emit('break-over', { breakType: this.breakType });
    }
    // breakDue 本身不设超时（不强制休息是这个阶段存在的全部理由），
    // 兜底交给下面这条：连着干太久就整个收摊，省得小窗在右下角挂到天亮
    this._checkAutoEnd();
  }

  // 连续工作超上限 → 自动结束专注。放在到点处理之后：番茄能正常走完就先记完成，
  // 落到 breakDue 再收摊，不至于把一个刚好走满的番茄记成放弃。
  _checkAutoEnd() {
    const limit = this.config.autoEndMin;
    if (!(limit > 0)) return;
    if (this.phase !== 'work' && this.phase !== 'breakDue') return;
    const worked = this.workedMs();
    if (worked < limit * MIN) return;
    this.emit('auto-ended', { workedMs: worked, inWork: this.phase === 'work' });
    this.endFocus(); // 工作中被截断会顺带记一条放弃，breakDue 下番茄早已记完成
  }

  // 该给多长的休息：超出计划的那段工作按设置里的 工作:休息 比例折算补上，封顶 MAX_BREAK_SCALE 倍
  _breakMs(type) {
    const base = (type === 'long' ? this.config.longMin : this.config.shortMin) * MIN;
    const planned = this.config.workMin * MIN;
    if (planned <= 0) return base;
    const overtime = Math.max(0, this.workedMs() - planned);
    return Math.min(base + overtime * (base / planned), base * MAX_BREAK_SCALE);
  }

  _enterBreakDue(type) {
    this.phase = 'breakDue';
    this.breakType = type;
    this.paused = false;
    this.endsAt = 0;
    this.phaseDurationMs = 0; // breakDue 的「时长」是动态的，由 getState 现算
    this.emit('break-due', { breakType: type });
  }

  _enterBreak(type) {
    const durationMs = this._breakMs(type); // 必须在切 phase 之前算：它依赖 workedMs()
    this.phase = 'break';
    this.breakType = type;
    this.paused = false;
    this.phaseDurationMs = durationMs;
    this.endsAt = this.now() + durationMs;
    this.emit('break-started', { breakType: type, durationMs });
  }

  _toIdle(resetCycle) {
    this.phase = 'idle';
    this.breakType = null;
    this.paused = false;
    if (resetCycle) this.cycleCount = 0;
  }
}

module.exports = { PomodoroTimer, DEFAULT_CONFIG };
