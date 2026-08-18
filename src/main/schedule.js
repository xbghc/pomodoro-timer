// 工作时段（纯逻辑，无 Electron 依赖）：
// blocks 固定三段 {start:'HH:MM', end:'HH:MM', workMin, shortMin, longMin, longEvery}，
// 两端时间留空表示停用该段（节奏参数保留，重新启用时还在）。
// 主进程在时钟跨入某段起点时自动开始番茄；时段外「休息结束」不再等待，直接收为空闲；
// 番茄开始时按所在段快照节奏参数，段外/模式关闭用全局「时长」设置。
'use strict';

const DEFAULT_SCHEDULE = {
  enabled: true,
  blocks: [
    // 上午：两个 50/10 深度块正好铺满 2 小时
    { start: '10:00', end: '12:00', workMin: 50, shortMin: 10, longMin: 15, longEvery: 0 },
    // 下午：标准番茄节奏，长休缓解午后低谷
    { start: '13:30', end: '18:00', workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 },
    // 晚上：45/15 三轮正好 3 小时，温和收尾
    { start: '19:30', end: '22:30', workMin: 45, shortMin: 15, longMin: 15, longEvery: 0 },
  ],
};

// 各节奏参数的取值范围（与全局设置一致）
const PARAM_RANGE = {
  workMin: [1, 180],
  shortMin: [1, 60],
  longMin: [1, 120],
  longEvery: [0, 12],
};

// 'HH:MM' → 当日分钟数；非法返回 null
function toMin(hm) {
  if (typeof hm !== 'string') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmtHM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// 有效段（起止合法且 start < end）换算成分钟区间，保留原段引用
function activeRanges(blocks) {
  const out = [];
  for (const b of blocks || []) {
    const s = toMin(b && b.start);
    const e = toMin(b && b.end);
    if (s !== null && e !== null && s < e) out.push({ startMin: s, endMin: e, block: b });
  }
  return out;
}

function minuteOf(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWorkTime(blocks, date) {
  const n = minuteOf(date);
  return activeRanges(blocks).some((r) => r.startMin <= n && n < r.endMin);
}

// 当前所在的段（段重叠时取结束最晚的）；不在任何段内返回 null
function currentBlock(blocks, date) {
  const n = minuteOf(date);
  let best = null;
  for (const r of activeRanges(blocks)) {
    if (r.startMin <= n && n < r.endMin && (best === null || r.endMin > best.endMin)) best = r;
  }
  return best === null ? null : best.block;
}

// 当前所在段的结束时刻；不在任何段内返回 null
function currentBlockEnd(blocks, date) {
  const b = currentBlock(blocks, date);
  return b === null ? null : fmtHM(toMin(b.end));
}

// 今天剩余时段里最近的开始时刻；没有则 null
function nextStartToday(blocks, date) {
  const n = minuteOf(date);
  let next = null;
  for (const r of activeRanges(blocks)) {
    if (r.startMin > n && (next === null || r.startMin < next)) next = r.startMin;
  }
  return next === null ? null : fmtHM(next);
}

// 归一化用户输入：三段定长；两端时间任一留空 → 该段停用（节奏参数保留）；
// 时间非法或 start ≥ end → 回退该段默认时间；节奏参数逐个夹取到合法范围
function sanitizeSchedule(s) {
  const src = s && typeof s === 'object' ? s : {};
  const list = Array.isArray(src.blocks) ? src.blocks : [];
  const blocks = DEFAULT_SCHEDULE.blocks.map((dflt, i) => {
    const b = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const params = {};
    for (const [key, [min, max]] of Object.entries(PARAM_RANGE)) {
      const n = Math.round(Number(b[key]));
      params[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt[key];
    }
    if (b.start === '' || b.end === '') return { start: '', end: '', ...params };
    const start = toMin(b.start);
    const end = toMin(b.end);
    if (start === null || end === null || start >= end) {
      return { start: dflt.start, end: dflt.end, ...params };
    }
    return { start: fmtHM(start), end: fmtHM(end), ...params };
  });
  const enabled = src.enabled === undefined ? DEFAULT_SCHEDULE.enabled : !!src.enabled;
  return { enabled, blocks };
}

module.exports = {
  DEFAULT_SCHEDULE,
  toMin,
  isWorkTime,
  currentBlock,
  currentBlockEnd,
  nextStartToday,
  sanitizeSchedule,
};
