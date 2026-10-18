'use strict';
const DEFAULT_SCHEDULE = {
  defaultTemplate: 'workday',
  weekdays: { '0': 'off', '1': 'workday', '2': 'workday', '3': 'workday', '4': 'workday', '5': 'workday', '6': 'off' },
  templates: { workday: [
    { start: '10:00', end: '12:00' }, { start: '13:30', end: '18:00' }, { start: '19:30', end: '22:30' },
  ], off: [] },
};
const own = (object, key) => Object.hasOwn(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function minutes(hm) {
  if (typeof hm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) return null;
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
}
function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function dateFromKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid date');
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (dateKey(date) !== key) throw new Error('Invalid date');
  return date;
}
function validateSchedule(config) {
  if (!object(config) || !object(config.templates) || !Object.keys(config.templates).length) throw new Error('schedule.json must define templates');
  for (const [name, ranges] of Object.entries(config.templates)) {
    if (!name.trim() || !Array.isArray(ranges)) throw new Error('Template must be a named array: ' + name);
    let prevEnd = -1;
    for (const range of ranges) {
      const start = minutes(range?.start), end = minutes(range?.end);
      if (start === null || end === null || start >= end || start < prevEnd) throw new Error('Invalid or overlapping block: ' + name);
      prevEnd = end;
    }
  }
  if (typeof config.defaultTemplate !== 'string' || !own(config.templates, config.defaultTemplate)) throw new Error('Unknown default template');
  if (config.weekdays !== undefined && !object(config.weekdays)) throw new Error('weekdays must be an object');
  for (const [day, name] of Object.entries(config.weekdays || {})) {
    if (!/^[0-6]$/.test(day) || typeof name !== 'string' || !own(config.templates, name)) throw new Error('Invalid weekday template: ' + day);
  }
  return config;
}
function planForDate(config, key, overrides = {}) {
  const date = dateFromKey(key);
  const selected = own(overrides, key) ? overrides[key] : null;
  // A removed template must not prevent the application from starting.
  const name = selected && own(config.templates, selected) ? selected : config.weekdays?.[date.getDay()] ?? config.defaultTemplate;
  return { name, blocks: config.templates[name].map((range) => ({ start: range.start, end: range.end })) };
}
function dayBounds(key) {
  const start = dateFromKey(key), end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}
function planWindows(config, key, overrides = {}) {
  const date = dateFromKey(key), plan = planForDate(config, key, overrides);
  const at = (hm) => { const d = new Date(date); const n = minutes(hm); d.setHours(Math.floor(n / 60), n % 60, 0, 0); return d.getTime(); };
  return plan.blocks.map((block, i) => ({ ...block, id: `${key}:${plan.name}:${i}`, startAt: at(block.start), endAt: at(block.end) }));
}
function windowAt(config, date, overrides = {}) {
  const at = date.getTime();
  return planWindows(config, dateKey(date), overrides).find((block) => at >= block.startAt && at < block.endAt) || null;
}
module.exports = { DEFAULT_SCHEDULE, minutes, dateKey, dateFromKey, dayBounds, validateSchedule, planForDate, planWindows, windowAt };
