import type {
  TalentTree,
  TalentNode,
  Constraint,
  Build,
  SolverResult,
} from "../../shared/types";
import { checkConstraints, getNodesByType } from "./constraints";
import { encodeBuild } from "./encoder";

interface SolverState {
  tiers: Map<number, TalentNode[]>;
  sortedTierKeys: number[];
  constraints: Map<number, Constraint>;
  alwaysNodes: Set<number>;
  neverNodes: Set<number>;
}

function prepareSolver(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): SolverState {
  const tiers = new Map<number, TalentNode[]>();
  for (const node of tree.nodes.values()) {
    let tier = tiers.get(node.row);
    if (!tier) {
      tier = [];
      tiers.set(node.row, tier);
    }
    tier.push(node);
  }

  return {
    tiers,
    sortedTierKeys: Array.from(tiers.keys()).sort((a, b) => a - b),
    constraints,
    alwaysNodes: getNodesByType(constraints, "always"),
    neverNodes: getNodesByType(constraints, "never"),
  };
}

interface PartialBuild {
  selected: Map<number, number>;
  entries: Map<number, number>;
  pointsSpent: number;
}

function emptyBuild(): PartialBuild {
  return { selected: new Map(), entries: new Map(), pointsSpent: 0 };
}

function cloneBuild(b: PartialBuild): PartialBuild {
  return {
    selected: new Map(b.selected),
    entries: new Map(b.entries),
    pointsSpent: b.pointsSpent,
  };
}

function gateCheck(
  tierRow: number,
  pointsSpent: number,
  gates: { row: number; requiredPoints: number }[],
): boolean {
  for (const gate of gates) {
    if (tierRow >= gate.row && pointsSpent < gate.requiredPoints) {
      return false;
    }
  }
  return true;
}

function prerequisitesMet(
  node: TalentNode,
  selected: Map<number, number>,
): boolean {
  if (node.entryNode || node.freeNode) return true;
  if (node.prev.length === 0) return true;
  return node.prev.some((prevId) => (selected.get(prevId) ?? 0) > 0);
}

function isAccessibleByBitmap(
  node: TalentNode,
  bitmap: number,
  ancestorBitIndex: Map<number, number>,
): boolean {
  if (node.entryNode || node.freeNode || node.prev.length === 0) return true;
  for (const prevId of node.prev) {
    const bit = ancestorBitIndex.get(prevId);
    if (bit != null && (bitmap & (1 << bit)) !== 0) return true;
  }
  return false;
}

type LeafVisitor = (build: PartialBuild) => void;

interface NodeLayout {
  orderedNodes: TalentNode[];
  flatOffsets: number[];
  ancestorBitIndex: Map<number, number>;
  bitCount: number;
}

function computeNodeLayout(
  tree: TalentTree,
  solverState: SolverState,
): NodeLayout {
  const ancestorIds = new Set<number>();
  for (const node of tree.nodes.values()) {
    if (node.freeNode || node.entryNode) continue;
    for (const prevId of node.prev) {
      ancestorIds.add(prevId);
    }
  }

  const orderedNodes: TalentNode[] = [];
  const flatOffsets: number[] = [];
  for (const tierKey of solverState.sortedTierKeys) {
    flatOffsets.push(orderedNodes.length);
    orderedNodes.push(...solverState.tiers.get(tierKey)!);
  }

  const ancestorBitIndex = new Map<number, number>();
  let bitCount = 0;
  for (const node of orderedNodes) {
    if (ancestorIds.has(node.id)) {
      ancestorBitIndex.set(node.id, bitCount++);
    }
  }

  return { orderedNodes, flatOffsets, ancestorBitIndex, bitCount };
}

