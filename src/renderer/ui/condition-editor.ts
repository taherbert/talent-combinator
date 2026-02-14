import { state } from "../state";
import type { TalentNode, TalentTree, BooleanExpr } from "../../shared/types";

export class ConditionEditor {
  private popover: HTMLElement | null = null;
  private currentNode: TalentNode | null = null;
  private currentTree: TalentTree | null = null;
  private conditions: { nodeId: number; name: string }[] = [];
  private operator: "AND" | "OR" = "AND";

  open(node: TalentNode, tree: TalentTree, x: number, y: number): void {
    this.close();
    this.currentNode = node;
    this.currentTree = tree;

    // Load existing condition
    const existing = state.constraints.get(node.id);
    if (existing?.type === "conditional" && existing.condition) {
      this.loadCondition(existing.condition);
    } else {
      this.conditions = [];
      this.operator = "AND";
    }

    this.popover = document.createElement("div");
    this.popover.className = "condition-popover";
    this.popover.style.left = `${x}px`;
    this.popover.style.top = `${y}px`;

    this.renderPopover();
    document.getElementById("dialog-container")!.appendChild(this.popover);

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (this.popover && !this.popover.contains(e.target as Node)) {
        this.close();
        document.removeEventListener("mousedown", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler), 0);
  }

  close(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
  }

  private loadCondition(expr: BooleanExpr): void {
    this.conditions = [];
    if (expr.op === "AND" || expr.op === "OR") {
      this.operator = expr.op;
      for (const child of expr.children) {
        if (child.op === "TALENT_SELECTED") {
          const node = this.findNodeById(child.nodeId);
          this.conditions.push({
            nodeId: child.nodeId,
            name: node?.name ?? `Node ${child.nodeId}`,
          });
        }
      }
    } else if (expr.op === "TALENT_SELECTED") {
      this.conditions.push({
        nodeId: expr.nodeId,
        name: this.findNodeById(expr.nodeId)?.name ?? `Node ${expr.nodeId}`,
      });
    }
  }

  private findNodeById(nodeId: number): TalentNode | undefined {
    // Search all active trees
    const spec = state.activeSpec;
    if (!spec) return undefined;
    return (
      spec.classTree.nodes.get(nodeId) ??
      spec.specTree.nodes.get(nodeId) ??
      state.activeHeroTree?.nodes.get(nodeId)
    );
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

    // Operator toggle
    if (this.conditions.length > 1) {
      const row = document.createElement("div");
      row.className = "condition-row";

      const toggle = document.createElement("button");
      toggle.className = `condition-op-toggle ${this.operator.toLowerCase()}`;
      toggle.textContent = this.operator;
      toggle.addEventListener("click", () => {
        this.operator = this.operator === "AND" ? "OR" : "AND";
        this.renderPopover();
      });
      row.appendChild(toggle);

      const label = document.createElement("span");
      label.style.cssText = "font-size: 12px; color: var(--text-secondary)";
      label.textContent =
        this.operator === "AND"
          ? "All of these talents are selected"
          : "Any of these talents is selected";
      row.appendChild(label);

      body.appendChild(row);
    }

    // Condition chips
    for (const cond of this.conditions) {
      const chip = document.createElement("div");
      chip.className = "condition-talent-chip";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = cond.name;
      const removeSpan = document.createElement("span");
      removeSpan.className = "remove";
      removeSpan.textContent = "\u00d7";
      chip.append(nameSpan, removeSpan);
      removeSpan.addEventListener("click", () => {
        this.conditions = this.conditions.filter(
          (c) => c.nodeId !== cond.nodeId,
        );
        this.renderPopover();
      });
      body.appendChild(chip);
    }

    // Add talent selector
    if (this.currentTree) {
      const hint = document.createElement("div");
      hint.className = "condition-add-hint";
      hint.textContent = "Click a talent below to add it as a condition:";
      body.appendChild(hint);

      const talentList = document.createElement("div");
      talentList.style.cssText =
        "max-height: 150px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 4px;";

      // Show all available talents from the same tree (excluding self)
      for (const node of this.currentTree.nodes.values()) {
        if (node.id === this.currentNode!.id) continue;
        if (this.conditions.some((c) => c.nodeId === node.id)) continue;

        const btn = document.createElement("button");
        btn.className = "condition-talent-chip";
        btn.textContent = node.name;
        btn.addEventListener("click", () => {
          this.conditions.push({ nodeId: node.id, name: node.name });
          this.renderPopover();
        });
        talentList.appendChild(btn);
      }
      body.appendChild(talentList);
    }

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

  private save(): void {
    if (!this.currentNode || this.conditions.length === 0) return;

    const children: BooleanExpr[] = this.conditions.map((c) => ({
      op: "TALENT_SELECTED" as const,
      nodeId: c.nodeId,
    }));

    const condition: BooleanExpr =
      children.length === 1 ? children[0] : { op: this.operator, children };

    state.setConstraint({
      nodeId: this.currentNode.id,
      type: "conditional",
      condition,
    });
  }
}
