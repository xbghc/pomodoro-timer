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
  const NAMES = ['work-completed', 'work-abandoned', 'break-due', 'break-started', 'break-over', 'auto-ended'];
  for (const name of NAMES) {
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

test('完整循环：工作→该休息了→休息→等待手动开始', () => {
  const { timer, events, advance } = setup();
  assert.equal(timer.getState().phase, 'idle');

  assert.ok(timer.startWork());
  const start = timer.getState();
  assert.equal(start.phase, 'work');
  assert.equal(start.remainingMs, 25 * MIN);

  advance(25 * MIN);
  assert.equal(timer.getState().phase, 'breakDue', '到点先落到「该休息了」，不直接进休息');
  assert.equal(timer.getState().breakType, 'short');
  assert.equal(timer.getState().cycleCount, 1, '番茄到点即计入完成');
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 25 * MIN);
  assert.ok(events.some((e) => e.name === 'break-due'));

  assert.ok(timer.startBreak());
  assert.equal(timer.getState().phase, 'break');
  assert.equal(timer.getState().remainingMs, 5 * MIN);

  advance(5 * MIN);
  assert.equal(timer.getState().phase, 'breakOver');
  assert.ok(events.some((e) => e.name === 'break-over'));

  // breakOver 停留，不会自己开始下一个
  advance(60 * MIN);
  assert.equal(timer.getState().phase, 'breakOver');
  assert.ok(timer.startWork());
  assert.equal(timer.getState().phase, 'work');
});

test('不强制休息：breakDue 挂多久都不会自己进休息', () => {
  const { timer, events, advance } = setup({ autoEndMin: 0 });
  timer.startWork();
  advance(25 * MIN);
  advance(3 * 60 * MIN); // 挂了三小时没理它
  assert.equal(timer.getState().phase, 'breakDue');
  assert.ok(!events.some((e) => e.name === 'break-started'));
  assert.equal(events.filter((e) => e.name === 'work-completed').length, 1, '不会重复记完成');
});

test('自动收摊：拖着不休息累计超上限，回到空闲并记完成不记放弃', () => {
  const { timer, events, advance } = setup({ autoEndMin: 120 });
  timer.startWork();
  advance(25 * MIN);
  advance(94 * MIN); // 累计 119 分钟，还差一点
  assert.equal(timer.getState().phase, 'breakDue');

  advance(1 * MIN); // 满 120
  assert.equal(timer.getState().phase, 'idle');
  assert.equal(timer.getState().cycleCount, 0, '结束专注同时清零循环计数');
  const auto = events.find((e) => e.name === 'auto-ended');
  assert.equal(auto.inWork, false);
  assert.equal(auto.workedMs, 120 * MIN);
  assert.ok(!events.some((e) => e.name === 'work-abandoned'), '番茄早已记完成，不该再记放弃');
});

test('自动收摊：工作中也生效，进行中的番茄被截断并记为放弃', () => {
  const { timer, events, advance } = setup({ workMin: 180, autoEndMin: 120 });
  timer.startWork();
  advance(119 * MIN);
  assert.equal(timer.getState().phase, 'work');

  advance(1 * MIN);
  assert.equal(timer.getState().phase, 'idle');
  const auto = events.find((e) => e.name === 'auto-ended');
  assert.equal(auto.inWork, true);
  const ab = events.find((e) => e.name === 'work-abandoned');
  assert.equal(ab.endedAt - ab.startedAt, 120 * MIN);
  assert.ok(!events.some((e) => e.name === 'work-completed'));
});

test('自动收摊：番茄正好走满时先记完成，再收摊', () => {
  const { timer, events, advance } = setup({ workMin: 120, autoEndMin: 120 });
  timer.startWork();
  advance(120 * MIN);
  assert.equal(timer.getState().phase, 'idle', '同一 tick 里完成 + 收摊');
  assert.ok(events.some((e) => e.name === 'work-completed'), '走满的番茄要记完成');
  assert.ok(!events.some((e) => e.name === 'work-abandoned'), '不能记成放弃');
  assert.equal(events.find((e) => e.name === 'auto-ended').inWork, false);
});

