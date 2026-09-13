// 「该休息了」右下角小窗：番茄到点先挂在这儿，点了「去休息」才真进休息
import '../src/renderer/views/due-view.js';
import dueHtml from '../src/renderer/due.html?raw';
import dueCss from '../src/renderer/due.css?raw';
import { windowFrame } from './lib/frame.js';
import { breakDueState } from './lib/fixtures.js';

// 与 main.js 里 DUE_SIZE 一致
const EXPANDED = { width: 312, height: 62 };
const COLLAPSED = { width: 40, height: 40 };

function dueWindow({ state, collapsed = false, note }) {
  const size = collapsed ? COLLAPSED : EXPANDED;
  return windowFrame({ html: dueHtml, css: [dueCss], ...size, note }, (body) => {
    window.DueView.setCollapsed(body, collapsed);
    window.DueView.render(body, state);
  });
}

export default {
  title: '该休息了小窗',
  parameters: {
    docs: {
      description: {
        component:
          '番茄到点后挂在屏幕右下角的小窗（312×62），不抢焦点、可拖走，也可以点「›」收成 40×40 的小把手。' +
          '拖着不休息的时间越长整块越红：绿 → 琥珀 → 红，收起后这层健康色仍在余光里。',
      },
    },
  },
  argTypes: {
    workedMin: { control: { type: 'range', min: 1, max: 120 }, description: '已连续工作分钟' },
    breakType: { control: 'inline-radio', options: ['short', 'long'] },
    collapsed: { control: 'boolean', description: '是否收成小把手' },
  },
  args: { workedMin: 25, breakType: 'short', collapsed: false },
  render: (args) =>
    dueWindow({
      state: breakDueState({ workedMin: args.workedMin, breakType: args.breakType }),
      collapsed: args.collapsed,
    }),
};

export const Healthy = {
  name: '刚到点（绿）',
  args: { workedMin: 25 },
};

export const Warning = {
  name: '接近健康上限（琥珀）',
  parameters: { docs: { description: { story: '连续工作超过健康上限的八成就先变琥珀，提醒但不喊。' } } },
  args: { workedMin: 45 },
};

export const Overwork = {
  name: '已超健康上限（红）',
  parameters: { docs: { description: { story: '超过上限后连边框一起变红；欠下的休息已按比例补进「休息 10 分钟」。' } } },
  args: { workedMin: 75 },
};

export const LongBreakDue = {
  name: '该长休息了',
  args: { workedMin: 25, breakType: 'long' },
};

export const Collapsed = {
  name: '收起成把手',
  parameters: { docs: { description: { story: '收起只是换了窗口尺寸，计时不受影响；整块染成当前健康色。' } } },
  args: { workedMin: 75, collapsed: true },
};
