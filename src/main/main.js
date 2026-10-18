'use strict';
const electron = require('electron');
const { startDesktop } = require('./activity-desktop');
const { followCurrentDesktop } = require('./virtual-desktop');
// Isolate automated smoke tests from real application data.
if (process.env.POMODORO_DATA_DIR) electron.app.setPath('userData', process.env.POMODORO_DATA_DIR);
if (!electron.app.requestSingleInstanceLock()) electron.app.quit();
else electron.app.whenReady().then(() => {
  electron.app.setAppUserModelId('com.ghm.pomodoro-timer');
  startDesktop(electron, { updater: require('electron-updater').autoUpdater, followDesktop: followCurrentDesktop });
}).catch((error) => {
  electron.dialog.showErrorBox('番茄钟启动失败', error.message);
  electron.app.quit();
});
