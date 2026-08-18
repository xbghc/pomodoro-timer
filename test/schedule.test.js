'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_SCHEDULE,
  toMin,
  isWorkTime,
  currentBlock,
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

test('currentBlock / currentBlockEnd / nextStartToday', () => {
  assert.equal(currentBlock(BLOCKS, at(10, 30)), BLOCKS[0]);
  assert.equal(currentBlock(BLOCKS, at(14, 0)), BLOCKS[1]);
  assert.equal(currentBlock(BLOCKS, at(12, 30)), null);

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

  // 任一端留空 → 该段停用，节奏参数保留
  const s1 = sanitizeSchedule({
    enabled: true,
    blocks: [{ start: '', end: '12:00', workMin: 40 }, BLOCKS[1], BLOCKS[2]],
  });
  assert.equal(s1.blocks[0].start, '');
  assert.equal(s1.blocks[0].end, '');
  assert.equal(s1.blocks[0].workMin, 40);
  assert.equal(s1.blocks[0].shortMin, BLOCKS[0].shortMin);

  // 非法时刻 / 起止倒置 → 回退该段默认值
  const s2 = sanitizeSchedule({
    enabled: false,
    blocks: [{ start: '25:00', end: '12:00' }, { start: '18:00', end: '13:30' }, BLOCKS[2]],
  });
  assert.equal(s2.enabled, false);
  assert.deepEqual(s2.blocks[0], BLOCKS[0]);
  assert.deepEqual(s2.blocks[1], BLOCKS[1]);

  // 补零归一化 + 缺失参数补该段默认
  const s3 = sanitizeSchedule({ blocks: [{ start: '9:00', end: '9:30' }, BLOCKS[1], BLOCKS[2]] });
  assert.deepEqual(s3.blocks[0], { ...BLOCKS[0], start: '09:00', end: '09:30' });

  // 完全损坏的输入 → 默认
  assert.deepEqual(sanitizeSchedule('x'), DEFAULT_SCHEDULE);
  assert.deepEqual(sanitizeSchedule({ blocks: 'x' }), DEFAULT_SCHEDULE);
});

test('sanitizeSchedule：节奏参数夹取范围、非法回退', () => {
  const s = sanitizeSchedule({
    blocks: [
      { ...BLOCKS[0], workMin: 999, shortMin: 0, longMin: 'abc', longEvery: -3 },
      { ...BLOCKS[1], workMin: 30.6 },
      BLOCKS[2],
    ],
  });
  assert.equal(s.blocks[0].workMin, 180); // 上限夹取
  assert.equal(s.blocks[0].shortMin, 1); // 下限夹取
  assert.equal(s.blocks[0].longMin, BLOCKS[0].longMin); // 非数字回退默认
  assert.equal(s.blocks[0].longEvery, 0);
  assert.equal(s.blocks[1].workMin, 31); // 四舍五入
  assert.deepEqual(s.blocks[2], BLOCKS[2]);
});
