import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send("update-downloaded", info.version);
  });

  ipcMain.once("install-update", () => autoUpdater.quitAndInstall());

  autoUpdater.on("error", () => {});

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5_000);
}
