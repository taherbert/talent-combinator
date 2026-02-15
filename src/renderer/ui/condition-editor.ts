import { state } from "../state";
import { addDismissHandler } from "./dismiss";
import type { TalentNode, TalentTree, BooleanExpr } from "../../shared/types";

interface Clause {
  talents: { nodeId: number; name: string }[];
  groupOp: "AND" | "OR";
}

export class ConditionEditor {
  private panel: HTMLElement | null = null;
  private currentNode: TalentNode | null = null;
  private currentTree: TalentTree | null = null;
  private clauses: Clause[] = [];
  private operators: ("AND" | "OR")[] = [];
  private dragSourceIndex = -1;

  open(
    node: TalentNode,
    tree: TalentTree,
    anchorX: number,
    anchorY: number,
  ): void {
    this.close();
    this.currentNode = node;
    this.currentTree = tree;

    const existing = state.constraints.get(node.id);
    if (existing?.type === "conditional" && existing.condition) {
      this.loadCondition(existing.condition);
    } else {
      this.clauses = [];
      this.operators = [];
    }

    this.panel = document.createElement("div");
    this.panel.className = "cond-panel";
    this.panel.style.left = `${anchorX}px`;
    this.panel.style.top = `${anchorY}px`;

    this.render();
    document.getElementById("dialog-container")!.appendChild(this.panel);

    requestAnimationFrame(() => this.clampPosition());

    addDismissHandler(this.panel, () => this.close());
  }

  close(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }

