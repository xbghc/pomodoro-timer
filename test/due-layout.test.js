'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { DUE_SIZE, pickDueDisplay, dueBounds } = require('../src/main/due-layout.js');

// 任务栏在底部、高 48 的一块屏
const screenAt = (id, x, y, width, height) => ({
  id,
  bounds: { x, y, width, height },
  workArea: { x, y, width, height: height - 48 },
});

// 两态都得满足的几何约束，每种布局都查一遍
function assertDocked(displays, primaryId, expectedId) {
  const target = displays.find((d) => d.id === expectedId);
  assert.equal(pickDueDisplay(displays, primaryId).id, expectedId);
  const right = target.workArea.x + target.workArea.width;
  const open = dueBounds(displays, primaryId, false);
  const shut = dueBounds(displays, primaryId, true);
  for (const b of [open, shut]) {
    // 盖住这块屏的最后一列像素：鼠标甩到头停下的地方必须在窗口上
    assert.ok(b.x < right - 1 && b.x + b.width > right, '盖住右缘最后一列');
    assert.ok(b.y + b.height <= target.workArea.y + target.workArea.height, '不压任务栏');
  }
  // 收起态整个落在展开态里，展开只向左长，否则 hover 展开会来回抖
  assert.equal(shut.x + shut.width, open.x + open.width);
  assert.equal(shut.y, open.y);
  assert.equal(shut.height, open.height);
  assert.ok(shut.x >= open.x);
  assert.equal(shut.width, DUE_SIZE.collapsed.width);
}

test('单屏：贴主屏右缘', () => {
  assertDocked([screenAt(1, 0, 0, 1920, 1080)], 1, 1);
});

test('双屏并排、主屏在左：挪到右边那块，不贴在两屏接缝上', () => {
  assertDocked([screenAt(1, 0, 0, 1920, 1080), screenAt(2, 1920, 0, 2560, 1440)], 1, 2);
});

test('双屏并排、主屏在右：留在主屏', () => {
  assertDocked([screenAt(1, 0, 0, 1920, 1080), screenAt(2, -1920, 0, 1920, 1080)], 1, 1);
});

test('三屏一排、主屏居中：挪到最右那块', () => {
  assertDocked(
    [screenAt(1, 0, 0, 1920, 1080), screenAt(2, -1920, 0, 1920, 1080), screenAt(3, 1920, 0, 1920, 1080)],
    1,
    3
  );
});

test('上下叠放：主屏右边没有屏，留在主屏', () => {
  assertDocked([screenAt(1, 0, 0, 1920, 1080), screenAt(2, 0, -1440, 2560, 1440)], 1, 1);
});

test('笔记本垫在外接屏左下方：小窗那截高度右边是空的，留在笔记本上', () => {
  // 外接屏在右上，只和笔记本上半截并排；小窗贴底，那截高度右边没有屏
  assertDocked([screenAt(1, 0, 0, 1920, 1080), screenAt(2, 1920, -900, 2560, 1440)], 1, 1);
});

test('外接屏只和主屏下半截并排：小窗那截高度右边有屏，挪过去', () => {
  assertDocked([screenAt(1, 0, 0, 1920, 1080), screenAt(2, 1920, 600, 2560, 1440)], 1, 2);
});

test('主屏 id 对不上时不崩，按第一块屏算', () => {
  assert.equal(pickDueDisplay([screenAt(7, 0, 0, 1920, 1080)], 999).id, 7);
});
