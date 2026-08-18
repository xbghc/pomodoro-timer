'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_SCHEDULE,
  toMin,
  isWorkTime,
  currentBlockEnd,
  nextStartToday,
  sanitizeSchedule,
} = require('../src/main/schedule.js');

const BLOCKS = DEFAULT_SCHEDULE.blocks;
const at = (h, m) => new Date(2026, 7, 18, h, m, 0);

test('toMin 解析与非法输入', () => {
  assert.equal(toMin('10:00'), 600);
  assert.equal(toMin('9:05'), 545);
  assert.equal(toMin('23:59'), 1439);
  assert.equal(toMin('00:00'), 0);
  assert.equal(toMin('24:00'), null);
  assert.equal(toMin('10:60'), null);
  assert.equal(toMin(''), null);
  assert.equal(toMin('abc'), null);
  assert.equal(toMin(600), null);
  assert.equal(toMin(undefined), null);
});

test('isWorkTime：段内含起点、不含终点', () => {
  assert.equal(isWorkTime(BLOCKS, at(9, 59)), false);
  assert.equal(isWorkTime(BLOCKS, at(10, 0)), true);
  assert.equal(isWorkTime(BLOCKS, at(11, 59)), true);
  assert.equal(isWorkTime(BLOCKS, at(12, 0)), false);
  assert.equal(isWorkTime(BLOCKS, at(13, 0)), false);
  assert.equal(isWorkTime(BLOCKS, at(13, 30)), true);
  assert.equal(isWorkTime(BLOCKS, at(18, 0)), false);
  assert.equal(isWorkTime(BLOCKS, at(19, 30)), true);
  assert.equal(isWorkTime(BLOCKS, at(22, 29)), true);
  assert.equal(isWorkTime(BLOCKS, at(22, 30)), false);
});

test('currentBlockEnd / nextStartToday', () => {
  assert.equal(currentBlockEnd(BLOCKS, at(10, 30)), '12:00');
  assert.equal(currentBlockEnd(BLOCKS, at(12, 30)), null);
  assert.equal(currentBlockEnd(BLOCKS, at(20, 0)), '22:30');

  assert.equal(nextStartToday(BLOCKS, at(8, 0)), '10:00');
  assert.equal(nextStartToday(BLOCKS, at(10, 30)), '13:30');
  assert.equal(nextStartToday(BLOCKS, at(12, 30)), '13:30');
  assert.equal(nextStartToday(BLOCKS, at(18, 30)), '19:30');
  assert.equal(nextStartToday(BLOCKS, at(22, 30)), null);
});

test('停用的段（留空）不参与判定', () => {
  const blocks = [{ start: '', end: '' }, BLOCKS[1], BLOCKS[2]];
  assert.equal(isWorkTime(blocks, at(10, 30)), false);
  assert.equal(nextStartToday(blocks, at(8, 0)), '13:30');
});

test('sanitizeSchedule：默认、停用、回退', () => {
  // 空输入 → 全默认
  assert.deepEqual(sanitizeSchedule(undefined), DEFAULT_SCHEDULE);
  assert.deepEqual(sanitizeSchedule({}), DEFAULT_SCHEDULE);

  // 任一端留空 → 该段停用
  const s1 = sanitizeSchedule({
    enabled: true,
    blocks: [{ start: '', end: '12:00' }, BLOCKS[1], BLOCKS[2]],
  });
  assert.deepEqual(s1.blocks[0], { start: '', end: '' });

  // 非法时刻 / 起止倒置 → 回退该段默认值
  const s2 = sanitizeSchedule({
    enabled: false,
    blocks: [{ start: '25:00', end: '12:00' }, { start: '18:00', end: '13:30' }, BLOCKS[2]],
  });
  assert.equal(s2.enabled, false);
  assert.deepEqual(s2.blocks[0], BLOCKS[0]);
  assert.deepEqual(s2.blocks[1], BLOCKS[1]);

  // 补零归一化
  const s3 = sanitizeSchedule({ blocks: [{ start: '9:00', end: '9:30' }, BLOCKS[1], BLOCKS[2]] });
  assert.deepEqual(s3.blocks[0], { start: '09:00', end: '09:30' });

  // 完全损坏的输入 → 默认
  assert.deepEqual(sanitizeSchedule('x'), DEFAULT_SCHEDULE);
  assert.deepEqual(sanitizeSchedule({ blocks: 'x' }), DEFAULT_SCHEDULE);
});
