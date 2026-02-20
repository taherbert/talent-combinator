import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { countTreeBuilds } from "../../src/shared/build-counter";
import { parseSpecializations } from "../../src/main/data/parser";
import type { RawSpecData } from "../../src/shared/types";

const TALENTS_JSON = "/tmp/claude/talents.json";
const GENERATE_TALENTS_PY = "/tmp/claude/generate_talents.py";
const NORRINIR_COUNTS_PY = join(
  dirname(import.meta.url.replace("file://", "")),
  "norrinir_counts.py",
);
const TALENTS_URL =
  "https://mimiron.raidbots.com/static/data/live/talents.json";
const SCRIPT_URL =
  "https://raw.githubusercontent.com/vituscze/simc-talent-generator/main/generate_talents.py";
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// Norrinir's script uses PEP 695 generics (Python 3.12+)
function findPython312Plus(): string {
  for (const candidate of [
    "/opt/homebrew/opt/python@3.13/bin/python3.13",
    "/opt/homebrew/opt/python@3.12/bin/python3.12",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "python3.13",
    "python3.12",
    "python3",
  ]) {
    try {
      const ver = execFileSync(candidate, ["--version"], {
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
      const match = ver.match(/Python 3\.(\d+)/);
      if (match && parseInt(match[1]) >= 12) return candidate;
    } catch {
      // not found, try next
    }
  }
  throw new Error("Python 3.12+ required (Norrinir uses PEP 695 generics)");
}

function isFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  const age = Date.now() - statSync(path).mtimeMs;
  return age < CACHE_MAX_AGE_MS;
}

function downloadIfStale(url: string, dest: string): void {
  if (isFresh(dest)) return;
  execFileSync("curl", ["-sS", "-o", dest, url], { timeout: 30_000 });
}

interface NorrinirCounts {
  [specKey: string]: { class: number; spec: number; hero: number };
}

let norrinirCounts: NorrinirCounts;
let specs: ReturnType<typeof parseSpecializations>;

beforeAll(() => {
  const python = findPython312Plus();
  downloadIfStale(TALENTS_URL, TALENTS_JSON);
  downloadIfStale(SCRIPT_URL, GENERATE_TALENTS_PY);

  const rawData: RawSpecData[] = JSON.parse(
    readFileSync(TALENTS_JSON, "utf-8"),
  );
  specs = parseSpecializations(rawData);

  const stdout = execFileSync(
    python,
    [NORRINIR_COUNTS_PY, TALENTS_JSON, GENERATE_TALENTS_PY],
    { timeout: 120_000, encoding: "utf-8" },
  );
  norrinirCounts = JSON.parse(stdout);
}, 180_000);

describe("cross-validate against Norrinir", () => {
  it("all spec counts match", () => {
    expect(Object.keys(norrinirCounts).length).toBeGreaterThanOrEqual(39);
    expect(specs.length).toBe(Object.keys(norrinirCounts).length);

    const mismatches: string[] = [];

    for (const spec of specs) {
      const key = `${spec.className} ${spec.specName}`;
      const norrinir = norrinirCounts[key];
      if (!norrinir) {
        mismatches.push(`${key}: missing from Norrinir output`);
        continue;
      }

      const classResult = countTreeBuilds(spec.classTree, new Map());
      if (classResult.count !== BigInt(norrinir.class)) {
        mismatches.push(
          `${key} class: ours=${classResult.count} norrinir=${norrinir.class}`,
        );
      }

      const specResult = countTreeBuilds(spec.specTree, new Map());
      if (specResult.count !== BigInt(norrinir.spec)) {
        mismatches.push(
          `${key} spec: ours=${specResult.count} norrinir=${norrinir.spec}`,
        );
      }

      // We split hero nodes by subTreeId; Norrinir has one combined tree with subtree lock.
      // sum(our hero tree counts) should equal Norrinir's single hero count.
      let heroSum = 0n;
      for (const ht of spec.heroTrees) {
        heroSum += countTreeBuilds(ht, new Map()).count;
      }
      if (heroSum !== BigInt(norrinir.hero)) {
        mismatches.push(
          `${key} hero: ours=${heroSum} norrinir=${norrinir.hero}`,
        );
      }
    }

    if (mismatches.length > 0) {
      expect.fail(
        `${mismatches.length} mismatch(es):\n${mismatches.join("\n")}`,
      );
    }
  }, 60_000);
});