function traverse(
  tree: TalentTree,
  solverState: SolverState,
  onLeaf: LeafVisitor,
): void {
  function dfs(tierIdx: number, build: PartialBuild): void {
    if (tierIdx >= solverState.sortedTierKeys.length) {
      if (checkConstraints(solverState.constraints, build.selected)) {
        onLeaf(build);
      }
      return;
    }

    const tierRow = solverState.sortedTierKeys[tierIdx];
    if (!gateCheck(tierRow, build.pointsSpent, tree.gates)) return;

    const tierNodes = solverState.tiers.get(tierRow)!;
    enumerateTier(tierIdx, 0, tierNodes, build);
  }

  function enumerateTier(
    tierIdx: number,
    nodeIdx: number,
    tierNodes: TalentNode[],
    build: PartialBuild,
  ): void {
    if (nodeIdx >= tierNodes.length) {
      dfs(tierIdx + 1, build);
      return;
    }

    const node = tierNodes[nodeIdx];
    const accessible = prerequisitesMet(node, build.selected);

    if (solverState.neverNodes.has(node.id)) {
      if (solverState.alwaysNodes.has(node.id)) return;
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
      return;
    }

    if (!accessible && !node.freeNode) {
      if (solverState.alwaysNodes.has(node.id)) return;
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
      return;
    }

    if (node.type === "choice") {
      const constraint = solverState.constraints.get(node.id);

      if (!solverState.alwaysNodes.has(node.id)) {
        const bSkip = cloneBuild(build);
        bSkip.selected.set(node.id, 0);
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, bSkip);
      }

      const entriesToTry =
        constraint?.entryIndex != null
          ? [node.entries[constraint.entryIndex]].filter(Boolean)
          : node.entries;

      for (const entry of entriesToTry) {
        const b = cloneBuild(build);
        b.selected.set(node.id, entry.maxRanks);
        b.entries.set(entry.id, entry.maxRanks);
        if (!node.freeNode && !node.entryNode) b.pointsSpent += entry.maxRanks;
        if (b.pointsSpent <= tree.pointBudget) {
          enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
        }
      }
    } else {
      const constraint = solverState.constraints.get(node.id);
      const entry = node.entries[0];

      let minRank: number, maxRank: number;
      if (constraint?.exactRank != null) {
        minRank = maxRank = constraint.exactRank;
      } else {
        minRank = solverState.alwaysNodes.has(node.id) ? 1 : 0;
        maxRank = node.maxRanks;
      }

      for (let rank = minRank; rank <= maxRank; rank++) {
        const b = cloneBuild(build);
        b.selected.set(node.id, rank);
        if (rank > 0 && entry) {
          b.entries.set(entry.id, rank);
        }
        if (!node.freeNode && !node.entryNode) b.pointsSpent += rank;
        if (b.pointsSpent <= tree.pointBudget) {
          enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
        }
      }
    }
  }

  dfs(0, emptyBuild());
}

// --- Polynomial DP fast counter ---
// Uses number[] internally for performance. Per-tree counts fit in
// Number.MAX_SAFE_INTEGER; BigInt conversion happens at the API boundary.

type Poly = number[];

function polyConvolve(a: Poly, b: Poly, maxDeg: number): Poly {
  const result = new Array(maxDeg + 1).fill(0);
  for (let i = 0; i < a.length && i <= maxDeg; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length && i + j <= maxDeg; j++) {
      result[i + j] += a[i] * b[j];
    }
  }
  return result;
}

