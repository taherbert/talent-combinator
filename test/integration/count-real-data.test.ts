import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { countTreeBuilds } from "../../src/shared/build-counter";
import { parseSpecializations } from "../../src/main/data/parser";
import type { RawSpecData, TalentTree } from "../../src/shared/types";

const rawData: RawSpecData[] = JSON.parse(
  readFileSync("/tmp/claude/talents.json", "utf-8"),
);

function treeInfo(tree: TalentTree): string {
  const entryNodes = [...tree.nodes.values()].filter((n) => n.entryNode).length;
  const freeNodes = [...tree.nodes.values()].filter((n) => n.freeNode).length;
  const ancestorIds = new Set<number>();
  for (const node of tree.nodes.values()) {
    if (node.freeNode || node.entryNode) continue;
    for (const prevId of node.prev) ancestorIds.add(prevId);
  }
  return `${tree.nodes.size} nodes, ${entryNodes} entry, ${freeNodes} free, budget=${tree.pointBudget}, ${tree.gates.length} gates, ${ancestorIds.size} ancestors`;
}

describe("real data", () => {
  const specs = parseSpecializations(rawData);

  it("parses data", () => {
    console.log(`Parsed ${specs.length} specs`);
    expect(specs.length).toBeGreaterThan(0);
  });

  it("counts first spec class tree", () => {
    const spec = specs[0];
    console.log(`\n${spec.className} ${spec.specName}`);
    console.log(`Class: ${treeInfo(spec.classTree)}`);
    const result = countTreeBuilds(spec.classTree, new Map());
    console.log(
      `Result: count=${result.count}, ${result.durationMs.toFixed(1)}ms`,
    );
    if (result.warnings.length)
      console.log(`Warnings: ${JSON.stringify(result.warnings)}`);
    expect(result.count).toBeGreaterThan(1n);
  }, 10000);

  it("counts first spec spec tree", () => {
    const spec = specs[0];
    console.log(`Spec: ${treeInfo(spec.specTree)}`);
    const result = countTreeBuilds(spec.specTree, new Map());
    console.log(
      `Result: count=${result.count}, ${result.durationMs.toFixed(1)}ms`,
    );
    expect(result.count).toBeGreaterThan(1n);
  }, 10000);

  it("counts first spec hero tree", () => {
    const spec = specs[0];
    const ht = spec.heroTrees[0];
    if (!ht) return;
    console.log(`Hero(${ht.subTreeName}): ${treeInfo(ht)}`);
    const result = countTreeBuilds(ht, new Map());
    console.log(
      `Result: count=${result.count}, ${result.durationMs.toFixed(1)}ms`,
    );
    expect(result.count).toBeGreaterThan(1n);
  }, 10000);
});
