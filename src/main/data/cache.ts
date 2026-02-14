import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "fs";
import { join } from "path";
import { CACHE_TTL_MS } from "../../shared/constants";
import type { RawSpecData } from "../../shared/types";

function getCacheDir(): string {
  const dir = join(app.getPath("userData"), "cache");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCachePath(): string {
  return join(getCacheDir(), "talents.json");
}

export function readCache(): RawSpecData[] | null {
  const path = getCachePath();
  if (!existsSync(path)) return null;

  try {
    const stat = statSync(path);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) return null;

    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as RawSpecData[];
  } catch {
    return null;
  }
}

export function writeCache(data: RawSpecData[]): void {
  try {
    writeFileSync(getCachePath(), JSON.stringify(data));
  } catch (e) {
    console.error("Failed to write talent cache:", e);
  }
}
