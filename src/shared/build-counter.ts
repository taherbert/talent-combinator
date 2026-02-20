import type {
  TalentTree,
  TalentNode,
  Constraint,
  Build,
  CountResult,
  CountWarning,
  BooleanExpr,
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

function pushToMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
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
    pushToMapList(tiers, node.reqPoints, node);
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

  for (const gate of tree.gates) {
    if (gate.requiredPoints === 0) continue;
    const gateReq = gate.requiredPoints;

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
    const minBefore = Math.max(forcedBefore, gateReq);
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
      const pointsNeededAfter = tree.pointBudget - gateReq;
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

interface ConditionalConstraintInfo {
  targetId: number;
  condition: BooleanExpr;
}

function collectExprNodeIds(expr: BooleanExpr): Set<number> {
  const ids = new Set<number>();
  switch (expr.op) {
    case "TALENT_SELECTED":
      ids.add(expr.nodeId);
      break;
    case "AND":
    case "OR":
      for (const child of expr.children) {
        for (const id of collectExprNodeIds(child)) ids.add(id);
      }
      break;
  }
  return ids;
}

function evalBitmapExpr(
  expr: BooleanExpr,
  bitmap: number,
  condBit: Map<number, number>,
): boolean {
  switch (expr.op) {
    case "TALENT_SELECTED": {
      const bit = condBit.get(expr.nodeId);
      if (bit == null) return false;
      // Bitmap only tracks "rank >= 1". For minRank > 1 we can't confirm
      // the actual rank, so conservatively return false (condition not met).
      if (expr.minRank != null && expr.minRank > 1) return false;
      return (bitmap & (1 << bit)) !== 0;
    }
    case "AND":
      return expr.children.every((c) => evalBitmapExpr(c, bitmap, condBit));
    case "OR":
      return expr.children.some((c) => evalBitmapExpr(c, bitmap, condBit));
  }
}

function isValidBitmapForConstraints(
  bitmap: number,
  enforcements: ConditionalConstraintInfo[],
  condBit: Map<number, number>,
): boolean {
  for (const { targetId, condition } of enforcements) {
    const bit = condBit.get(targetId);
    if (bit == null) continue;
    if (evalBitmapExpr(condition, bitmap, condBit) && !(bitmap & (1 << bit))) {
      return false;
    }
  }
  return true;
}

interface ConditionalSetup {
  needsSeparateBit: Set<number>;
  sharesAncestorBit: Set<number>;
  allCondNodes: Set<number>;
  enforceAtIndex: Map<number, ConditionalConstraintInfo[]>;
  condAssignAtIndex: Map<number, number[]>;
  condRetireAtIndex: Map<number, number[]>;
  ancestorRetireDelay: Map<number, number>;
  hasUnresolvable: boolean;
}

function buildConditionalSetup(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  orderedNodes: TalentNode[],
  ancestorIds: Set<number>,
  lastConsumerIndex: Map<number, number>,
): ConditionalSetup {
  const nodeIndex = new Map<number, number>();
  for (let i = 0; i < orderedNodes.length; i++) {
    nodeIndex.set(orderedNodes[i].id, i);
  }

  const inTreeIds = new Set(tree.nodes.keys());
  const needsSeparateBit = new Set<number>();
  const sharesAncestorBit = new Set<number>();
  const allCondNodes = new Set<number>();
  const enforceAtIndex = new Map<number, ConditionalConstraintInfo[]>();
  const condRetireNodeIndex = new Map<number, number>();
  let hasUnresolvable = false;

  for (const [nodeId, c] of constraints) {
    if (c.type !== "conditional" || !c.condition) continue;
    if (!tree.nodes.has(nodeId)) continue;

    const triggerIds = collectExprNodeIds(c.condition);
    const inTreeTriggers = new Set<number>();
    for (const tid of triggerIds) {
      if (inTreeIds.has(tid)) inTreeTriggers.add(tid);
    }

    if (inTreeTriggers.size === 0) {
      hasUnresolvable = true;
      continue;
    }

    let enforceIdx = nodeIndex.get(nodeId)!;
    for (const tid of inTreeTriggers) {
      const idx = nodeIndex.get(tid);
      if (idx != null && idx > enforceIdx) enforceIdx = idx;
    }

    pushToMapList(enforceAtIndex, enforceIdx, {
      targetId: nodeId,
      condition: c.condition,
    });

    const condNodes = new Set([nodeId, ...inTreeTriggers]);
    for (const nid of condNodes) {
      allCondNodes.add(nid);
      const current = condRetireNodeIndex.get(nid) ?? -1;
      if (enforceIdx > current) condRetireNodeIndex.set(nid, enforceIdx);
    }
  }

  for (const nid of allCondNodes) {
    const node = tree.nodes.get(nid)!;
    if (ancestorIds.has(nid) && node.maxRanks === 1) {
      sharesAncestorBit.add(nid);
    } else {
      needsSeparateBit.add(nid);
    }
  }

  const condAssignAtIndex = new Map<number, number[]>();
  const condRetireAtIndex = new Map<number, number[]>();

  for (const nid of needsSeparateBit) {
    pushToMapList(condAssignAtIndex, nodeIndex.get(nid)!, nid);
    pushToMapList(condRetireAtIndex, condRetireNodeIndex.get(nid)!, nid);
  }

  const ancestorRetireDelay = new Map<number, number>();
  for (const nid of sharesAncestorBit) {
    const requiredRetire = condRetireNodeIndex.get(nid)!;
    const currentRetire = lastConsumerIndex.get(nid);
    if (currentRetire == null || requiredRetire > currentRetire) {
      ancestorRetireDelay.set(nid, requiredRetire);
    }
  }

  return {
    needsSeparateBit,
    sharesAncestorBit,
    allCondNodes,
    enforceAtIndex,
    condAssignAtIndex,
    condRetireAtIndex,
    ancestorRetireDelay,
    hasUnresolvable,
  };
}

function countDP(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  alwaysNodes: Set<number>,
  neverNodes: Set<number>,
): bigint {
  const budget = tree.pointBudget;
  const { tiers, sortedKeys } = buildTiers(tree);

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

  const condSetup = buildConditionalSetup(
    tree,
    constraints,
    orderedNodes,
    ancestorIds,
    lastConsumerIndex,
  );

  // Dynamic bit assignment: assign bit positions lazily and recycle retired ones.
  const ancestorBitIndex = new Map<number, number>();
  const condSelectBitIndex = new Map<number, number>();
  const freeBits: number[] = [];
  let nextBit = 0;

  const assignAtIndex = new Map<number, number[]>();
  const retireAtIndex = new Map<number, number[]>();

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (ancestorIds.has(node.id)) {
      pushToMapList(assignAtIndex, i, node.id);
    }
  }

  for (const [ancestorId, lastIdx] of lastConsumerIndex) {
    pushToMapList(retireAtIndex, lastIdx, ancestorId);
  }

  // Delay ancestor retirement for shared conditional bits
  for (const [ancestorId, newRetireIdx] of condSetup.ancestorRetireDelay) {
    const currentRetireIdx = lastConsumerIndex.get(ancestorId)!;
    const currentList = retireAtIndex.get(currentRetireIdx);
    if (currentList) {
      const idx = currentList.indexOf(ancestorId);
      if (idx >= 0) currentList.splice(idx, 1);
      if (currentList.length === 0) retireAtIndex.delete(currentRetireIdx);
    }
    pushToMapList(retireAtIndex, newRetireIdx, ancestorId);
  }

  let dp = new Map<number, Poly>();
  const initPoly = new Array(budget + 1).fill(0);
  initPoly[0] = 1;
  dp.set(0, initPoly);

  const gateReqPoints = new Set(tree.gates.map((g) => g.requiredPoints));

  const polyCache = new Map<string, NodePolyResult>();
  let currentTierReq = sortedKeys[0];

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];

    // Assign ancestor bits
    const toAssign = assignAtIndex.get(i);
    if (toAssign) {
      for (const ancestorId of toAssign) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        ancestorBitIndex.set(ancestorId, bit);
        if (condSetup.sharesAncestorBit.has(ancestorId)) {
          condSelectBitIndex.set(ancestorId, bit);
        }
      }
    }

    // Assign separate conditional bits
    const toAssignCond = condSetup.condAssignAtIndex.get(i);
    if (toAssignCond) {
      for (const nodeId of toAssignCond) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        condSelectBitIndex.set(nodeId, bit);
      }
    }

    if (node.reqPoints !== currentTierReq) {
      if (gateReqPoints.has(node.reqPoints)) {
        dp = enforceGate(dp, node.reqPoints, budget);
      }
      currentTierReq = node.reqPoints;
    }

    const isNever = neverNodes.has(node.id);
    const isAlways = alwaysNodes.has(node.id) || node.freeNode;
    const constraint = constraints.get(node.id);
    const selectBits = condSelectBitIndex.has(node.id)
      ? 1 << condSelectBitIndex.get(node.id)!
      : 0;
    const fullBits = ancestorBitIndex.has(node.id)
      ? 1 << ancestorBitIndex.get(node.id)!
      : 0;
    const isTracked = selectBits !== 0 || fullBits !== 0;

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
        if (skipPoly != null) {
          mergePoly(newDp, bitmap, poly, budget);
        }
        if (selectPoly != null) {
          if (fullBits !== 0 && node.maxRanks > 1) {
            // Multi-rank ancestor: partial ranks set selectBits only,
            // full rank sets selectBits | fullBits.
            const fullCost = node.freeNode ? 0 : node.maxRanks;
            const partialPoly = selectPoly.slice(0, fullCost);
            if (partialPoly.some((c) => c > 0)) {
              mergePoly(
                newDp,
                bitmap | selectBits,
                polyConvolve(poly, partialPoly, budget),
                budget,
              );
            }
            const fullCoeff = selectPoly[fullCost] ?? 0;
            if (fullCoeff > 0) {
              const fullSelectPoly = new Array(fullCost + 1).fill(0);
              fullSelectPoly[fullCost] = fullCoeff;
              mergePoly(
                newDp,
                bitmap | selectBits | fullBits,
                polyConvolve(poly, fullSelectPoly, budget),
                budget,
              );
            }
          } else {
            const conv = polyConvolve(poly, selectPoly, budget);
            mergePoly(newDp, bitmap | selectBits | fullBits, conv, budget);
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

    // Enforce conditional constraints at this index
    const toEnforce = condSetup.enforceAtIndex.get(i);
    if (toEnforce) {
      for (const { targetId, condition } of toEnforce) {
        const targetBit = 1 << condSelectBitIndex.get(targetId)!;
        for (const [bitmap] of [...newDp]) {
          if (
            evalBitmapExpr(condition, bitmap, condSelectBitIndex) &&
            !(bitmap & targetBit)
          ) {
            newDp.delete(bitmap);
          }
        }
      }
    }

    // Retire ancestor bits (includes shared conditional bits)
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
        if (condSelectBitIndex.get(ancestorId) === bit) {
          condSelectBitIndex.delete(ancestorId);
        }
        freeBits.push(bit);
      }
    }

    // Retire separate conditional bits
    const toRetireCond = condSetup.condRetireAtIndex.get(i);
    if (toRetireCond) {
      for (const nodeId of toRetireCond) {
        const bit = condSelectBitIndex.get(nodeId)!;
        const mask = 1 << bit;
        for (const [bitmap, poly] of [...newDp]) {
          if (bitmap & mask) {
            mergePoly(newDp, bitmap & ~mask, poly, budget);
            newDp.delete(bitmap);
          }
        }
        condSelectBitIndex.delete(nodeId);
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

  for (const [nodeId, c] of constraints) {
    if (!tree.nodes.has(nodeId)) continue;
    if (c.type === "always") alwaysNodes.add(nodeId);
    if (c.type === "never") neverNodes.add(nodeId);
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

  // Phase 5: Count (conditionals enforced within DP)
  const count = countDP(tree, constraints, alwaysNodes, neverNodes);

  // Warn only for fully-unresolvable cross-tree conditionals
  let hasUnresolvable = false;
  for (const [nodeId, c] of constraints) {
    if (c.type !== "conditional" || !c.condition) continue;
    if (!tree.nodes.has(nodeId)) continue;
    const triggerIds = collectExprNodeIds(c.condition);
    let hasInTree = false;
    for (const tid of triggerIds) {
      if (tree.nodes.has(tid)) {
        hasInTree = true;
        break;
      }
    }
    if (!hasInTree) {
      hasUnresolvable = true;
      break;
    }
  }

  if (hasUnresolvable && count > 0n) {
    warnings.push({
      severity: "warning",
      message:
        "Some conditional constraints reference only talents in other trees and cannot be evaluated — count may be an upper bound",
    });
  }

  return { count, durationMs: performance.now() - startTime, warnings };
}

interface TreeLayout {
  orderedNodes: TalentNode[];
  assignAtIndex: Map<number, number[]>;
  retireAtIndex: Map<number, number[]>;
  permanentBitAssignment: Map<number, number>;
  gateReqPoints: Set<number>;
  tierFirstIndex: Map<number, number>;
  budget: number;
  condSelectBitAssignment: Map<number, number>;
  condRetireAtIndex: Map<number, number[]>;
  enforceAtIndex: Map<number, ConditionalConstraintInfo[]>;
}

function computeLayout(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): TreeLayout {
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

  const condSetup = buildConditionalSetup(
    tree,
    constraints,
    orderedNodes,
    ancestorIds,
    lastConsumerIndex,
  );

  const assignAtIndex = new Map<number, number[]>();
  const retireAtIndex = new Map<number, number[]>();
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (ancestorIds.has(node.id)) {
      pushToMapList(assignAtIndex, i, node.id);
    }
  }
  for (const [ancestorId, lastIdx] of lastConsumerIndex) {
    pushToMapList(retireAtIndex, lastIdx, ancestorId);
  }

  // Delay ancestor retirement for shared conditional bits
  for (const [ancestorId, newRetireIdx] of condSetup.ancestorRetireDelay) {
    const currentRetireIdx = lastConsumerIndex.get(ancestorId)!;
    const currentList = retireAtIndex.get(currentRetireIdx);
    if (currentList) {
      const idx = currentList.indexOf(ancestorId);
      if (idx >= 0) currentList.splice(idx, 1);
      if (currentList.length === 0) retireAtIndex.delete(currentRetireIdx);
    }
    pushToMapList(retireAtIndex, newRetireIdx, ancestorId);
  }

  // Simulate bit assignment with the same logic as countDP
  const permanentBitAssignment = new Map<number, number>();
  const condSelectBitAssignment = new Map<number, number>();
  const freeBits: number[] = [];
  let nextBit = 0;

  for (let i = 0; i < orderedNodes.length; i++) {
    const toAssign = assignAtIndex.get(i);
    if (toAssign) {
      for (const ancestorId of toAssign) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        permanentBitAssignment.set(ancestorId, bit);
        if (condSetup.sharesAncestorBit.has(ancestorId)) {
          condSelectBitAssignment.set(ancestorId, bit);
        }
      }
    }
    const toAssignCond = condSetup.condAssignAtIndex.get(i);
    if (toAssignCond) {
      for (const nodeId of toAssignCond) {
        const bit = freeBits.length > 0 ? freeBits.pop()! : nextBit++;
        condSelectBitAssignment.set(nodeId, bit);
      }
    }
    const toRetire = retireAtIndex.get(i);
    if (toRetire) {
      for (const ancestorId of toRetire) {
        freeBits.push(permanentBitAssignment.get(ancestorId)!);
      }
    }
    const toRetireCond = condSetup.condRetireAtIndex.get(i);
    if (toRetireCond) {
      for (const nodeId of toRetireCond) {
        freeBits.push(condSelectBitAssignment.get(nodeId)!);
      }
    }
  }

  const gateReqPoints = new Set(tree.gates.map((g) => g.requiredPoints));

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
    gateReqPoints,
    tierFirstIndex,
    budget,
    condSelectBitAssignment,
    condRetireAtIndex: condSetup.condRetireAtIndex,
    enforceAtIndex: condSetup.enforceAtIndex,
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
    gateReqPoints,
    tierFirstIndex,
    budget,
    condSelectBitAssignment,
    condRetireAtIndex,
    enforceAtIndex,
  } = layout;
  const N = orderedNodes.length;
  const suffix: Map<number, number[]>[] = new Array(N + 1);

  const basePoly = new Array(budget + 1).fill(0);
  basePoly[0] = 1;
  suffix[N] = new Map([[0, basePoly]]);

  for (let i = N - 1; i >= 0; i--) {
    const node = orderedNodes[i];
    suffix[i] = new Map<number, number[]>();

    const gateReq =
      tierFirstIndex.get(node.reqPoints) === i &&
      gateReqPoints.has(node.reqPoints)
        ? node.reqPoints
        : 0;
    const isNever = neverNodes.has(node.id);
    const isAlways = alwaysNodes.has(node.id) || node.freeNode;
    const constraint = constraints.get(node.id);
    const isFree = node.freeNode;
    const selectBits = condSelectBitAssignment.has(node.id)
      ? 1 << condSelectBitAssignment.get(node.id)!
      : 0;
    const fullBits = permanentBitAssignment.has(node.id)
      ? 1 << permanentBitAssignment.get(node.id)!
      : 0;
    const allBits = selectBits | fullBits;
    const isTracked = allBits !== 0;

    const toRetire = retireAtIndex.get(i);
    let retireMask = 0;
    if (toRetire) {
      for (const ancestorId of toRetire) {
        retireMask |= 1 << permanentBitAssignment.get(ancestorId)!;
      }
    }
    const toRetireCond = condRetireAtIndex.get(i);
    if (toRetireCond) {
      for (const nodeId of toRetireCond) {
        retireMask |= 1 << condSelectBitAssignment.get(nodeId)!;
      }
    }

    const toEnforce = enforceAtIndex.get(i);

    // Reverse-engineer incoming bitmaps from suffix[i+1]
    const bitmapsNeeded = new Set<number>();
    for (const bmNext of suffix[i + 1].keys()) {
      // Skip/untracked path: no bits added
      let sub = retireMask;
      for (;;) {
        bitmapsNeeded.add(bmNext | sub);
        if (sub === 0) break;
        sub = (sub - 1) & retireMask;
      }
      // Full select path: allBits added
      if (allBits > 0 && (bmNext & allBits) === allBits) {
        const bmBase = bmNext & ~allBits;
        sub = retireMask;
        for (;;) {
          bitmapsNeeded.add(bmBase | sub);
          if (sub === 0) break;
          sub = (sub - 1) & retireMask;
        }
      }
      // Partial select path (multi-rank ancestor with selectBits)
      if (
        selectBits > 0 &&
        fullBits > 0 &&
        node.maxRanks > 1 &&
        (bmNext & selectBits) === selectBits &&
        (bmNext & fullBits) === 0
      ) {
        const bmBase = bmNext & ~selectBits;
        sub = retireMask;
        for (;;) {
          bitmapsNeeded.add(bmBase | sub);
          if (sub === 0) break;
          sub = (sub - 1) & retireMask;
        }
      }
    }

    for (const bitmapIn of bitmapsNeeded) {
      const result = new Array(budget + 1).fill(0);

      for (let r = 0; r <= budget; r++) {
        if (gateReq > 0 && budget - r < gateReq) continue;

        const accessible = isAccessibleByBitmap(
          node,
          bitmapIn,
          permanentBitAssignment,
        );
        let total = 0;

        if (isNever || (!accessible && !isFree)) {
          if (!isAlways) {
            const bmAfter = bitmapIn;
            if (
              !toEnforce ||
              isValidBitmapForConstraints(
                bmAfter,
                toEnforce,
                condSelectBitAssignment,
              )
            ) {
              total = suffixLookup(suffix[i + 1], bmAfter & ~retireMask, r);
            }
          }
        } else if (isAlways) {
          if (node.type === "choice") {
            const entriesToUse =
              constraint?.entryIndex != null
                ? [node.entries[constraint.entryIndex]].filter(Boolean)
                : node.entries;
            for (const entry of entriesToUse) {
              const cost = isFree ? 0 : entry.maxRanks;
              if (r >= cost) {
                const bmAfter = bitmapIn | selectBits | fullBits;
                if (
                  !toEnforce ||
                  isValidBitmapForConstraints(
                    bmAfter,
                    toEnforce,
                    condSelectBitAssignment,
                  )
                ) {
                  total += suffixLookup(
                    suffix[i + 1],
                    bmAfter & ~retireMask,
                    r - cost,
                  );
                }
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
                const bmAfter =
                  rank === node.maxRanks
                    ? bitmapIn | selectBits | fullBits
                    : bitmapIn | selectBits;
                if (
                  !toEnforce ||
                  isValidBitmapForConstraints(
                    bmAfter,
                    toEnforce,
                    condSelectBitAssignment,
                  )
                ) {
                  total += suffixLookup(
                    suffix[i + 1],
                    bmAfter & ~retireMask,
                    r - cost,
                  );
                }
              }
            }
          }
        } else {
          // Optional: skip path
          const bmSkip = bitmapIn;
          if (
            !toEnforce ||
            isValidBitmapForConstraints(
              bmSkip,
              toEnforce,
              condSelectBitAssignment,
            )
          ) {
            total += suffixLookup(suffix[i + 1], bmSkip & ~retireMask, r);
          }

          if (node.type === "choice") {
            const entriesToUse =
              constraint?.entryIndex != null
                ? [node.entries[constraint.entryIndex]].filter(Boolean)
                : node.entries;
            for (const entry of entriesToUse) {
              const cost = isFree ? 0 : entry.maxRanks;
              if (r >= cost) {
                const bmAfter = bitmapIn | selectBits | fullBits;
                if (
                  !toEnforce ||
                  isValidBitmapForConstraints(
                    bmAfter,
                    toEnforce,
                    condSelectBitAssignment,
                  )
                ) {
                  total += suffixLookup(
                    suffix[i + 1],
                    bmAfter & ~retireMask,
                    r - cost,
                  );
                }
              }
            }
          } else {
            if (constraint?.exactRank != null) {
              const cost = isFree ? 0 : constraint.exactRank;
              if (r >= cost) {
                const bmAfter =
                  constraint.exactRank === node.maxRanks
                    ? bitmapIn | selectBits | fullBits
                    : bitmapIn | selectBits;
                if (
                  !toEnforce ||
                  isValidBitmapForConstraints(
                    bmAfter,
                    toEnforce,
                    condSelectBitAssignment,
                  )
                ) {
                  total += suffixLookup(
                    suffix[i + 1],
                    bmAfter & ~retireMask,
                    r - cost,
                  );
                }
              }
            } else {
              for (let rank = 1; rank <= node.maxRanks; rank++) {
                const cost = isFree ? 0 : rank;
                if (r >= cost) {
                  const bmAfter =
                    rank === node.maxRanks
                      ? bitmapIn | selectBits | fullBits
                      : bitmapIn | selectBits;
                  if (
                    !toEnforce ||
                    isValidBitmapForConstraints(
                      bmAfter,
                      toEnforce,
                      condSelectBitAssignment,
                    )
                  ) {
                    total += suffixLookup(
                      suffix[i + 1],
                      bmAfter & ~retireMask,
                      r - cost,
                    );
                  }
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
  const {
    orderedNodes,
    retireAtIndex,
    permanentBitAssignment,
    budget,
    condSelectBitAssignment,
    condRetireAtIndex,
    enforceAtIndex,
  } = layout;
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
    const selectBits = condSelectBitAssignment.has(node.id)
      ? 1 << condSelectBitAssignment.get(node.id)!
      : 0;
    const fullBits = permanentBitAssignment.has(node.id)
      ? 1 << permanentBitAssignment.get(node.id)!
      : 0;
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
    const toRetireCond = condRetireAtIndex.get(i);
    if (toRetireCond) {
      for (const nodeId of toRetireCond) {
        retireMask |= 1 << condSelectBitAssignment.get(nodeId)!;
      }
    }

    const toEnforce = enforceAtIndex.get(i);

    if (isNever || (!accessible && !isFree)) {
      bitmap = bitmap & ~retireMask;
      continue;
    }

    if (!isAlways) {
      const bmSkip = bitmap;
      let skipCount = 0;
      if (
        !toEnforce ||
        isValidBitmapForConstraints(bmSkip, toEnforce, condSelectBitAssignment)
      ) {
        skipCount = suffixLookup(suffix[i + 1], bmSkip & ~retireMask, r);
      }
      if (k < skipCount) {
        bitmap = bmSkip & ~retireMask;
        continue;
      }
      k -= skipCount;
    }

    if (node.type === "choice") {
      const entriesToUse =
        constraint?.entryIndex != null
          ? [node.entries[constraint.entryIndex]].filter(Boolean)
          : node.entries;
      for (const entry of entriesToUse) {
        const cost = isFree ? 0 : entry.maxRanks;
        if (r >= cost) {
          const bmAfter = bitmap | selectBits | fullBits;
          let count = 0;
          if (
            !toEnforce ||
            isValidBitmapForConstraints(
              bmAfter,
              toEnforce,
              condSelectBitAssignment,
            )
          ) {
            count = suffixLookup(
              suffix[i + 1],
              bmAfter & ~retireMask,
              r - cost,
            );
          }
          if (k < count) {
            entries.set(entry.id, entry.maxRanks);
            bitmap = bmAfter & ~retireMask;
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
          const bmAfter =
            rank === node.maxRanks
              ? bitmap | selectBits | fullBits
              : bitmap | selectBits;
          let count = 0;
          if (
            !toEnforce ||
            isValidBitmapForConstraints(
              bmAfter,
              toEnforce,
              condSelectBitAssignment,
            )
          ) {
            count = suffixLookup(
              suffix[i + 1],
              bmAfter & ~retireMask,
              r - cost,
            );
          }
          if (k < count) {
            if (entry) entries.set(entry.id, rank);
            bitmap = bmAfter & ~retireMask;
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

  const layout = computeLayout(tree, constraints);
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
