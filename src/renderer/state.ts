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
    classCount: 0n,
    specCount: 0n,
    heroCount: 0n,
    totalCount: 0n,
  };
  private _validationErrors: string[] = [];
  private _impliedBy = new Map<number, Set<number>>();

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
  get validationErrors(): string[] {
    return this._validationErrors;
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
    this._impliedBy.clear();
    this._validationErrors = [];
    this.emit({ type: "spec-selected", spec });
  }

  selectHeroTree(tree: TalentTree): void {
    this._activeHeroTree = tree;
    // Remove constraints belonging to other hero trees
    for (const [nodeId] of this._constraints) {
      if (tree.nodes.has(nodeId)) continue;
      const fromOtherHero = this._activeSpec?.heroTrees.some(
        (ht) => ht !== tree && ht.nodes.has(nodeId),
      );
      if (fromOtherHero) {
        this._constraints.delete(nodeId);
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

  setValidationErrors(errors: string[]): void {
    this._validationErrors = errors;
    this.emit({ type: "validation-errors", errors });
  }

  setImpliedConstraints(sourceId: number, impliedIds: number[]): void {
    this.clearImpliedConstraints(sourceId);
    if (impliedIds.length === 0) return;
    this._impliedBy.set(sourceId, new Set(impliedIds));
    for (const id of impliedIds) {
      if (!this._constraints.has(id)) {
        this._constraints.set(id, { nodeId: id, type: "always" });
      }
    }
  }

  clearImpliedConstraints(sourceId: number): void {
    const implied = this._impliedBy.get(sourceId);
    if (!implied) return;
    for (const id of implied) {
      if (this.isImplied(id)) {
        this._constraints.delete(id);
      }
    }
    this._impliedBy.delete(sourceId);
  }

  isImplied(nodeId: number): boolean {
    for (const impliedSet of this._impliedBy.values()) {
      if (impliedSet.has(nodeId)) return true;
    }
    return false;
  }

  promoteImpliedToUser(nodeId: number): void {
    for (const impliedSet of this._impliedBy.values()) {
      impliedSet.delete(nodeId);
    }
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