  private clampPosition(): void {
    if (!this.panel) return;
    const rect = this.panel.getBoundingClientRect();
    const margin = 8;
    let left = rect.left;
    let top = rect.top;
    if (rect.right > window.innerWidth - margin) {
      left = window.innerWidth - margin - rect.width;
    }
    if (rect.bottom > window.innerHeight - margin) {
      top = window.innerHeight - margin - rect.height;
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }

  // --- Load / Save helpers ---

  private isLeafOrGroup(expr: BooleanExpr): boolean {
    if (expr.op === "TALENT_SELECTED") return true;
    return expr.children.every((c) => c.op === "TALENT_SELECTED");
  }

  private exprToClause(expr: BooleanExpr): Clause {
    if (expr.op === "TALENT_SELECTED") {
      return {
        talents: [
          { nodeId: expr.nodeId, name: this.findNodeName(expr.nodeId) },
        ],
        groupOp: "AND",
      };
    }
    return {
      talents: expr.children
        .filter(
          (c): c is BooleanExpr & { op: "TALENT_SELECTED" } =>
            c.op === "TALENT_SELECTED",
        )
        .map((c) => ({
          nodeId: c.nodeId,
          name: this.findNodeName(c.nodeId),
        })),
      groupOp: expr.op,
    };
  }

  private loadCondition(expr: BooleanExpr): void {
    this.clauses = [];
    this.operators = [];

    if (expr.op === "TALENT_SELECTED") {
      this.clauses.push(this.exprToClause(expr));
      return;
    }

    if (expr.op === "AND") {
      for (const child of expr.children) {
        if (this.clauses.length > 0) this.operators.push("AND");
        this.clauses.push(this.exprToClause(child));
      }
      return;
    }

    // OR: flatten AND children whose children are all leaf/group
    for (const child of expr.children) {
      if (
        child.op === "AND" &&
        child.children.every((gc) => this.isLeafOrGroup(gc))
      ) {
        for (let j = 0; j < child.children.length; j++) {
          if (this.clauses.length > 0) {
            this.operators.push(j === 0 ? "OR" : "AND");
          }
          this.clauses.push(this.exprToClause(child.children[j]));
        }
      } else if (this.isLeafOrGroup(child)) {
        if (this.clauses.length > 0) this.operators.push("OR");
        this.clauses.push(this.exprToClause(child));
      } else {
        if (this.clauses.length > 0) this.operators.push("OR");
        this.clauses.push(this.exprToClause(child));
      }
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

  // --- Rendering ---

  private render(): void {
    if (!this.panel || !this.currentNode) return;
    this.panel.innerHTML = "";

    this.panel.appendChild(this.buildHeader());
    this.panel.appendChild(this.buildBody());
    this.panel.appendChild(this.buildFooter());
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

    const sentence = document.createElement("div");
    sentence.className = "cond-sentence";
    sentence.textContent = "Include this talent when:";
    body.appendChild(sentence);

    if (this.clauses.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cond-empty";
      empty.textContent =
        "No conditions set. Search for a talent below to add one.";
      body.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "cond-clause-list";

      for (let ci = 0; ci < this.clauses.length; ci++) {
        if (ci > 0) {
          list.appendChild(this.buildOpSeparator(ci - 1));
        }
        list.appendChild(this.buildClauseRow(ci));
      }

      body.appendChild(list);
    }

    body.appendChild(this.buildSearchSection());

    return body;
  }

  private buildOpSeparator(operatorIndex: number): HTMLElement {
    const op = this.operators[operatorIndex];
    const sep = document.createElement("div");
    sep.className = "cond-op-sep";

    const btn = document.createElement("button");
    btn.className = `cond-op-btn ${op.toLowerCase()}`;
    btn.textContent = op;
    btn.title = `Click to switch to ${op === "AND" ? "OR" : "AND"}`;
    btn.addEventListener("click", () => {
      this.operators[operatorIndex] = op === "AND" ? "OR" : "AND";
      this.render();
    });
    sep.appendChild(btn);

    return sep;
  }

  private buildClauseRow(clauseIndex: number): HTMLElement {
    const clause = this.clauses[clauseIndex];
    const row = document.createElement("div");
    row.className = "cond-clause";
    row.draggable = true;
    row.dataset.clauseIndex = String(clauseIndex);

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "cond-drag-handle";
    handle.textContent = "\u2807";
    row.appendChild(handle);

    const isGroup = clause.talents.length > 1;

    if (isGroup) {
      row.classList.add("cond-clause-group");
    }

    for (let ti = 0; ti < clause.talents.length; ti++) {
      if (ti > 0) {
        const innerOpBtn = document.createElement("button");
        innerOpBtn.className = `cond-inner-op ${clause.groupOp.toLowerCase()}`;
        innerOpBtn.textContent = clause.groupOp;
        innerOpBtn.title = `Click to switch to ${clause.groupOp === "AND" ? "OR" : "AND"}`;
        innerOpBtn.addEventListener("click", () => {
          clause.groupOp = clause.groupOp === "AND" ? "OR" : "AND";
          this.render();
        });
        row.appendChild(innerOpBtn);
      }

      const talent = clause.talents[ti];
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
        clause.talents.splice(ti, 1);
        if (clause.talents.length === 0) {
          this.clauses.splice(clauseIndex, 1);
          if (this.operators.length > 0) {
            const opIdx = clauseIndex === 0 ? 0 : clauseIndex - 1;
            this.operators.splice(opIdx, 1);
          }
        }
        this.render();
      });
      chip.appendChild(removeBtn);

      row.appendChild(chip);
    }

    if (isGroup) {
      const addAlt = document.createElement("button");
      addAlt.className = "cond-add-alt";
      addAlt.textContent = `+ ${clause.groupOp}`;
      addAlt.title = `Add ${clause.groupOp} alternative to this group`;
      addAlt.addEventListener("click", () => {
        this.showInlineSearch(addAlt, (nodeId, name) => {
          clause.talents.push({ nodeId, name });
          this.render();
        });
      });
      row.appendChild(addAlt);
    }

    // --- Drag-and-drop events ---

    row.addEventListener("dragstart", (e) => {
      this.dragSourceIndex = clauseIndex;
      row.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", String(clauseIndex));
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      this.dragSourceIndex = -1;
      this.panel
        ?.querySelectorAll(".drag-over-top, .drag-over-bottom")
        .forEach((el) => {
          el.classList.remove("drag-over-top", "drag-over-bottom");
        });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";

      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      row.classList.remove("drag-over-top", "drag-over-bottom");
      if (e.clientY < midY) {
        row.classList.add("drag-over-top");
      } else {
        row.classList.add("drag-over-bottom");
      }
    });

    row.addEventListener("dragleave", (e) => {
      if (!row.contains(e.relatedTarget as Node)) {
        row.classList.remove("drag-over-top", "drag-over-bottom");
      }
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over-top", "drag-over-bottom");

      const sourceIndex = this.dragSourceIndex;
      if (sourceIndex < 0 || sourceIndex === clauseIndex) return;

      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      let targetIndex = e.clientY < midY ? clauseIndex : clauseIndex + 1;

      if (sourceIndex < targetIndex) targetIndex--;

      if (sourceIndex !== targetIndex) {
        const [moved] = this.clauses.splice(sourceIndex, 1);
        this.clauses.splice(targetIndex, 0, moved);
        this.render();
      }
    });

    return row;
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

    if (this.clauses.length > 0) {
      const hint = document.createElement("div");
      hint.className = "cond-search-hint";
      hint.textContent =
        "Shift+click to group with last condition. Click operators to toggle AND/OR.";
      section.appendChild(hint);
    }

    const candidates = this.getCandidates();

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
        item.addEventListener("click", (e) => {
          if (e.shiftKey && this.clauses.length > 0) {
            this.clauses[this.clauses.length - 1].talents.push({
              nodeId: match.nodeId,
              name: match.name,
            });
          } else {
            if (this.clauses.length > 0) this.operators.push("AND");
            this.clauses.push({
              talents: [{ nodeId: match.nodeId, name: match.name }],
              groupOp: "AND",
            });
          }
          this.render();
        });
        dropdown.appendChild(item);
      }
      dropdown.classList.add("visible");
    };

    input.addEventListener("input", () => showResults(input.value));
    input.addEventListener("focus", () => showResults(input.value));

