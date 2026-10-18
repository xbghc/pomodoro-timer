'use strict';

// This file is a schema and computation layer; the JSON schedule is user-editable.
const DEFAULT_SCHEDULE = {
  defaultTemplate: 'workday',
  weekdays: { '0': 'off', '1': 'workday', '2': 'workday', '3': 'workday', '4': 'workday', '5': 'workday', '6': 'off' },
  templates: {
    workday: [
      { start: '10:00', end: '12:00' },
      { start: '13:30', end: '18:00' },
      { start: '19:30', end: '22:30' },
    ],
    off: [],
  },
};

function minutes(hm) {
  if (typeof hm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) return null;
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
}
function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}
function dateFromKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid date');
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (dateKey(date) !== key) throw new Error('Invalid date');
  return date;
}
function validateSchedule(config) {
  if (!config || typeof config !== 'object' || !config.templates || typeof config.templates !== 'object') {
    throw new Error('schedule.json must define templates');
  }
  for (const [name, ranges] of Object.entries(config.templates)) {
    if (!Array.isArray(ranges)) throw new Error('Template must be an array: ' + name);
    let prevEnd = -1;
    for (const range of ranges) {
      const start = minutes(range && range.start);
      const end = minutes(range && range.end);
      if (start === null || end === null || start >= end || start < prevEnd) {
        throw new Error('Invalid or overlapping schedule block in template: ' + name);
      }
      prevEnd = end;
    }
  }
  if (!(config.defaultTemplate in config.templates)) throw new Error('Unknown default template');
  for (const name of Object.values(config.weekdays || {})) {
    if (!(name in config.templates)) throw new Error('Unknown weekday template: ' + name);
  }
  return config;
}
function templateName(config, date, overrides = {}) {
  return overrides[dateKey(date)] || (config.weekdays || {})[date.getDay()] || config.defaultTemplate;
}
function planForDate(config, key, overrides = {}) {
  const date = dateFromKey(key);
  const name = templateName(config, date, overrides);
  const ranges = config.templates[name];
  if (!ranges) throw new Error('Unknown template: ' + name);
  return { name, blocks: ranges.map((r) => ({ ...r })) };
}
function windowAt(config, date, overrides = {}) {
  const day = dateKey(date);
  const plan = planForDate(config, day, overrides);
  const now = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  for (let i = 0; i < plan.blocks.length; i++) {
    const block = plan.blocks[i];
    const start = minutes(block.start);
    const end = minutes(block.end);
    if (now >= start && now < end) {
      const [h, m] = block.end.split(':').map(Number);
      const endAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime();
      return { id: day + ':' + plan.name + ':' + i, endAt, ...block };
    }
  }
  return null;
}
module.exports = { DEFAULT_SCHEDULE, minutes, dateKey, dateFromKey, validateSchedule, planForDate, windowAt };
