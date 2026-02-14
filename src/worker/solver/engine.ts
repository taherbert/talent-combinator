import type {
  TalentTree,
  TalentNode,
  Constraint,
  Build,
  SolverResult,
} from "../../shared/types";
import { checkConstraints, getAlwaysNodes, getNeverNodes } from "./constraints";
import { buildKey } from "./encoder";

interface SolverState {
  nodes: TalentNode[];
  tiers: Map<number, TalentNode[]>;
  sortedTierKeys: number[];
  constraints: Map<number, Constraint>;
  alwaysNodes: Set<number>;
  neverNodes: Set<number>;
  maxPoints: number;
}

function prepareSolver(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): SolverState {
  const nodes = Array.from(tree.nodes.values());

  // Group by tier
  const tiers = new Map<number, TalentNode[]>();
  for (const node of nodes) {
    let tier = tiers.get(node.row);
    if (!tier) {
      tier = [];
      tiers.set(node.row, tier);
    }
    tier.push(node);
  }

  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);

  return {
    nodes,
    tiers,
    sortedTierKeys,
    constraints,
    alwaysNodes: getAlwaysNodes(constraints),
    neverNodes: getNeverNodes(constraints),
    maxPoints: tree.maxPoints,
  };
}

interface PartialBuild {
  // nodeId → points allocated
  selected: Map<number, number>;
  // entryId → points (for build output)
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

export function countBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): number {
  const state = prepareSolver(tree, constraints);
  let count = 0;

  function dfs(tierIdx: number, build: PartialBuild): void {
    if (tierIdx >= state.sortedTierKeys.length) {
      // Check all "always" constraints are satisfied
      if (checkConstraints(state.constraints, build.selected)) {
        count++;
      }
      return;
    }

    const tierRow = state.sortedTierKeys[tierIdx];
    const tierNodes = state.tiers.get(tierRow)!;

    // Check gate
    if (!gateCheck(tierRow, build.pointsSpent, tree.gates)) {
      return;
    }

    // Enumerate all valid selections for this tier's nodes
    enumerateTier(tierIdx, 0, tierNodes, build, state);
  }

  function enumerateTier(
    tierIdx: number,
    nodeIdx: number,
    tierNodes: TalentNode[],
    build: PartialBuild,
    state: SolverState,
  ): void {
    if (nodeIdx >= tierNodes.length) {
      // All nodes in this tier assigned, proceed to next tier
      dfs(tierIdx + 1, build);
      return;
    }

    const node = tierNodes[nodeIdx];

    // Check if node is accessible (prerequisites)
    const accessible = prerequisitesMet(node, build.selected);

    if (state.neverNodes.has(node.id)) {
      // Must skip this node
      if (state.alwaysNodes.has(node.id)) return; // contradiction
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      return;
    }

    if (!accessible && !node.freeNode) {
      // Can't select this node, skip it
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      if (state.alwaysNodes.has(node.id)) return; // can't satisfy always constraint
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      return;
    }

    // For choice nodes, we select one entry at its max ranks (or skip)
    if (node.type === "choice") {
      // Option: skip the node
      if (!state.alwaysNodes.has(node.id)) {
        const bSkip = cloneBuild(build);
        bSkip.selected.set(node.id, 0);
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, bSkip, state);
      }

      // Option: select each choice entry
      for (const entry of node.entries) {
        const b = cloneBuild(build);
        b.selected.set(node.id, entry.maxRanks);
        b.entries.set(entry.id, entry.maxRanks);
        b.pointsSpent += entry.maxRanks;
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      }
    } else {
      // Single node: try ranks 0 through maxRanks
      const minRank = state.alwaysNodes.has(node.id) ? 1 : 0;
      const maxRank = node.maxRanks;
      const entry = node.entries[0];

      for (let rank = minRank; rank <= maxRank; rank++) {
        const b = cloneBuild(build);
        b.selected.set(node.id, rank);
        if (rank > 0 && entry) {
          b.entries.set(entry.id, rank);
        }
        b.pointsSpent += rank;
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      }
    }
  }

  dfs(0, emptyBuild());
  return count;
}

export function generateBuilds(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
  onProgress?: (current: number) => void,
): SolverResult {
  const startTime = performance.now();
  const state = prepareSolver(tree, constraints);
  const builds: Build[] = [];
  const seen = new Set<string>();
  let progressCounter = 0;

  function dfs(tierIdx: number, build: PartialBuild): void {
    if (tierIdx >= state.sortedTierKeys.length) {
      if (checkConstraints(state.constraints, build.selected)) {
        const b: Build = { entries: new Map(build.entries) };
        const key = buildKey(b);
        if (!seen.has(key)) {
          seen.add(key);
          builds.push(b);
          progressCounter++;
          if (onProgress && progressCounter % 100 === 0) {
            onProgress(progressCounter);
          }
        }
      }
      return;
    }

    const tierRow = state.sortedTierKeys[tierIdx];
    const tierNodes = state.tiers.get(tierRow)!;

    if (!gateCheck(tierRow, build.pointsSpent, tree.gates)) {
      return;
    }

    enumerateTier(tierIdx, 0, tierNodes, build, state);
  }

  function enumerateTier(
    tierIdx: number,
    nodeIdx: number,
    tierNodes: TalentNode[],
    build: PartialBuild,
    state: SolverState,
  ): void {
    if (nodeIdx >= tierNodes.length) {
      dfs(tierIdx + 1, build);
      return;
    }

    const node = tierNodes[nodeIdx];
    const accessible = prerequisitesMet(node, build.selected);

    if (state.neverNodes.has(node.id)) {
      if (state.alwaysNodes.has(node.id)) return;
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      return;
    }

    if (!accessible && !node.freeNode) {
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      if (state.alwaysNodes.has(node.id)) return;
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      return;
    }

    if (node.type === "choice") {
      if (!state.alwaysNodes.has(node.id)) {
        const bSkip = cloneBuild(build);
        bSkip.selected.set(node.id, 0);
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, bSkip, state);
      }

      for (const entry of node.entries) {
        const b = cloneBuild(build);
        b.selected.set(node.id, entry.maxRanks);
        b.entries.set(entry.id, entry.maxRanks);
        b.pointsSpent += entry.maxRanks;
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      }
    } else {
      const minRank = state.alwaysNodes.has(node.id) ? 1 : 0;
      const maxRank = node.maxRanks;
      const entry = node.entries[0];

      for (let rank = minRank; rank <= maxRank; rank++) {
        const b = cloneBuild(build);
        b.selected.set(node.id, rank);
        if (rank > 0 && entry) {
          b.entries.set(entry.id, rank);
        }
        b.pointsSpent += rank;
        enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b, state);
      }
    }
  }

  dfs(0, emptyBuild());

  return {
    count: builds.length,
    builds,
    durationMs: performance.now() - startTime,
  };
}
