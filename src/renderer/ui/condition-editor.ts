import { state } from "../state";
import type { BooleanExpr, TalentNode, TalentTree } from "../../shared/types";

interface TalentRef {
  nodeId: number;
  name: string;
}

interface RuleGroup {
  talents: TalentRef[];
}

export class ConditionEditor {
  private panel: HTMLElement | null = null;
  private currentNode: TalentNode | null = null;
  private currentTree: TalentTree | null = null;
  private groups: RuleGroup[] = [];
  private mode: "any" | "all" = "any";
  private targetGroupIndex: number | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  open(node: TalentNode, tree: TalentTree): void {
    this.close();
    this.currentNode = node;
    this.currentTree = tree;

    const existing = state.constraints.get(node.id);
    if (existing?.type === "conditional" && existing.condition) {
      this.loadCondition(existing.condition);
    } else {
      this.groups = [];
      this.mode = "any";
    }

    const overlay = document.createElement("div");
    overlay.className = "cond-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const dialog = document.createElement("div");
    dialog.className = "cond-dialog";
    overlay.appendChild(dialog);

    this.panel = overlay;
    this.render();
    document.getElementById("dialog-container")!.appendChild(overlay);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this.keyHandler);

    requestAnimationFrame(() => {
      overlay.querySelector<HTMLInputElement>(".cond-search-input")?.focus();
    });
  }

  close(): void {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }

  // --- Load / Save conversion ---

  private loadCondition(expr: BooleanExpr): void {
    this.groups = [];
    this.mode = "any";

    if (expr.op === "TALENT_SELECTED") {
      this.groups.push({ talents: [this.refFromExpr(expr)] });
      return;
    }

    if (expr.op === "OR") {
      // DNF: OR of ANDs or leaves → "any" mode
      this.mode = "any";
      this.loadGroupChildren(expr.children);
      return;
    }

    // AND
    if (expr.children.every((c) => c.op === "TALENT_SELECTED")) {
      // Simple AND of leaves → "any" mode, one group
      this.groups.push({
        talents: expr.children.map((c) => this.refFromExpr(c)),
      });
      return;
    }

    if (expr.children.some((c) => c.op === "OR")) {
      // AND of ORs → CNF → "all" mode
      this.mode = "all";
      this.loadGroupChildren(expr.children);
      return;
    }

    // AND of mixed non-OR — fallback to single group
    this.groups.push({ talents: this.collectLeaves(expr) });
  }

  private loadGroupChildren(children: BooleanExpr[]): void {
    const innerOp = this.mode === "any" ? "AND" : "OR";
    for (const child of children) {
      if (child.op === "TALENT_SELECTED") {
        this.groups.push({ talents: [this.refFromExpr(child)] });
      } else if (
        child.op === innerOp &&
        child.children.every((c) => c.op === "TALENT_SELECTED")
      ) {
        this.groups.push({
          talents: child.children.map((c) => this.refFromExpr(c)),
        });
      } else {
        const leaves = this.collectLeaves(child);
        if (leaves.length > 0) {
          this.groups.push({ talents: leaves });
        }
      }
    }
  }

  private refFromExpr(expr: BooleanExpr): TalentRef {
    if (expr.op !== "TALENT_SELECTED") return { nodeId: 0, name: "Unknown" };
    return { nodeId: expr.nodeId, name: this.findNodeName(expr.nodeId) };
  }

  private collectLeaves(expr: BooleanExpr): TalentRef[] {
    if (expr.op === "TALENT_SELECTED") return [this.refFromExpr(expr)];
    return expr.children.flatMap((c) => this.collectLeaves(c));
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

  // --- Rendering ---

  private render(): void {
    if (!this.panel || !this.currentNode) return;
    const target = this.panel.querySelector(".cond-dialog") ?? this.panel;
    target.innerHTML = "";

    target.appendChild(this.buildHeader());
    target.appendChild(this.buildBody());
    target.appendChild(this.buildFooter());
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "cond-header";

    const title = document.createElement("span");
    title.className = "cond-title";
    title.textContent = this.currentNode!.name;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "cond-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);

    return header;
  }

  private buildBody(): HTMLElement {
    const body = document.createElement("div");
    body.className = "cond-body";

    body.appendChild(this.buildSearchSection());

    const sentence = document.createElement("div");
    sentence.className = "cond-sentence";
    sentence.textContent = "Include this talent when:";
    body.appendChild(sentence);

    if (this.groups.length > 0) {
      body.appendChild(this.buildModeToggle());
    }

    const conditions = document.createElement("div");
    conditions.className = "cond-conditions";

    if (this.groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cond-empty";
      empty.textContent =
        "No conditions set. Search for a talent above to add one.";
      conditions.appendChild(empty);
    } else {
      const outerOp = this.mode === "any" ? "OR" : "AND";

      for (let gi = 0; gi < this.groups.length; gi++) {
        if (gi > 0) {
          const sep = document.createElement("div");
          sep.className = "cond-or-sep";
          const badge = document.createElement("span");
          badge.textContent = outerOp;
          sep.appendChild(badge);
          conditions.appendChild(sep);
        }
        conditions.appendChild(this.buildGroupCard(gi));
      }

      const addGroupBtn = document.createElement("button");
      addGroupBtn.className = "cond-add-group";
      addGroupBtn.textContent = `+ ${outerOp} group`;
      addGroupBtn.addEventListener("click", () => {
        this.groups.push({ talents: [] });
        this.targetGroupIndex = this.groups.length - 1;
        this.render();
        requestAnimationFrame(() => {
          this.panel
            ?.querySelector<HTMLInputElement>(".cond-search-input")
            ?.focus();
        });
      });
      conditions.appendChild(addGroupBtn);
    }

    body.appendChild(conditions);
    return body;
  }

  private buildModeToggle(): HTMLElement {
    const toggle = document.createElement("div");
    toggle.className = "cond-mode-toggle";

    const modes: [typeof this.mode, string][] = [
      ["any", "Any group matches"],
      ["all", "All groups match"],
    ];

    for (const [value, label] of modes) {
      const btn = document.createElement("button");
      btn.className = `cond-mode-btn${this.mode === value ? " active" : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        if (this.mode !== value) {
          this.mode = value;
          this.render();
        }
      });
      toggle.appendChild(btn);
    }

    return toggle;
  }

  private buildGroupCard(gi: number): HTMLElement {
    const group = this.groups[gi];
    const card = document.createElement("div");
    card.className = "cond-group-card";

    // Delete group button (top-right)
    if (this.groups.length > 1 || group.talents.length > 1) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "cond-group-delete";
      deleteBtn.textContent = "\u00d7";
      deleteBtn.title = "Remove group";
      deleteBtn.addEventListener("click", () => {
        this.groups.splice(gi, 1);
        this.render();
      });
      card.appendChild(deleteBtn);
    }

    // Talent items
    for (let ti = 0; ti < group.talents.length; ti++) {
      const talent = group.talents[ti];
      const item = document.createElement("div");
      item.className = "cond-item";

      if (ti > 0) {
        const innerLabel = document.createElement("span");
        innerLabel.className = "cond-inner-label";
        innerLabel.textContent = this.mode === "any" ? "and" : "or";
        card.appendChild(innerLabel);
      }

      const chip = document.createElement("span");
      chip.className = "cond-chip";

      const nameEl = document.createElement("span");
      nameEl.className = "cond-chip-name";
      nameEl.textContent = talent.name;
      chip.appendChild(nameEl);

      const removeBtn = document.createElement("button");
      removeBtn.className = "cond-chip-remove";
      removeBtn.textContent = "\u00d7";
      removeBtn.title = `Remove ${talent.name}`;
      removeBtn.addEventListener("click", () => {
        group.talents.splice(ti, 1);
        // Auto-remove empty groups
        if (group.talents.length === 0) {
          this.groups.splice(gi, 1);
        }
        this.render();
      });
      chip.appendChild(removeBtn);

      item.appendChild(chip);
      card.appendChild(item);
    }

    // "+ Add condition" button
    const addBtn = document.createElement("button");
    addBtn.className = "cond-add-condition";
    addBtn.textContent = "+ Add condition";
    addBtn.addEventListener("click", () => {
      this.targetGroupIndex = gi;
      this.render();
      requestAnimationFrame(() => {
        this.panel
          ?.querySelector<HTMLInputElement>(".cond-search-input")
          ?.focus();
      });
    });
    card.appendChild(addBtn);

    return card;
  }

  private buildSearchSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "cond-search-section";

    const label = document.createElement("label");
    label.className = "cond-search-label";
    label.textContent = "Add talent:";
    section.appendChild(label);

    const wrapper = document.createElement("div");
    wrapper.className = "cond-search-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cond-search-input";
    input.placeholder = "Type to search talents...";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    wrapper.appendChild(input);

    const dropdown = document.createElement("div");
    dropdown.className = "cond-search-results";
    wrapper.appendChild(dropdown);

    section.appendChild(wrapper);

    // Show hint when targeting a specific group
    if (this.targetGroupIndex !== null) {
      const hint = document.createElement("div");
      hint.className = "cond-search-hint";
      hint.textContent = `Adding to group ${this.targetGroupIndex + 1}`;
      section.appendChild(hint);
    }

    const candidates = this.getCandidates();

    const addTalent = (nodeId: number, name: string): void => {
      if (
        this.targetGroupIndex !== null &&
        this.targetGroupIndex < this.groups.length
      ) {
        this.groups[this.targetGroupIndex].talents.push({ nodeId, name });
      } else if (this.groups.length > 0) {
        // Add to last group
        this.groups[this.groups.length - 1].talents.push({ nodeId, name });
      } else {
        // Create first group
        this.groups.push({ talents: [{ nodeId, name }] });
      }
      this.targetGroupIndex = null;
      this.render();
    };

    const showResults = (filter: string): void => {
      dropdown.innerHTML = "";
      const query = filter.toLowerCase().trim();
      const matches = query
        ? candidates.filter((c) => c.name.toLowerCase().includes(query))
        : candidates.slice(0, 12);

      if (matches.length === 0) {
        const noMatch = document.createElement("div");
        noMatch.className = "cond-no-results";
        noMatch.textContent = query
          ? "No matching talents."
          : "No available talents.";
        dropdown.appendChild(noMatch);
        dropdown.classList.add("visible");
        return;
      }

      for (const match of matches.slice(0, 12)) {
        const item = document.createElement("button");
        item.className = "cond-result-item";
        item.textContent = match.name;
        item.addEventListener("click", () => {
          addTalent(match.nodeId, match.name);
        });
        dropdown.appendChild(item);
      }
      dropdown.classList.add("visible");
    };

    input.addEventListener("input", () => showResults(input.value));
    input.addEventListener("focus", () => showResults(input.value));
    input.addEventListener("blur", () => {
      // Delay so click on result item fires first
      setTimeout(() => dropdown.classList.remove("visible"), 150);
    });

    input.addEventListener("keydown", (e) => {
      const items =
        dropdown.querySelectorAll<HTMLButtonElement>(".cond-result-item");
      const active = dropdown.querySelector<HTMLButtonElement>(
        ".cond-result-item.active",
      );
      let index = active ? Array.from(items).indexOf(active) : -1;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        index =
          e.key === "ArrowDown"
            ? Math.min(index + 1, items.length - 1)
            : Math.max(index - 1, 0);
        items.forEach((el) => el.classList.remove("active"));
        items[index]?.classList.add("active");
        items[index]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active) active.click();
        else if (items.length > 0) items[0].click();
      } else if (e.key === "Escape") {
        dropdown.classList.remove("visible");
      }
    });

    return section;
  }

  private getCandidates(): TalentRef[] {
    if (!this.currentTree) return [];

    // Only exclude talents already in the target group (allow cross-group reuse)
    const excludeIds = new Set<number>();
    const gi = this.targetGroupIndex ?? this.groups.length - 1;
    if (gi >= 0 && gi < this.groups.length) {
      for (const t of this.groups[gi].talents) {
        excludeIds.add(t.nodeId);
      }
    }

    const spec = state.activeSpec;
    const trees: TalentTree[] = [this.currentTree];
    if (spec) {
      for (const tree of [spec.classTree, spec.specTree]) {
        if (tree !== this.currentTree) trees.push(tree);
      }
      if (state.activeHeroTree && state.activeHeroTree !== this.currentTree) {
        trees.push(state.activeHeroTree);
      }
    }

    const result: TalentRef[] = [];
    for (const tree of trees) {
      for (const node of tree.nodes.values()) {
        if (node.id === this.currentNode!.id) continue;
        if (excludeIds.has(node.id)) continue;
        result.push({ nodeId: node.id, name: node.name });
      }
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  private buildFooter(): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "cond-footer";

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-secondary cond-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      state.removeConstraint(this.currentNode!.id);
      this.close();
    });
    footer.appendChild(clearBtn);

    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    footer.appendChild(spacer);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary cond-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());
    footer.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary cond-btn";
    saveBtn.textContent = "Save";
    const hasTalents = this.groups.some((g) => g.talents.length > 0);
    saveBtn.disabled = !hasTalents;
    saveBtn.addEventListener("click", () => {
      this.save();
      this.close();
    });
    footer.appendChild(saveBtn);

    return footer;
  }

  // --- Persistence ---

  private talentLeaf(nodeId: number): BooleanExpr {
    return { op: "TALENT_SELECTED", nodeId };
  }

  private save(): void {
    if (!this.currentNode) return;

    const nonEmpty = this.groups.filter((g) => g.talents.length > 0);
    if (nonEmpty.length === 0) return;

    const outerOp: "OR" | "AND" = this.mode === "any" ? "OR" : "AND";
    const innerOp: "AND" | "OR" = this.mode === "any" ? "AND" : "OR";

    const groupToExpr = (g: RuleGroup): BooleanExpr => {
      if (g.talents.length === 1) return this.talentLeaf(g.talents[0].nodeId);
      return {
        op: innerOp,
        children: g.talents.map((t) => this.talentLeaf(t.nodeId)),
      };
    };

    let condition: BooleanExpr;
    if (nonEmpty.length === 1) {
      condition = groupToExpr(nonEmpty[0]);
    } else {
      condition = { op: outerOp, children: nonEmpty.map(groupToExpr) };
    }

    state.setConstraint({
      nodeId: this.currentNode.id,
      type: "conditional",
      condition,
    });
  }
}
