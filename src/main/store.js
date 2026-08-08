// 本地 JSON 持久化（settings / history / runtime），原子写入，损坏时回退默认值
'use strict';

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  _read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  _write(name, data) {
    const p = path.join(this.dir, name);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, p);
  }

  loadSettings(defaults) {
    return { ...defaults, ...this._read('settings.json', {}) };
  }

  saveSettings(settings) {
    this._write('settings.json', settings);
  }

  loadHistory() {
    const h = this._read('history.json', []);
    return Array.isArray(h) ? h : [];
  }

  appendRecord(record) {
    const h = this.loadHistory();
    h.push(record);
    this._write('history.json', h);
  }

  updateRecord(id, patch) {
    const h = this.loadHistory();
    const r = h.find((x) => x.id === id);
    if (!r) return false;
    Object.assign(r, patch);
    this._write('history.json', h);
    return true;
  }

  loadRuntime() {
    return this._read('runtime.json', {});
  }

  saveRuntime(runtime) {
    this._write('runtime.json', runtime);
  }
}

module.exports = { Store };