test('自动收摊：暂停的时间不算，挂着暂停不会被收摊', () => {
  const { timer, events, advance } = setup({ workMin: 180, autoEndMin: 120 });
  timer.startWork();
  advance(60 * MIN);
  timer.pause();
  advance(5 * 60 * MIN); // 暂停中挂了五小时
  assert.equal(timer.getState().phase, 'work');
  assert.ok(!events.some((e) => e.name === 'auto-ended'));
  timer.resume();
  advance(60 * MIN); // 实际工作满 120
  assert.equal(timer.getState().phase, 'idle');
  assert.equal(events.find((e) => e.name === 'auto-ended').workedMs, 120 * MIN);
});

test('自动收摊：休息中不触发，休息不算连续工作', () => {
  const { timer, events, advance } = setup({ autoEndMin: 120 });
  timer.startWork();
  advance(25 * MIN);
  timer.startBreak();
  advance(5 * MIN);
  advance(3 * 60 * MIN); // breakOver 挂了三小时
  assert.equal(timer.getState().phase, 'breakOver');
  assert.ok(!events.some((e) => e.name === 'auto-ended'));
});

test('每完成 4 个番茄进入长休息，长休息结束循环计数归零', () => {
  const { timer, advance } = setup();
  for (let i = 1; i <= 3; i++) {
    timer.startWork();
    advance(25 * MIN);
    assert.equal(timer.getState().breakType, 'short', `第 ${i} 个应为短休息`);
    timer.startBreak();
    advance(5 * MIN);
  }
  timer.startWork();
  advance(25 * MIN);
  assert.equal(timer.getState().breakType, 'long');
  assert.equal(timer.getState().cycleCount, 4);
  timer.startBreak();
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
  assert.equal(timer.getState().phase, 'breakDue');
  // 记录的是真实起止：中间隔了暂停，跨度 10+37+15 分钟
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 62 * MIN);
});

