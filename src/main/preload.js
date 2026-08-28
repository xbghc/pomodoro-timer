'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 拉取初始状态：{ state, settings, dark }
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  // 计时命令：start | pause | resume | abandon | grace | finishGrace | skipBreak | endFocus
  // 遮罩命令：away（暂时让开，遮罩收起一小会儿）| endAway（立即回到休息）
  // start 可带 arg（本番茄的规划文本）
  cmd: (name, arg) => ipcRenderer.invoke('cmd', name, arg),
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  // 复盘 {note} 挂到刚完成的番茄；下一步规划 {next} 在下个番茄开始时自动带入
  saveReview: (payload) => ipcRenderer.invoke('save-review', payload),
  // 更新：checkUpdate 触发检查并返回当前状态，installUpdate 在下载就绪后重启安装
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onCue: (cb) => ipcRenderer.on('cue', (_e, c) => cb(c)),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, t) => cb(t)),
  onHistoryChanged: (cb) => ipcRenderer.on('history-changed', () => cb()),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, u) => cb(u)),
});
