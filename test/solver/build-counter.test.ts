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

  it("negated: 'take B if A NOT selected'", () => {
    // A, B, C — budget 2. Conditional: if A NOT selected → B must be selected.
    // Builds: A+B, A+C, B+C.
    // A+B: A selected, condition false → no enforcement. OK.
    // A+C: A selected, condition false → no enforcement. OK.
    // B+C: A not selected, condition true → B must be selected. B is. OK.
    // All 3 survive → count = 3.
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 2,
    });
    const negSel: BooleanExpr = {
      op: "TALENT_SELECTED",
      nodeId: 1,
      negated: true,
    };
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: negSel }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(3n);
  });

  it("negated: forces target when trigger absent", () => {
    // A (never), B, C — budget 1. Conditional: if A NOT selected → B.
    // A is never → always absent. Condition always true → B forced.
    // Budget 1: only {B}. Count = 1.
    const tree = makeTree([makeNode(1), makeNode(2), makeNode(3)], {
      pointBudget: 1,
    });
    const negSel: BooleanExpr = {
      op: "TALENT_SELECTED",
      nodeId: 1,
      negated: true,
    };
    const constraints = new Map<number, Constraint>([
      [1, { nodeId: 1, type: "never" }],
      [2, { nodeId: 2, type: "conditional", condition: negSel }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(1n);
  });

  it("entry-specific: condition on specific choice entry", () => {
    // Choice node C (entries 100, 101), single node B — budget 2.
    // Conditional: if entry 100 of C selected → B must be selected.
    // Without: C(100)+B, C(101)+B → 2 builds (budget forces both nodes).
    // Actually let's use 3 nodes:
    // A, B, C (choice with entries 300, 301) — budget 2.
    // Builds: A+B, A+C(300), A+C(301), B+C(300), B+C(301) → 5 builds.
    // Conditional: if entry 300 → B must be selected.
    // A+B: no entry 300 → OK.
    // A+C(300): entry 300, B not → INVALID.
    // A+C(301): no entry 300 → OK.
    // B+C(300): entry 300, B selected → OK.
    // B+C(301): no entry 300 → OK.
    // Count = 4.
    const a = makeNode(1);
    const b = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([a, b, c], { pointBudget: 2 });
    const entryCond: BooleanExpr = {
      op: "TALENT_SELECTED",
      nodeId: 3,
      entryId: 300,
    };
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: entryCond }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(4n);
  });

  it("entry-specific: node-level ref still checks any entry", () => {
    // Same setup but condition uses nodeId without entryId.
    // Conditional: if C (any entry) → B must be selected.
    // A+C(300): C selected, B not → INVALID.
    // A+C(301): C selected, B not → INVALID.
    // Others: A+B OK, B+C(300) OK, B+C(301) OK.
    // Count = 3.
    const a = makeNode(1);
    const b = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([a, b, c], { pointBudget: 2 });
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: sel(3) }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(3n);
  });

  it("negated + entry-specific: NOT entry 300", () => {
    // A, B, C (choice: 300, 301) — budget 2.
    // Conditional: if entry 300 NOT selected → B must be selected.
    // A+B: entry 300 absent → B must be selected. B is. OK.
    // A+C(300): entry 300 present → no enforcement. OK.
    // A+C(301): entry 300 absent → B must be selected. B not. INVALID.
    // B+C(300): entry 300 present → no enforcement. OK.
    // B+C(301): entry 300 absent → B must be selected. B is. OK.
    // Count = 4.
    const a = makeNode(1);
    const b = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([a, b, c], { pointBudget: 2 });
    const negEntryCond: BooleanExpr = {
      op: "TALENT_SELECTED",
      nodeId: 3,
      entryId: 300,
      negated: true,
    };
    const constraints = new Map<number, Constraint>([
      [2, { nodeId: 2, type: "conditional", condition: negEntryCond }],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(4n);
  });
});

describe("entry-conditional constraints", () => {
  it("one entry gated: entry 300 only available when X taken", () => {
    // X (id=1), C (id=2, choice: 300, 301) — budget 2.
    // Constraint: entry 300 of C only available when X is taken.
    // Without constraint: X+C(300), X+C(301) = 2 builds.
    // With: X+C(300) OK (X taken), X+C(301) OK, C(300) alone impossible
    //   (X not taken), C(301) alone: not possible (budget=2, C costs 1, need 1 more).
    // Wait, budget=2 with 2 nodes. Let me add a third.
    // X(1), Y(2), C(3, choice: 300, 301) — budget 2.
    // Without: X+Y, X+C(300), X+C(301), Y+C(300), Y+C(301) = 5.
    // Constraint: entry 300 of C only if X taken.
    // X+Y OK, X+C(300) OK (X taken), X+C(301) OK, Y+C(300) INVALID (X not taken),
    // Y+C(301) OK. Count = 4.
    const x = makeNode(1);
    const y = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([x, y, c], { pointBudget: 2 });
    const sel1: BooleanExpr = { op: "TALENT_SELECTED", nodeId: 1 };
    const constraints = new Map<number, Constraint>([
      [
        3,
        {
          nodeId: 3,
          type: "entry-conditional",
          entryConditions: [{ entryIndex: 0, condition: sel1 }],
        },
      ],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(4n);
  });

  it("both entries gated with different triggers", () => {
    // X(1), Y(2), C(3, choice: 300, 301) — budget 2.
    // Entry 300 requires X, entry 301 requires Y.
    // X+Y: both conditions met, but C not taken (skip). Valid.
    // X+C(300): X taken → 300 OK. Y not taken → 301 unavailable. Valid.
    // X+C(301): X taken → 300 available. Y not taken → 301 INVALID.
    // Y+C(300): Y taken → 301 OK. X not taken → 300 INVALID.
    // Y+C(301): Y taken → 301 OK. X not taken → 300 unavailable. Valid.
    // Count = 3.
    const x = makeNode(1);
    const y = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([x, y, c], { pointBudget: 2 });
    const selX: BooleanExpr = { op: "TALENT_SELECTED", nodeId: 1 };
    const selY: BooleanExpr = { op: "TALENT_SELECTED", nodeId: 2 };
    const constraints = new Map<number, Constraint>([
      [
        3,
        {
          nodeId: 3,
          type: "entry-conditional",
          entryConditions: [
            { entryIndex: 0, condition: selX },
            { entryIndex: 1, condition: selY },
          ],
        },
      ],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(3n);
  });

  it("entry-conditional with negated trigger", () => {
    // X(1), Y(2), C(3, choice: 300, 301) — budget 2.
    // Entry 300 requires NOT X (available only when X is NOT taken).
    // X+Y: X taken, so 300 unavailable. C not taken. Valid.
    // X+C(300): X taken → 300 INVALID.
    // X+C(301): X taken → 300 unavailable, 301 free. Valid.
    // Y+C(300): X not taken → 300 OK. Valid.
    // Y+C(301): X not taken → 300 available, 301 also free. Valid.
    // Count = 4.
    const x = makeNode(1);
    const y = makeNode(2);
    const c = makeNode(3, {
      type: "choice",
      entries: [makeEntry(300), makeEntry(301)],
    });
    const tree = makeTree([x, y, c], { pointBudget: 2 });
    const notX: BooleanExpr = {
      op: "TALENT_SELECTED",
      nodeId: 1,
      negated: true,
    };
    const constraints = new Map<number, Constraint>([
      [
        3,
        {
          nodeId: 3,
          type: "entry-conditional",
          entryConditions: [{ entryIndex: 0, condition: notX }],
        },
      ],
    ]);
    expect(countTreeBuilds(tree, constraints).count).toBe(4n);
  });
});
