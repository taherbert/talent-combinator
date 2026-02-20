import type {
  TalentTree,
  TalentNode,
  Constraint,
  Build,
  CountResult,
  CountWarning,
} from "./types";

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

function buildTiers(tree: TalentTree): {
  tiers: Map<number, TalentNode[]>;
  sortedKeys: number[];
} {
  // Group by reqPoints (gate tier), then sort by row within each group.
  // This ensures nodes from lower gate tiers are processed before higher
  // gate thresholds are enforced, even when they share a visual row.
  const tiers = new Map<number, TalentNode[]>();
  for (const node of tree.nodes.values()) {
    let tier = tiers.get(node.reqPoints);
    if (!tier) {
      tier = [];
      tiers.set(node.reqPoints, tier);
    }
    tier.push(node);
  }
  for (const tier of tiers.values()) {
    tier.sort((a, b) => a.row - b.row);
  }
  const sortedKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
  return { tiers, sortedKeys };
}

// Guaranteed minimum cost of a free node before a gate
function freeNodeCost(node: TalentNode): number {
  if (node.type === "choice") {
    return Math.min(...node.entries.map((e) => e.maxRanks));
  }
  return node.maxRanks;
}

// Gate thresholds adjusted for free node investments that don't consume budget.
// Returns {requiredPoints: raw gate key, adjustedPoints: budget threshold}.
function computeAdjustedGates(
  tree: TalentTree,
): { requiredPoints: number; adjustedPoints: number }[] {
  return tree.gates.map((gate) => {
    let freeInvested = 0;
    for (const node of tree.nodes.values()) {
      if (node.reqPoints < gate.requiredPoints && node.freeNode) {
        freeInvested += freeNodeCost(node);
      }
    }
    return {
      requiredPoints: gate.requiredPoints,
      adjustedPoints: Math.max(0, gate.requiredPoints - freeInvested),
    };
  });
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
  const isFree = node.freeNode;

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
  } else if (isFree) {
    // Free/entry nodes are always taken at max rank — no variation
    minRank = maxRank = node.maxRanks;
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

export function computeReachable(
  tree: TalentTree,
  neverNodes: Set<number>,
): Set<number> {
  const reachable = new Set<number>();
  const queue: number[] = [];

  for (const node of tree.nodes.values()) {
    const isRoot = node.entryNode || node.freeNode || node.prev.length === 0;
    if (isRoot && !neverNodes.has(node.id)) {
      reachable.add(node.id);
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = tree.nodes.get(id)!;
    for (const nextId of node.next) {
      if (!reachable.has(nextId) && !neverNodes.has(nextId)) {
        reachable.add(nextId);
        queue.push(nextId);
      }
    }
  }

  return reachable;
}

function nodeName(tree: TalentTree, nodeId: number): string {
  return tree.nodes.get(nodeId)?.name ?? `#${nodeId}`;
}

function nameList(tree: TalentTree, ids: Iterable<number>): string {
  const names = [...ids].map((id) => `"${nodeName(tree, id)}"`);
  if (names.length <= 2) return names.join(" and ");
  return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
}

function validateBudgetAndGates(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  alwaysNodes: Set<number>,
  neverNodes: Set<number>,
  reachable: Set<number>,
  warnings: CountWarning[],
): void {
  if (alwaysNodes.size === 0 && neverNodes.size === 0) return;

  let totalAvailable = 0;
  for (const node of tree.nodes.values()) {
    if (!neverNodes.has(node.id) && !node.freeNode) {
      totalAvailable += node.maxRanks;
    }
  }
  if (totalAvailable < tree.pointBudget) {
    const gap = tree.pointBudget - totalAvailable;
    warnings.push({
      severity: "error",
      message: `Blocked too many talents — ${totalAvailable} points selectable, ${tree.pointBudget} needed. Unblock ${gap} points of talents to fix.`,
      nodeIds: [...neverNodes],
    });
  }

  // Forced-node computation (only when there are always constraints)
  const forcedNodes = new Set<number>();
  let totalForced = 0;

  function mandatoryRanks(nodeId: number): number {
    const node = tree.nodes.get(nodeId);
    if (!node || node.freeNode) return 0;
    const c = constraints.get(nodeId);
    if (c?.exactRank != null) return c.exactRank;
    if (node.type === "choice") return freeNodeCost(node);
    return 1;
  }

  if (alwaysNodes.size > 0) {
    // DAG DP by row: minimum additional (non-always) cost to connect each
    // node to a root. Always-nodes have 0 self-cost since they're already
    // committed; this makes paths through already-selected nodes preferred.
    const minCost = new Map<number, number>();
    const bestPrev = new Map<number, number>();
    const sortedNodes = [...tree.nodes.values()].sort((a, b) => a.row - b.row);

    for (const node of sortedNodes) {
      if (neverNodes.has(node.id)) continue;
      if (node.entryNode || node.freeNode) {
        minCost.set(node.id, 0);
        continue;
      }
      const selfCost = alwaysNodes.has(node.id) ? 0 : mandatoryRanks(node.id);
      if (node.prev.length === 0) {
        minCost.set(node.id, selfCost);
        continue;
      }
      let best = Infinity;
      let bestP = -1;
      for (const prevId of node.prev) {
        if (neverNodes.has(prevId)) continue;
        const pc = minCost.get(prevId);
        if (pc == null) continue;
        if (pc < best || (pc === best && alwaysNodes.has(prevId))) {
          best = pc;
          bestP = prevId;
        }
      }
      if (best !== Infinity) {
        minCost.set(node.id, best + selfCost);
        bestPrev.set(node.id, bestP);
      }
    }

    // Trace shortest paths from always nodes to find all forced nodes
    for (const nodeId of alwaysNodes) {
      if (!reachable.has(nodeId)) continue;
      let current: number | undefined = nodeId;
      while (current != null && !forcedNodes.has(current)) {
        forcedNodes.add(current);
        current = bestPrev.get(current);
      }
    }

    for (const nodeId of forcedNodes) {
      totalForced += mandatoryRanks(nodeId);
    }

    if (totalForced > tree.pointBudget) {
      const gap = totalForced - tree.pointBudget;
      warnings.push({
        severity: "error",
        message: `${nameList(tree, alwaysNodes)} and their prerequisites need ${totalForced} points — exceeds the ${tree.pointBudget}-point budget by ${gap}`,
        nodeIds: [...forcedNodes],
      });
    }
  }

  const adjustedGates = computeAdjustedGates(tree);
  for (let gi = 0; gi < tree.gates.length; gi++) {
    const gate = tree.gates[gi];
    if (gate.requiredPoints === 0) continue;
    const adjustedGateReq = adjustedGates[gi].adjustedPoints;

    // Forced points before/after gate
    let forcedBefore = 0;
    let forcedAfter = 0;
    const forcedAfterIds: number[] = [];
    for (const nodeId of forcedNodes) {
      const node = tree.nodes.get(nodeId)!;
      if (node.reqPoints < gate.requiredPoints) {
        forcedBefore += mandatoryRanks(nodeId);
      } else {
        forcedAfter += mandatoryRanks(nodeId);
        forcedAfterIds.push(nodeId);
      }
    }

    // Budget check: gate minimum + forced after must fit in budget
    const minBefore = Math.max(forcedBefore, adjustedGateReq);
    if (forcedAfter > 0 && minBefore + forcedAfter > tree.pointBudget) {
      const availableAfter = tree.pointBudget - minBefore;
      warnings.push({
        severity: "error",
        message: `Required talents after ${gate.requiredPoints}-point gate need ${forcedAfter} points, but only ${availableAfter} remain (${tree.pointBudget} budget − ${minBefore} before gate)`,
        nodeIds: forcedAfterIds,
      });
    }

    // Enough selectable nodes before gate to pass it
    let availableBefore = 0;
    const neverBeforeGate: number[] = [];
    for (const node of tree.nodes.values()) {
      if (node.reqPoints < gate.requiredPoints) {
        if (neverNodes.has(node.id)) {
          neverBeforeGate.push(node.id);
        } else {
          availableBefore += node.maxRanks;
        }
      }
    }
    if (availableBefore < gate.requiredPoints) {
      const gap = gate.requiredPoints - availableBefore;
      warnings.push({
        severity: "error",
        message: `Need ${gate.requiredPoints} points before gate, but only ${availableBefore} selectable — unblock at least ${gap} more points`,
        nodeIds: neverBeforeGate,
      });
    }

    // Enough selectable nodes after gate to fill remaining budget
    if (neverNodes.size > 0) {
      let availableAfterGate = 0;
      const neverAfterGate: number[] = [];
      for (const node of tree.nodes.values()) {
        if (node.reqPoints >= gate.requiredPoints && !node.freeNode) {
          if (neverNodes.has(node.id)) {
            neverAfterGate.push(node.id);
          } else {
            availableAfterGate += node.maxRanks;
          }
        }
      }
      const pointsNeededAfter = tree.pointBudget - adjustedGateReq;
      if (availableAfterGate < pointsNeededAfter) {
        const gap = pointsNeededAfter - availableAfterGate;
        warnings.push({
          severity: "error",
          message: `Only ${availableAfterGate} points selectable after ${gate.requiredPoints}-point gate, need ${pointsNeededAfter} — unblock at least ${gap} more points`,
          nodeIds: neverAfterGate,
        });
      }
    }
  }
}

function countDP(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  alwaysNodes: Set<number>,
  neverNodes: Set<number>,
): bigint {
  const budget = tree.pointBudget;
  const { tiers, sortedKeys } = buildTiers(tree);

  // Build ordered nodes and identify which nodes need tracking
  const ancestorIds = new Set<number>();
  for (const node of tree.nodes.values()) {
    if (node.freeNode || node.entryNode) continue;
    for (const prevId of node.prev) {
      ancestorIds.add(prevId);
    }
  }

  const orderedNodes: TalentNode[] = [];
  for (const tierKey of sortedKeys) {
    orderedNodes.push(...tiers.get(tierKey)!);
  }

  // Compute last consumer index for each ancestor (for bit retirement)
  const lastConsumerIndex = new Map<number, number>();
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (node.freeNode || node.entryNode || node.prev.length === 0) continue;
    for (const prevId of node.prev) {
      if (ancestorIds.has(prevId)) {
        lastConsumerIndex.set(prevId, i);
      }
    }
  }

  // Dynamic bit assignment: assign bit positions lazily and recycle retired ones.
  // This keeps the bitmap width bounded by max simultaneous active ancestors
  // (typically 7-10) instead of total ancestor count (often 30-40).
  const ancestorBitIndex = new Map<number, number>();
  const freeBits: number[] = [];
  let nextBit = 0;

  // Pre-compute which ancestors to assign and retire at each node index
  const assignAtIndex = new Map<number, number[]>(); // node index → ancestor node IDs to assign
  const retireAtIndex = new Map<number, number[]>(); // node index → ancestor node IDs to retire

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (ancestorIds.has(node.id)) {
      let list = assignAtIndex.get(i);
      if (!list) {
        list = [];
        assignAtIndex.set(i, list);
      }
      list.push(node.id);
    }
  }

  for (const [ancestorId, lastIdx] of lastConsumerIndex) {
    let list = retireAtIndex.get(lastIdx);
    if (!list) {
      list = [];
      retireAtIndex.set(lastIdx, list);
    }
    list.push(ancestorId);
  }

  let dp = new Map<number, Poly>();
  const initPoly = new Array(budget + 1).fill(0);
  initPoly[0] = 1;
  dp.set(0, initPoly);

  // The DP polynomial only tracks budget-spending points, but gates count
  // total invested including free/entry nodes. Use pre-adjusted thresholds.
  const gateAtReqPoints = new Map<number, number>();
  for (const gate of computeAdjustedGates(tree)) {
    gateAtReqPoints.set(gate.requiredPoints, gate.adjustedPoints);
  }

  const polyCache = new Map<string, NodePolyResult>();
  let currentTierReq = sortedKeys[0];

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];

    // Assign bit positions to ancestors appearing at this index
    const toAssign = assignAtIndex.get(i);
    if (toAssign) {
      for (const ancestorId of toAssign) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        ancestorBitIndex.set(ancestorId, bit);
      }
    }

    if (node.reqPoints !== currentTierReq) {
      const gateReq = gateAtReqPoints.get(node.reqPoints);
      if (gateReq != null) {
        dp = enforceGate(dp, gateReq, budget);
      }
      currentTierReq = node.reqPoints;
    }

    const isNever = neverNodes.has(node.id);
    // Free nodes are pre-selected in WoW — force them to always be taken
    const isAlways = alwaysNodes.has(node.id) || node.freeNode;
    const constraint = constraints.get(node.id);
    const isTracked = ancestorBitIndex.has(node.id);

    if (isNever && isAlways) {
      return 0n;
    }

    const newDp = new Map<number, Poly>();

    for (const [bitmap, poly] of dp) {
      const accessible = isAccessibleByBitmap(node, bitmap, ancestorBitIndex);

      if (isNever || (!accessible && !node.freeNode)) {
        if (isAlways) continue;
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
          if (node.maxRanks > 1) {
            // WoW only unlocks children when fully invested (all ranks filled).
            // Split: partial ranks don't set the bit, full rank does.
            const fullCost = node.freeNode ? 0 : node.maxRanks;
            const partialPoly = selectPoly.slice(0, fullCost);
            if (partialPoly.some((c) => c > 0)) {
              mergePoly(
                newDp,
                bitmap,
                polyConvolve(poly, partialPoly, budget),
                budget,
              );
            }
            const fullCoeff = selectPoly[fullCost] ?? 0;
            if (fullCoeff > 0) {
              const fullPoly = new Array(fullCost + 1).fill(0);
              fullPoly[fullCost] = fullCoeff;
              mergePoly(
                newDp,
                bitmap | nodeBit,
                polyConvolve(poly, fullPoly, budget),
                budget,
              );
            }
          } else {
            const conv = polyConvolve(poly, selectPoly, budget);
            mergePoly(newDp, bitmap | nodeBit, conv, budget);
          }
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
    const toRetire = retireAtIndex.get(i);
    if (toRetire) {
      for (const ancestorId of toRetire) {
        const bit = ancestorBitIndex.get(ancestorId)!;
        const mask = 1 << bit;
        for (const [bitmap, poly] of [...newDp]) {
          if (bitmap & mask) {
            mergePoly(newDp, bitmap & ~mask, poly, budget);
            newDp.delete(bitmap);
          }
        }
        ancestorBitIndex.delete(ancestorId);
        freeBits.push(bit);
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

  // WoW requires spending exactly the budget — no unspent points
  let total = 0;
  for (const poly of dp.values()) {
    if (budget < poly.length) {
      total += poly[budget];
    }
  }
  return BigInt(total);
}

export function countTreeBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): CountResult {
  const startTime = performance.now();
  const warnings: CountWarning[] = [];

  // Phase 1: Classify constraints
  const alwaysNodes = new Set<number>();
  const neverNodes = new Set<number>();
  let hasConditional = false;

  for (const [nodeId, c] of constraints) {
    if (!tree.nodes.has(nodeId)) continue;
    if (c.type === "always") alwaysNodes.add(nodeId);
    if (c.type === "never") neverNodes.add(nodeId);
    if (c.type === "conditional") hasConditional = true;
  }

  // Detect always+never conflict on same node
  for (const nodeId of alwaysNodes) {
    if (neverNodes.has(nodeId)) {
      const node = tree.nodes.get(nodeId)!;
      warnings.push({
        severity: "error",
        message: `"${node.name}" is both Always and Never`,
        nodeIds: [nodeId],
      });
      return { count: 0n, durationMs: performance.now() - startTime, warnings };
    }
  }

  // Phase 2: Reachability
  const reachable = computeReachable(tree, neverNodes);
  let hasUnreachable = false;

  for (const nodeId of alwaysNodes) {
    const node = tree.nodes.get(nodeId);
    if (node && !reachable.has(nodeId)) {
      warnings.push({
        severity: "error",
        message: `"${node.name}" can't be reached — all paths to it are blocked`,
        nodeIds: [nodeId],
      });
      hasUnreachable = true;
    }
  }

  if (hasUnreachable) {
    return { count: 0n, durationMs: performance.now() - startTime, warnings };
  }

  // Phase 3 + 4: Budget and gate validation
  validateBudgetAndGates(
    tree,
    constraints,
    alwaysNodes,
    neverNodes,
    reachable,
    warnings,
  );

  // Phase 5: Count
  // Always use polynomial DP — DFS is exponentially expensive on real trees.
  // Conditional constraints are enforced during build generation (worker DFS),
  // not during counting. The count is an upper bound when conditionals exist.
  const count = countDP(tree, constraints, alwaysNodes, neverNodes);

  if (hasConditional && count > 0n) {
    warnings.push({
      severity: "warning",
      message:
        "Conditional constraints reduce builds during generation but are not reflected in the count",
    });
  }

  return { count, durationMs: performance.now() - startTime, warnings };
}

interface TreeLayout {
  orderedNodes: TalentNode[];
  assignAtIndex: Map<number, number[]>;
  retireAtIndex: Map<number, number[]>;
  /** Stable bit position for each ancestor node — identical schedule to countDP. */
  permanentBitAssignment: Map<number, number>;
  gateAtReqPoints: Map<number, number>;
  /** First orderedNodes index of each reqPoints tier, for gate enforcement. */
  tierFirstIndex: Map<number, number>;
  budget: number;
}

function computeLayout(tree: TalentTree): TreeLayout {
  const budget = tree.pointBudget;
  const { tiers, sortedKeys } = buildTiers(tree);

  const ancestorIds = new Set<number>();
  for (const node of tree.nodes.values()) {
    if (node.freeNode || node.entryNode) continue;
    for (const prevId of node.prev) ancestorIds.add(prevId);
  }

  const orderedNodes: TalentNode[] = [];
  for (const tierKey of sortedKeys) orderedNodes.push(...tiers.get(tierKey)!);

  const lastConsumerIndex = new Map<number, number>();
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (node.freeNode || node.entryNode || node.prev.length === 0) continue;
    for (const prevId of node.prev) {
      if (ancestorIds.has(prevId)) lastConsumerIndex.set(prevId, i);
    }
  }

  const assignAtIndex = new Map<number, number[]>();
  const retireAtIndex = new Map<number, number[]>();
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (ancestorIds.has(node.id)) {
      let list = assignAtIndex.get(i);
      if (!list) {
        list = [];
        assignAtIndex.set(i, list);
      }
      list.push(node.id);
    }
  }
  for (const [ancestorId, lastIdx] of lastConsumerIndex) {
    let list = retireAtIndex.get(lastIdx);
    if (!list) {
      list = [];
      retireAtIndex.set(lastIdx, list);
    }
    list.push(ancestorId);
  }

  // Simulate bit assignment with the same logic as countDP so suffix tables
  // use consistent bit positions.
  const permanentBitAssignment = new Map<number, number>();
  const freeBits: number[] = [];
  let nextBit = 0;
  for (let i = 0; i < orderedNodes.length; i++) {
    const toAssign = assignAtIndex.get(i);
    if (toAssign) {
      for (const ancestorId of toAssign) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        permanentBitAssignment.set(ancestorId, bit);
      }
    }
    const toRetire = retireAtIndex.get(i);
    if (toRetire) {
      for (const ancestorId of toRetire) {
        freeBits.push(permanentBitAssignment.get(ancestorId)!);
      }
    }
  }

  const gateAtReqPoints = new Map<number, number>();
  for (const gate of computeAdjustedGates(tree))
    gateAtReqPoints.set(gate.requiredPoints, gate.adjustedPoints);

  const tierFirstIndex = new Map<number, number>();
  let currentReq = -1;
  for (let i = 0; i < orderedNodes.length; i++) {
    if (orderedNodes[i].reqPoints !== currentReq) {
      currentReq = orderedNodes[i].reqPoints;
      tierFirstIndex.set(currentReq, i);
    }
  }

  return {
    orderedNodes,
    assignAtIndex,
    retireAtIndex,
    permanentBitAssignment,
    gateAtReqPoints,
    tierFirstIndex,
    budget,
  };
}

