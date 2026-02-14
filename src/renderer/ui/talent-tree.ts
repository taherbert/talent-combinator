import { state } from "../state";
import { TalentNodeView } from "./talent-node";
import { ConditionEditor } from "./condition-editor";
import { addDismissHandler } from "./dismiss";
import type {
  TalentTree,
  TalentNode,
  NodeState,
  Constraint,
} from "../../shared/types";
import {
  NODE_SIZE,
  NODE_GAP_X,
  NODE_GAP_Y,
  TREE_PADDING,
} from "../../shared/constants";

const SVG_NS = "http://www.w3.org/2000/svg";

export class TalentTreeView {
  private container: HTMLElement;
  private nodeViews = new Map<number, TalentNodeView>();
  private connectors = new Map<string, SVGLineElement>();
  private tree: TalentTree | null = null;
  private conditionEditor: ConditionEditor;
  private tooltipEl: HTMLElement;
  private nodePopover: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.conditionEditor = new ConditionEditor();
    this.tooltipEl = document.getElementById("tooltip-container")!;

    state.subscribe((event) => {
      if (
        event.type === "constraint-changed" ||
        event.type === "constraint-removed"
      ) {
        this.updateNodeStates();
        this.updateConnectors();
      }
    });
  }

  render(tree: TalentTree): void {
    this.tree = tree;
    this.nodeViews.clear();
    this.connectors.clear();
    this.container.innerHTML = "";

    const section = document.createElement("div");
    section.className = "tree-section";

    // Header — just the tree name
    const header = document.createElement("div");
    header.className = "tree-section-header";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = tree.subTreeName ?? `${tree.type} talents`;
    header.appendChild(titleSpan);
    section.appendChild(header);

    const svgContainer = document.createElement("div");
    svgContainer.className = "tree-svg-container";

    // Compute layout bounds
    let minCol = Infinity,
      maxCol = -Infinity;
    let minRow = Infinity,
      maxRow = -Infinity;
    for (const node of tree.nodes.values()) {
      minCol = Math.min(minCol, node.col);
      maxCol = Math.max(maxCol, node.col);
      minRow = Math.min(minRow, node.row);
      maxRow = Math.max(maxRow, node.row);
    }

    const width = (maxCol - minCol) * NODE_GAP_X + NODE_SIZE + TREE_PADDING * 2;
    const height =
      (maxRow - minRow) * NODE_GAP_Y + NODE_SIZE + TREE_PADDING * 2 + 20;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Tier gates (visual separators only)
    const gateGroup = document.createElementNS(SVG_NS, "g");
    for (const gate of tree.gates) {
      const y =
        (gate.row - minRow) * NODE_GAP_Y +
        TREE_PADDING -
        NODE_GAP_Y / 2 +
        NODE_SIZE / 2;

      if (gate.row <= minRow) continue;

      const line = document.createElementNS(SVG_NS, "line");
      line.classList.add("tier-gate-line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(width));
      line.setAttribute("y2", String(y));
      gateGroup.appendChild(line);
    }

    // Connectors
    const connectorGroup = document.createElementNS(SVG_NS, "g");
    connectorGroup.classList.add("connectors");

    // Nodes
    const nodeGroup = document.createElementNS(SVG_NS, "g");
    nodeGroup.classList.add("nodes");

    for (const node of tree.nodes.values()) {
      const x = (node.col - minCol) * NODE_GAP_X + TREE_PADDING + NODE_SIZE / 2;
      const y = (node.row - minRow) * NODE_GAP_Y + TREE_PADDING + NODE_SIZE / 2;

      const view = new TalentNodeView(
        node,
        x,
        y,
        (n, e) => this.handleClick(n, e),
        (n, e) => this.handleContextMenu(n, e),
        (n, e, entering) => this.handleHover(n, e, entering),
      );

      this.nodeViews.set(node.id, view);
      nodeGroup.appendChild(view.group);
    }

    // Draw connector lines
    for (const node of tree.nodes.values()) {
      const fromView = this.nodeViews.get(node.id);
      if (!fromView) continue;

      for (const nextId of node.next) {
        const toView = this.nodeViews.get(nextId);
        if (!toView) continue;

        const line = document.createElementNS(SVG_NS, "line");
        line.classList.add("connector");
        line.setAttribute("x1", String(fromView.centerX));
        line.setAttribute("y1", String(fromView.centerY + NODE_SIZE / 2));
        line.setAttribute("x2", String(toView.centerX));
        line.setAttribute("y2", String(toView.centerY - NODE_SIZE / 2));

        const key = `${node.id}-${nextId}`;
        this.connectors.set(key, line);
        connectorGroup.appendChild(line);
      }
    }

    svg.appendChild(gateGroup);
    svg.appendChild(connectorGroup);
    svg.appendChild(nodeGroup);
    svgContainer.appendChild(svg);
    section.appendChild(svgContainer);
    this.container.appendChild(section);

    this.updateNodeStates();
    this.updateConnectors();
  }

  private handleClick(node: TalentNode, event: MouseEvent): void {
    // Choice nodes or multi-rank nodes get a popover
    if (node.type === "choice" || node.maxRanks > 1) {
      this.showNodePopover(node, event.clientX, event.clientY);
      return;
    }

    // Single-rank non-choice: simple cycle
    const currentType = state.constraints.get(node.id)?.type;
    if (!currentType) {
      state.setConstraint({ nodeId: node.id, type: "always" });
    } else if (currentType === "always") {
      state.setConstraint({ nodeId: node.id, type: "never" });
    } else {
      state.removeConstraint(node.id);
    }
  }

  private showNodePopover(node: TalentNode, x: number, y: number): void {
    this.closeNodePopover();

    const popover = document.createElement("div");
    popover.className = "node-popover";
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;

    const title = document.createElement("div");
    title.className = "node-popover-title";
    title.textContent = node.name;
    popover.appendChild(title);

    const current = state.constraints.get(node.id);

    const addBtn = (
      label: string,
      activeClass: string | null,
      onClick: () => void,
      extraClass?: string,
    ): void => {
      const btn = document.createElement("button");
      btn.className = `node-popover-btn${extraClass ? ` ${extraClass}` : ""}`;
      if (activeClass) btn.classList.add(activeClass);
      btn.textContent = label;
      btn.addEventListener("click", () => {
        onClick();
        this.closeNodePopover();
      });
      popover.appendChild(btn);
    };

    if (node.type === "choice") {
      for (let i = 0; i < node.entries.length; i++) {
        const entry = node.entries[i];
        const active =
          current?.type === "always" && current.entryIndex === i
            ? "active-always"
            : null;
        addBtn(`Always: ${entry.name || `Choice ${i + 1}`}`, active, () =>
          state.setConstraint({
            nodeId: node.id,
            type: "always",
            entryIndex: i,
          }),
        );
      }

      const eitherActive =
        current?.type === "always" && current.entryIndex == null
          ? "active-always"
          : null;
      addBtn("Always: Either choice", eitherActive, () =>
        state.setConstraint({ nodeId: node.id, type: "always" }),
      );
    }

    if (node.maxRanks > 1 && node.type !== "choice") {
      for (let r = 1; r <= node.maxRanks; r++) {
        const active =
          current?.type === "always" && current.exactRank === r
            ? "active-always"
            : null;
        addBtn(`Always at ${r}/${node.maxRanks}`, active, () =>
          state.setConstraint({
            nodeId: node.id,
            type: "always",
            exactRank: r,
          }),
        );
      }

      const anyActive =
        current?.type === "always" && current.exactRank == null
          ? "active-always"
          : null;
      addBtn("Always (any rank)", anyActive, () =>
        state.setConstraint({ nodeId: node.id, type: "always" }),
      );
    }

    addBtn("Never", current?.type === "never" ? "active-never" : null, () =>
      state.setConstraint({ nodeId: node.id, type: "never" }),
    );

    if (current) {
      addBtn("Clear", null, () => state.removeConstraint(node.id), "clear");
    }

    document.getElementById("dialog-container")!.appendChild(popover);
    this.nodePopover = popover;

    addDismissHandler(popover, () => this.closeNodePopover());
  }

  private closeNodePopover(): void {
    if (this.nodePopover) {
      this.nodePopover.remove();
      this.nodePopover = null;
    }
  }

  private handleContextMenu(node: TalentNode, event: MouseEvent): void {
    if (!this.tree) return;
    this.conditionEditor.open(node, this.tree, event.clientX, event.clientY);
  }

  private handleHover(
    node: TalentNode,
    event: MouseEvent,
    entering: boolean,
  ): void {
    if (!entering) {
      this.tooltipEl.innerHTML = "";
      return;
    }

    const tooltip = document.createElement("div");
    tooltip.className = "talent-tooltip";

    const name = document.createElement("div");
    name.className = "tooltip-name";
    name.textContent = node.name;
    tooltip.appendChild(name);

    if (node.type === "choice" && node.entries.length > 1) {
      for (const entry of node.entries) {
        const entryDiv = document.createElement("div");
        entryDiv.className = "tooltip-detail";
        entryDiv.textContent = `Choice: ${entry.name || `Entry ${entry.id}`}`;
        tooltip.appendChild(entryDiv);
      }
    }

    if (node.maxRanks > 1) {
      const rank = document.createElement("div");
      rank.className = "tooltip-detail";
      rank.textContent = `Max ranks: ${node.maxRanks}`;
      tooltip.appendChild(rank);
    }

    const constraint = state.constraints.get(node.id);
    if (constraint) {
      const statusDiv = document.createElement("div");
      statusDiv.className = "tooltip-status";
      statusDiv.textContent = this.constraintLabel(constraint, node);
      tooltip.appendChild(statusDiv);
    }

    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;

    this.tooltipEl.innerHTML = "";
    this.tooltipEl.appendChild(tooltip);
  }

  private constraintLabel(constraint: Constraint, node: TalentNode): string {
    if (constraint.type !== "always") return constraint.type;
    if (constraint.entryIndex != null) {
      const entryName =
        node.entries[constraint.entryIndex]?.name ||
        `Choice ${constraint.entryIndex + 1}`;
      return `always: ${entryName}`;
    }
    if (constraint.exactRank != null) {
      return `always at ${constraint.exactRank}/${node.maxRanks}`;
    }
    return "always";
  }

  private updateNodeStates(): void {
    if (!this.tree) return;

    for (const [nodeId, view] of this.nodeViews) {
      const constraint = state.constraints.get(nodeId);
      const nodeState: NodeState = constraint?.type ?? "available";
      view.setState(nodeState, constraint);
    }
  }

  private updateConnectors(): void {
    if (!this.tree) return;

    for (const [key, line] of this.connectors) {
      const [fromIdStr, toIdStr] = key.split("-");
      const fromConstraint = state.constraints.get(Number(fromIdStr));
      const toConstraint = state.constraints.get(Number(toIdStr));

      line.classList.remove("active", "possible", "impossible");

      const fromNever = fromConstraint?.type === "never";
      const toNever = toConstraint?.type === "never";
      const fromAlways = fromConstraint?.type === "always";

      if (fromNever || toNever) {
        // Either end excluded — path is impossible
        line.classList.add("impossible");
      } else if (fromAlways) {
        // Source included — path is possible
        line.classList.add("possible");
      } else if (fromConstraint || toConstraint) {
        line.classList.add("active");
      }
    }
  }
}
