import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../shared/types";

const api: ElectronAPI = {
  fetchTalentData: () => ipcRenderer.invoke("fetch-talent-data"),
  saveFile: (content: string, defaultName: string) =>
    ipcRenderer.invoke("save-file", content, defaultName),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
};

contextBridge.exposeInMainWorld("electronAPI", api);
