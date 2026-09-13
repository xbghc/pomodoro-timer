// 全屏休息遮罩：真进休息时盖住所有显示器，副屏只留倒计时
import '../src/renderer/views/overlay-view.js';
import overlayHtml from '../src/renderer/overlay.html?raw';
import overlayCss from '../src/renderer/overlay.css?raw';
import { windowFrame } from './lib/frame.js';
import { breakOverState, breakState } from './lib/fixtures.js';

// 遮罩铺满整块屏幕：按 1920×1080 渲染，再整体缩到一半看，版式与真机一致
const SCREEN = { width: 1920, height: 1080, scale: 0.5 };
const NOTE = '按 1920×1080 的屏幕渲染，整体缩至 50% 显示';

function overlay({ state, mode = 'primary', tip = '眺望 6 米以外 20 秒，让眼睛歇歇', note = NOTE }) {
  return windowFrame({ html: overlayHtml, css: [overlayCss], ...SCREEN, note }, (body) => {
    body.classList.add(`mode-${mode}`);
    body.querySelector('#ovTip').textContent = tip;
    window.OverlayView.render(body, state);
  });
}

export default {
  title: '休息遮罩',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '点了「去休息」才会盖上的全屏遮罩，始终深色。倒计时只报整分钟；中间是复盘与下一步规划两个输入区，' +
          '底部留着「暂时让开」和弱化的「跳过休息」。副屏（mode-secondary）只显示倒计时，交互元素全部隐藏。',
      },
    },
  },
  argTypes: {
    remainingMin: { control: { type: 'range', min: 1, max: 30 } },
    breakType: { control: 'inline-radio', options: ['short', 'long'] },
    cycleCount: { control: { type: 'range', min: 0, max: 4 } },
    plan: { control: 'text', description: '本番茄的规划，写复盘时对照用' },
    mode: { control: 'inline-radio', options: ['primary', 'secondary'], description: '主屏 / 副屏' },
  },
  args: { remainingMin: 4, breakType: 'short', cycleCount: 1, plan: '', mode: 'primary' },
  render: (args) =>
    overlay({
      state: breakState({
        remainingMin: args.remainingMin,
        breakType: args.breakType,
        cycleCount: args.cycleCount,
        plan: args.plan,
      }),
      mode: args.mode,
    }),
};

export const ShortBreak = {
  name: '短休息',
  args: { remainingMin: 4, cycleCount: 1 },
};

export const LongBreak = {
  name: '长休息',
  args: { remainingMin: 12, breakType: 'long', cycleCount: 4 },
};

export const WithPlan = {
  name: '带着本次规划',
  parameters: { docs: { description: { story: '番茄开始时写过规划的话，复盘框上方会把它原样摆出来对照。' } } },
  args: { plan: '把历史页的日期导航接上', remainingMin: 3 },
};

export const BreakOver = {
  name: '休息结束',
  parameters: { docs: { description: { story: '倒计时整块收掉，位置让给「开始下一个番茄」——人不在座位上时计时不空跑。' } } },
  render: (args) =>
    overlay({
      state: breakOverState({ breakType: args.breakType, cycleCount: args.cycleCount, plan: args.plan }),
      mode: args.mode,
      tip: '休息好了？回到座位就开始吧',
    }),
};

export const Secondary = {
  name: '副屏',
  parameters: { docs: { description: { story: '副屏只留标题、倒计时与进度条，按钮和复盘框都不出现，避免多屏各点一次。' } } },
  args: { mode: 'secondary', remainingMin: 4 },
};