function suffixLookup(
  table: Map<number, number[]>,
  bitmap: number,
  r: number,
): number {
  if (r < 0) return 0;
  const poly = table.get(bitmap);
  return poly?.[r] ?? 0;
}

function buildSuffixTables(
  layout: TreeLayout,
  constraints: Map<number, Constraint>,
  alwaysNodes: Set<number>,
  neverNodes: Set<number>,
): Map<number, number[]>[] {
  const {
    orderedNodes,
    retireAtIndex,
    permanentBitAssignment,
    gateAtReqPoints,
    tierFirstIndex,
    budget,
  } = layout;
  const N = orderedNodes.length;
  const suffix: Map<number, number[]>[] = new Array(N + 1);

  // Base: after all nodes, exactly one valid state — (bitmap=0, r=0).
  const basePoly = new Array(budget + 1).fill(0);
  basePoly[0] = 1;
  suffix[N] = new Map([[0, basePoly]]);

  for (let i = N - 1; i >= 0; i--) {
    const node = orderedNodes[i];
    suffix[i] = new Map<number, number[]>();

    const gateReq =
      tierFirstIndex.get(node.reqPoints) === i
        ? (gateAtReqPoints.get(node.reqPoints) ?? 0)
        : 0;
    const isNever = neverNodes.has(node.id);
    const isAlways = alwaysNodes.has(node.id) || node.freeNode;
    const constraint = constraints.get(node.id);
    const isFree = node.freeNode;
    const isTracked = permanentBitAssignment.has(node.id);
    const nodeBit = isTracked ? 1 << permanentBitAssignment.get(node.id)! : 0;

    const toRetire = retireAtIndex.get(i);
    let retireMask = 0;
    if (toRetire) {
      for (const ancestorId of toRetire) {
        retireMask |= 1 << permanentBitAssignment.get(ancestorId)!;
      }
    }

    // Collect all incoming bitmaps at step i by working backward from suffix[i+1].
    // Transitions: skip/partial-select → bitmapIn & ~retireMask (no nodeBit),
    // full-select → (bitmapIn | nodeBit) & ~retireMask.
    // nodeBit is never in retireMask (a node can't be its own last consumer).
    const bitmapsNeeded = new Set<number>();
    for (const bmNext of suffix[i + 1].keys()) {
      if (isTracked && bmNext & nodeBit) {
        // This next-bitmap has nodeBit set → it came from a select path.
        // Reverse: incoming = (bmNext & ~nodeBit) | (any subset of retireMask).
        const bmBase = bmNext & ~nodeBit;
        let sub = retireMask;
        for (;;) {
          bitmapsNeeded.add(bmBase | sub);
          if (sub === 0) break;
          sub = (sub - 1) & retireMask;
        }
      }
      // Every bmNext also reachable from skip/untracked: incoming = bmNext | (any subset of retireMask).
      let sub = retireMask;
      for (;;) {
        bitmapsNeeded.add(bmNext | sub);
        if (sub === 0) break;
        sub = (sub - 1) & retireMask;
      }
    }

    for (const bitmapIn of bitmapsNeeded) {
      const result = new Array(budget + 1).fill(0);

      for (let r = 0; r <= budget; r++) {
        // Gate: if this is the first node of a gated tier, states with too few
        // spent points (budget - r < gateReq) are invalid.
        if (gateReq > 0 && budget - r < gateReq) continue;

        const accessible = isAccessibleByBitmap(
          node,
          bitmapIn,
          permanentBitAssignment,
        );
        let total = 0;

        if (isNever || (!accessible && !isFree)) {
          // Forced skip — pass through if not also always (conflict would yield 0 builds).
          if (!isAlways) {
            total = suffixLookup(suffix[i + 1], bitmapIn & ~retireMask, r);
          }
        } else if (isAlways) {
          // Forced select — enumerate valid choices.
          if (node.type === "choice") {
            const entriesToUse =
              constraint?.entryIndex != null
                ? [node.entries[constraint.entryIndex]].filter(Boolean)
                : node.entries;
            for (const entry of entriesToUse) {
              const cost = isFree ? 0 : entry.maxRanks;
              if (r >= cost) {
                const bmNext =
                  (isTracked ? bitmapIn | nodeBit : bitmapIn) & ~retireMask;
                total += suffixLookup(suffix[i + 1], bmNext, r - cost);
              }
            }
          } else {
            let minRank: number, maxRank: number;
            if (constraint?.exactRank != null) {
              minRank = maxRank = constraint.exactRank;
            } else if (isFree) {
              minRank = maxRank = node.maxRanks;
            } else {
              minRank = 1;
              maxRank = node.maxRanks;
            }
            for (let rank = minRank; rank <= maxRank; rank++) {
              const cost = isFree ? 0 : rank;
              if (r >= cost) {
                const bmNext =
                  (isTracked && rank === node.maxRanks
                    ? bitmapIn | nodeBit
                    : bitmapIn) & ~retireMask;
                total += suffixLookup(suffix[i + 1], bmNext, r - cost);
              }
            }
          }
        } else {
          // Optional: skip path first, then select.
          total += suffixLookup(suffix[i + 1], bitmapIn & ~retireMask, r);

          if (node.type === "choice") {
            const entriesToUse =
              constraint?.entryIndex != null
                ? [node.entries[constraint.entryIndex]].filter(Boolean)
                : node.entries;
            for (const entry of entriesToUse) {
              const cost = isFree ? 0 : entry.maxRanks;
              if (r >= cost) {
                const bmNext =
                  (isTracked ? bitmapIn | nodeBit : bitmapIn) & ~retireMask;
                total += suffixLookup(suffix[i + 1], bmNext, r - cost);
              }
            }
          } else {
            if (constraint?.exactRank != null) {
              const cost = isFree ? 0 : constraint.exactRank;
              if (r >= cost) {
                const bmNext =
                  (isTracked && constraint.exactRank === node.maxRanks
                    ? bitmapIn | nodeBit
                    : bitmapIn) & ~retireMask;
                total += suffixLookup(suffix[i + 1], bmNext, r - cost);
              }
            } else {
              for (let rank = 1; rank <= node.maxRanks; rank++) {
                const cost = isFree ? 0 : rank;
                if (r >= cost) {
                  const bmNext =
                    (isTracked && rank === node.maxRanks
                      ? bitmapIn | nodeBit
                      : bitmapIn) & ~retireMask;
                  total += suffixLookup(suffix[i + 1], bmNext, r - cost);
                }
              }
            }
          }
        }

        result[r] = total;
      }

      if (result.some((v) => v > 0)) suffix[i].set(bitmapIn, result);
    }
  }

  return suffix;
}

