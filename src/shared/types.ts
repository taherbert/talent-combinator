export interface RawTalentEntry {
  id: number;
  name: string;
  maxRanks: number;
  index: number;
  icon?: string;
  spellId?: number;
}

export interface RawTalentNode {
  id: number;
  name: string;
  icon: string;
  type: string;
  entries: RawTalentEntry[];
  next: number[];
  prev: number[];
  reqPoints: number;
  maxRanks: number;
  freeNode: boolean;
  entryNode: boolean;
  posX: number;
  posY: number;
  subTreeId?: number;
}

export interface RawSubTreeEntry {
  id: number;
  type: string;
  name: string;
  traitSubTreeId: number;
  nodes: number[];
}

export interface RawSubTreeNode {
  id: number;
  name: string;
  type: string;
  entries: RawSubTreeEntry[];
}

export interface RawSpecData {
  className: string;
  specName: string;
  specId?: number;
  classNodes: RawTalentNode[];
  specNodes: RawTalentNode[];
  heroNodes: RawTalentNode[];
  subTreeNodes: RawSubTreeNode[];
}

export interface TalentEntry {
  id: number;
  name: string;
  maxRanks: number;
  index: number;
  icon: string;
  spellId?: number;
}

export interface TalentNode {
  id: number;
  name: string;
  icon: string;
  type: "single" | "choice";
  maxRanks: number;
  entries: TalentEntry[];
  next: number[];
  prev: number[];
  reqPoints: number;
  row: number;
  col: number;
  freeNode: boolean;
  entryNode: boolean;
  isApex: boolean;
  subTreeId?: number;
}

export interface TierGate {
  row: number;
  requiredPoints: number;
}

export interface TalentTree {
  type: "class" | "spec" | "hero";
  nodes: Map<number, TalentNode>;
  gates: TierGate[];
  maxPoints: number;
  pointBudget: number;
  totalNodes: number;
  subTreeId?: number;
  subTreeName?: string;
}

// Hero tree selection node — the "choice" node where you pick a hero spec.
// Needed to correctly position bits when decoding a talent import string.
export interface SubTreeNodeInfo {
  id: number;
  entries: { traitSubTreeId: number }[];
}

export interface Specialization {
  className: string;
  specName: string;
  specId?: number;
  classTree: TalentTree;
  specTree: TalentTree;
  heroTrees: TalentTree[];
  subTreeNodes: SubTreeNodeInfo[];
  // Node IDs excluded from the talent tree display (entryNode/freeNode with no name)
  // but still present in the game's GetTreeNodes hash encoding.
  systemNodeIds: number[];
}

export type BooleanExpr =
  | { op: "AND"; children: BooleanExpr[] }
  | { op: "OR"; children: BooleanExpr[] }
  | { op: "TALENT_SELECTED"; nodeId: number; minRank?: number };

export type ConstraintType = "always" | "never" | "conditional";

export interface Constraint {
  nodeId: number;
  type: ConstraintType;
  entryIndex?: number; // For choice nodes: which entry (0 or 1)
  exactRank?: number; // For multi-rank: specific rank desired
  condition?: BooleanExpr;
}

export type NodeState =
  | "locked"
  | "available"
  | "always"
  | "never"
  | "conditional"
  | "implied"
  | "free";

export interface SolverConfig {
  tree: TalentTree;
  constraints: Map<number, Constraint>;
}

export interface SolverResult {
  count: number;
  builds?: Build[];
  durationMs: number;
}

export interface Build {
  entries: Map<number, number>; // entryId → points
}

export type CountWarningSeverity = "error" | "warning";

export interface CountWarning {
  severity: CountWarningSeverity;
  message: string;
  nodeIds?: number[];
}

export interface CountResult {
  count: bigint;
  durationMs: number;
  warnings: CountWarning[];
}

export type WorkerResponse =
  | { type: "generate"; result: SolverResult }
  | { type: "progress"; current: number; total: number }
  | { type: "error"; message: string };

export interface TalentDataResult {
  specs: Specialization[];
  version: string;
  cached: boolean;
}

export interface SpellTooltip {
  meta: string; // "25 Energy · Melee Range · Instant · 45 sec cooldown"
  desc: string;
}

export interface Loadout {
  version: 1;
  className: string;
  specName: string;
  heroTreeName?: string;
  constraints: Constraint[];
}

export interface ElectronAPI {
  fetchTalentData: () => Promise<TalentDataResult>;
  fetchSpellTooltip: (spellId: number) => Promise<SpellTooltip | null>;
  saveFile: (content: string, defaultName: string) => Promise<boolean>;
  saveLoadout: (data: Loadout) => Promise<boolean>;
  loadLoadout: () => Promise<Loadout | null>;
  getAppVersion: () => Promise<string>;
}

export type AppEvent =
  | { type: "spec-selected"; spec: Specialization }
  | { type: "hero-tree-selected"; tree: TalentTree }
  | { type: "constraint-changed"; constraint: Constraint }
  | { type: "constraint-removed"; nodeId: number }
  | { type: "count-updated"; counts: TreeCounts }
  | { type: "data-loaded"; data: TalentDataResult }
  | { type: "validation-changed" };

export interface TreeCounts {
  classCount: bigint;
  specCount: bigint;
  heroCount: bigint;
  totalCount: bigint;
  details?: {
    class?: CountResult;
    spec?: CountResult;
    hero?: CountResult;
  };
}
