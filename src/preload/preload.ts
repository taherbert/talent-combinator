import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../shared/types";

const api: ElectronAPI = {
  fetchTalentData: () => ipcRenderer.invoke("fetch-talent-data"),
  fetchSpellTooltip: (spellId: number) =>
    ipcRenderer.invoke("fetch-spell-tooltip", spellId),
  saveFile: (content: string, defaultName: string) =>
    ipcRenderer.invoke("save-file", content, defaultName),
  saveLoadout: (data) => ipcRenderer.invoke("save-loadout", data),
  loadLoadout: () => ipcRenderer.invoke("load-loadout"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
};

contextBridge.exposeInMainWorld("electronAPI", api);
