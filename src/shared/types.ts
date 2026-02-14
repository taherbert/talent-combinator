// --- Raidbots raw JSON types ---

export interface RawTalentEntry {
  id: number;
  name: string;
  maxRanks: number;
  index: number;
  icon?: string;
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
  classNodes: RawTalentNode[];
  specNodes: RawTalentNode[];
  heroNodes: RawTalentNode[];
  subTreeNodes: RawSubTreeNode[];
}

// --- Internal domain types ---

export interface TalentEntry {
  id: number;
  name: string;
  maxRanks: number;
  index: number;
  icon: string;
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
  totalNodes: number;
  subTreeId?: number;
  subTreeName?: string;
}

export interface Specialization {
  className: string;
  specName: string;
  classTree: TalentTree;
  specTree: TalentTree;
  heroTrees: TalentTree[];
}

// --- Constraint types ---

export type BooleanExpr =
  | { op: "AND"; children: BooleanExpr[] }
  | { op: "OR"; children: BooleanExpr[] }
  | { op: "TALENT_SELECTED"; nodeId: number; minRank?: number };

export type ConstraintType = "always" | "never" | "conditional";

export interface Constraint {
  nodeId: number;
  type: ConstraintType;
  condition?: BooleanExpr;
}

// --- Node visual state ---

export type NodeState =
  | "locked"
  | "available"
  | "always"
  | "never"
  | "conditional";

// --- Solver types ---

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

// --- Worker messages ---

export type WorkerRequest =
  | { type: "count"; config: SolverConfig }
  | { type: "generate"; config: SolverConfig };

export type WorkerResponse =
  | { type: "count"; result: { count: number; durationMs: number } }
  | { type: "generate"; result: SolverResult }
  | { type: "progress"; current: number; total: number }
  | { type: "error"; message: string };

// --- IPC API ---

export interface TalentDataResult {
  specs: Specialization[];
  version: string;
  cached: boolean;
}

export interface ElectronAPI {
  fetchTalentData: () => Promise<TalentDataResult>;
  saveFile: (content: string, defaultName: string) => Promise<boolean>;
  getAppVersion: () => Promise<string>;
}

// --- State events ---

export type AppEvent =
  | { type: "spec-selected"; spec: Specialization }
  | { type: "hero-tree-selected"; tree: TalentTree }
  | { type: "constraint-changed"; constraint: Constraint }
  | { type: "constraint-removed"; nodeId: number }
  | { type: "count-updated"; counts: TreeCounts }
  | { type: "generation-complete"; result: SolverResult }
  | { type: "data-loaded"; data: TalentDataResult };

export interface TreeCounts {
  classCount: number;
  specCount: number;
  heroCount: number;
  totalCount: number;
}
