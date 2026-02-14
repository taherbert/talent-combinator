import type {
  AppEvent,
  Constraint,
  Specialization,
  TalentTree,
  TreeCounts,
} from "../shared/types";

type Listener = (event: AppEvent) => void;

class AppState {
  private listeners: Listener[] = [];
  private _specs: Specialization[] = [];
  private _activeSpec: Specialization | null = null;
  private _activeHeroTree: TalentTree | null = null;
  private _constraints = new Map<number, Constraint>();
  private _counts: TreeCounts = {
    classCount: 0,
    specCount: 0,
    heroCount: 0,
    totalCount: 0,
  };

  get specs(): Specialization[] {
    return this._specs;
  }
  get activeSpec(): Specialization | null {
    return this._activeSpec;
  }
  get activeHeroTree(): TalentTree | null {
    return this._activeHeroTree;
  }
  get constraints(): Map<number, Constraint> {
    return this._constraints;
  }
  get counts(): TreeCounts {
    return this._counts;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  setSpecs(specs: Specialization[], version: string, cached: boolean): void {
    this._specs = specs;
    this.emit({ type: "data-loaded", data: { specs, version, cached } });
  }

  selectSpec(spec: Specialization): void {
    this._activeSpec = spec;
    this._activeHeroTree = null;
    this._constraints.clear();
    this.emit({ type: "spec-selected", spec });
  }

  selectHeroTree(tree: TalentTree): void {
    this._activeHeroTree = tree;
    // Clear hero constraints when switching hero trees
    for (const [nodeId, constraint] of this._constraints) {
      const heroNodes = tree.nodes;
      if (!heroNodes.has(nodeId)) {
        // Check if it was a hero node from another tree
        const wasHero = this._activeSpec?.heroTrees.some(
          (ht) => ht !== tree && ht.nodes.has(nodeId),
        );
        if (wasHero) {
          this._constraints.delete(nodeId);
        }
      }
    }
    this.emit({ type: "hero-tree-selected", tree });
  }

  setConstraint(constraint: Constraint): void {
    this._constraints.set(constraint.nodeId, constraint);
    this.emit({ type: "constraint-changed", constraint });
  }

  removeConstraint(nodeId: number): void {
    this._constraints.delete(nodeId);
    this.emit({ type: "constraint-removed", nodeId });
  }

  updateCounts(counts: TreeCounts): void {
    this._counts = counts;
    this.emit({ type: "count-updated", counts });
  }

  getConstraintsForTree(tree: TalentTree): Map<number, Constraint> {
    const result = new Map<number, Constraint>();
    for (const [nodeId, constraint] of this._constraints) {
      if (tree.nodes.has(nodeId)) {
        result.set(nodeId, constraint);
      }
    }
    return result;
  }
}

export const state = new AppState();
