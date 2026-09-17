// 「该休息了」小窗摆在哪（纯逻辑，无 Electron 依赖）：
// 小窗贴着某块屏 workArea 的右缘，收起时是一条窄把手，鼠标往右一甩就该撞上它。
// displays 形如 Electron 的 Display：{ id, bounds, workArea }，都是 DIP 坐标。
'use strict';

// 两态尺寸：展开是完整卡片，收起只剩一条贴着屏幕右缘的窄把手。
// 收起后仍带着健康色（绿/琥珀/红），让开了地方但不丢提醒。
// 两态等高、共用同一个右下角锚点，展开只向左长 —— 这条是硬性的，理由见 dueBounds。
const DUE_SIZE = {
  expanded: { width: 312, height: 62 },
  collapsed: { width: 18, height: 62 },
};

// 小窗离任务栏上沿留的空隙。左右不留：贴死屏幕右缘。
const DUE_GAP = 16;

// 窗口故意往屏幕外多伸出这么一点，防的是 DIP 换算物理像素时的舍入：缩放 150% 的 2560 宽屏，
// workArea 右缘是 1706.67 DIP，零头若被舍掉，窗口右缘就可能差出最后一列像素 ——
// 鼠标甩到头正好停在那一列上，悬在窗口外面，把手就蹭不开了。（防御性的，没在 Windows 上实际撞见过）
// 伸出去的部分落在屏外，看不见也不碍事。
const DUE_OVERHANG = 2;

// 小窗在这块屏上占的那一截高度（两态等高）
function dockBand(display) {
  const bottom = display.workArea.y + display.workArea.height - DUE_GAP;
  return { top: bottom - DUE_SIZE.expanded.height, bottom };
}

// 这块屏的右缘在小窗那一截高度上是不是「墙」：右边没有别的屏接着，鼠标甩过去会停住。
// 宁严勿松：右边只要有屏和这截高度重叠就算不是墙，不去细算它是否正好挨着 ——
// 混合 DPI 下各屏的 DIP 坐标有舍入，精确判相邻不可靠。误判成「不是墙」顶多换一块屏放；
// 误判成「是墙」则鼠标直接甩到隔壁屏去。
// 物理上屏与屏不重叠，和这截高度重叠的别的屏只可能整个在左边或整个在右边，比左上角 x 就够分。
function hasWallOnRight(display, displays) {
  const { top, bottom } = dockBand(display);
  return !displays.some(
    (o) =>
      o.id !== display.id &&
      o.bounds.x > display.bounds.x &&
      o.bounds.y < bottom &&
      o.bounds.y + o.bounds.height > top
  );
}

// 挑放小窗的那块屏：主屏右缘是墙就用主屏（单屏、主屏在最右、笔记本垫在外接屏下面都落在这里）；
// 主屏右边还接着别的屏时，挪到右缘是墙的屏里最靠右的那块。
// 不按鼠标所在的屏挑：主屏在左的双屏布局里鼠标多半就在主屏上，把手贴在两屏接缝处，一甩就越过去了。
function pickDueDisplay(displays, primaryId) {
  const primary = displays.find((d) => d.id === primaryId) || displays[0];
  if (hasWallOnRight(primary, displays)) return primary;
  const right = (d) => d.bounds.x + d.bounds.width;
  const walls = displays.filter((d) => hasWallOnRight(d, displays));
  if (walls.length === 0) return primary; // 走不到：x 最大的那块右边不可能再有屏，必是墙
  return walls.reduce((best, d) => (right(d) > right(best) ? d : best));
}

// 用 workArea 而非 bounds：贴边但不压任务栏（挑屏看的是 bounds —— 墙在屏幕物理边缘）。
// 等右缘、等高是硬性要求：收起态的矩形必须整个落在展开态矩形里。否则鼠标蹭到把手、
// 窗口一展开就从指针底下挪开，指针落到窗外又立刻缩回去，来回抖个不停（hover 展开见 due.js）。
function dueBounds(displays, primaryId, collapsed) {
  const wa = pickDueDisplay(displays, primaryId).workArea;
  const size = collapsed ? DUE_SIZE.collapsed : DUE_SIZE.expanded;
  return {
    x: wa.x + wa.width - size.width + DUE_OVERHANG,
    y: wa.y + wa.height - DUE_GAP - size.height,
    ...size,
  };
}

module.exports = { DUE_SIZE, pickDueDisplay, dueBounds };
