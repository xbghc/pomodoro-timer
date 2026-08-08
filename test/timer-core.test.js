'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PomodoroTimer } = require('../src/main/timer-core.js');

const MIN = 60 * 1000;

// 可控时钟 + 事件收集
function setup(config = {}) {
  const clock = { t: 1_000_000 };
  const timer = new PomodoroTimer({ config, now: () => clock.t });
  const events = [];
  for (const name of ['work-completed', 'work-extended', 'work-abandoned', 'break-started', 'break-over']) {
    timer.on(name, (payload) => events.push({ name, ...payload }));
  }
  // 前进 ms 毫秒，模拟宿主每 500ms 一次 tick
  const advance = (ms) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(clock.t + 500, end);
      timer.tick();
    }
  };
  return { timer, clock, events, advance };
}

test('完整循环：工作→短休息→等待手动开始', () => {
  const { timer, events, advance } = setup();
  assert.equal(timer.getState().phase, 'idle');

  assert.ok(timer.startWork());
  const start = timer.getState();
  assert.equal(start.phase, 'work');
  assert.equal(start.remainingMs, 25 * MIN);

  advance(25 * MIN);
  assert.equal(timer.getState().phase, 'break');
  assert.equal(timer.getState().breakType, 'short');
  assert.equal(timer.getState().cycleCount, 1);
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 25 * MIN);

  advance(5 * MIN);
  assert.equal(timer.getState().phase, 'breakOver');
  assert.ok(events.some((e) => e.name === 'break-over'));

  // breakOver 停留，不会自己开始下一个
  advance(60 * MIN);
  assert.equal(timer.getState().phase, 'breakOver');
  assert.ok(timer.startWork());
  assert.equal(timer.getState().phase, 'work');
});

test('每完成 4 个番茄进入长休息，长休息结束循环计数归零', () => {
  const { timer, advance } = setup();
  for (let i = 1; i <= 3; i++) {
    timer.startWork();
    advance(25 * MIN);
    assert.equal(timer.getState().breakType, 'short', `第 ${i} 个应为短休息`);
    advance(5 * MIN);
  }
  timer.startWork();
  advance(25 * MIN);
  assert.equal(timer.getState().breakType, 'long');
  assert.equal(timer.getState().cycleCount, 4);
  advance(15 * MIN);
  assert.equal(timer.getState().phase, 'breakOver');
  assert.equal(timer.getState().cycleCount, 0);
});

test('暂停期间时间不流逝，继续后按剩余时间走完', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(10 * MIN);
  assert.ok(timer.pause());
  advance(37 * MIN); // 暂停中挂机
  assert.equal(timer.getState().phase, 'work');
  assert.equal(timer.getState().remainingMs, 15 * MIN);
  assert.ok(timer.resume());
  advance(15 * MIN);
  assert.equal(timer.getState().phase, 'break');
  // 记录的是真实起止：中间隔了暂停，跨度 10+37+15 分钟
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 62 * MIN);
});

test('放弃番茄：记为 abandoned，不计入完成数', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(9 * MIN);
  assert.ok(timer.abandon());
  assert.equal(timer.getState().phase, 'idle');
  assert.equal(timer.getState().cycleCount, 0);
  const ab = events.find((e) => e.name === 'work-abandoned');
  assert.equal(ab.endedAt - ab.startedAt, 9 * MIN);
  assert.ok(!events.some((e) => e.name === 'work-completed'));
});

test('收尾推迟：休息中 grace 回工作 3 分钟，结束重新进完整休息，不重复计数', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  assert.equal(timer.getState().phase, 'break');

  advance(2 * MIN); // 休息了 2 分钟才想起没收尾
  assert.ok(timer.grace());
  const g = timer.getState();
  assert.equal(g.phase, 'work');
  assert.ok(g.graceActive);
  assert.ok(g.graceUsed);
  assert.equal(g.remainingMs, 3 * MIN);

  advance(3 * MIN);
  const s = timer.getState();
  assert.equal(s.phase, 'break');
  assert.equal(s.remainingMs, 5 * MIN, '收尾后重新进入完整时长的休息');
  assert.equal(s.cycleCount, 1, '完成数不能因收尾重复 +1');
  assert.equal(events.filter((e) => e.name === 'work-completed').length, 1);
  assert.ok(events.some((e) => e.name === 'work-extended'));

  // 每番茄只能推迟一次
  assert.equal(timer.grace(), false);
});

test('收尾段提前结束：finishGrace 立即进休息', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  timer.grace();
  advance(1 * MIN);
  assert.ok(timer.finishGrace());
  assert.equal(timer.getState().phase, 'break');
  assert.ok(events.some((e) => e.name === 'work-extended'));
});

test('收尾段不提供暂停/放弃', () => {
  const { timer, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  timer.grace();
  assert.equal(timer.pause(), false);
  assert.equal(timer.abandon(), false);
});

test('跳过休息：直接开始下一个番茄；跳过长休息同样清零循环计数', () => {
  const { timer, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  assert.ok(timer.skipBreak());
  const s = timer.getState();
  assert.equal(s.phase, 'work');
  assert.equal(s.remainingMs, 25 * MIN);
  assert.ok(!s.graceUsed, '新番茄的收尾推迟机会要重置');

  // 凑到长休息再跳过
  advance(25 * MIN); // cycle 2
  timer.skipBreak();
  advance(25 * MIN); // cycle 3
  timer.skipBreak();
  advance(25 * MIN); // cycle 4 → long
  assert.equal(timer.getState().breakType, 'long');
  timer.skipBreak();
  assert.equal(timer.getState().cycleCount, 0);
});

test('结束专注：工作中记放弃并回 idle，循环计数清零', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  advance(5 * MIN);
  timer.startWork(); // 第 2 个
  advance(10 * MIN);
  assert.ok(timer.endFocus());
  assert.equal(timer.getState().phase, 'idle');
  assert.equal(timer.getState().cycleCount, 0);
  assert.ok(events.some((e) => e.name === 'work-abandoned'));
});

test('休息中结束专注：无放弃记录，直接回 idle', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  timer.endFocus();
  assert.equal(timer.getState().phase, 'idle');
  assert.ok(!events.some((e) => e.name === 'work-abandoned'));
});

test('longEvery=0 时永远不进长休息', () => {
  const { timer, advance } = setup({ longEvery: 0 });
  for (let i = 0; i < 6; i++) {
    timer.startWork();
    advance(25 * MIN);
    assert.equal(timer.getState().breakType, 'short');
    timer.skipBreak();
    timer.endFocus();
  }
});

test('机器休眠唤醒：晚到的 tick 用计划时间记账，休息从唤醒时刻起算', () => {
  const { timer, clock, events } = setup();
  timer.startWork();
  clock.t += 90 * MIN; // 睡死 90 分钟才迎来下一次 tick
  timer.tick();
  const s = timer.getState();
  assert.equal(s.phase, 'break');
  assert.equal(s.remainingMs, 5 * MIN, '休息从唤醒时刻开始完整计时');
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 25 * MIN, '记录按计划结束时间，不含休眠');
});

test('非法状态调用一律返回 false 不抛错', () => {
  const { timer } = setup();
  assert.equal(timer.pause(), false);
  assert.equal(timer.resume(), false);
  assert.equal(timer.abandon(), false);
  assert.equal(timer.grace(), false);
  assert.equal(timer.finishGrace(), false);
  assert.equal(timer.skipBreak(), false);
  assert.equal(timer.endFocus(), false);
  timer.startWork();
  assert.equal(timer.startWork(), false, '工作中不能再次开始');
});
