import type {
  TalentTree,
  TalentNode,
  TalentEntry,
} from "../../src/shared/types";

export function makeEntry(id: number, maxRanks = 1): TalentEntry {
  return { id, name: `Entry ${id}`, maxRanks, index: 0, icon: "" };
}

export function makeNode(
  id: number,
  opts: Partial<TalentNode> = {},
): TalentNode {
  return {
    id,
    name: `Node ${id}`,
    icon: "",
    type: "single",
    maxRanks: 1,
    entries: [makeEntry(id * 100)],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: false,
    entryNode: false,
    isApex: false,
    ...opts,
  };
}

export function makeTree(
  nodes: TalentNode[],
  overrides: Partial<TalentTree> = {},
): TalentTree {
  const nodeMap = new Map<number, TalentNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  let maxPoints = 0;
  for (const n of nodes) maxPoints += n.maxRanks;

  return {
    type: "class",
    nodes: nodeMap,
    gates: [],
    maxPoints,
    pointBudget: maxPoints,
    totalNodes: nodes.length,
    ...overrides,
  };
}
