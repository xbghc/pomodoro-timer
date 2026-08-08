'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 拉取初始状态：{ state, settings, dark }
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  // 计时命令：start | pause | resume | abandon | grace | finishGrace | skipBreak | endFocus
  cmd: (name) => ipcRenderer.invoke('cmd', name),
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  saveNote: (text) => ipcRenderer.invoke('save-note', text),

  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onCue: (cb) => ipcRenderer.on('cue', (_e, c) => cb(c)),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, t) => cb(t)),
  onHistoryChanged: (cb) => ipcRenderer.on('history-changed', () => cb()),
});
