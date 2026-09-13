// 主窗口「历史」页：按天翻看番茄记录
import { mainWindow } from './lib/main-window.js';
import { SAMPLE_DATE, SAMPLE_HISTORY, makeState } from './lib/fixtures.js';

export default {
  title: '主窗口 · 历史',
  parameters: {
    docs: {
      description: {
        component: '按天翻看：每条记录是起止时间 + 完成/放弃标记 + 规划与复盘，顶部是当天的汇总。',
      },
    },
  },
  render: (args, { globals }) =>
    mainWindow({
      tab: 'history',
      state: makeState(),
      history: args.history,
      date: args.date,
      today: SAMPLE_DATE,
      theme: globals.theme,
    }),
  args: { history: SAMPLE_HISTORY, date: SAMPLE_DATE },
  argTypes: { history: { control: 'object' }, date: { control: 'text' } },
};

export const Records = {
  name: '有记录的一天',
};

export const NoPlanOrNote = {
  name: '缺规划 / 缺复盘',
  parameters: {
    docs: { description: { story: '写了规划没复盘显示「未复盘」，两者都没有显示「未记录」，都是弱化的灰字。' } },
  },
  args: {
    history: SAMPLE_HISTORY.filter((r) => !r.note),
  },
};

export const EmptyDay = {
  name: '空的一天',
  args: { date: '2026-03-04' },
};
