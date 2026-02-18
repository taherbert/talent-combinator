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

  // Filter out constraints for nodes not in this tree (matches build-counter.ts)
  const treeConstraints = new Map<number, Constraint>();
  for (const [nodeId, c] of constraints) {
    if (tree.nodes.has(nodeId)) treeConstraints.set(nodeId, c);
  }

  return {
    tiers,
    sortedTierKeys: Array.from(tiers.keys()).sort((a, b) => a - b),
    constraints: treeConstraints,
    alwaysNodes: getNodesByType(treeConstraints, "always"),
    neverNodes: getNodesByType(treeConstraints, "never"),
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

function computeAdjustedGates(
  tree: TalentTree,
): { row: number; requiredPoints: number }[] {
  return tree.gates.map((gate) => {
    let freeInvested = 0;
    for (const node of tree.nodes.values()) {
      if (node.row < gate.row && (node.entryNode || node.freeNode)) {
        freeInvested +=
          node.type === "choice"
            ? Math.min(...node.entries.map((e) => e.maxRanks))
            : node.maxRanks;
      }
    }
    return {
      row: gate.row,
      requiredPoints: Math.max(0, gate.requiredPoints - freeInvested),
    };
  });
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

type LeafVisitor = (build: PartialBuild) => void;

function traverse(
  tree: TalentTree,
  solverState: SolverState,
  onLeaf: LeafVisitor,
): void {
  const adjustedGates = computeAdjustedGates(tree);

  function dfs(tierIdx: number, build: PartialBuild): void {
    if (tierIdx >= solverState.sortedTierKeys.length) {
      if (
        build.pointsSpent === tree.pointBudget &&
        checkConstraints(solverState.constraints, build.selected)
      ) {
        onLeaf(build);
      }
      return;
    }

    const tierRow = solverState.sortedTierKeys[tierIdx];
    if (!gateCheck(tierRow, build.pointsSpent, adjustedGates)) return;

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

    const isNodeAlways = solverState.alwaysNodes.has(node.id) || node.entryNode;

    if (solverState.neverNodes.has(node.id)) {
      if (isNodeAlways) return;
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
      return;
    }

    if (!accessible && !node.freeNode) {
      if (isNodeAlways) return;
      const b = cloneBuild(build);
      b.selected.set(node.id, 0);
      enumerateTier(tierIdx, nodeIdx + 1, tierNodes, b);
      return;
    }

    if (node.type === "choice") {
      const constraint = solverState.constraints.get(node.id);

      if (!isNodeAlways) {
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
        minRank = isNodeAlways ? 1 : 0;
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
