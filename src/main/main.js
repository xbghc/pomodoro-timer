'use strict';
const electron = require('electron');
const { startDesktop } = require('./activity-desktop');
const { followCurrentDesktop } = require('./virtual-desktop');
if (!electron.app.requestSingleInstanceLock()) electron.app.quit();
else electron.app.whenReady().then(() => {
  electron.app.setAppUserModelId('com.ghm.pomodoro-timer');
  startDesktop(electron, { updater: require('electron-updater').autoUpdater, followDesktop: followCurrentDesktop });
}).catch((error) => {
  electron.dialog.showErrorBox('番茄钟启动失败', error.message);
  electron.app.quit();
});
