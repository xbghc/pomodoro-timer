'use strict';

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const MIN = 60_000;

// Activity and reminders deliberately have separate lifecycles. A reminder never closes a work record.
class ActivityTimer extends EventEmitter {
  constructor({ now = Date.now, workMin = 50, breakMin = 10, snoozeMin = 60 } = {}) {
    super();
    this.now = now;
    this.defaults = { workMin, breakMin, snoozeMin };
    this.phase = 'waiting';
    this.startedAt = null;
    this.reminderAt = null;
    this.reminderDue = false;
    this.breakEndsAt = null;
    this.boundaryAt = null;
    this.lastObservedAt = this.now();
  }

  getState() {
    const now = this.now();
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      elapsedMs: this.startedAt === null ? 0 : Math.max(0, now - this.startedAt),
      reminderAt: this.reminderAt,
      reminderDue: this.reminderDue,
      breakEndsAt: this.breakEndsAt,
      boundaryAt: this.boundaryAt,
      remainingMs: this.phase === 'break' && this.breakEndsAt !== null
        ? Math.max(0, this.breakEndsAt - now)
        : this.phase === 'work' && this.reminderAt !== null
          ? Math.max(0, this.reminderAt - now) : 0,
    };
  }

  _close(at) {
    if (this.phase === 'waiting' || this.startedAt === null) return;
    const endedAt = Math.max(this.startedAt, at);
    if (endedAt > this.startedAt) {
      this.emit('record', {
        id: randomUUID(), type: this.phase,
        startedAt: this.startedAt, endedAt,
      });
    }
  }

  _enter(phase, at) {
    if (this.phase === phase) return false;
    this._close(at);
    this.phase = phase;
    this.startedAt = phase === 'waiting' ? null : at;
    this.reminderAt = null;
    this.reminderDue = false;
    this.breakEndsAt = null;
    this.boundaryAt = null;
    this.emit('change', this.getState());
    return true;
  }

  startWork({ remindInMin = this.defaults.workMin, boundaryAt = null } = {}) {
    this.tick();
    const at = this.now();
    if (boundaryAt !== null && boundaryAt <= at) return false;
    if (this.phase !== 'work') this._enter('work', at);
    this.boundaryAt = boundaryAt;
    this.remindIn(remindInMin);
    return true;
  }

  remindIn(minutes) {
    if (this.phase !== 'work' || !Number.isFinite(minutes) || minutes <= 0) return false;
    const at = this.now();
    this.reminderAt = at + minutes * MIN;
    if (this.boundaryAt !== null) this.reminderAt = Math.min(this.reminderAt, this.boundaryAt);
    this.reminderDue = false;
    this.emit('change', this.getState());
    return true;
  }

  skipReminder() {
    if (this.phase !== 'work') return false;
    return this.remindIn(this.defaults.snoozeMin);
  }

  startBreak({ minutes = this.defaults.breakMin, boundaryAt = null } = {}) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    this.tick();
    const at = this.now();
    if (boundaryAt !== null && boundaryAt <= at) return false;
    if (this.phase !== 'break') this._enter('break', at);
    this.breakEndsAt = at + minutes * MIN;
    this.boundaryAt = boundaryAt;
    if (boundaryAt !== null) this.breakEndsAt = Math.min(this.breakEndsAt, boundaryAt);
    this.emit('change', this.getState());
    return true;
  }

  // A changed timetable changes the cutoff, never the active activity's startedAt.
  setBoundary(boundaryAt) {
    if (this.phase === 'waiting') return false;
    this.boundaryAt = boundaryAt;
    if (boundaryAt !== null) {
      if (this.reminderAt !== null) this.reminderAt = Math.min(this.reminderAt, boundaryAt);
      if (this.breakEndsAt !== null) this.breakEndsAt = Math.min(this.breakEndsAt, boundaryAt);
    }
    this.tick();
    return true;
  }

  stop(at = this.now()) {
    const result = this._enter('waiting', at);
    this.lastObservedAt = this.now();
    return result;
  }

  // Call on powerMonitor.suspend, before-quit, and unexpected long timer gaps.
  suspend(at = this.now()) {
    this.stop(at);
  }

  tick() {
    const now = this.now();
    if (now < this.lastObservedAt) this.lastObservedAt = now;
    // Avoid charging sleep/hibernation time when OS never delivered a suspend callback.
    if (this.phase !== 'waiting' && now - this.lastObservedAt > 120_000) {
      this.suspend(this.lastObservedAt);
      this.lastObservedAt = now;
      return 'suspended';
    }
    this.lastObservedAt = now;
    if (this.phase === 'waiting') return null;
    if (this.boundaryAt !== null && now >= this.boundaryAt) {
      this.stop(this.boundaryAt);
      return 'boundary';
    }
    if (this.phase === 'break' && this.breakEndsAt !== null && now >= this.breakEndsAt) {
      this.stop(this.breakEndsAt);
      this.emit('break-over');
      return 'break-over';
    }
    if (this.phase === 'work' && !this.reminderDue && this.reminderAt !== null && now >= this.reminderAt) {
      this.reminderDue = true;
      this.reminderAt = null;
      this.emit('break-due');
      this.emit('change', this.getState());
      return 'break-due';
    }
    return null;
  }
}

module.exports = { ActivityTimer, MIN };
