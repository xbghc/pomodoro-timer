// 工作时段（纯逻辑，无 Electron 依赖）：
// blocks 固定三段 {start:'HH:MM', end:'HH:MM'}，两端留空表示停用该段。
// 主进程在时钟跨入某段起点时自动开始番茄；时段外「休息结束」不再等待，直接收为空闲。
'use strict';

const DEFAULT_SCHEDULE = {
  enabled: true,
  blocks: [
    { start: '10:00', end: '12:00' },
    { start: '13:30', end: '18:00' },
    { start: '19:30', end: '22:30' },
  ],
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

// 有效段（起止合法且 start < end）换算成分钟区间
function activeRanges(blocks) {
  const out = [];
  for (const b of blocks || []) {
    const s = toMin(b && b.start);
    const e = toMin(b && b.end);
    if (s !== null && e !== null && s < e) out.push({ startMin: s, endMin: e });
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

// 当前所在段的结束时刻（段重叠时取最晚）；不在任何段内返回 null
function currentBlockEnd(blocks, date) {
  const n = minuteOf(date);
  let end = null;
  for (const r of activeRanges(blocks)) {
    if (r.startMin <= n && n < r.endMin && (end === null || r.endMin > end)) end = r.endMin;
  }
  return end === null ? null : fmtHM(end);
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

// 归一化用户输入：三段定长；两端任一留空 → 该段停用；非法或 start ≥ end → 回退默认
function sanitizeSchedule(s) {
  const src = s && typeof s === 'object' ? s : {};
  const list = Array.isArray(src.blocks) ? src.blocks : [];
  const blocks = DEFAULT_SCHEDULE.blocks.map((dflt, i) => {
    const b = list[i] && typeof list[i] === 'object' ? list[i] : {};
    if (b.start === '' || b.end === '') return { start: '', end: '' };
    const start = toMin(b.start);
    const end = toMin(b.end);
    if (start === null || end === null || start >= end) return { ...dflt };
    return { start: fmtHM(start), end: fmtHM(end) };
  });
  const enabled = src.enabled === undefined ? DEFAULT_SCHEDULE.enabled : !!src.enabled;
  return { enabled, blocks };
}

module.exports = {
  DEFAULT_SCHEDULE,
  toMin,
  isWorkTime,
  currentBlockEnd,
  nextStartToday,
  sanitizeSchedule,
};
