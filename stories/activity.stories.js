import html from '../src/renderer/activity.html?raw';
import css from '../src/renderer/activity.css?raw';
import view from '../src/renderer/activity-view.js?raw';
import renderer from '../src/renderer/activity.js?raw';
import mock from './lib/activity-mock.js?raw';

function render(args, context) {
  const role = args.role || 'main';
  const frame = document.createElement('iframe');
  frame.title = `Activity v2 ${role} preview`;
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
  frame.style.cssText = `display:block;border:0;width:${role === 'due' ? 390 : 1100}px;max-width:100%;height:${role === 'due' ? 280 : role === 'break' ? 720 : 1000}px;`;
  const marker = "new URLSearchParams(location.search).get('role') || 'main'";
  if (!renderer.includes(marker)) throw new Error('Update the preview role adapter for the current renderer');
  const source = renderer.replace(marker, JSON.stringify(role));
  const config = JSON.stringify({ ...args, theme: context.globals.theme || 'light' }).replace(/</g, '\\u003c');
  const script = (code) => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
  // Only the isolated preview permits inline scripts. The production CSP is unchanged.
  frame.srcdoc = html.replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace(/<link[^>]+>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('</head>', `<style>${css}</style></head>`)
    .replace('</body>', `${script(mock + '\ninstallActivityPreview(' + config + ');')}${script(view)}${script(source)}</body>`);
  return frame;
}
export default {
  title: 'Activity v2', render, parameters: { layout: 'fullscreen' },
  args: { role: 'main', phase: 'work', empty: false, reminderDue: false, failure: '' },
  argTypes: { role: { control: 'select', options: ['main', 'due', 'break'] }, phase: { control: 'select', options: ['work', 'break', 'waiting'] } },
};
export const Working = { name: '工作与活动日历' };
export const Waiting = { name: '等待，不累计时间', args: { phase: 'waiting' } };
export const EmptyDay = { name: '没有实际记录', args: { phase: 'waiting', empty: true } };
export const Reminder = { name: '轻提醒，工作不中断', args: { role: 'due', reminderDue: true } };
export const Rest = { name: '休息遮罩', args: { role: 'break', phase: 'break' } };
export const Paused = { name: '存储错误时暂停', args: { failure: '示例：无法写入活动文件，请检查磁盘空间后重启。' } };
