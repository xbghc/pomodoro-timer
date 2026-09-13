/** @type { import('@storybook/html-vite').Preview } */
const preview = {
  // 每组自动生成一页文档：把 story 里写的说明和 Controls 汇总成一页
  tags: ['autodocs'],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i } },
    options: {
      // 侧边栏按窗口排，组内按「空闲 → 专注 → 该休息了 → 休息」的真实流程走
      storySort: {
        order: ['介绍', '主窗口 · 计时', '主窗口 · 历史', '主窗口 · 设置', '该休息了小窗', '休息遮罩'],
      },
    },
    backgrounds: {
      options: {
        canvas: { name: '画布', value: '#8b867c' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'canvas' },
    theme: 'dark',
  },
  // 主窗口跟随系统深浅色，这里用工具栏手动切；遮罩与小窗按设计恒为深色，不受它影响
  globalTypes: {
    theme: {
      description: '主窗口主题',
      toolbar: {
        title: '主题',
        icon: 'circlehollow',
        items: [
          { value: 'dark', icon: 'circle', title: '深色' },
          { value: 'light', icon: 'circlehollow', title: '浅色' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
