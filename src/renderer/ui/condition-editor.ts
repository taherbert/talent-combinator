import { state } from "../state";
import { addDismissHandler } from "./dismiss";
import type { TalentNode, TalentTree, BooleanExpr } from "../../shared/types";

interface ConditionGroup {
  talents: { nodeId: number; name: string }[];
}

export class ConditionEditor {
  private popover: HTMLElement | null = null;
  private currentNode: TalentNode | null = null;
  private currentTree: TalentTree | null = null;
  private groups: ConditionGroup[] = [];
  private topOp: "AND" | "OR" = "AND";

  open(node: TalentNode, tree: TalentTree, x: number, y: number): void {
    this.close();
    this.currentNode = node;
    this.currentTree = tree;

    const existing = state.constraints.get(node.id);
    if (existing?.type === "conditional" && existing.condition) {
      this.loadCondition(existing.condition);
    } else {
      this.groups = [];
      this.topOp = "AND";
    }

    this.popover = document.createElement("div");
    this.popover.className = "condition-popover";
    this.popover.style.left = `${x}px`;
    this.popover.style.top = `${y}px`;

    this.renderPopover();
    document.getElementById("dialog-container")!.appendChild(this.popover);

    addDismissHandler(this.popover, () => this.close());
  }

  close(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
  }

  private loadCondition(expr: BooleanExpr): void {
    this.groups = [];

    if (expr.op === "AND" || expr.op === "OR") {
      this.topOp = expr.op;
      for (const child of expr.children) {
        if (child.op === "TALENT_SELECTED") {
          // Single talent as its own group
          this.groups.push({
            talents: [
              {
                nodeId: child.nodeId,
                name: this.findNodeName(child.nodeId),
              },
            ],
          });
        } else if (child.op === "AND" || child.op === "OR") {
          // Sub-group of talents
          const talents = child.children
            .filter(
              (c): c is BooleanExpr & { op: "TALENT_SELECTED" } =>
                c.op === "TALENT_SELECTED",
            )
            .map((c) => ({
              nodeId: c.nodeId,
              name: this.findNodeName(c.nodeId),
            }));
          if (talents.length > 0) {
            this.groups.push({ talents });
          }
        }
      }
    } else if (expr.op === "TALENT_SELECTED") {
      this.topOp = "AND";
      this.groups.push({
        talents: [
          { nodeId: expr.nodeId, name: this.findNodeName(expr.nodeId) },
        ],
      });
    }
  }

  private findNodeName(nodeId: number): string {
    const spec = state.activeSpec;
    if (!spec) return `Node ${nodeId}`;
    const node =
      spec.classTree.nodes.get(nodeId) ??
      spec.specTree.nodes.get(nodeId) ??
      state.activeHeroTree?.nodes.get(nodeId);
    return node?.name ?? `Node ${nodeId}`;
  }

  private get innerOp(): "AND" | "OR" {
    return this.topOp === "AND" ? "OR" : "AND";
  }

