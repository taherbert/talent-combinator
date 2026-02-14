import { describe, it, expect } from "vitest";
import { countBuilds, generateBuilds } from "../../src/worker/solver/engine";
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
    ...opts,
  };
}

function makeTree(nodes: TalentNode[]): TalentTree {
  const nodeMap = new Map<number, TalentNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return {
    type: "class",
    nodes: nodeMap,
    gates: [],
    maxPoints: nodes.reduce((s, n) => s + n.maxRanks, 0),
    totalNodes: nodes.length,
  };
}

describe("countBuilds", () => {
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

  it("counts two independent nodes as 2×2=4", () => {
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
    // Node 1 must be selected, node 2 is optional → 1×2=2
    expect(count).toBe(2);
  });

  it("respects 'never' constraint", () => {
    const tree = makeTree([makeNode(1), makeNode(2)]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
    ]);
    const count = countBuilds(tree, constraints);
    // Node 1 must be skipped, node 2 is optional → 1×2=2
    expect(count).toBe(2);
  });

  it("always constraint on multi-rank node enumerates all valid ranks", () => {
    const tree = makeTree([
      makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const count = countBuilds(tree, constraints);
    // Must select at least rank 1, so ranks 1,2,3 → 3
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
    // Skip, choose entry A, choose entry B → 3
    expect(count).toBe(3);
  });

  it("handles prerequisite chains", () => {
    const node1 = makeNode(1, { next: [2], row: 0 });
    const node2 = makeNode(2, { prev: [1], row: 1, entryNode: false });
    const tree = makeTree([node1, node2]);
    const count = countBuilds(tree, new Map());
    // node1=0,node2=0 | node1=1,node2=0 | node1=1,node2=1 → 3
    expect(count).toBe(3);
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
    // Every build must have node 1's entry
    for (const build of result.builds!) {
      const hasNode1 = build.entries.has(100); // entry id = node.id * 100 = 100
      expect(hasNode1).toBe(true);
    }
  });
});
