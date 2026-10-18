'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SCHEDULE, validateSchedule, dateFromKey } = require('./schedule-v2');
const { validMinutes } = require('./activity-core');
const DEFAULT_PREFERENCES = { reminderMin: 50, breakMin: 10, soundOn: true, soundVolume: 0.6, theme: 'system', autoStart: false, dayTemplates: {} };
function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences');
  const p = { ...DEFAULT_PREFERENCES, ...value };
  if (![p.reminderMin, p.breakMin].every(validMinutes) || !['system', 'light', 'dark'].includes(p.theme) ||
      typeof p.soundOn !== 'boolean' || typeof p.autoStart !== 'boolean' ||
      !Number.isFinite(p.soundVolume) || p.soundVolume < 0 || p.soundVolume > 1 ||
      !p.dayTemplates || typeof p.dayTemplates !== 'object' || Array.isArray(p.dayTemplates)) throw new Error('Invalid preferences');
  for (const [key, name] of Object.entries(p.dayTemplates)) {
    dateFromKey(key);
    if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid day template');
  }
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((key) => [key, p[key]]));
}
class ActivityStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.recordsPath = path.join(dir, 'activity-records.json');
    this.schedulePath = path.join(dir, 'schedule.json');
    this.preferencesPath = path.join(dir, 'activity-preferences.json');
    this.checkpointPath = path.join(dir, 'activity-checkpoint.json');
    // No reads of history.json, settings.json, or runtime.json. No migration.
    if (!fs.existsSync(this.schedulePath)) this._write(this.schedulePath, DEFAULT_SCHEDULE);
  }
  _read(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  _write(file, data) {
    const temp = file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  schedule() { return validateSchedule(this._read(this.schedulePath, DEFAULT_SCHEDULE)); }
  preferences() { return validatePreferences(this._read(this.preferencesPath, {})); }
  savePreferences(patch) {
    const previous = this.preferences();
    const next = validatePreferences({ ...previous, ...patch, dayTemplates: { ...previous.dayTemplates, ...patch.dayTemplates } });
    this._write(this.preferencesPath, next);
    return next;
  }
  _validated(record) {
    if (!record || !['work', 'break'].includes(record.type) ||
        !Number.isFinite(record.startedAt) || !Number.isFinite(record.endedAt) ||
        record.startedAt < 0 || record.endedAt <= record.startedAt || record.endedAt > 8.64e15 ||
        (record.id !== undefined && (typeof record.id !== 'string' || !record.id))) throw new Error('Invalid activity record');
    return { id: record.id || randomUUID(), type: record.type, startedAt: record.startedAt, endedAt: record.endedAt };
  }
  records() {
    const value = this._read(this.recordsPath, []);
    if (!Array.isArray(value)) throw new Error('Invalid activity records');
    const records = value.map((r) => {
      if (!r?.id) throw new Error('Record ID is missing');
      return this._validated(r);
    });
    if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('Duplicate record ID');
    return records;
  }
  create(record) {
    const item = this._validated(record), records = this.records();
    if (records.some((r) => r.id === item.id)) throw new Error('Duplicate record ID');
    records.push(item);
    this._write(this.recordsPath, records);
    return item;
  }
  update(id, patch) {
    const records = this.records(), index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;
    records[index] = this._validated({ ...records[index], ...patch, id });
    this._write(this.recordsPath, records);
    return records[index];
  }
  delete(id) {
    const records = this.records(), next = records.filter((r) => r.id !== id);
    if (next.length === records.length) return false;
    this._write(this.recordsPath, next);
    return true;
  }
  checkpoint(state, observedAt) {
    const checkpoint = state.startedAt === null ? null : { id: state.id, type: state.phase, startedAt: state.startedAt, endedAt: observedAt };
    this._write(this.checkpointPath, checkpoint);
  }
  recover() {
    const checkpoint = this._read(this.checkpointPath, null);
    if (checkpoint && checkpoint.endedAt > checkpoint.startedAt) {
      const record = this._validated(checkpoint);
      if (!this.records().some((r) => r.id === record.id)) this.create(record);
    }
    this._write(this.checkpointPath, null);
  }
}
module.exports = { ActivityStore, DEFAULT_PREFERENCES, validatePreferences };