function unrankBuild(
  targetK: number,
  layout: TreeLayout,
  suffix: Map<number, number[]>[],
  constraints: Map<number, Constraint>,
  alwaysNodes: Set<number>,
  neverNodes: Set<number>,
): Build {
  const { orderedNodes, retireAtIndex, permanentBitAssignment, budget } =
    layout;
  const entries = new Map<number, number>();
  let bitmap = 0;
  let r = budget;
  let k = targetK;

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    const isNever = neverNodes.has(node.id);
    const isAlways = alwaysNodes.has(node.id) || node.freeNode;
    const constraint = constraints.get(node.id);
    const isFree = node.freeNode;
    const isTracked = permanentBitAssignment.has(node.id);
    const nodeBit = isTracked ? 1 << permanentBitAssignment.get(node.id)! : 0;
    const accessible = isAccessibleByBitmap(
      node,
      bitmap,
      permanentBitAssignment,
    );

    const toRetire = retireAtIndex.get(i);
    let retireMask = 0;
    if (toRetire) {
      for (const ancestorId of toRetire) {
        retireMask |= 1 << permanentBitAssignment.get(ancestorId)!;
      }
    }

    if (isNever || (!accessible && !isFree)) {
      bitmap = bitmap & ~retireMask;
      continue;
    }

    if (!isAlways) {
      const bmSkipNext = bitmap & ~retireMask;
      const skipCount = suffixLookup(suffix[i + 1], bmSkipNext, r);
      if (k < skipCount) {
        bitmap = bmSkipNext;
        continue;
      }
      k -= skipCount;
    }

    // Select: enumerate choices in the same canonical order as buildSuffixTables.
    if (node.type === "choice") {
      const entriesToUse =
        constraint?.entryIndex != null
          ? [node.entries[constraint.entryIndex]].filter(Boolean)
          : node.entries;
      for (const entry of entriesToUse) {
        const cost = isFree ? 0 : entry.maxRanks;
        if (r >= cost) {
          const bmNext = (isTracked ? bitmap | nodeBit : bitmap) & ~retireMask;
          const count = suffixLookup(suffix[i + 1], bmNext, r - cost);
          if (k < count) {
            entries.set(entry.id, entry.maxRanks);
            bitmap = bmNext;
            r -= cost;
            break;
          }
          k -= count;
        }
      }
    } else {
      const entry = node.entries[0];
      let minRank: number, maxRank: number;
      if (constraint?.exactRank != null) {
        minRank = maxRank = constraint.exactRank;
      } else if (isFree) {
        minRank = maxRank = node.maxRanks;
      } else {
        minRank = 1;
        maxRank = node.maxRanks;
      }
      for (let rank = minRank; rank <= maxRank; rank++) {
        const cost = isFree ? 0 : rank;
        if (r >= cost) {
          const bmNext =
            (isTracked && rank === node.maxRanks ? bitmap | nodeBit : bitmap) &
            ~retireMask;
          const count = suffixLookup(suffix[i + 1], bmNext, r - cost);
          if (k < count) {
            if (entry) entries.set(entry.id, rank);
            bitmap = bmNext;
            r -= cost;
            break;
          }
          k -= count;
        }
      }
    }
  }

  return { entries };
}

