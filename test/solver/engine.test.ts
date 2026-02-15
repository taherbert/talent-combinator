import { describe, it, expect } from "vitest";
import {
  countBuilds,
  countBuildsFast,
  generateBuilds,
} from "../../src/worker/solver/engine";
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
    entryNode: true,
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

describe("countBuilds (DFS)", () => {
  it("counts a single optional node as 2 (take it or skip it)", () => {
    const tree = makeTree([makeNode(1)]);
    const count = countBuilds(tree, new Map());
    expect(count).toBe(2);
  });

  it("counts a single node with maxRanks=3 as 4 (0,1,2,3)", () => {
    const tree = makeTree([
      makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] }),
    ]);
    const count = countBuilds(tree, new Map());
    expect(count).toBe(4);
  });

  it("counts two independent nodes as 2x2=4", () => {
    const tree = makeTree([makeNode(1), makeNode(2)]);
    const count = countBuilds(tree, new Map());
    expect(count).toBe(4);
  });

  it("respects 'always' constraint", () => {
    const tree = makeTree([makeNode(1), makeNode(2)]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const count = countBuilds(tree, constraints);
    expect(count).toBe(2);
  });

  it("respects 'never' constraint", () => {
    const tree = makeTree([makeNode(1), makeNode(2)]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
    ]);
    const count = countBuilds(tree, constraints);
    expect(count).toBe(2);
  });

  it("always constraint on multi-rank enumerates valid ranks", () => {
    const tree = makeTree([
      makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const count = countBuilds(tree, constraints);
    // ranks 1,2,3
    expect(count).toBe(3);
  });

  it("handles choice nodes", () => {
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    const count = countBuilds(tree, new Map());
    // skip, A, B
    expect(count).toBe(3);
  });

  it("handles prerequisite chains", () => {
    const node1 = makeNode(1, { next: [2], row: 0 });
    const node2 = makeNode(2, { prev: [1], row: 1, entryNode: false });
    const tree = makeTree([node1, node2]);
    const count = countBuilds(tree, new Map());
    // (0,0) (1,0) (1,1) = 3
    expect(count).toBe(3);
  });

  it("does not charge free nodes against budget", () => {
    const freeRoot = makeNode(1, { freeNode: true, row: 0 });
    const child = makeNode(2, { row: 1, prev: [1], entryNode: false });
    freeRoot.next = [2];
    const tree = makeTree([freeRoot, child], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    // Free root costs 0 points, child costs 1 point, budget is 1
    expect(countBuilds(tree, constraints)).toBe(1);
  });

  it("does not charge entry nodes against budget", () => {
    const entry = makeNode(1, { entryNode: true, row: 0 });
    const child = makeNode(2, { row: 1, prev: [1], entryNode: false });
    entry.next = [2];
    const tree = makeTree([entry, child], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    expect(countBuilds(tree, constraints)).toBe(1);
  });

  it("respects pointBudget (not maxPoints)", () => {
    const n1 = makeNode(1, {
      maxRanks: 2,
      entries: [makeEntry(100, 2)],
      row: 0,
      entryNode: false,
    });
    const n2 = makeNode(2, {
      maxRanks: 2,
      entries: [makeEntry(200, 2)],
      row: 0,
      entryNode: false,
    });
    // maxPoints = 4, but pointBudget = 2
    const tree = makeTree([n1, n2], { pointBudget: 2 });
    // Valid: (0,0)(0,1)(0,2)(1,0)(1,1)(2,0) = 6
    expect(countBuilds(tree, new Map())).toBe(6);
  });
});

describe("countBuildsFast (DP)", () => {
  it("returns 1 for an empty tree", () => {
    const tree = makeTree([]);
    expect(countBuildsFast(tree, new Map())).toBe(1n);
  });

  it("matches DFS for single node with 3 ranks", () => {
    const node = makeNode(1, {
      maxRanks: 3,
      entries: [makeEntry(100, 3)],
    });
    const tree = makeTree([node]);
    const dfs = countBuilds(tree, new Map());
    const dp = countBuildsFast(tree, new Map());
    expect(dp).toBe(BigInt(dfs));
  });

  it("matches DFS with always constraint", () => {
    const node = makeNode(1);
    const tree = makeTree([node]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    expect(countBuildsFast(tree, constraints)).toBe(
      BigInt(countBuilds(tree, constraints)),
    );
  });

  it("matches DFS with never constraint", () => {
    const node = makeNode(1);
    const tree = makeTree([node]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
    ]);
    expect(countBuildsFast(tree, constraints)).toBe(
      BigInt(countBuilds(tree, constraints)),
    );
  });

  it("uses pointBudget, not maxPoints", () => {
    const n1 = makeNode(1, {
      maxRanks: 2,
      entries: [makeEntry(100, 2)],
      row: 0,
      entryNode: false,
    });
    const n2 = makeNode(2, {
      maxRanks: 2,
      entries: [makeEntry(200, 2)],
      row: 0,
      entryNode: false,
    });
    const tree = makeTree([n1, n2], { pointBudget: 2 });
    expect(countBuildsFast(tree, new Map())).toBe(6n);
  });

  it("does not charge free/entry nodes", () => {
    const freeRoot = makeNode(1, { freeNode: true, row: 0 });
    const child = makeNode(2, { row: 1, prev: [1], entryNode: false });
    freeRoot.next = [2];
    const tree = makeTree([freeRoot, child], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    expect(countBuildsFast(tree, constraints)).toBe(1n);
  });

  it("matches DFS for choice nodes", () => {
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    expect(countBuildsFast(tree, new Map())).toBe(3n);
  });

  it("matches DFS with entryIndex constraint on choice", () => {
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", entryIndex: 0 }],
    ]);
    expect(countBuildsFast(tree, constraints)).toBe(1n);
  });

  it("returns 0n for always+never conflict on same node", () => {
    // Set up: two constraints that conflict
    const n1 = makeNode(1, { row: 0, next: [2] });
    const n2 = makeNode(2, { row: 1, prev: [1], entryNode: false });
    const tree = makeTree([n1, n2]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    // Now block the only path: set n1 never
    constraints.set(1, { nodeId: 1, type: "never" });
    // n2 is always but unreachable = 0 builds
    expect(countBuildsFast(tree, constraints)).toBe(0n);
  });

  it("matches DFS for branching tree", () => {
    //   1 (entry)
    //  / \
    // 2   3
    //  \ /
    //   4
    const n1 = makeNode(1, { entryNode: true, row: 0, next: [2, 3] });
    const n2 = makeNode(2, { row: 1, prev: [1], next: [4], entryNode: false });
    const n3 = makeNode(3, { row: 1, prev: [1], next: [4], entryNode: false });
    const n4 = makeNode(4, { row: 2, prev: [2, 3], entryNode: false });
    const tree = makeTree([n1, n2, n3, n4], { pointBudget: 3 });

    const dfs = countBuilds(tree, new Map());
    const dp = countBuildsFast(tree, new Map());
    expect(dp).toBe(BigInt(dfs));
  });

  it("matches DFS with mixed always/never constraints", () => {
    const n1 = makeNode(1, { row: 0, next: [2, 3] });
    const n2 = makeNode(2, { row: 1, prev: [1], entryNode: false });
    const n3 = makeNode(3, { row: 1, prev: [1], entryNode: false });
    const tree = makeTree([n1, n2, n3]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [3, { nodeId: 3, type: "never" }],
    ]);
    const dfs = countBuilds(tree, constraints);
    const dp = countBuildsFast(tree, constraints);
    expect(dp).toBe(BigInt(dfs));
  });
});

describe("gate enforcement", () => {
  it("enforces gate requirements", () => {
    const a = makeNode(1, { row: 0, entryNode: false });
    const b = makeNode(2, { prev: [1], row: 1, entryNode: false });
    a.next = [2];
    const tree = makeTree([a, b], {
      gates: [{ row: 1, requiredPoints: 1 }],
    });
    // a=1,b=0: OK (1pt >= gate req)
    // a=1,b=1: OK (1pt >= gate req, prereq met)
    // a=0: gate blocks tier 1 entirely, can't even assign b=0
    expect(countBuilds(tree, new Map())).toBe(2);
  });

  it("gate enforcement matches between DFS and DP", () => {
    const a = makeNode(1, { row: 0, entryNode: false });
    const b = makeNode(2, { prev: [1], row: 1, entryNode: false });
    a.next = [2];
    const tree = makeTree([a, b], {
      gates: [{ row: 1, requiredPoints: 1 }],
    });
    const dfs = countBuilds(tree, new Map());
    const dp = countBuildsFast(tree, new Map());
    expect(dp).toBe(BigInt(dfs));
  });
});

describe("fully selected hero tree", () => {
  it("returns 1 build when all nodes are always-selected with free root", () => {
    const freeRoot = makeNode(1, { freeNode: true, row: 0, next: [2] });
    const nodes: TalentNode[] = [freeRoot];
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);

    let prevId = 1;
    for (let i = 2; i <= 14; i++) {
      const node = makeNode(i, {
        row: i - 1,
        prev: [prevId],
        entryNode: false,
      });
      nodes[prevId - 1].next = [...(nodes[prevId - 1].next || []), i];
      nodes.push(node);
      constraints.set(i, { nodeId: i, type: "always" });
      prevId = i;
    }

    // 13 non-free nodes = 13 points needed, budget = 13
    const tree = makeTree(nodes, { type: "hero", pointBudget: 13 });
    expect(countBuilds(tree, constraints)).toBe(1);
    expect(countBuildsFast(tree, constraints)).toBe(1n);
  });
});

