/** @type { import('@storybook/html-vite').Preview } */
export default {
  tags: ['autodocs'],
  parameters: { options: { storySort: { order: ['介绍', 'Activity v2'] } } },
  initialGlobals: { theme: 'light' },
  globalTypes: {
    theme: {
      description: '界面主题',
      toolbar: { title: '主题', icon: 'circlehollow', items: [
        { value: 'light', title: '浅色' }, { value: 'dark', title: '深色' },
      ], dynamicTitle: true },
    },
  },
};
