import { state } from "../state";
import { TalentNodeView } from "./talent-node";
import { ConditionEditor } from "./condition-editor";
import type {
  TalentTree,
  TalentNode,
  Constraint,
  NodeState,
  ConstraintType,
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
  private tree: TalentTree | null = null;
  private conditionEditor: ConditionEditor;
  private tooltipEl: HTMLElement;

  constructor(
    container: HTMLElement,
    private treeType: "class" | "spec" | "hero",
  ) {
    this.container = container;
    this.conditionEditor = new ConditionEditor();
    this.tooltipEl = document.getElementById("tooltip-container")!;

    state.subscribe((event) => {
      if (
        event.type === "constraint-changed" ||
        event.type === "constraint-removed"
      ) {
        this.updateNodeStates();
      }
    });
  }

  render(tree: TalentTree): void {
    this.tree = tree;
    this.nodeViews.clear();
    this.container.innerHTML = "";

    const section = document.createElement("div");
    section.className = "tree-section";

    const header = document.createElement("div");
    header.className = "tree-section-header";
    header.innerHTML = `<span>${tree.type} talents</span><span>${tree.totalNodes} nodes</span>`;
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
      (maxRow - minRow) * NODE_GAP_Y + NODE_SIZE + TREE_PADDING * 2 + 20; // extra for name labels

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Draw connectors first (behind nodes)
    const connectorGroup = document.createElementNS(SVG_NS, "g");
    connectorGroup.classList.add("connectors");

    // Create node views
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

    // Draw connectors between nodes
    for (const node of tree.nodes.values()) {
      const fromView = this.nodeViews.get(node.id);
      if (!fromView) continue;

      for (const nextId of node.next) {
        const toView = this.nodeViews.get(nextId);
        if (!toView) continue;

        const path = document.createElementNS(SVG_NS, "path");
        path.classList.add("connector");

        const x1 = fromView.centerX;
        const y1 = fromView.centerY + NODE_SIZE / 2;
        const x2 = toView.centerX;
        const y2 = toView.centerY - NODE_SIZE / 2;
        const cy = (y1 + y2) / 2;

        path.setAttribute(
          "d",
          `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`,
        );
        connectorGroup.appendChild(path);
      }
    }

    // Draw tier gates
    const gateGroup = document.createElementNS(SVG_NS, "g");
    for (const gate of tree.gates) {
      const y =
        (gate.row - minRow) * NODE_GAP_Y +
        TREE_PADDING -
        NODE_GAP_Y / 2 +
        NODE_SIZE / 2;
      const g = document.createElementNS(SVG_NS, "g");
      g.classList.add("tier-gate");

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(width));
      line.setAttribute("y2", String(y));
      g.appendChild(line);

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String(width / 2));
      text.setAttribute("y", String(y - 4));
      text.textContent = `${gate.requiredPoints} points required`;
      g.appendChild(text);

      gateGroup.appendChild(g);
    }

    svg.appendChild(gateGroup);
    svg.appendChild(connectorGroup);
    svg.appendChild(nodeGroup);
    svgContainer.appendChild(svg);
    section.appendChild(svgContainer);
    this.container.appendChild(section);

    this.updateNodeStates();
  }

  private handleClick(node: TalentNode, _event: MouseEvent): void {
    const constraint = state.constraints.get(node.id);
    const currentType = constraint?.type;

    // Cycle: unselected → always → never → unselected
    let newType: ConstraintType | null;
    if (!currentType) {
      newType = "always";
    } else if (currentType === "always") {
      newType = "never";
    } else {
      newType = null;
    }

    if (newType) {
      state.setConstraint({
        nodeId: node.id,
        type: newType,
      });
    } else {
      state.removeConstraint(node.id);
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
        entryDiv.className = "tooltip-rank";
        entryDiv.textContent = `Choice: ${entry.name || `Entry ${entry.id}`}`;
        tooltip.appendChild(entryDiv);
      }
    }

    const rank = document.createElement("div");
    rank.className = "tooltip-rank";
    rank.textContent = `Max ranks: ${node.maxRanks}`;
    tooltip.appendChild(rank);

    if (node.reqPoints > 0) {
      const req = document.createElement("div");
      req.className = "tooltip-rank";
      req.textContent = `Requires: ${node.reqPoints} points in tree`;
      tooltip.appendChild(req);
    }

    const constraint = state.constraints.get(node.id);
    if (constraint) {
      const cDiv = document.createElement("div");
      cDiv.className = "tooltip-rank";
      cDiv.textContent = `Status: ${constraint.type}`;
      tooltip.appendChild(cDiv);
    }

    // Position tooltip near mouse
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;

    this.tooltipEl.innerHTML = "";
    this.tooltipEl.appendChild(tooltip);
  }

  private updateNodeStates(): void {
    if (!this.tree) return;

    for (const [nodeId, view] of this.nodeViews) {
      const constraint = state.constraints.get(nodeId);
      let nodeState: NodeState;

      if (constraint) {
        nodeState = constraint.type;
      } else {
        nodeState = "available";
      }

      view.setState(nodeState);
    }
  }

  clear(): void {
    this.container.innerHTML = "";
    this.nodeViews.clear();
    this.tree = null;
  }
}