describe("generateBuilds", () => {
  it("generates correct builds for single node", () => {
    const tree = makeTree([makeNode(1)]);
    const result = generateBuilds(tree, new Map());
    expect(result.count).toBe(2);
    expect(result.builds).toHaveLength(2);
  });

  it("deduplicates identical builds", () => {
    const tree = makeTree([makeNode(1)]);
    const result = generateBuilds(tree, new Map());
    const keys = new Set(
      result.builds!.map((b) =>
        Array.from(b.entries.entries())
          .sort(([a], [b]) => a - b)
          .map(([k, v]) => `${k}:${v}`)
          .join("/"),
      ),
    );
    expect(keys.size).toBe(result.builds!.length);
  });

  it("respects constraints in generated builds", () => {
    const tree = makeTree([makeNode(1), makeNode(2)]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const result = generateBuilds(tree, constraints);
    for (const build of result.builds!) {
      expect(build.entries.has(100)).toBe(true);
    }
  });

  it("respects entryIndex on choice nodes", () => {
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", entryIndex: 0 }],
    ]);
    const result = generateBuilds(tree, constraints);
    expect(result.count).toBe(1);
    expect(result.builds![0].entries.has(100)).toBe(true);
    expect(result.builds![0].entries.has(101)).toBe(false);
  });

  it("respects exactRank on multi-rank nodes", () => {
    const tree = makeTree([
      makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", exactRank: 2 }],
    ]);
    const result = generateBuilds(tree, constraints);
    expect(result.count).toBe(1);
    expect(result.builds![0].entries.get(100)).toBe(2);
  });
});