/**
 * Generate up to `limit` builds for a tree using suffix-DP unranking.
 * If limit is omitted or exceeds the total count, all builds are returned.
 * Builds are sampled at evenly-spaced indices across the full count space.
 */
export function generateTreeBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  limit?: number,
): Build[] {
  const alwaysNodes = new Set<number>();
  const neverNodes = new Set<number>();
  for (const [nodeId, c] of constraints) {
    if (!tree.nodes.has(nodeId)) continue;
    if (c.type === "always") alwaysNodes.add(nodeId);
    if (c.type === "never") neverNodes.add(nodeId);
  }

  const layout = computeLayout(tree);
  const suffix = buildSuffixTables(
    layout,
    constraints,
    alwaysNodes,
    neverNodes,
  );
  const totalCount = suffixLookup(suffix[0], 0, layout.budget);
  if (totalCount === 0) return [];

  const count = limit != null && limit < totalCount ? limit : totalCount;
  const builds: Build[] = [];

  if (count === totalCount) {
    for (let k = 0; k < count; k++) {
      builds.push(
        unrankBuild(k, layout, suffix, constraints, alwaysNodes, neverNodes),
      );
    }
  } else {
    // Evenly spaced sampling across the build space.
    const step = totalCount / count;
    for (let i = 0; i < count; i++) {
      const k = Math.floor(i * step);
      builds.push(
        unrankBuild(k, layout, suffix, constraints, alwaysNodes, neverNodes),
      );
    }
  }

  return builds;
}
