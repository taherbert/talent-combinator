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

function nodeName(raw: RawTalentNode): string {
  // Node name from data, fallback to first entry name
  if (raw.name) return raw.name;
  if (raw.entries.length > 0 && raw.entries[0].name) return raw.entries[0].name;
  return `Node ${raw.id}`;
}

function parseNodes(rawNodes: RawTalentNode[]): Map<number, TalentNode> {
  const nodes = new Map<number, TalentNode>();

  for (const raw of rawNodes) {
    nodes.set(raw.id, {
      id: raw.id,
      name: nodeName(raw),
      icon: raw.icon ?? raw.entries[0]?.icon ?? "",
      type: raw.entries.length > 1 ? "choice" : "single",
      maxRanks: raw.maxRanks,
      entries: raw.entries.map(parseEntry),
      next: raw.next ?? [],
      prev: raw.prev ?? [],
      reqPoints: raw.reqPoints ?? 0,
      row: Math.round(raw.posY / 300),
      col: Math.round(raw.posX / 300),
      freeNode: raw.freeNode ?? false,
      entryNode: raw.entryNode ?? false,
      subTreeId: raw.subTreeId,
    });
  }

  // Supplement reverse edges if not present in raw data
  for (const node of nodes.values()) {
    for (const nextId of node.next) {
      const nextNode = nodes.get(nextId);
      if (nextNode && !nextNode.prev.includes(node.id)) {
        nextNode.prev.push(node.id);
      }
    }
  }

  return nodes;
}

function computeGates(nodes: Map<number, TalentNode>): TierGate[] {
  // Deduplicate by requiredPoints value (one gate per unique point threshold)
  const gatesByPoints = new Map<number, TierGate>();
  for (const node of nodes.values()) {
    if (node.reqPoints > 0) {
      const existing = gatesByPoints.get(node.reqPoints);
      if (!existing || node.row < existing.row) {
        gatesByPoints.set(node.reqPoints, {
          row: node.row,
          requiredPoints: node.reqPoints,
        });
      }
    }
  }
  return Array.from(gatesByPoints.values()).sort(
    (a, b) => a.requiredPoints - b.requiredPoints,
  );
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
    // Build hero subtree name lookup from subTreeNodes
    const heroNameMap = new Map<number, string>();
    if (raw.subTreeNodes) {
      for (const stNode of raw.subTreeNodes) {
        for (const entry of stNode.entries) {
          if (entry.traitSubTreeId && entry.name) {
            heroNameMap.set(entry.traitSubTreeId, entry.name);
          }
        }
      }
    }

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
      buildTree(nodes, "hero", stId, heroNameMap.get(stId)),
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
