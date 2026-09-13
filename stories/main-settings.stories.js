// 主窗口「设置」页：时长、工作时段、提醒、外观、关于
import { mainWindow } from './lib/main-window.js';
import { DEFAULT_SETTINGS, makeState } from './lib/fixtures.js';

export default {
  title: '主窗口 · 设置',
  parameters: {
    docs: {
      description: {
        component: '一页到底的设置。工作时段三段各带自己的节奏参数；「关于」一栏兼作更新入口。',
      },
    },
  },
  render: (args, { globals }) =>
    mainWindow({
      tab: 'settings',
      state: makeState(),
      settings: args.settings,
      update: args.update,
      theme: globals.theme,
    }),
  args: { settings: DEFAULT_SETTINGS, update: { status: 'idle', version: '' } },
  argTypes: {
    settings: { control: 'object' },
    update: { control: 'object', description: '更新状态：dev / idle / checking / none / downloading / ready / error' },
  },
};

export const Default = {
  name: '默认设置',
};

export const ScheduleOff = {
  name: '关掉工作时段',
  args: { settings: { ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: false } } },
};

export const UpdateDownloading = {
  name: '更新下载中',
  args: { update: { status: 'downloading', version: '1.11.0' } },
};

export const UpdateReady = {
  name: '更新已就绪',
  parameters: { docs: { description: { story: '下载完成后按钮变成「重启并更新」，提示语点亮。' } } },
  args: { update: { status: 'ready', version: '1.11.0' } },
};
