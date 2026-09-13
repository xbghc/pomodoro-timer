// 把一个真实窗口装进 <iframe> 里显示。
//
// 三个窗口的 CSS 都直接写在 body 上（遮罩的深色底、小窗的健康色边框、主窗口的主题变量），
// 放进 Storybook 的画布会互相污染，也拿不到真实的窗口尺寸；套一层同源 iframe 就都解决了：
// 里面是原样的 src/renderer HTML + CSS，外面按 main.js 里的 BrowserWindow 尺寸给宽高。
// 只摘掉 <script> 和 CSP <meta>：脚本要接 window.api，这里不需要，渲染由 story 直接调 *View 完成。

function buildDoc(html, css, theme) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, link[rel="stylesheet"], meta[http-equiv]').forEach((n) => n.remove());
  const style = doc.createElement('style');
  style.textContent = css.join('\n');
  doc.head.appendChild(style);
  if (theme) doc.documentElement.dataset.theme = theme;
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * @param {object} opts
 * @param {string} opts.html    src/renderer 下的 HTML 原文（?raw 导入）
 * @param {string[]} opts.css   该窗口的样式表原文（?raw 导入），按 HTML 里的顺序
 * @param {number} opts.width   窗口宽（px），与主进程建窗时一致
 * @param {number} opts.height  窗口高（px）
 * @param {number} [opts.scale]  等比缩放，遮罩这种整屏窗口用它按原尺寸渲染、缩着看
 * @param {string} [opts.theme] 写到 <html data-theme> 上，仅主窗口用
 * @param {string} [opts.note]  框下方的一行说明
 * @param {(body: HTMLElement) => void} paint  iframe 就绪后的渲染回调，拿到的是窗口的 <body>
 */
export function windowFrame({ html, css, width, height, scale = 1, theme, note }, paint) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:inline-flex;flex-direction:column;gap:8px;padding:16px;max-width:100%';

  // 缩放的是整块 iframe：里面仍按真实窗口尺寸布局，px 写死的字号间距才不会走样
  const box = document.createElement('div');
  box.style.cssText = `width:${width * scale}px;height:${height * scale}px;overflow:hidden;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);background:#141210;max-width:100%`;

  const frame = document.createElement('iframe');
  frame.title = '窗口预览';
  frame.width = width;
  frame.height = height;
  frame.style.cssText = `border:0;display:block;transform:scale(${scale});transform-origin:top left`;
  frame.srcdoc = buildDoc(html, css, theme);
  frame.addEventListener('load', () => paint(frame.contentDocument.body));
  box.appendChild(frame);
  wrap.appendChild(box);

  if (note) {
    const cap = document.createElement('p');
    cap.textContent = note;
    cap.style.cssText =
      "margin:0;font:12px/1.5 'Segoe UI','Microsoft YaHei',system-ui,sans-serif;color:#efebe3;opacity:.75";
    wrap.appendChild(cap);
  }
  return wrap;
}
