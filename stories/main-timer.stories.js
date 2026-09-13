// 主窗口「计时」页：番茄循环里的每一个状态各摆一格
import { mainWindow } from './lib/main-window.js';
import {
  DEFAULT_SETTINGS,
  breakDueState,
  breakOverState,
  breakState,
  makeState,
  workState,
} from './lib/fixtures.js';

function stateFromArgs(a) {
  const opts = { cycleCount: a.cycleCount, breakType: a.breakType, plan: a.plan };
  if (a.phase === 'work') return workState({ ...opts, remainingMin: a.remainingMin, paused: a.paused });
  if (a.phase === 'breakDue') return breakDueState({ ...opts, workedMin: a.workedMin });
  if (a.phase === 'break') return breakState({ ...opts, remainingMin: a.remainingMin });
  if (a.phase === 'breakOver') return breakOverState(opts);
  return makeState({ pendingPlan: a.plan });
}

export default {
  title: '主窗口 · 计时',
  parameters: {
    docs: {
      description: {
        component:
          '440×660 的主窗口，计时页是一块 60 分钟刻度的厨房计时器盘面。' +
          '工作时读 mm:ss，休息只读整分钟；拖着不休息时状态标签会跟着右下角小窗一起变红。',
      },
    },
  },
  argTypes: {
    phase: {
      control: 'select',
      options: ['idle', 'work', 'breakDue', 'break', 'breakOver'],
      description: '计时状态机所处阶段',
    },
    breakType: { control: 'inline-radio', options: ['short', 'long'], description: '休息类型' },
    remainingMin: { control: { type: 'range', min: 1, max: 60 }, description: '剩余分钟（工作/休息中）' },
    workedMin: { control: { type: 'range', min: 1, max: 120 }, description: '已连续工作分钟（该休息了）' },
    cycleCount: { control: { type: 'range', min: 0, max: 4 }, description: '距上次长休息已完成的番茄数' },
    paused: { control: 'boolean' },
    plan: { control: 'text', description: '本番茄的规划' },
  },
  args: {
    phase: 'idle',
    breakType: 'short',
    remainingMin: 18,
    workedMin: 25,
    cycleCount: 1,
    paused: false,
    plan: '',
  },
  render: (args, { globals }) => mainWindow({ state: stateFromArgs(args), theme: globals.theme }),
};

export const Idle = {
  name: '空闲',
  args: { phase: 'idle' },
};

export const IdleInWorkBlock = {
  name: '空闲 · 工作时段内',
  parameters: { docs: { description: { story: '开了「按时段自动作息」后，空闲态会说明当前处在哪一段、几点自动开始。' } } },
  render: (args, { globals }) =>
    mainWindow({
      state: makeState({ schedule: { enabled: true, inWork: true, blockEnd: '18:00', nextStart: null } }),
      settings: DEFAULT_SETTINGS,
      theme: globals.theme,
    }),
};

export const Working = {
  name: '专注中',
  args: { phase: 'work', remainingMin: 18, plan: '把历史页的日期导航接上' },
};

export const Paused = {
  name: '已暂停',
  args: { phase: 'work', remainingMin: 12, paused: true, plan: '开个短会' },
};

export const BreakDue = {
  name: '该休息了',
  args: { phase: 'breakDue', workedMin: 25, cycleCount: 1 },
};

export const BreakDueOvertime = {
  name: '该休息了 · 已超健康上限',
  parameters: {
    docs: { description: { story: '拖着不休息超过健康上限（默认 50 分钟），状态标签变红，能休的时长也按拖堂补到了 10 分钟。' } },
  },
  args: { phase: 'breakDue', workedMin: 75, cycleCount: 1 },
};

export const LongBreakDue = {
  name: '该长休息了',
  args: { phase: 'breakDue', breakType: 'long', workedMin: 25, cycleCount: 4 },
};

export const Breaking = {
  name: '休息中',
  args: { phase: 'break', remainingMin: 4, cycleCount: 1 },
};

export const BreakOver = {
  name: '休息结束',
  args: { phase: 'breakOver', cycleCount: 2 },
};
