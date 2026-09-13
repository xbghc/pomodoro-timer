// 主窗口的取景框：用真实 HTML/CSS 起一个 440×660 的 iframe，再调 MainView 渲染
import '../../src/renderer/views/main-view.js';
import mainHtml from '../../src/renderer/main.html?raw';
import themeCss from '../../src/renderer/theme.css?raw';
import mainCss from '../../src/renderer/main.css?raw';
import { windowFrame } from './frame.js';
import { DEFAULT_SETTINGS, SAMPLE_DATE, makeState } from './fixtures.js';

// 与 main.js 里 createMainWindow 的 BrowserWindow 尺寸一致
export const MAIN_SIZE = { width: 440, height: 660 };

export function mainWindow({
  tab = 'timer',
  state = makeState(),
  settings = DEFAULT_SETTINGS,
  history = [],
  date = SAMPLE_DATE,
  today = SAMPLE_DATE,
  update = { status: 'idle', version: '' },
  version = '1.10.1',
  theme = 'dark',
  note,
} = {}) {
  return windowFrame({ html: mainHtml, css: [themeCss, mainCss], ...MAIN_SIZE, note }, (body) => {
    const V = window.MainView;
    V.applyTheme(body, theme === 'dark');
    V.buildDial(body);
    V.activateTab(body, tab);
    V.renderTimer(body, state);
    V.renderTodayLine(body, history, today);
    V.renderHistory(body, { history, date, today });
    V.fillSettings(body, settings);
    V.renderUpdate(body, update);
    body.querySelector('#aboutVersion').textContent = `番茄钟 v${version}`;
  });
}