function polyAdd(a: Poly, b: Poly, maxDeg: number): Poly {
  const len = Math.max(a.length, b.length);
  const result = new Array(Math.min(len, maxDeg + 1)).fill(0);
  for (let i = 0; i < result.length; i++) {
    result[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }
  return result;
}

function hasConditionalConstraints(
  constraints: Map<number, Constraint>,
): boolean {
  for (const c of constraints.values()) {
    if (c.type === "conditional") return true;
  }
  return false;
}

interface NodePolyResult {
  skipPoly: Poly | null;
  selectPoly: Poly | null;
}

function buildNodePoly(
  node: TalentNode,
  constraint: Constraint | undefined,
  isAlways: boolean,
  isNever: boolean,
  accessible: boolean,
): NodePolyResult {
  const isFree = node.freeNode || node.entryNode;

  if (isNever || (!accessible && !node.freeNode)) {
    return { skipPoly: null, selectPoly: null };
  }

  if (node.type === "choice") {
    const entriesToUse =
      constraint?.entryIndex != null
        ? [node.entries[constraint.entryIndex]].filter(Boolean)
        : node.entries;

    const selPoly: Poly = [];
    for (const entry of entriesToUse) {
      const cost = isFree ? 0 : entry.maxRanks;
      while (selPoly.length <= cost) selPoly.push(0);
      selPoly[cost] += 1;
    }

    if (isAlways) {
      return { skipPoly: null, selectPoly: selPoly };
    }
    return { skipPoly: [1], selectPoly: selPoly };
  }

  let minRank: number, maxRank: number;
  if (constraint?.exactRank != null) {
    minRank = maxRank = constraint.exactRank;
  } else {
    minRank = isAlways ? 1 : 0;
    maxRank = node.maxRanks;
  }

  const startRank = Math.max(minRank, 1);
  const selPoly: Poly = [];
  for (let rank = startRank; rank <= maxRank; rank++) {
    const cost = isFree ? 0 : rank;
    while (selPoly.length <= cost) selPoly.push(0);
    selPoly[cost] += 1;
  }

  const skipPoly = minRank > 0 ? null : ([1] as Poly);
  return { skipPoly, selectPoly: selPoly };
}

// JS bitwise ops work on 32-bit signed ints (bits 0-31), so we can
// track up to 32 ancestor nodes. Beyond that, fall back to DFS.
const MAX_BITMAP_BITS = 32;

export function countBuildsFast(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): bigint {
  if (hasConditionalConstraints(constraints)) {
    return BigInt(countBuilds(tree, constraints));
  }

  const solverState = prepareSolver(tree, constraints);
  const budget = tree.pointBudget;
  const { orderedNodes, ancestorBitIndex, bitCount } = computeNodeLayout(
    tree,
    solverState,
  );

  if (bitCount > MAX_BITMAP_BITS) {
    return BigInt(countBuilds(tree, constraints));
  }

  // Bitmap bit retirement: once all children of a tracked ancestor have been
  // processed, that bit no longer affects future accessibility decisions.
  // Merge states that differ only in retired bits to shrink the DP state space.
  const lastConsumerIndex = new Map<number, number>();
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (node.freeNode || node.entryNode || node.prev.length === 0) continue;
    for (const prevId of node.prev) {
      if (ancestorBitIndex.has(prevId)) {
        lastConsumerIndex.set(prevId, i);
      }
    }
  }

  const bitsToRetireAfter = new Map<number, number[]>();
  for (const [ancestorId, lastIdx] of lastConsumerIndex) {
    const bit = ancestorBitIndex.get(ancestorId)!;
    let list = bitsToRetireAfter.get(lastIdx);
    if (!list) {
      list = [];
      bitsToRetireAfter.set(lastIdx, list);
    }
    list.push(bit);
  }

  let dp = new Map<number, Poly>();
  dp.set(0, makeInitPoly(budget));

  const gateAtRow = new Map<number, number>();
  for (const gate of tree.gates) {
    gateAtRow.set(gate.row, gate.requiredPoints);
  }

  const polyCache = new Map<string, NodePolyResult>();

  let currentTierRow = solverState.sortedTierKeys[0];

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];

    if (node.row !== currentTierRow) {
      const gateReq = gateAtRow.get(node.row);
      if (gateReq != null) {
        dp = enforceGate(dp, gateReq, budget);
      }
      currentTierRow = node.row;
    }

    const isNever = solverState.neverNodes.has(node.id);
    const isAlways = solverState.alwaysNodes.has(node.id);
    const constraint = solverState.constraints.get(node.id);
    const isTracked = ancestorBitIndex.has(node.id);

    if (isNever && isAlways) {
      return 0n;
    }

    const newDp = new Map<number, Poly>();

    for (const [bitmap, poly] of dp) {
      const accessible = isAccessibleByBitmap(node, bitmap, ancestorBitIndex);

      if (isNever || (!accessible && !node.freeNode)) {
        if (isAlways) {
          continue;
        }
        mergePoly(newDp, bitmap, poly, budget);
        continue;
      }

      const cacheKey = `${node.id}:${accessible ? 1 : 0}`;
      let nodeResult = polyCache.get(cacheKey);
      if (!nodeResult) {
        nodeResult = buildNodePoly(
          node,
          constraint,
          isAlways,
          isNever,
          accessible,
        );
        polyCache.set(cacheKey, nodeResult);
      }
      const { skipPoly, selectPoly } = nodeResult;

      if (isTracked) {
        const nodeBit = 1 << ancestorBitIndex.get(node.id)!;

        if (skipPoly != null) {
          mergePoly(newDp, bitmap, poly, budget);
        }
        if (selectPoly != null) {
          const conv = polyConvolve(poly, selectPoly, budget);
          mergePoly(newDp, bitmap | nodeBit, conv, budget);
        }
      } else if (selectPoly != null) {
        const nodePoly = skipPoly
          ? polyAdd(skipPoly, selectPoly, budget)
          : selectPoly;
        mergePoly(newDp, bitmap, polyConvolve(poly, nodePoly, budget), budget);
      } else {
        mergePoly(newDp, bitmap, poly, budget);
      }
    }

    // Retire bits for ancestors whose last consumer was this node
    const bitsToRetire = bitsToRetireAfter.get(i);
    if (bitsToRetire) {
      for (const bit of bitsToRetire) {
        const mask = 1 << bit;
        for (const [bitmap, poly] of [...newDp]) {
          if (bitmap & mask) {
            mergePoly(newDp, bitmap & ~mask, poly, budget);
            newDp.delete(bitmap);
          }
        }
      }
    }

    // Prune dead states
    for (const [bitmap, poly] of newDp) {
      if (poly.every((c) => c === 0)) {
        newDp.delete(bitmap);
      }
    }

    dp = newDp;
  }

  let total = 0;
  for (const poly of dp.values()) {
    for (let p = 0; p <= budget && p < poly.length; p++) {
      total += poly[p];
    }
  }
  return BigInt(total);
}

