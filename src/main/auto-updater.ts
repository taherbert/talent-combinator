import { autoUpdater } from "electron-updater";
import { app, BrowserWindow, ipcMain } from "electron";

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send("update-downloaded", info.version);
  });

  ipcMain.on("install-update", () => autoUpdater.quitAndInstall());

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5_000);
}
