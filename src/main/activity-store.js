'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SCHEDULE, validateSchedule } = require('./schedule-v2');

class ActivityStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.recordsPath = path.join(dir, 'activity-records.json');
    this.schedulePath = path.join(dir, 'schedule.json');
    this.preferencesPath = path.join(dir, 'activity-preferences.json');
    // Deliberately no reads of old history.json, settings.json, or runtime.json.
    if (!fs.existsSync(this.schedulePath)) this._write(this.schedulePath, DEFAULT_SCHEDULE);
  }
  _read(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  _write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  }
  schedule() {
    return validateSchedule(this._read(this.schedulePath, DEFAULT_SCHEDULE));
  }
  preferences() {
    return this._read(this.preferencesPath, {
      reminderMin: 50, breakMin: 10, soundOn: true, soundVolume: 0.6,
      theme: 'system', autoStart: false, dayTemplates: {},
    });
  }
  savePreferences(patch) {
    const previous = this.preferences();
    const next = { ...previous, ...patch };
    if (patch.dayTemplates) next.dayTemplates = { ...previous.dayTemplates, ...patch.dayTemplates };
    this._write(this.preferencesPath, next);
    return next;
  }
  records() {
    const result = this._read(this.recordsPath, []);
    if (!Array.isArray(result)) throw new Error('Invalid activity records');
    return result;
  }
  _validated(record) {
    const startedAt = Number(record.startedAt);
    const endedAt = Number(record.endedAt);
    if (!['work', 'break'].includes(record.type) ||
        !Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
      throw new Error('Invalid activity record');
    }
    return { id: record.id || randomUUID(), type: record.type, startedAt, endedAt };
  }
  create(record) {
    const item = this._validated(record);
    const records = this.records();
    records.push(item);
    this._write(this.recordsPath, records);
    return item;
  }
  update(id, patch) {
    const records = this.records();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;
    records[index] = this._validated({ ...records[index], ...patch, id });
    this._write(this.recordsPath, records);
    return records[index];
  }
  delete(id) {
    const records = this.records();
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) return false;
    this._write(this.recordsPath, next);
    return true;
  }
}
module.exports = { ActivityStore };