function makeInitPoly(budget: number): Poly {
  const poly = new Array(budget + 1).fill(0);
  poly[0] = 1;
  return poly;
}

function mergePoly(
  dp: Map<number, Poly>,
  bitmap: number,
  poly: Poly,
  budget: number,
): void {
  const existing = dp.get(bitmap);
  if (existing) {
    dp.set(bitmap, polyAdd(existing, poly, budget));
  } else {
    dp.set(bitmap, poly);
  }
}

function enforceGate(
  dp: Map<number, Poly>,
  requiredPoints: number,
  budget: number,
): Map<number, Poly> {
  const newDp = new Map<number, Poly>();
  for (const [bitmap, poly] of dp) {
    const trimmed = new Array(Math.min(poly.length, budget + 1)).fill(0);
    for (let p = requiredPoints; p < trimmed.length; p++) {
      trimmed[p] = poly[p];
    }
    if (trimmed.some((c) => c > 0)) {
      mergePoly(newDp, bitmap, trimmed, budget);
    }
  }
  return newDp;
}

export function countBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): number {
  const solverState = prepareSolver(tree, constraints);
  let count = 0;

  traverse(tree, solverState, () => {
    count++;
  });

  return count;
}

export function generateBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  onProgress?: (current: number) => void,
): SolverResult {
  const startTime = performance.now();
  const solverState = prepareSolver(tree, constraints);
  const builds: Build[] = [];
  const seen = new Set<string>();

  traverse(tree, solverState, (partial) => {
    const build: Build = { entries: new Map(partial.entries) };
    const key = encodeBuild(build);
    if (!seen.has(key)) {
      seen.add(key);
      builds.push(build);
      if (onProgress && builds.length % 100 === 0) {
        onProgress(builds.length);
      }
    }
  });

  return {
    count: builds.length,
    builds,
    durationMs: performance.now() - startTime,
  };
}
