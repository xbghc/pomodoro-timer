'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const MIN = 60_000;
const validMinutes = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1440;
const validBoundary = (value) => value === null || (Number.isFinite(value) && value >= 0);

// A reminder is metadata on an activity, never an activity transition.
class ActivityTimer extends EventEmitter {
  constructor({ now = Date.now, workMin = 50, breakMin = 10, snoozeMin = 60 } = {}) {
    super();
    if (![workMin, breakMin, snoozeMin].every(validMinutes)) throw new Error('Invalid duration');
    this.now = now;
    this.defaults = { workMin, breakMin, snoozeMin };
    this.phase = 'waiting';
    this.id = null;
    this.startedAt = null;
    this.reminderAt = null;
    this.reminderDue = false;
    this.breakEndsAt = null;
    this.boundaryAt = null;
    this.lastObservedAt = now();
  }
  getState() {
    const at = this.now();
    const target = this.phase === 'break' ? this.breakEndsAt : this.reminderAt;
    const deadline = target === null ? null : Math.min(target, this.boundaryAt ?? Infinity);
    return {
      id: this.id, phase: this.phase, startedAt: this.startedAt,
      elapsedMs: this.startedAt === null ? 0 : Math.max(0, at - this.startedAt),
      reminderAt: this.reminderAt, reminderDue: this.reminderDue,
      breakEndsAt: this.breakEndsAt, boundaryAt: this.boundaryAt,
      remainingMs: deadline === null ? 0 : Math.max(0, deadline - at),
    };
  }
  _enter(phase, at) {
    if (phase === this.phase) return false;
    if (this.startedAt !== null && at > this.startedAt) {
      // Stable IDs allow a checkpoint to be recovered without duplicating a closed record.
      this.emit('record', { id: this.id, type: this.phase, startedAt: this.startedAt, endedAt: at });
    }
    this.phase = phase;
    this.id = phase === 'waiting' ? null : randomUUID();
    this.startedAt = phase === 'waiting' ? null : at;
    this.reminderAt = this.breakEndsAt = this.boundaryAt = null;
    this.reminderDue = false;
    return true;
  }
  _changed() { this.emit('change', this.getState()); }
  startWork({ remindInMin = this.defaults.workMin, boundaryAt = null } = {}) {
    if (!validMinutes(remindInMin) || !validBoundary(boundaryAt)) return false;
    this.tick();
    const at = this.now();
    if (boundaryAt !== null && boundaryAt <= at) return false;
    this._enter('work', at);
    this.boundaryAt = boundaryAt;
    this.reminderAt = at + remindInMin * MIN;
    this.reminderDue = false;
    this._changed();
    return true;
  }
  remindIn(minutes) {
    if (!validMinutes(minutes)) return false;
    this.tick();
    if (this.phase !== 'work') return false;
    this.reminderAt = this.now() + minutes * MIN;
    this.reminderDue = false;
    this._changed();
    return true;
  }
  skipReminder() { return this.remindIn(this.defaults.snoozeMin); }
  startBreak({ minutes = this.defaults.breakMin, boundaryAt = null } = {}) {
    if (!validMinutes(minutes) || !validBoundary(boundaryAt)) return false;
    this.tick();
    const at = this.now();
    if (boundaryAt !== null && boundaryAt <= at) return false;
    this._enter('break', at);
    this.breakEndsAt = at + minutes * MIN;
    this.boundaryAt = boundaryAt;
    this._changed();
    return true;
  }
  setBoundary(boundaryAt) {
    if (!validBoundary(boundaryAt) || this.phase === 'waiting') return false;
    this.boundaryAt = boundaryAt;
    this.tick();
    this._changed();
    return true;
  }
  stop() {
    this.tick();
    const changed = this._enter('waiting', this.now());
    if (changed) this._changed();
    return changed;
  }
  suspend() { return this.stop(); }
  tick() {
    const at = this.now();
    if (at < this.lastObservedAt || at - this.lastObservedAt > 120_000) {
      const changed = this._enter('waiting', this.lastObservedAt);
      this.lastObservedAt = at;
      if (changed) { this._changed(); return 'suspended'; }
    }
    this.lastObservedAt = at;
    if (this.phase === 'waiting') return null;
    const breakEnd = this.phase === 'break' ? this.breakEndsAt : null;
    const deadline = Math.min(this.boundaryAt ?? Infinity, breakEnd ?? Infinity);
    if (at >= deadline) {
      const reason = deadline === this.boundaryAt ? 'boundary' : 'break-over';
      this._enter('waiting', deadline);
      this._changed();
      this.emit(reason);
      return reason;
    }
    if (this.phase === 'work' && !this.reminderDue && this.reminderAt !== null && at >= this.reminderAt) {
      this.reminderDue = true;
      this.reminderAt = null;
      this._changed();
      this.emit('break-due');
      return 'break-due';
    }
    return null;
  }
}
module.exports = { ActivityTimer, MIN, validMinutes };
