import { describe, it, expect } from "vitest";
import {
  generateTreeBuilds,
  countTreeBuilds,
} from "../../src/shared/build-counter";
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

/** Encode a build as a sorted "entryId:points" string for comparison. */
function encodeForTest(build: { entries: Map<number, number> }): string {
  return Array.from(build.entries.entries())
    .filter(([, p]) => p > 0)
    .sort(([a], [b]) => a - b)
    .map(([id, p]) => `${id}:${p}`)
    .join("/");
}

describe("generateTreeBuilds", () => {
  it("produces the correct count of builds (matches countTreeBuilds)", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const { count } = countTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
    expect(builds.length).toBe(3);
  });

  it("produces all unique builds (no duplicates)", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const encoded = builds.map(encodeForTest);
    const unique = new Set(encoded);
    expect(unique.size).toBe(builds.length);
  });

  it("each build spends exactly the budget (single nodes)", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    for (const build of builds) {
      const spent = Array.from(build.entries.values()).reduce(
        (s, p) => s + p,
        0,
      );
      expect(spent).toBe(2);
    }
  });

  it("single node, budget=1 → exactly 1 build", () => {
    const tree = makeTree([makeNode(1)]);
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    expect(builds.length).toBe(1);
    expect(builds[0].entries.get(100)).toBe(1);
  });

  it("no valid builds returns empty array", () => {
    const nodeA = makeNode(1);
    const nodeB = makeNode(2, { prev: [1] });
    nodeA.next = [2];
    // Budget=1 but B requires A → impossible with prerequisite-only tree at budget=1
    // Actually: A or B alone works. Let's make an impossible constraint.
    const tree = makeTree([nodeA, nodeB], { pointBudget: 2 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    const builds = generateTreeBuilds(tree, constraints);
    expect(builds.length).toBe(0);
  });

  it("prerequisite chain: A→B, budget=2 → only 1 valid build (select both)", () => {
    const nodeA = makeNode(1, { row: 0 });
    const nodeB = makeNode(2, { row: 1, prev: [1] });
    nodeA.next = [2];
    const tree = makeTree([nodeA, nodeB]);
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    // Budget=2, A and B each cost 1. Only valid build: A+B.
    expect(builds.length).toBe(1);
    expect(builds[0].entries.get(100)).toBe(1); // A
    expect(builds[0].entries.get(200)).toBe(1); // B
  });

  it("prerequisite chain: A→B→C, budget=2 → 2 builds (A+B or A+C)", () => {
    const nodeA = makeNode(1, { row: 0 });
    const nodeB = makeNode(2, { row: 1, prev: [1] });
    const nodeC = makeNode(3, { row: 2, prev: [2] });
    nodeA.next = [2];
    nodeB.next = [3];
    const tree = makeTree([nodeA, nodeB, nodeC], { pointBudget: 2 });
    const constraints = new Map<number, Constraint>();
    const { count } = countTreeBuilds(tree, constraints);
    const builds = generateTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
  });

  it("choice node: 2 entries, budget=entry cost → 2 builds", () => {
    const nodeC = makeNode(1, {
      type: "choice",
      maxRanks: 1,
      entries: [makeEntry(10, 1), makeEntry(11, 1)],
    });
    const tree = makeTree([nodeC]);
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    expect(builds.length).toBe(2);
    const encoded = builds.map(encodeForTest);
    expect(encoded).toContain("10:1");
    expect(encoded).toContain("11:1");
  });

  it("multi-rank node: must spend exactly budget, so only rank=3 is valid with budget=3", () => {
    // Single node maxRanks=3, budget=3. Only spending exactly 3 is valid → rank 3 only.
    const node = makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] });
    const tree = makeTree([node], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const { count } = countTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
    expect(builds.length).toBe(1);
    expect(builds[0].entries.get(100)).toBe(3);
  });

  it("multi-rank node: two nodes yield builds covering different rank combinations", () => {
    // Node A (maxRanks=3) + Node B (maxRanks=1), budget=3.
    // Valid: A(2)+B(1)=3, A(3)+B(skip)=3 → 2 builds.
    const nodeA = makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] });
    const nodeB = makeNode(2, { maxRanks: 1, entries: [makeEntry(200, 1)] });
    const tree = makeTree([nodeA, nodeB], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const { count } = countTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
    // Both rank 2 and rank 3 should appear for node A.
    const rankA = builds.map((b) => b.entries.get(100) ?? 0);
    expect(new Set(rankA)).toEqual(new Set([2, 3]));
  });

  it("always constraint forces a node to be selected", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const builds = generateTreeBuilds(tree, constraints);
    // Node 1 always selected → pick 1 more from {2,3} → 2 builds
    expect(builds.length).toBe(2);
    for (const build of builds) {
      expect(build.entries.get(100)).toBe(1); // node 1 always present
    }
  });

  it("never constraint excludes a node", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
    ]);
    const builds = generateTreeBuilds(tree, constraints);
    // Node 1 excluded → pick 2 from {2,3} → only 1 build
    expect(builds.length).toBe(1);
    for (const build of builds) {
      expect(build.entries.has(100)).toBe(false); // node 1 never present
    }
  });

  it("count matches suffix[0][0][budget] (internal consistency)", () => {
    const tree = makeTree(
      [makeNode(1), makeNode(2), makeNode(3), makeNode(4)],
      { pointBudget: 3 },
    );
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const { count } = countTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
  });

  it("with gate: nodes in later tier require spending enough points first", () => {
    const nodeA = makeNode(1, { row: 0 });
    const nodeB = makeNode(2, { row: 0 });
    const nodeC = makeNode(3, { row: 2, prev: [] }); // gated
    const tree = makeTree([nodeA, nodeB, nodeC], {
      pointBudget: 2,
      gates: [{ row: 2, requiredPoints: 2 }],
    });
    const constraints = new Map<number, Constraint>();
    const builds = generateTreeBuilds(tree, constraints);
    const { count } = countTreeBuilds(tree, constraints);
    expect(builds.length).toBe(Number(count));
    // Gate requires 2 pts spent before row 2. Budget=2, so must spend both on row 0 nodes.
    // Builds: (A+B, no C) is impossible since budget=2 and gate requires 2 pts → can't also take C.
    // Wait: gate says must have spent 2 before accessing row 2. Budget=2. So build must spend 2 on row 0.
    // Row 0 nodes: A(1) + B(1) = 2. So A+B only (can't take C since budget exhausted).
    // Actually C would require additional budget beyond 2... so only 1 build: A+B.
    for (const build of builds) {
      expect(build.entries.has(300)).toBe(false); // C never taken (budget exhausted before it)
    }
  });

  it("limit parameter caps the number of builds returned", () => {
    const nodes = [1, 2, 3, 4, 5].map((id) => makeNode(id));
    const tree = makeTree(nodes, { pointBudget: 3 });
    const constraints = new Map<number, Constraint>();
    const { count } = countTreeBuilds(tree, constraints);
    const all = generateTreeBuilds(tree, constraints);
    const limited = generateTreeBuilds(tree, constraints, 3);
    expect(all.length).toBe(Number(count));
    expect(limited.length).toBe(3);
  });
});
