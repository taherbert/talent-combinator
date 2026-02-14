import { ipcMain, dialog, BrowserWindow } from "electron";
import { writeFileSync } from "fs";
import { fetchTalentJSON } from "./data/raidbots-client";
import { readCache, writeCache } from "./data/cache";
import { parseSpecializations } from "./data/parser";
import type { TalentDataResult } from "../shared/types";

export function registerIPC(): void {
  ipcMain.handle("fetch-talent-data", async (): Promise<TalentDataResult> => {
    const cached = readCache();
    const isCached = cached !== null;
    const raw = cached ?? (await fetchTalentJSON());
    if (!isCached) writeCache(raw);

    return {
      specs: parseSpecializations(raw),
      version: "live",
      cached: isCached,
    };
  });

  ipcMain.handle(
    "save-file",
    async (_event, content: string, defaultName: string): Promise<boolean> => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return false;

      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [
          { name: "SimC Profile", extensions: ["simc"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) return false;

      try {
        writeFileSync(result.filePath, content, "utf-8");
        return true;
      } catch (e) {
        console.error("Failed to save file:", e);
        return false;
      }
    },
  );

  ipcMain.handle("get-app-version", () => {
    return require("../../package.json").version;
  });
}