  private renderPopover(): void {
    if (!this.popover || !this.currentNode) return;
    this.popover.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "condition-popover-header";
    const headerSpan = document.createElement("span");
    headerSpan.textContent = `Include "${this.currentNode.name}" when...`;
    header.appendChild(headerSpan);
    this.popover.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "condition-popover-body";

    // Top operator toggle
    if (this.groups.length > 1) {
      const opRow = document.createElement("div");
      opRow.className = "condition-row";

      const toggle = document.createElement("button");
      toggle.className = `condition-op-toggle ${this.topOp.toLowerCase()}`;
      toggle.textContent = this.topOp;
      toggle.title = "Toggle between AND / OR";
      toggle.addEventListener("click", () => {
        this.topOp = this.topOp === "AND" ? "OR" : "AND";
        this.renderPopover();
      });
      opRow.appendChild(toggle);

      const label = document.createElement("span");
      label.className = "condition-op-label";
      label.textContent =
        this.topOp === "AND"
          ? "All conditions must be met"
          : "Any condition must be met";
      opRow.appendChild(label);

      body.appendChild(opRow);
    }

    if (this.groups.length === 0) {
      const hint = document.createElement("div");
      hint.className = "condition-hint";
      hint.textContent =
        "Add talents below. Group them with OR/AND to create complex conditions.";
      body.appendChild(hint);
    }

    // Render each group
    for (let gi = 0; gi < this.groups.length; gi++) {
      if (gi > 0) {
        const sep = document.createElement("div");
        sep.className = "condition-separator";
        sep.textContent = this.topOp;
        body.appendChild(sep);
      }

      const group = this.groups[gi];
      const groupEl = document.createElement("div");
      groupEl.className = "condition-group";

      for (let ti = 0; ti < group.talents.length; ti++) {
        const talent = group.talents[ti];

        if (ti > 0) {
          const innerSep = document.createElement("span");
          innerSep.className = "condition-inner-op";
          innerSep.textContent = this.innerOp;
          groupEl.appendChild(innerSep);
        }

        const chip = document.createElement("span");
        chip.className = "condition-talent-chip";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = talent.name;
        const removeSpan = document.createElement("span");
        removeSpan.className = "remove";
        removeSpan.textContent = "\u00d7";
        chip.append(nameSpan, removeSpan);
        removeSpan.addEventListener("click", () => {
          group.talents.splice(ti, 1);
          if (group.talents.length === 0) {
            this.groups.splice(gi, 1);
          }
          this.renderPopover();
        });
        groupEl.appendChild(chip);
      }

      // "Add OR/AND alternative" button within group
      if (group.talents.length > 0) {
        const addAltBtn = document.createElement("button");
        addAltBtn.className = "condition-add-alt";
        addAltBtn.textContent = `+ ${this.innerOp}`;
        addAltBtn.title = `Add ${this.innerOp} alternative to this group`;
        addAltBtn.addEventListener("click", () => {
          this.showTalentPicker(body, (nodeId, name) => {
            group.talents.push({ nodeId, name });
            this.renderPopover();
          });
        });
        groupEl.appendChild(addAltBtn);
      }

      body.appendChild(groupEl);
    }

    // Add new condition group
    const addSection = document.createElement("div");
    addSection.className = "condition-add-section";

    const addHint = document.createElement("div");
    addHint.className = "condition-hint";
    addHint.textContent = "Click a talent to add a new condition:";
    addSection.appendChild(addHint);

    this.showTalentPicker(addSection, (nodeId, name) => {
      this.groups.push({ talents: [{ nodeId, name }] });
      this.renderPopover();
    });

    body.appendChild(addSection);
    this.popover.appendChild(body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "condition-popover-footer";

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-secondary";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      state.removeConstraint(this.currentNode!.id);
      this.close();
    });
    footer.appendChild(clearBtn);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      this.save();
      this.close();
    });
    footer.appendChild(saveBtn);

    this.popover.appendChild(footer);
  }

  private showTalentPicker(
    container: HTMLElement,
    onSelect: (nodeId: number, name: string) => void,
  ): void {
    if (!this.currentTree) return;

    const allTalentIds = new Set(
      this.groups.flatMap((g) => g.talents.map((t) => t.nodeId)),
    );

    const talentList = document.createElement("div");
    talentList.className = "condition-talent-list";

    for (const node of this.currentTree.nodes.values()) {
      if (node.id === this.currentNode!.id) continue;
      if (allTalentIds.has(node.id)) continue;

      const btn = document.createElement("button");
      btn.className = "condition-talent-chip";
      btn.textContent = node.name;
      btn.addEventListener("click", () => onSelect(node.id, node.name));
      talentList.appendChild(btn);
    }
    container.appendChild(talentList);
  }

  private save(): void {
    if (!this.currentNode || this.groups.length === 0) return;

    const groupExprs: BooleanExpr[] = this.groups.map((group) => {
      if (group.talents.length === 1) {
        return {
          op: "TALENT_SELECTED" as const,
          nodeId: group.talents[0].nodeId,
        };
      }
      return {
        op: this.innerOp,
        children: group.talents.map((t) => ({
          op: "TALENT_SELECTED" as const,
          nodeId: t.nodeId,
        })),
      };
    });

    const condition: BooleanExpr =
      groupExprs.length === 1
        ? groupExprs[0]
        : { op: this.topOp, children: groupExprs };

    state.setConstraint({
      nodeId: this.currentNode.id,
      type: "conditional",
      condition,
    });
  }
}
