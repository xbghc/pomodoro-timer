'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const request = async (operation, ...args) => {
  const result = await ipcRenderer.invoke('activity:request', operation, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('activity', {
  bootstrap: () => request('bootstrap'),
  command: (name, value) => request('command', name, value),
  day: (key) => request('day', key),
  saveRecord: (record) => request('saveRecord', record),
  deleteRecord: (id) => request('deleteRecord', id),
  selectTodayTemplate: (name) => request('selectTodayTemplate', name),
  reloadSchedule: () => request('reloadSchedule'),
  openSchedule: () => request('openSchedule'),
  savePreferences: (patch) => request('savePreferences', patch),
  checkUpdate: () => request('checkUpdate'),
  installUpdate: () => request('installUpdate'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('activity:state', listener);
    return () => ipcRenderer.removeListener('activity:state', listener);
  },
});
