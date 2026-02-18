import { describe, it, expect } from "vitest";
import { countTreeBuilds } from "../../src/shared/build-counter";
import { generateBuilds } from "../../src/worker/solver/engine";
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

describe("countTreeBuilds", () => {
  it("picks subset when budget < total nodes", () => {
    // 3 nodes, budget=2: pick any 2 of 3 → (1,1,0)(1,0,1)(0,1,1) = 3
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    expect(countTreeBuilds(tree, new Map()).count).toBe(3n);
  });

  it("counts multi-rank distributions", () => {
    // 2 nodes each maxRanks=2, budget=3: (1,2)(2,1) = 2
    const n1 = makeNode(1, {
      maxRanks: 2,
      entries: [makeEntry(100, 2)],
    });
    const n2 = makeNode(2, {
      maxRanks: 2,
      entries: [makeEntry(200, 2)],
    });
    const tree = makeTree([n1, n2], { pointBudget: 3 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(2n);
  });

  it("respects 'always' constraint", () => {
    // 3 nodes, budget=2, node1=always: must take node1 + pick 1 of 2 remaining
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(2n);
  });

  it("respects 'never' constraint", () => {
    // 3 nodes, budget=2, node1=never: pick 2 from nodes 2,3 → (1,1) = 1
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("always constraint on multi-rank enumerates valid ranks", () => {
    // node1 maxRanks=3 (always), node2 maxRanks=1, budget=3
    // node1 must be ≥1: (2,1) or (3,0) = 2
    const n1 = makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] });
    const n2 = makeNode(2);
    const tree = makeTree([n1, n2], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(2n);
  });

  it("handles choice nodes", () => {
    // 1 choice node with 2 entries, budget=1: must spend 1 → A or B = 2
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    expect(countTreeBuilds(tree, new Map()).count).toBe(2n);
  });

  it("handles prerequisite chains", () => {
    // node1→node2, node3 independent, budget=2
    // (1,1,0) and (1,0,1) = 2 (node2 requires node1)
    const n1 = makeNode(1, { next: [2], row: 0 });
    const n2 = makeNode(2, { prev: [1], row: 1, entryNode: false });
    const n3 = makeNode(3, { row: 0 });
    const tree = makeTree([n1, n2, n3], { pointBudget: 2 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(2n);
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
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
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
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("respects pointBudget (not maxPoints)", () => {
    const n1 = makeNode(1, {
      maxRanks: 2,
      entries: [makeEntry(100, 2)],
    });
    const n2 = makeNode(2, {
      maxRanks: 2,
      entries: [makeEntry(200, 2)],
    });
    // maxPoints = 4, but pointBudget = 2: (0,2)(1,1)(2,0) = 3
    const tree = makeTree([n1, n2], { pointBudget: 2 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(3n);
  });

  it("returns 1n for an empty tree", () => {
    const tree = makeTree([], { pointBudget: 0 });
    expect(countTreeBuilds(tree, new Map()).count).toBe(1n);
  });

  it("handles entryIndex constraint on choice", () => {
    const tree = makeTree([
      makeNode(1, {
        type: "choice",
        entries: [makeEntry(100), makeEntry(101)],
      }),
    ]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", entryIndex: 0 }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("returns 0n when always node is unreachable", () => {
    const n1 = makeNode(1, { row: 0, next: [2] });
    const n2 = makeNode(2, { row: 1, prev: [1], entryNode: false });
    const tree = makeTree([n1, n2]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(0n);
  });

  it("matches generateBuilds for branching tree", () => {
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

    const counted = countTreeBuilds(tree, new Map());
    const generated = generateBuilds(tree, new Map());
    expect(counted.count).toBe(BigInt(generated.count));
  });

  it("matches generateBuilds with mixed always/never constraints", () => {
    const n1 = makeNode(1, { row: 0, next: [2, 3] });
    const n2 = makeNode(2, { row: 1, prev: [1], entryNode: false });
    const n3 = makeNode(3, { row: 1, prev: [1], entryNode: false });
    const tree = makeTree([n1, n2, n3]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [3, { nodeId: 3, type: "never" }],
    ]);
    const counted = countTreeBuilds(tree, constraints);
    const generated = generateBuilds(tree, constraints);
    expect(counted.count).toBe(BigInt(generated.count));
  });

  it("returns 1 build for fully-selected hero tree", () => {
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
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });
});

describe("countTreeBuilds gates", () => {
  it("enforces gate requirements", () => {
    // 3 nodes: a (row 0), b (row 0), c (row 1, prev=[a])
    // Gate at row 1 requires 1pt. Budget=2.
    // Must spend exactly 2. Gate requires ≥1pt before row 1.
    // Options: a=1 passes gate → (1,0,1) or (1,1,0) = 2
    // b alone can't pass gate for c, but (0,1,?) only has b=1 before gate → passes!
    // Wait: c prev=[a], so c requires a to be selected.
    // (1,0,1)=2pts: a=1 gate pass, c accessible ✓
    // (1,1,0)=2pts: a=1 gate pass, c skipped ✓
    // (0,1,1): gate passes (b=1≥1) but c requires a=1 → inaccessible. Invalid.
    // (0,1,0)=1pt: not exactly 2. Invalid.
    const a = makeNode(1, { row: 0, next: [3] });
    const b = makeNode(2, { row: 0 });
    const c = makeNode(3, { prev: [1], row: 1, entryNode: false });
    const tree = makeTree([a, b, c], {
      pointBudget: 2,
      gates: [{ row: 1, requiredPoints: 1 }],
    });
    expect(countTreeBuilds(tree, new Map()).count).toBe(2n);
  });
});

describe("countTreeBuilds warnings", () => {
  it("warns on unreachable always node", () => {
    const n1 = makeNode(1, { row: 0, next: [2] });
    const n2 = makeNode(2, { row: 1, prev: [1], entryNode: false });
    const tree = makeTree([n1, n2]);
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
      [2, { nodeId: 2, type: "always" }],
    ]);
    const result = countTreeBuilds(tree, constraints);
    expect(result.count).toBe(0n);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].severity).toBe("error");
    expect(result.warnings[0].message).toContain("unreachable");
  });

  it("warns when mandatory talents exceed budget", () => {
    const nodes: TalentNode[] = [];
    const constraints = new Map<number, Constraint>();

    for (let i = 1; i <= 5; i++) {
      const node = makeNode(i, {
        row: i - 1,
        prev: i > 1 ? [i - 1] : [],
        next: i < 5 ? [i + 1] : [],
        entryNode: i === 1,
      });
      nodes.push(node);
      constraints.set(i, { nodeId: i, type: "always" });
    }

    // 4 non-entry always nodes = 4 points needed, budget = 3
    const tree = makeTree(nodes, { pointBudget: 3 });
    const result = countTreeBuilds(tree, constraints);
    expect(
      result.warnings.some(
        (w) => w.severity === "error" && w.message.includes("points"),
      ),
    ).toBe(true);
  });

  it("warns when never constraints block gate passage", () => {
    const nodes = [
      makeNode(1, { row: 0, entryNode: false }),
      makeNode(2, { row: 0, entryNode: false }),
      makeNode(3, { row: 0, entryNode: false }),
      makeNode(4, { row: 1, entryNode: false }),
    ];
    const tree = makeTree(nodes, {
      gates: [{ row: 1, requiredPoints: 3 }],
    });

    // Block 2 of 3 nodes before gate
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "never" }],
      [3, { nodeId: 3, type: "never" }],
    ]);

    // Available before gate: only node 1 (maxRanks=1) = 1 < 3 required
    const result = countTreeBuilds(tree, constraints);
    expect(result.warnings.some((w) => w.message.includes("gate"))).toBe(true);
  });

  it("returns no warnings for valid constraints", () => {
    // 3 nodes, budget=2, node1=always: pick node1 + 1 of 2 = 2 builds, no warnings
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
    ]);
    const result = countTreeBuilds(tree, constraints);
    expect(result.warnings).toHaveLength(0);
    expect(result.count).toBe(2n);
  });

  it("includes timing information", () => {
    const tree = makeTree([makeNode(1)]);
    const result = countTreeBuilds(tree, new Map());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("generateBuilds", () => {
  it("generates correct builds for subset selection", () => {
    // 3 nodes, budget=2: pick any 2 of 3
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const result = generateBuilds(tree, new Map());
    expect(result.count).toBe(3);
    expect(result.builds).toHaveLength(3);
  });

  it("deduplicates identical builds", () => {
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
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
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
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
    // node1 maxRanks=3 exactRank=2, node2 maxRanks=1, budget=3
    // node1 must be rank 2 (2pts), node2 must fill remaining 1pt → (2,1)
    const tree = makeTree(
      [makeNode(1, { maxRanks: 3, entries: [makeEntry(100, 3)] }), makeNode(2)],
      { pointBudget: 3 },
    );
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always", exactRank: 2 }],
    ]);
    const result = generateBuilds(tree, constraints);
    expect(result.count).toBe(1);
    expect(result.builds![0].entries.get(100)).toBe(2);
  });
});
