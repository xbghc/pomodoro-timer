// story 用的假数据：形状照搬 main.js 里 fullState() 广播的那份状态，
// 以及 store 里 settings.json / history.json 的结构，改一处就能对齐真实应用。

const MIN = 60 * 1000;

// 与 timer-core.js 的 DEFAULT_CONFIG 一致
export const DEFAULT_CONFIG = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  healthMaxMin: 50,
  autoEndMin: 120,
};

// 与 main.js 的 DEFAULT_SETTINGS + schedule.js 的 DEFAULT_SCHEDULE 一致
export const DEFAULT_SETTINGS = {
  ...DEFAULT_CONFIG,
  soundOn: true,
  soundVolume: 0.6,
  theme: 'system',
  autoStart: true,
  schedule: {
    enabled: true,
    blocks: [
      { start: '10:00', end: '12:00', workMin: 50, shortMin: 10, longMin: 15, longEvery: 0 },
      { start: '13:30', end: '18:00', workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 },
      { start: '19:30', end: '22:30', workMin: 45, shortMin: 15, longMin: 15, longEvery: 0 },
    ],
  },
};

const IDLE_SCHEDULE = { enabled: false, inWork: false, blockEnd: null, nextStart: null };

/** 造一份广播状态；不传的字段用空闲态的默认值 */
export function makeState(overrides = {}) {
  return {
    phase: 'idle',
    breakType: null,
    paused: false,
    remainingMs: 0,
    phaseDurationMs: 0,
    workedMs: 0,
    overwork: 0,
    cycleCount: 0,
    workStartedAt: 0,
    plan: '',
    pendingPlan: '',
    schedule: IDLE_SCHEDULE,
    ...overrides,
    config: { ...DEFAULT_CONFIG, ...overrides.config },
  };
}

/** 工作中：剩 remainingMin 分钟 */
export function workState({ remainingMin = 18, cycleCount = 1, paused = false, plan = '', config } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return makeState({
    phase: 'work',
    paused,
    remainingMs: remainingMin * MIN,
    phaseDurationMs: cfg.workMin * MIN,
    workedMs: (cfg.workMin - remainingMin) * MIN,
    cycleCount,
    plan,
    config: cfg,
  });
}

/** 该休息了：已连续工作 workedMin 分钟，拖堂会把能休的时长撑大（见 timer-core 的 _breakMs） */
export function breakDueState({ workedMin = 25, breakType = 'short', cycleCount = 1, config } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const base = (breakType === 'long' ? cfg.longMin : cfg.shortMin) * MIN;
  const overtime = Math.max(0, workedMin * MIN - cfg.workMin * MIN);
  const breakMs = Math.min(base + overtime * (base / (cfg.workMin * MIN)), base * 2);
  const healthMaxMs = Math.max(cfg.healthMaxMin, cfg.workMin) * MIN;
  const worked = workedMin * MIN;
  return makeState({
    phase: 'breakDue',
    breakType,
    remainingMs: breakMs,
    phaseDurationMs: breakMs,
    workedMs: worked,
    overwork: worked > healthMaxMs ? 2 : worked > healthMaxMs * 0.8 ? 1 : 0,
    cycleCount,
    config: cfg,
  });
}

/** 休息中：剩 remainingMin 分钟 */
export function breakState({ remainingMin = 4, breakType = 'short', cycleCount = 1, plan = '', config } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const total = (breakType === 'long' ? cfg.longMin : cfg.shortMin) * MIN;
  return makeState({
    phase: 'break',
    breakType,
    remainingMs: remainingMin * MIN,
    phaseDurationMs: total,
    cycleCount,
    plan,
    config: cfg,
  });
}

/** 休息结束，等人回座位点「开始下一个番茄」 */
export function breakOverState({ breakType = 'short', cycleCount = 2, plan = '', config } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return makeState({
    phase: 'breakOver',
    breakType,
    phaseDurationMs: (breakType === 'long' ? cfg.longMin : cfg.shortMin) * MIN,
    cycleCount,
    plan,
    config: cfg,
  });
}

// 历史页用固定的一天，story 截图不随运行日期变动
export const SAMPLE_DATE = '2026-03-05';

const at = (h, m) => new Date(2026, 2, 5, h, m).getTime();

export const SAMPLE_HISTORY = [
  {
    id: '1',
    startedAt: at(9, 30),
    endedAt: at(9, 55),
    status: 'completed',
    plan: '写周报开头',
    note: '开头写完了，数据还差一节',
  },
  {
    id: '2',
    startedAt: at(10, 5),
    endedAt: at(10, 30),
    status: 'completed',
    plan: '补周报数据',
    note: '',
  },
  {
    id: '3',
    startedAt: at(10, 40),
    endedAt: at(10, 48),
    status: 'abandoned',
    plan: '改 bug',
    note: '',
  },
  {
    id: '4',
    startedAt: at(14, 0),
    endedAt: at(14, 25),
    status: 'completed',
    plan: '',
    note: '看完了一章文档',
  },
  {
    id: '5',
    startedAt: at(14, 35),
    endedAt: at(15, 0),
    status: 'completed',
    plan: '重构计时状态机',
    note: '拆出了纯逻辑部分，测试补齐',
  },
];
