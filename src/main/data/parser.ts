import type {
  RawSpecData,
  RawTalentNode,
  Specialization,
  TalentEntry,
  TalentNode,
  TalentTree,
  TierGate,
} from "../../shared/types";
import {
  POINT_BUDGET_CLASS,
  POINT_BUDGET_SPEC,
  POINT_BUDGET_HERO,
} from "../../shared/constants";

function parseEntry(raw: RawTalentNode["entries"][number]): TalentEntry {
  return {
    id: raw.id,
    name: raw.name ?? "",
    maxRanks: raw.maxRanks,
    index: raw.index,
    icon: raw.icon ?? "",
    spellId: raw.spellId,
  };
}

function isValidNode(raw: RawTalentNode): boolean {
  return Boolean(raw.name || raw.entries[0]?.id);
}

function nodeName(raw: RawTalentNode): string {
  return raw.name || raw.entries[0]?.name || `Node ${raw.id}`;
}

function normalizeRows(nodes: Map<number, TalentNode>): void {
  const uniqueRows = [...new Set([...nodes.values()].map((n) => n.row))].sort(
    (a, b) => a - b,
  );
  const rowMap = new Map(uniqueRows.map((r, i) => [r, i]));
  for (const node of nodes.values()) {
    node.row = rowMap.get(node.row)!;
  }
}

function parseNodes(rawNodes: RawTalentNode[]): Map<number, TalentNode> {
  const nodes = new Map<number, TalentNode>();

  for (const raw of rawNodes) {
    if (!isValidNode(raw)) continue;

    nodes.set(raw.id, {
      id: raw.id,
      name: nodeName(raw),
      icon: raw.icon || raw.entries[0]?.icon || "",
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
      isApex: false,
      subTreeId: raw.subTreeId,
    });
  }

  normalizeRows(nodes);

  // Keep only top-down (forward) connections and supplement reverse edges
  for (const node of nodes.values()) {
    node.next = node.next.filter((id) => {
      const n = nodes.get(id);
      return n && n.row > node.row;
    });
    node.prev = node.prev.filter((id) => {
      const n = nodes.get(id);
      return n && n.row < node.row;
    });
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
  return [...nodes.values()].reduce((sum, node) => sum + node.maxRanks, 0);
}

function buildTree(
  rawNodes: RawTalentNode[],
  type: TalentTree["type"],
  subTreeId?: number,
  subTreeName?: string,
): TalentTree {
  const nodes = parseNodes(rawNodes);

  // Mark apex (capstone) nodes in hero trees — leaf nodes that are always taken
  if (type === "hero") {
    for (const node of nodes.values()) {
      if (node.next.length === 0) {
        node.isApex = true;
      }
    }
  }

  const maxPoints = computeMaxPoints(nodes);
  const pointBudget =
    type === "class"
      ? POINT_BUDGET_CLASS
      : type === "spec"
        ? POINT_BUDGET_SPEC
        : POINT_BUDGET_HERO;

  return {
    type,
    nodes,
    gates: computeGates(nodes),
    maxPoints,
    pointBudget,
    totalNodes: nodes.size,
    subTreeId,
    subTreeName,
  };
}

function buildHeroNameMap(raw: RawSpecData): Map<number, string> {
  const map = new Map<number, string>();
  if (!raw.subTreeNodes) return map;

  // Primary: extract from subTreeNodes entries
  for (const stNode of raw.subTreeNodes) {
    if (!stNode.entries) continue;
    for (const entry of stNode.entries) {
      if (entry.traitSubTreeId != null && entry.name) {
        map.set(entry.traitSubTreeId, entry.name);
      }
    }
  }

  if (map.size > 0) return map;

  // Fallback: parse "Name A / Name B" from a parent node name
  for (const stNode of raw.subTreeNodes) {
    if (!stNode.name?.includes(" / ")) continue;

    const names = stNode.name.split(" / ");
    const subTreeIds = [
      ...new Set(
        raw.heroNodes
          .map((n) => n.subTreeId)
          .filter((id): id is number => id != null),
      ),
    ].sort((a, b) => a - b);
    for (let i = 0; i < Math.min(names.length, subTreeIds.length); i++) {
      map.set(subTreeIds[i], names[i].trim());
    }
    break;
  }

  return map;
}

export function parseSpecializations(rawData: RawSpecData[]): Specialization[] {
  return rawData.map((raw) => {
    const heroNameMap = buildHeroNameMap(raw);

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
