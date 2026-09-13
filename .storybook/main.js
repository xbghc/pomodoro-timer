/** @type { import('@storybook/html-vite').StorybookConfig } */
export default {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.js'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
  // 三个窗口各自装进 <iframe>，story 里用 ?raw 直接读 src/renderer 下的真身
  core: { disableTelemetry: true },
};
