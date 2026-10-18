'use strict';
const { EventEmitter } = require('node:events');
const { ActivityTimer } = require('./activity-core');
const { dateKey, dayBounds, planForDate, planWindows, windowAt } = require('./schedule-v2');

// Electron-free orchestration: all entry points share the same schedule and recording rules.
class ActivityService extends EventEmitter {
  constructor({ store, now = Date.now }) {
    super();
    this.store = store;
    this.now = now;
    this.schedule = store.schedule();
    this.preferences = store.preferences();
    store.records(); // Fail loudly on corrupt history; never replace it with an empty array.
    store.recover();
    this.timer = new ActivityTimer({ now, workMin: this.preferences.reminderMin, breakMin: this.preferences.breakMin });
    this.previousWindow = undefined;
    this.suspended = false;
    this.lastCheckpoint = -Infinity;
    this.revision = 0;
    this.timer.on('record', (record) => { store.create(record); this.revision++; });
    for (const event of ['break-due', 'break-over', 'boundary']) this.timer.on(event, () => this.emit(event));
  }
  currentWindow() { return windowAt(this.schedule, new Date(this.now()), this.preferences.dayTemplates); }
  boundary() { return this.currentWindow()?.endAt ?? dayBounds(dateKey(new Date(this.now()))).endAt; }
  _checkpoint(force = false) {
    if (force || this.now() - this.lastCheckpoint >= 5000 || this.now() < this.lastCheckpoint) {
      this.store.checkpoint(this.timer.getState(), this.timer.lastObservedAt);
      this.lastCheckpoint = this.now();
    }
  }
  _reconcile(reconfigured = false) {
    const current = this.currentWindow(), previous = this.previousWindow;
    // Trigger on entering a block, not on being idle inside one. Break completion stays waiting.
    const entering = current && (previous === undefined || previous === null ||
      (!reconfigured && current.startAt !== previous.startAt));
    if (entering) {
      if (this.timer.phase === 'work') this.timer.setBoundary(current.endAt);
      else this.timer.startWork({ boundaryAt: current.endAt });
    } else if (reconfigured && previous && !current) {
      this.timer.stop();
    } else if (current && this.timer.phase !== 'waiting') {
      if (this.timer.boundaryAt !== current.endAt) this.timer.setBoundary(current.endAt);
    }
    this.previousWindow = current;
  }
  tick() {
    if (this.suspended) return this.state();
    const result = this.timer.tick();
    // Resume from a missed power event at *now*, never extrapolate the gap.
    if (result === 'suspended') this.previousWindow = undefined;
    this._reconcile();
    this._checkpoint(result !== null);
    return this.state();
  }
  state() {
    return { ...this.timer.getState(), now: this.now(), today: dateKey(new Date(this.now())),
      window: this.currentWindow(), preferences: this.preferences,
      templateNames: Object.keys(this.schedule.templates),
      todayTemplate: planForDate(this.schedule, dateKey(new Date(this.now())), this.preferences.dayTemplates).name,
      revision: this.revision, suspended: this.suspended };
  }
  command(name, value) {
    if (this.suspended) throw new Error('Timer is suspended');
    this.tick();
    let result;
    switch (name) {
      case 'startWork': result = this.timer.startWork({ remindInMin: value ?? this.preferences.reminderMin, boundaryAt: this.boundary() }); break;
      case 'startBreak': result = this.timer.startBreak({ minutes: value ?? this.preferences.breakMin, boundaryAt: this.boundary() }); break;
      case 'focus': result = this.timer.remindIn(value); break;
      case 'skipReminder': result = this.timer.skipReminder(); break;
      case 'stop': result = this.timer.stop(); break;
      default: throw new Error('Unknown command');
    }
    if (!result && !['stop'].includes(name)) throw new Error('Command is not valid in the current state or duration is invalid');
    this._checkpoint(true);
    return this.state();
  }
  suspend() {
    if (this.suspended) return;
    this.timer.suspend();
    this.suspended = true;
    this._checkpoint(true);
  }
  resume() {
    if (!this.suspended) return this.tick();
    this.suspended = false;
    this.previousWindow = undefined;
    this.timer.lastObservedAt = this.now();
    return this.tick();
  }
  close() { this.suspend(); }
  reloadSchedule() {
    const next = this.store.schedule(); // Validate before replacing a known-good configuration.
    this.tick();
    this.schedule = next;
    this._reconcile(true);
    this.revision++;
    this._checkpoint(true);
    return this.state();
  }
  selectTodayTemplate(name) {
    if (typeof name !== 'string' || !Object.hasOwn(this.schedule.templates, name)) throw new Error('Unknown template');
    this.tick();
    this.preferences = this.store.savePreferences({ dayTemplates: { [dateKey(new Date(this.now()))]: name } });
    this._reconcile(true);
    this.revision++;
    this._checkpoint(true);
    return this.state();
  }
  savePreferences(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid preferences');
    const allowed = ['reminderMin', 'breakMin', 'soundOn', 'theme', 'autoStart'];
    if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('Unknown preference');
    this.preferences = this.store.savePreferences(patch);
    this.timer.defaults.workMin = this.preferences.reminderMin;
    this.timer.defaults.breakMin = this.preferences.breakMin;
    // Changing defaults does not reset the current reminder or split the record.
    return this.state();
  }
  day(key) {
    const bounds = dayBounds(key);
    const records = this.store.records().filter((r) => r.endedAt > bounds.startAt && r.startedAt < bounds.endAt)
      .sort((a, b) => a.startedAt - b.startedAt);
    return { key, ...bounds, records, plan: planWindows(this.schedule, key, this.preferences.dayTemplates),
      template: planForDate(this.schedule, key, this.preferences.dayTemplates).name, revision: this.revision };
  }
  saveRecord(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid activity record');
    this.tick();
    const records = this.store.records();
    const existing = payload.id === undefined ? null : records.find((r) => r.id === payload.id);
    if (payload.id !== undefined && !existing) throw new Error('Record not found');
    const record = this.store._validated({ ...payload, id: existing?.id });
    if (record.endedAt > this.now()) throw new Error('Actual records cannot be in the future');
    const active = this.timer.getState();
    if (active.startedAt !== null && record.endedAt > active.startedAt) throw new Error('Record overlaps the ongoing activity; stop it before editing');
    if (records.some((r) => r.id !== existing?.id && record.startedAt < r.endedAt && record.endedAt > r.startedAt)) throw new Error('Activity records cannot overlap');
    const result = existing ? this.store.update(existing.id, record) : this.store.create(record);
    this.revision++;
    return result;
  }
  deleteRecord(id) {
    if (typeof id !== 'string' || !this.store.delete(id)) throw new Error('Record not found');
    this.revision++;
    return true;
  }
}
module.exports = { ActivityService };
