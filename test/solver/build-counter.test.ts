import { describe, it, expect } from "vitest";
import { countTreeBuilds } from "../../src/shared/build-counter";
import type {
  TalentTree,
  TalentNode,
  TalentEntry,
  Constraint,
} from "../../src/shared/types";

function makeEntry(id: number, maxRanks = 1): TalentEntry {
  return { id, name: `Entry ${id}`, maxRanks, index: 0, icon: "" };
}

function makeNode(id: number, opts: Partial<TalentNode> = {}): TalentNode {
  return {
    id,
    name: `Node ${id}`,
    icon: "",
    type: "single",
    maxRanks: 1,
    entries: [makeEntry(id * 100)],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: false,
    entryNode: false,
    isApex: false,
    ...opts,
  };
}

function makeTree(
  nodes: TalentNode[],
  overrides: Partial<TalentTree> = {},
): TalentTree {
  const nodeMap = new Map<number, TalentNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  let maxPoints = 0;
  for (const n of nodes) maxPoints += n.maxRanks;

  return {
    type: "class",
    nodes: nodeMap,
    gates: [],
    maxPoints,
    pointBudget: maxPoints,
    totalNodes: nodes.length,
    ...overrides,
  };
}

describe("tiered nodes (parsed as single)", () => {
  it("tiered-as-single node with maxRanks=4 counts as 1 way when always", () => {
    // A tiered node has 3 tierrank entries but is really a linear rank
    // progression (1→2→4 ranks). After the parser maps raw type "tiered"
    // to internal type "single", the counter should treat it as a single
    // node with maxRanks=4. When forced (isAlways via entryNode), and
    // the node is freeNode, it should produce exactly 1 way (max rank).
    const tiered = makeNode(1, {
      type: "single",
      maxRanks: 4,
      entries: [makeEntry(100, 4)],
      freeNode: true,
      entryNode: true,
      row: 0,
    });
    const child = makeNode(2, { row: 1, prev: [1] });
    tiered.next = [2];

    const tree = makeTree([tiered, child], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    // tiered node costs 0 (freeNode), child costs 1. Total = 1 = budget.
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("tiered node without freeNode produces rank variations", () => {
    // Non-free single node with maxRanks=4, always, budget=4.
    // Must take at least 1 rank. Since budget=4 and only one node,
    // must spend exactly 4 → rank 4. Only 1 build.
    const tiered = makeNode(1, {
      type: "single",
      maxRanks: 4,
      entries: [makeEntry(100, 4)],
    });
    const tree = makeTree([tiered], { pointBudget: 4 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(1n);
  });

  it("choice node with 3 entries counts 3 ways (not tiered)", () => {
    // When a node IS a real choice (not tiered), 3 entries = 3 builds.
    const choice = makeNode(1, {
      type: "choice",
      maxRanks: 1,
      entries: [makeEntry(100), makeEntry(101), makeEntry(102)],
    });
    const tree = makeTree([choice], { pointBudget: 1 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(3n);
  });
});

describe("freeNode force-select", () => {
  it("freeNode is force-selected even without explicit constraint", () => {
    // freeNode + entryNode → isAlways. With no explicit constraint, the
    // counter should still force-select it (no optional skip).
    const free = makeNode(1, { freeNode: true, entryNode: false, row: 0 });
    const paid = makeNode(2, { row: 0 });
    const tree = makeTree([free, paid], { pointBudget: 1 });
    // free node costs 0 (freeNode) and is always taken.
    // paid node costs 1, budget=1 → must take it. 1 build total.
    expect(countTreeBuilds(tree, new Map()).count).toBe(1n);
  });

  it("freeNode does not double-count as optional", () => {
    // 2 paid nodes + 1 freeNode, budget=2. If freeNode were optional,
    // it'd produce 2× builds. It should be forced, giving just 1 build.
    const free = makeNode(1, { freeNode: true, row: 0 });
    const n2 = makeNode(2, { row: 0 });
    const n3 = makeNode(3, { row: 0 });
    const tree = makeTree([free, n2, n3], { pointBudget: 2 });
    // free always taken (0 cost), n2 and n3 each cost 1, budget=2 → must take both.
    expect(countTreeBuilds(tree, new Map()).count).toBe(1n);
  });
});

describe("fully-constrained tree", () => {
  it("all nodes always/never gives exactly 1 build", () => {
    // 4 nodes in a chain, budget=3. Pin 3 as always, 1 as never.
    const n1 = makeNode(1, { entryNode: true, row: 0, next: [2] });
    const n2 = makeNode(2, { row: 1, prev: [1], next: [3, 4] });
    const n3 = makeNode(3, { row: 2, prev: [2] });
    const n4 = makeNode(4, { row: 2, prev: [2] });
    const tree = makeTree([n1, n2, n3, n4], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "always" }],
      [3, { nodeId: 3, type: "always" }],
      [4, { nodeId: 4, type: "never" }],
    ]);
    // n1 is entryNode (isAlways), n2+n3 always, n4 never → exactly 1 build
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("single node with exactRank gives count=1", () => {
    const n1 = makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] });
    const tree = makeTree([n1], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", exactRank: 3 }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });
});
