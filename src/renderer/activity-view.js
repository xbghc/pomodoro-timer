'use strict';
// Pure calendar calculations, shared by the renderer and Node tests.
(function (root) {
  const MIN = 60_000;
  function clipped(record, startAt, endAt) {
    const start = Math.max(record.startedAt, startAt), end = Math.min(record.endedAt, endAt);
    return end > start ? { ...record, startedAt: start, endedAt: end } : null;
  }
  function activeRecord(state, day) {
    if (!state || state.startedAt === null || state.phase === 'waiting' || state.suspended) return null;
    const deadline = Math.min(state.now, state.boundaryAt ?? Infinity, state.phase === 'break' ? state.breakEndsAt ?? Infinity : Infinity);
    return clipped({ id: state.id, type: state.phase, startedAt: state.startedAt, endedAt: deadline, ongoing: true }, day.startAt, day.endAt);
  }
  function totals(day, state) {
    const sum = { work: 0, break: 0 };
    const active = activeRecord(state, day);
    for (const item of [...day.records.filter((record) => !active || record.id !== active.id), ...(active ? [active] : [])]) {
      const record = clipped(item, day.startAt, day.endAt);
      if (record) sum[record.type] += record.endedAt - record.startedAt;
    }
    return sum;
  }
  function duration(ms) {
    const minutes = Math.floor(Math.max(0, ms) / MIN);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
  }
  function clock(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const pad = (value) => String(value).padStart(2, '0');
    return seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }
  function localInput(at) {
    const date = new Date(at);
    return new Date(at - date.getTimezoneOffset() * MIN).toISOString().slice(0, -1);
  }
  const api = { clipped, activeRecord, totals, duration, clock, localInput };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ActivityView = api;
})(globalThis);
