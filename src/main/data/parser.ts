import type {
  RawSpecData,
  RawTalentNode,
  Specialization,
  TalentEntry,
  TalentNode,
  TalentTree,
  TierGate,
} from "../../shared/types";

function parseEntry(raw: RawTalentNode["entries"][number]): TalentEntry {
  return {
    id: raw.id,
    name: raw.name ?? "",
    maxRanks: raw.maxRanks,
    index: raw.index,
    icon: raw.icon ?? "",
  };
}

function parseNodes(rawNodes: RawTalentNode[]): Map<number, TalentNode> {
  const nodes = new Map<number, TalentNode>();

  for (const raw of rawNodes) {
    nodes.set(raw.id, {
      id: raw.id,
      name: raw.name,
      type: raw.entries.length > 1 ? "choice" : "single",
      maxRanks: raw.maxRanks,
      entries: raw.entries.map(parseEntry),
      next: raw.next ?? [],
      prev: [],
      reqPoints: raw.reqPoints ?? 0,
      row: 0,
      col: 0,
      freeNode: raw.freeNode ?? false,
      entryNode: raw.entryNode ?? false,
      subTreeId: raw.subTreeId,
    });
  }

  // Build reverse edges
  for (const node of nodes.values()) {
    for (const nextId of node.next) {
      const nextNode = nodes.get(nextId);
      if (nextNode) {
        nextNode.prev.push(node.id);
      }
    }
  }

  // Compute rows/cols from Raidbots posX/posY
  const rawLookup = new Map(rawNodes.map((n) => [n.id, n]));
  for (const node of nodes.values()) {
    const raw = rawLookup.get(node.id);
    if (raw) {
      // posX/posY in Raidbots data are layout coordinates
      // Normalize: row from posY, col from posX
      node.row = Math.round(raw.posY / 300);
      node.col = Math.round(raw.posX / 300);
    }
  }

  return nodes;
}

function computeGates(nodes: Map<number, TalentNode>): TierGate[] {
  const gates = new Map<number, number>();
  for (const node of nodes.values()) {
    if (node.reqPoints > 0) {
      const existing = gates.get(node.row);
      if (existing === undefined || node.reqPoints > existing) {
        gates.set(node.row, node.reqPoints);
      }
    }
  }
  return Array.from(gates.entries())
    .map(([row, requiredPoints]) => ({ row, requiredPoints }))
    .sort((a, b) => a.row - b.row);
}

function computeMaxPoints(nodes: Map<number, TalentNode>): number {
  let total = 0;
  for (const node of nodes.values()) {
    total += node.maxRanks;
  }
  return total;
}

function buildTree(
  rawNodes: RawTalentNode[],
  type: TalentTree["type"],
  subTreeId?: number,
  subTreeName?: string,
): TalentTree {
  const nodes = parseNodes(rawNodes);
  return {
    type,
    nodes,
    gates: computeGates(nodes),
    maxPoints: computeMaxPoints(nodes),
    totalNodes: nodes.size,
    subTreeId,
    subTreeName,
  };
}

export function parseSpecializations(rawData: RawSpecData[]): Specialization[] {
  return rawData.map((raw) => {
    // Group hero nodes by subTreeId
    const heroGroups = new Map<number, RawTalentNode[]>();
    for (const node of raw.heroNodes) {
      const stId = node.subTreeId ?? 0;
      let group = heroGroups.get(stId);
      if (!group) {
        group = [];
        heroGroups.set(stId, group);
      }
      group.push(node);
    }

    const heroTrees = Array.from(heroGroups.entries()).map(([stId, nodes]) =>
      buildTree(nodes, "hero", stId),
    );

    return {
      className: raw.className,
      specName: raw.specName,
      classTree: buildTree(raw.classNodes, "class"),
      specTree: buildTree(raw.specNodes, "spec"),
      heroTrees,
    };
  });
}
