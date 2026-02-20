import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { countTreeBuilds } from "../../src/shared/build-counter";
import { parseSpecializations } from "../../src/main/data/parser";
import type { RawSpecData } from "../../src/shared/types";

const DATA_PATH =
  process.env.TALENT_DATA_PATH || "./test/fixtures/talents.json";
const HAS_DATA = existsSync(DATA_PATH);

describe.skipIf(!HAS_DATA)("all specs counting", () => {
  const rawData: RawSpecData[] = HAS_DATA
    ? JSON.parse(readFileSync(DATA_PATH, "utf-8"))
    : [];
  const specs = parseSpecializations(rawData);

  for (const spec of specs) {
    it(`${spec.className} ${spec.specName}`, () => {
      process.stdout.write(`  Testing ${spec.className} ${spec.specName}...`);

      const classResult = countTreeBuilds(spec.classTree, new Map());
      process.stdout.write(` class=${classResult.count}`);

      const specResult = countTreeBuilds(spec.specTree, new Map());
      process.stdout.write(` spec=${specResult.count}`);

      for (const ht of spec.heroTrees) {
        const heroResult = countTreeBuilds(ht, new Map());
        process.stdout.write(` hero=${heroResult.count}`);
      }

      process.stdout.write("\n");
      expect(classResult.count).toBeGreaterThan(0n);
      expect(specResult.count).toBeGreaterThan(0n);
    }, 10000);
  }
});