    input.addEventListener("keydown", (e) => {
      const items =
        dropdown.querySelectorAll<HTMLButtonElement>(".cond-result-item");
      const active = dropdown.querySelector<HTMLButtonElement>(
        ".cond-result-item.active",
      );
      let index = active ? Array.from(items).indexOf(active) : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        index = Math.min(index + 1, items.length - 1);
        items.forEach((el) => el.classList.remove("active"));
        items[index]?.classList.add("active");
        items[index]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        index = Math.max(index - 1, 0);
        items.forEach((el) => el.classList.remove("active"));
        items[index]?.classList.add("active");
        items[index]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active) {
          active.click();
        } else if (items.length > 0) {
          items[0].click();
        }
      } else if (e.key === "Escape") {
        dropdown.classList.remove("visible");
      }
    });

    return section;
  }

  private showInlineSearch(
    anchor: HTMLElement,
    onSelect: (nodeId: number, name: string) => void,
  ): void {
    this.panel?.querySelector(".cond-inline-search")?.remove();

    const container = document.createElement("div");
    container.className = "cond-inline-search";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cond-search-input";
    input.placeholder = "Search...";
    container.appendChild(input);

    const results = document.createElement("div");
    results.className = "cond-search-results visible";
    container.appendChild(results);

    const candidates = this.getCandidates();

    const show = (filter: string): void => {
      results.innerHTML = "";
      const query = filter.toLowerCase().trim();
      const matches = query
        ? candidates.filter((c) => c.name.toLowerCase().includes(query))
        : candidates.slice(0, 8);

      for (const match of matches.slice(0, 8)) {
        const item = document.createElement("button");
        item.className = "cond-result-item";
        item.textContent = match.name;
        item.addEventListener("click", () => {
          onSelect(match.nodeId, match.name);
          container.remove();
        });
        results.appendChild(item);
      }
    };

    input.addEventListener("input", () => show(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") container.remove();
      if (e.key === "Enter") {
        const first =
          results.querySelector<HTMLButtonElement>(".cond-result-item");
        if (first) first.click();
      }
    });

    const clauseRow = anchor.closest(".cond-clause");
    if (clauseRow?.parentElement) {
      clauseRow.parentElement.insertBefore(container, clauseRow.nextSibling);
    } else {
      this.panel?.querySelector(".cond-body")?.appendChild(container);
    }

    show("");
    input.focus();
  }

  private getCandidates(): { nodeId: number; name: string }[] {
    if (!this.currentTree) return [];

    const usedIds = new Set(
      this.clauses.flatMap((c) => c.talents.map((t) => t.nodeId)),
    );
    const result: { nodeId: number; name: string }[] = [];

    for (const node of this.currentTree.nodes.values()) {
      if (node.id === this.currentNode!.id) continue;
      if (usedIds.has(node.id)) continue;
      result.push({ nodeId: node.id, name: node.name });
    }

    const spec = state.activeSpec;
    if (spec) {
      const allTrees = [spec.classTree, spec.specTree];
      if (state.activeHeroTree) allTrees.push(state.activeHeroTree);

      for (const tree of allTrees) {
        if (tree === this.currentTree) continue;
        for (const node of tree.nodes.values()) {
          if (node.id === this.currentNode!.id) continue;
          if (usedIds.has(node.id)) continue;
          result.push({ nodeId: node.id, name: node.name });
        }
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
    saveBtn.disabled = this.clauses.length === 0;
    saveBtn.addEventListener("click", () => {
      this.save();
      this.close();
    });
    footer.appendChild(saveBtn);

    return footer;
  }

  // --- Persistence ---

  private save(): void {
    if (!this.currentNode || this.clauses.length === 0) return;

    const clauseExprs: BooleanExpr[] = this.clauses.map((clause) => {
      if (clause.talents.length === 1) {
        return {
          op: "TALENT_SELECTED" as const,
          nodeId: clause.talents[0].nodeId,
        };
      }
      return {
        op: clause.groupOp,
        children: clause.talents.map((t) => ({
          op: "TALENT_SELECTED" as const,
          nodeId: t.nodeId,
        })),
      };
    });

    let condition: BooleanExpr;

    if (clauseExprs.length === 1) {
      condition = clauseExprs[0];
    } else if (this.operators.every((op) => op === this.operators[0])) {
      condition = { op: this.operators[0], children: clauseExprs };
    } else {
      // AND binds tighter than OR: group consecutive AND-joined clauses
      const groups: BooleanExpr[][] = [[clauseExprs[0]]];
      for (let i = 0; i < this.operators.length; i++) {
        if (this.operators[i] === "OR") {
          groups.push([clauseExprs[i + 1]]);
        } else {
          groups[groups.length - 1].push(clauseExprs[i + 1]);
        }
      }

      const orChildren: BooleanExpr[] = groups.map((group) =>
        group.length === 1 ? group[0] : { op: "AND" as const, children: group },
      );

      condition =
        orChildren.length === 1
          ? orChildren[0]
          : { op: "OR" as const, children: orChildren };
    }

    state.setConstraint({
      nodeId: this.currentNode.id,
      type: "conditional",
      condition,
    });
  }
}
