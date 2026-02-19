import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseSpecializations } from "../src/main/data/parser";
import { decodeTalentHash } from "../src/renderer/hash-decoder";
import { countTreeBuilds } from "../src/shared/build-counter";
import type { RawSpecData, TalentNode, Constraint } from "../src/shared/types";

const HASH =
  "CUkAAAAAAAAAAAAAAAAAAAAAAAAYMzMjhZkZmBWMDDmZMzYmZmxYGzsNzYbMzyYMDAAAAzyMYYsswEGmZGLAAAAYgBAAzMADAAAgB";

const rawData: RawSpecData[] = JSON.parse(
  readFileSync("/tmp/claude/talents.json", "utf-8"),
);

function makeStub(id: number): TalentNode {
  return {
    id,
    name: `[stub ${id}]`,
    icon: "",
    type: "single" as const,
    maxRanks: 1,
    entries: [],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: true,
    entryNode: true,
    isApex: false,
  };
}

describe("Vengeance DH hash import", () => {
  const specs = parseSpecializations(rawData);
  const vengeance = specs.find(
    (s) => s.className === "Demon Hunter" && s.specName === "Vengeance",
  )!;
  const sameClassSpecs = specs.filter(
    (s) => s.className === vengeance.className,
  );

  // Reproduce the node assembly from importTalentHash()
  const allNodeMap = new Map<number, TalentNode>();
  for (const s of sameClassSpecs) {
    for (const node of s.classTree.nodes.values())
      allNodeMap.set(node.id, node);
    for (const node of s.specTree.nodes.values()) allNodeMap.set(node.id, node);
    for (const heroTree of s.heroTrees)
      for (const node of heroTree.nodes.values()) allNodeMap.set(node.id, node);
    for (const stn of s.subTreeNodes) allNodeMap.set(stn.id, makeStub(stn.id));
    for (const sid of s.systemNodeIds) allNodeMap.set(sid, makeStub(sid));
  }
  const allNodes: TalentNode[] = [...allNodeMap.values()];

  const result = decodeTalentHash(HASH, allNodes)!;

  it("decodes specId 581 (Vengeance DH)", () => {
    expect(result).not.toBeNull();
    expect(result.specId).toBe(581);
  });

  it("selects 29 class nodes (28 purchased + 1 free)", () => {
    const classIds = new Set(vengeance.classTree.nodes.keys());
    const classSelections = result.selections.filter((s) =>
      classIds.has(s.nodeId),
    );
    expect(classSelections).toHaveLength(29);
  });

  it("selects 27 spec nodes", () => {
    const specIds = new Set(vengeance.specTree.nodes.keys());
    const specSelections = result.selections.filter((s) =>
      specIds.has(s.nodeId),
    );
    expect(specSelections).toHaveLength(27);

    // Diagnostic: how many are free in hash vs freeNode in parser?
    const freeInHash = specSelections.filter((s) => s.free);
    const freeInParser = specSelections.filter(
      (s) => allNodeMap.get(s.nodeId)?.freeNode,
    );
    const entryInParser = specSelections.filter(
      (s) => allNodeMap.get(s.nodeId)?.entryNode,
    );
    const totalRanks = specSelections.reduce((sum, s) => sum + s.ranks, 0);
    const purchasedRanks = specSelections
      .filter((s) => !s.free)
      .reduce((sum, s) => sum + s.ranks, 0);

    console.log("Spec selections diagnostic:");
    console.log(`  Total: ${specSelections.length}`);
    console.log(`  Free in hash (isPurchased=0): ${freeInHash.length}`);
    console.log(`  freeNode in parser: ${freeInParser.length}`);
    console.log(`  entryNode in parser: ${entryInParser.length}`);
    console.log(`  Total ranks: ${totalRanks}`);
    console.log(`  Purchased ranks: ${purchasedRanks}`);

    // Show the free-in-hash nodes that are NOT freeNode
    const freeButNotFreeNode = freeInHash.filter(
      (s) => !allNodeMap.get(s.nodeId)?.freeNode,
    );
    for (const s of freeButNotFreeNode) {
      const node = allNodeMap.get(s.nodeId)!;
      console.log(
        `  Free-in-hash but not freeNode: ${node.name} (id=${node.id}, entryNode=${node.entryNode}, maxRanks=${node.maxRanks})`,
      );
    }
  });

  it("selects 14 Aldrachi Reaver hero nodes (13 purchased + 1 free)", () => {
    const aldrachiReaver = vengeance.heroTrees.find(
      (ht) => ht.subTreeName === "Aldrachi Reaver",
    )!;
    const heroIds = new Set(aldrachiReaver.nodes.keys());
    const heroSelections = result.selections.filter((s) =>
      heroIds.has(s.nodeId),
    );
    expect(heroSelections).toHaveLength(14);
  });

  it("detects Aldrachi Reaver hero tree from subTreeNode entryIndex", () => {
    const allSubTreeNodes = sameClassSpecs.flatMap((s) => s.subTreeNodes);

    let detectedHeroTree: TalentTree | null = null;
    for (const sel of result.selections) {
      const stn = allSubTreeNodes.find((s) => s.id === sel.nodeId);
      if (stn && sel.entryIndex !== undefined) {
        const traitSubTreeId = stn.entries[sel.entryIndex]?.traitSubTreeId;
        if (traitSubTreeId != null) {
          detectedHeroTree =
            vengeance.heroTrees.find((ht) => ht.subTreeId === traitSubTreeId) ??
            null;
          break;
        }
      }
    }

    expect(detectedHeroTree).not.toBeNull();
    expect(detectedHeroTree!.subTreeName).toBe("Aldrachi Reaver");
  });

  it("import produces 1x1x1 builds with full constraints", () => {
    const subTreeAndSystemIds = new Set([
      ...sameClassSpecs.flatMap((s) => s.subTreeNodes.map((n) => n.id)),
      ...sameClassSpecs.flatMap((s) => s.systemNodeIds),
    ]);
    const currentSpecTalentIds = new Set([
      ...vengeance.classTree.nodes.keys(),
      ...vengeance.specTree.nodes.keys(),
      ...vengeance.heroTrees.flatMap((ht) => [...ht.nodes.keys()]),
    ]);

    // Simulate importTalentHash constraint-setting loop (matches app.ts logic)
    const constraints = new Map<number, Constraint>();
    for (const sel of result.selections) {
      if (subTreeAndSystemIds.has(sel.nodeId)) continue;
      if (!currentSpecTalentIds.has(sel.nodeId)) continue;

      const node = allNodeMap.get(sel.nodeId);
      const entryIndex =
        sel.entryIndex ?? (sel.free && node?.type === "choice" ? 0 : undefined);
      constraints.set(sel.nodeId, {
        nodeId: sel.nodeId,
        type: "always",
        entryIndex,
        exactRank: sel.ranks,
      });
    }

    // Count each tree with its constraints
    function treeConstraints(tree: import("../src/shared/types").TalentTree) {
      const tc = new Map<number, Constraint>();
      for (const [id, c] of constraints) {
        if (tree.nodes.has(id)) tc.set(id, c);
      }
      return tc;
    }

    const specResult = countTreeBuilds(
      vengeance.specTree,
      treeConstraints(vengeance.specTree),
    );
    const classResult = countTreeBuilds(
      vengeance.classTree,
      treeConstraints(vengeance.classTree),
    );

    const aldrachiReaver = vengeance.heroTrees.find(
      (ht) => ht.subTreeName === "Aldrachi Reaver",
    )!;
    const heroResult = countTreeBuilds(
      aldrachiReaver,
      treeConstraints(aldrachiReaver),
    );

    expect(classResult.count).toBe(1n);
    expect(specResult.count).toBe(1n);
    expect(heroResult.count).toBe(1n);
  });
});
