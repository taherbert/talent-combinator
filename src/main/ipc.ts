import { ipcMain, dialog, BrowserWindow, net } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { fetchTalentJSON } from "./data/raidbots-client";
import { readCache, writeCache } from "./data/cache";
import { parseSpecializations } from "./data/parser";
import { WOWHEAD_TOOLTIP_URL } from "../shared/constants";
import type { TalentDataResult, SpellTooltip, Loadout } from "../shared/types";

const tooltipCache = new Map<number, SpellTooltip | null>();

function stripHtml(html: string): string {
  return html
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .trim();
}

function parseTooltipHtml(html: string): SpellTooltip | null {
  // Strip HTML comments
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");

  // Extract meta from inner <table width="100%"> blocks (cost, range, cast, cooldown)
  const metaParts: string[] = [];
  const innerTableRegex = /<table width="100%"><tr>([\s\S]*?)<\/tr><\/table>/gi;
  let match;
  while ((match = innerTableRegex.exec(clean)) !== null) {
    const cells = stripHtml(match[1])
      .split("\t")
      .map((s) => s.trim())
      .filter(Boolean);
    metaParts.push(...cells);
  }

  // Extract description from <div class="q">
  const descMatch = clean.match(/<div class="q">([\s\S]*?)<\/div>/);
  if (!descMatch) return null;

  const desc = descMatch[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!desc) return null;

  return {
    meta: metaParts.join(" \u00b7 "),
    desc,
  };
}

function fetchTooltip(spellId: number): Promise<SpellTooltip | null> {
  if (tooltipCache.has(spellId))
    return Promise.resolve(tooltipCache.get(spellId)!);

  return new Promise((resolve) => {
    const url = `${WOWHEAD_TOOLTIP_URL}/${spellId}?dataEnv=1&locale=0`;
    const request = net.request(url);

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        tooltipCache.set(spellId, null);
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const result = parseTooltipHtml(json.tooltip ?? "");
          tooltipCache.set(spellId, result);
          resolve(result);
        } catch {
          tooltipCache.set(spellId, null);
          resolve(null);
        }
      });
      response.on("error", () => {
        tooltipCache.set(spellId, null);
        resolve(null);
      });
    });

    request.on("error", () => {
      tooltipCache.set(spellId, null);
      resolve(null);
    });

    request.end();
  });
}

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
    "fetch-spell-tooltip",
    (_event, spellId: number): Promise<SpellTooltip | null> => {
      return fetchTooltip(spellId);
    },
  );

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

  ipcMain.handle(
    "save-loadout",
    async (_event, data: Loadout): Promise<boolean> => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return false;

      const defaultName = `${data.specName}-loadout.json`;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [
          { name: "Loadout", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) return false;

      try {
        writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
        return true;
      } catch (e) {
        console.error("Failed to save loadout:", e);
        return false;
      }
    },
  );

  ipcMain.handle("load-loadout", async (): Promise<Loadout | null> => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      filters: [
        { name: "Loadout", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
      const content = readFileSync(result.filePaths[0], "utf-8");
      const parsed = JSON.parse(content);
      if (parsed?.version !== 1) return null;
      return parsed as Loadout;
    } catch (e) {
      console.error("Failed to load loadout:", e);
      return null;
    }
  });

  ipcMain.handle("get-app-version", () => {
    return require("../../package.json").version;
  });
}