test('暂停时长不算进「实际工作时间」，不会误判为拖堂', () => {
  const { timer, advance } = setup();
  timer.startWork();
  advance(10 * MIN);
  timer.pause();
  advance(90 * MIN); // 中途去开了个长会
  assert.equal(timer.getState().workedMs, 10 * MIN, '暂停中工作时长不增长');
  assert.equal(timer.getState().overwork, 0);
  timer.resume();
  advance(15 * MIN);
  assert.equal(timer.getState().phase, 'breakDue');
  assert.equal(timer.getState().workedMs, 25 * MIN, '扣掉暂停后正好是计划时长');
  assert.equal(timer.getState().remainingMs, 5 * MIN, '没有拖堂就按原时长休息');
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

test('拖堂按比例补休息：多干的时间按 工作:休息 折算加进去', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  assert.equal(timer.getState().remainingMs, 5 * MIN, '刚到点时预告的还是原时长');

  advance(10 * MIN); // 拖着又干了 10 分钟
  const due = timer.getState();
  assert.equal(due.workedMs, 35 * MIN);
  // 25:5 = 每工作 5 分钟换 1 分钟休息，多干 10 分钟 → 多休 2 分钟
  assert.equal(due.remainingMs, 7 * MIN, 'breakDue 里预告的时长随拖堂增长');

  timer.startBreak();
  assert.equal(timer.getState().remainingMs, 7 * MIN);
  assert.equal(events.find((e) => e.name === 'break-started').durationMs, 7 * MIN);
});

test('拖堂补偿封顶 2 倍：挂机一下午不会换来荒唐的长休息', () => {
  const { timer, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  advance(40 * MIN); // 多干 40 分钟 → 该补 8 分钟，被 2 倍封顶砍到 5
  timer.startBreak();
  assert.equal(timer.getState().remainingMs, 10 * MIN, '短休息最多补到 2 倍');
});

test('健康上限：超出后 overwork 升到 2，接近时先给 1', () => {
  const { timer, advance } = setup({ healthMaxMin: 50 });
  timer.startWork();
  advance(25 * MIN);
  assert.equal(timer.getState().overwork, 0, '刚到点还很健康');

  advance(16 * MIN); // 共 41 分钟，过了 50×0.8
  assert.equal(timer.getState().overwork, 1);

  advance(10 * MIN); // 共 51 分钟，超上限
  assert.equal(timer.getState().overwork, 2);
});

test('健康上限低于番茄时长时以番茄时长为准，不会一到点就报红', () => {
  const { timer, advance } = setup({ workMin: 90, healthMaxMin: 50 });
  timer.startWork();
  advance(60 * MIN);
  assert.equal(timer.getState().overwork, 0, '90 分钟的番茄是用户自己设的，不按 50 分钟报警');
  advance(30 * MIN);
  assert.equal(timer.getState().phase, 'breakDue');
  assert.equal(timer.getState().overwork, 1, '到点时正好在上限边上，先给黄灯');
  advance(5 * MIN);
  assert.equal(timer.getState().overwork, 2, '再拖下去才报红');
});

test('跳过休息：从「该休息了」和休息中都能直接开始下一个番茄', () => {
  const { timer, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  assert.ok(timer.skipBreak(), 'breakDue 下可跳过');
  let s = timer.getState();
  assert.equal(s.phase, 'work');
  assert.equal(s.remainingMs, 25 * MIN);

  advance(25 * MIN);
  timer.startBreak();
  advance(1 * MIN);
  assert.ok(timer.skipBreak(), '休息中也可跳过');
  assert.equal(timer.getState().phase, 'work');

  // 凑到长休息再跳过
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
  timer.startBreak();
  advance(5 * MIN);
  timer.startWork(); // 第 2 个
  advance(10 * MIN);
  assert.ok(timer.endFocus());
  assert.equal(timer.getState().phase, 'idle');
  assert.equal(timer.getState().cycleCount, 0);
  assert.ok(events.some((e) => e.name === 'work-abandoned'));
});

test('「该休息了」/ 休息中结束专注：无放弃记录，直接回 idle', () => {
  const { timer, events, advance } = setup();
  timer.startWork();
  advance(25 * MIN);
  timer.endFocus(); // breakDue 下
  assert.equal(timer.getState().phase, 'idle');
  assert.ok(!events.some((e) => e.name === 'work-abandoned'));

  timer.startWork();
  advance(25 * MIN);
  timer.startBreak();
  timer.endFocus(); // break 下
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

test('机器休眠唤醒：晚到的 tick 用计划时间记账，停在「该休息了」等人回来', () => {
  const { timer, clock, events } = setup();
  timer.startWork();
  clock.t += 90 * MIN; // 睡死 90 分钟才迎来下一次 tick
  timer.tick();
  const s = timer.getState();
  assert.equal(s.phase, 'breakDue', '人不在，休息不空跑');
  const done = events.find((e) => e.name === 'work-completed');
  assert.equal(done.endedAt - done.startedAt, 25 * MIN, '记录按计划结束时间，不含休眠');
  // 睡过去的 65 分钟会被当成拖堂 → 休息补到封顶
  timer.startBreak();
  assert.equal(timer.getState().remainingMs, 10 * MIN);
});

test('非法状态调用一律返回 false 不抛错', () => {
  const { timer } = setup();
  assert.equal(timer.pause(), false);
  assert.equal(timer.resume(), false);
  assert.equal(timer.abandon(), false);
  assert.equal(timer.startBreak(), false);
  assert.equal(timer.skipBreak(), false);
  assert.equal(timer.endFocus(), false);
  timer.startWork();
  assert.equal(timer.startWork(), false, '工作中不能再次开始');
  assert.equal(timer.startBreak(), false, '工作中不能直接进休息');
});
