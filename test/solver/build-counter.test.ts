import { describe, it, expect } from "vitest";
import { countTreeBuilds } from "../../src/shared/build-counter";
import type { Constraint, BooleanExpr } from "../../src/shared/types";
import { makeEntry, makeNode, makeTree } from "./test-helpers";

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

describe("conditional constraints", () => {
  function sel(nodeId: number): BooleanExpr {
    return { op: "TALENT_SELECTED", nodeId };
  }

  it("simple: 'take B if A selected' excludes A-without-B build", () => {
    // A, B, C — budget 2. Without conditional: 3 builds (A+B, A+C, B+C).
    // Conditional: if A selected → B selected. Removes A+C. Leaves A+B, B+C.
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(2n);
  });

  it("trigger processed after target in ordering", () => {
    // B (row 0), A (row 1). Conditional: if A selected → B selected.
    // Enforcement at max(index(B)=0, index(A)=1) = 1.
    // Budget=1: builds {B}, {A}. Conditional removes {A} (A selected, B not).
    // Only {B} survives → count = 1.
    const b = makeNode(2, { row: 0 });
    const a = makeNode(1, { row: 1 });
    const tree = makeTree([b, a], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("multi-rank conditional target — rank >= 1 satisfies", () => {
    // A (maxRanks=1), B (maxRanks=3), budget=3.
    // Conditional: if A selected → B selected.
    // Without: A(1)+B(2)=3, A(skip)+B(3)=3 → 2 builds.
    // With: A selected → B must be selected. A(1)+B(2): B selected ✓.
    //        A(skip)+B(3): A not selected, no enforcement. ✓. Count = 2.
    const a = makeNode(1, { row: 0 });
    const b = makeNode(2, {
      maxRanks: 3,
      entries: [makeEntry(200, 3)],
      row: 0,
    });
    const tree = makeTree([a, b], { pointBudget: 3 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(2n);
  });

  it("conditional + always trigger forces target too", () => {
    // A (always), B, C — budget 2. Conditional: if A → B.
    // A is forced. So B must be selected. Only build: A+B. Count = 1.
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("impossible conditional gives zero builds", () => {
    // Budget=2, A costs 1, B blocked → can't spend 2. Count = 0.
    const tree = makeTree([makeNode(1), makeNode(2)], { pointBudget: 2 });
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "always" }],
      [2, { nodeId: 2, type: "never" }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(0n);
  });

  it("OR compound condition", () => {
    // A, B, C, D — budget 2. Conditional: if (A OR B) → C.
    // Without conditional: C(4,2) = 6 builds.
    // With: any build containing A or B must also contain C.
    // Builds without A or B: {C,D} → OK.
    // Builds with A or B: must include C.
    //   {A,C}, {B,C} → OK.
    //   {A,B}, {A,D}, {B,D} → A or B selected but C not → invalid.
    // Total: 3 builds.
    const tree = makeTree(
      [makeNode(1), makeNode(2), makeNode(3), makeNode(4)],
      { pointBudget: 2 },
    );
    const cond: BooleanExpr = {
      op: "OR",
      children: [sel(1), sel(2)],
    };
    const constraints = new Map<number, Constraint>([
      [3, { nodeId: 3, type: "conditional", condition: cond }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(3n);
  });

  it("AND compound condition", () => {
    // A, B, C — budget 2. Conditional: if (A AND B) → C.
    // Without: 3 builds (A+B, A+C, B+C).
    // With: if A AND B both selected → C must be selected.
    //   A+B: both selected, C not → invalid.
    //   A+C: only A selected, AND = false → OK.
    //   B+C: only B selected, AND = false → OK.
    // Total: 2 builds.
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const cond: BooleanExpr = {
      op: "AND",
      children: [sel(1), sel(2)],
    };
    const constraints = new Map<number, Constraint>([
      [3, { nodeId: 3, type: "conditional", condition: cond }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(2n);
  });

  it("multi-rank ancestor trigger uses separate cond bit", () => {
    // A (maxRanks=2, parent of C), B standalone. Conditional: if A → B.
    // Budget=2. A is an ancestor with maxRanks>1, so gets a separate cond bit.
    // Builds without conditional:
    //   A(1)+B(1)=2, A(2)+C(skip because C needs A fully invested? No — C
    //   only needs A as prev, which requires full rank): A(2)+C(0)=2 is invalid
    //   since budget is 2 and C can't be taken without full A... actually
    //   C requires A fully invested (bit set). A(2) sets fullBits. Budget=2.
    //   A(2): 2 pts spent, 0 left → only A. No room for C. A(1)+B(1): valid.
    //   A(1)+C(?): C needs A fully invested (maxRanks=2) → inaccessible. Invalid.
    //   B(1)+??: only 1 pt, need 2. Impossible without A.
    //   So without conditional: A(2), A(1)+B(1) → 2 builds.
    // With conditional (if A selected → B selected):
    //   A(2): A selected (rank≥1), B not → INVALID.
    //   A(1)+B(1): A selected, B selected → OK.
    // Count = 1.
    const a = makeNode(1, {
      maxRanks: 2,
      entries: [makeEntry(100, 2)],
      row: 0,
      next: [3],
    });
    const b = makeNode(2, { row: 0 });
    const c = makeNode(3, { row: 1, prev: [1] });
    const tree = makeTree([a, b, c], { pointBudget: 2 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("no warning for same-tree conditionals", () => {
    const tree = makeTree([makeNode(1), makeNode(2)], { pointBudget: 1 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(1) }],
    ]);
    const result = countTreeBuilds(tree, constraints);
    const hasCondWarning = result.warnings.some(
      (w) => w.severity === "warning" && w.message.includes("conditional"),
    );
    expect(hasCondWarning).toBe(false);
  });
});
