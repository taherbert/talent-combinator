import type { TalentTree, TalentNode, Constraint } from "./types";

export interface ValidationError {
  message: string;
  nodeIds?: number[];
}

export function validateTree(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const neverNodes = new Set<number>();
  const alwaysNodes = new Set<number>();

  for (const [nodeId, c] of constraints) {
    if (!tree.nodes.has(nodeId)) continue;
    if (c.type === "never") neverNodes.add(nodeId);
    if (c.type === "always") alwaysNodes.add(nodeId);
  }

  if (alwaysNodes.size === 0 && neverNodes.size === 0) return errors;

  // Reachability: BFS from entry/free nodes, skipping "never" nodes
  const reachable = new Set<number>();
  const queue: number[] = [];

  for (const node of tree.nodes.values()) {
    if ((node.entryNode || node.freeNode) && !neverNodes.has(node.id)) {
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

  for (const nodeId of alwaysNodes) {
    const node = tree.nodes.get(nodeId);
    if (node && !reachable.has(nodeId)) {
      errors.push({
        message: `"${node.name}" is required but unreachable — blocked by Never constraints`,
        nodeIds: [nodeId],
      });
    }
  }

  // Minimum path cost: DP on the DAG (sorted by row) to find cheapest
  // path from any root to each node. This accounts for travel cost.
  const minCost = new Map<number, number>();
  const bestPrev = new Map<number, number>();
  const sortedNodes = [...tree.nodes.values()].sort((a, b) => a.row - b.row);

  for (const node of sortedNodes) {
    if (neverNodes.has(node.id)) continue;

    if (node.entryNode || node.freeNode) {
      minCost.set(node.id, 0);
      continue;
    }

    let best = Infinity;
    let bestP = -1;
    for (const prevId of node.prev) {
      if (neverNodes.has(prevId)) continue;
      const pc = minCost.get(prevId);
      if (pc == null) continue;
      const prevNode = tree.nodes.get(prevId)!;
      const better = pc < best || (pc === best && prevNode.type !== "choice");
      if (better) {
        best = pc;
        bestP = prevId;
      }
    }

    if (best !== Infinity) {
      minCost.set(node.id, best + 1);
      bestPrev.set(node.id, bestP);
    }
  }

  // Collect all nodes forced by shortest paths to "always" nodes
  const forcedNodes = new Set<number>();
  for (const nodeId of alwaysNodes) {
    if (!reachable.has(nodeId)) continue;
    let current: number | undefined = nodeId;
    while (current != null && !forcedNodes.has(current)) {
      forcedNodes.add(current);
      current = bestPrev.get(current);
    }
  }

  // Compute minimum forced points (path cost to reach all always nodes)
  function mandatoryRanks(nodeId: number): number {
    const node = tree.nodes.get(nodeId);
    if (node && (node.freeNode || node.entryNode)) return 0;
    const c = constraints.get(nodeId);
    if (c?.exactRank != null) return c.exactRank;
    return 1;
  }

  let totalForced = 0;
  for (const nodeId of forcedNodes) {
    totalForced += mandatoryRanks(nodeId);
  }

  if (totalForced > tree.pointBudget) {
    errors.push({
      message: `Mandatory talents + prerequisites need ${totalForced} points, but only ${tree.pointBudget} available`,
    });
  }

  // Per-gate: forced points before + forced points after vs budget
  for (const gate of tree.gates) {
    if (gate.requiredPoints === 0) continue;

    let forcedBefore = 0;
    let forcedAfter = 0;
    for (const nodeId of forcedNodes) {
      const node = tree.nodes.get(nodeId)!;
      if (node.row < gate.row) {
        forcedBefore += mandatoryRanks(nodeId);
      } else {
        forcedAfter += mandatoryRanks(nodeId);
      }
    }

    const minBefore = Math.max(forcedBefore, gate.requiredPoints);
    if (minBefore + forcedAfter > tree.pointBudget) {
      errors.push({
        message: `Gate needs ${gate.requiredPoints} points + ${forcedAfter} mandatory after it — exceeds ${tree.pointBudget} budget`,
      });
    }

    // Not enough available (non-never) points to pass the gate
    let availableBefore = 0;
    for (const node of tree.nodes.values()) {
      if (node.row < gate.row && !neverNodes.has(node.id)) {
        availableBefore += node.maxRanks;
      }
    }
    if (availableBefore < gate.requiredPoints) {
      errors.push({
        message: `Not enough talents before gate (need ${gate.requiredPoints}, only ${availableBefore} available)`,
      });
    }
  }

  return errors;
}

export interface ZeroBuildDiagnosis {
  message: string;
}

export function diagnoseZeroBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): ZeroBuildDiagnosis | null {
  const alwaysNodes: TalentNode[] = [];
  const neverIds = new Set<number>();

  for (const [nodeId, c] of constraints) {
    const node = tree.nodes.get(nodeId);
    if (!node) continue;
    if (c.type === "always") alwaysNodes.push(node);
    if (c.type === "never") neverIds.add(nodeId);
  }

  // Budget check: sum minimum points for all "always" nodes
  let minRequired = 0;
  for (const node of alwaysNodes) {
    if (node.freeNode || node.entryNode) continue;
    const c = constraints.get(node.id)!;
    if (c.exactRank != null) {
      minRequired += c.exactRank;
    } else if (node.type === "choice") {
      const costs = node.entries.map((e) => e.maxRanks);
      minRequired += Math.min(...costs);
    } else {
      minRequired += 1;
    }
  }
  if (minRequired > tree.pointBudget) {
    return {
      message: `Always-selected talents need at least ${minRequired} points, but the budget is ${tree.pointBudget}`,
    };
  }

  // Gate check: available (non-never) points before each gate
  for (const gate of tree.gates) {
    let available = 0;
    for (const node of tree.nodes.values()) {
      if (node.row >= gate.row) continue;
      if (neverIds.has(node.id)) continue;
      if (node.freeNode || node.entryNode) continue;
      available += node.maxRanks;
    }
    if (available < gate.requiredPoints) {
      return {
        message: `Not enough talents before the ${gate.requiredPoints}-point gate — ${available} available, some blocked by Never`,
      };
    }
  }

  // Prerequisite check: any always node whose ALL predecessors are never
  for (const node of alwaysNodes) {
    if (node.entryNode || node.freeNode || node.prev.length === 0) continue;
    const allPrevBlocked = node.prev.every((prevId) => neverIds.has(prevId));
    if (allPrevBlocked) {
      return {
        message: `"${node.name}" is required but all its prerequisites are blocked`,
      };
    }
  }

  return null;
}
