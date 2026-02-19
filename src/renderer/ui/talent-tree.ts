import { state } from "../state";
import { TalentNodeView } from "./talent-node";
import { ConditionEditor } from "./condition-editor";
import { addDismissHandler } from "./dismiss";
import { clampToViewport } from "./clamp";
import type {
  TalentTree,
  TalentNode,
  NodeState,
  Constraint,
  SpellTooltip,
} from "../../shared/types";
import {
  NODE_SIZE,
  NODE_GAP_X,
  NODE_GAP_Y,
  TREE_PADDING,
} from "../../shared/constants";
import { computeReachable } from "../../shared/build-counter";

declare const electronAPI: import("../../shared/types").ElectronAPI;

const SVG_NS = "http://www.w3.org/2000/svg";
const descriptionCache = new Map<number, SpellTooltip | null>();

export class TalentTreeView {
  private container: HTMLElement;
  private nodeViews = new Map<number, TalentNodeView>();
  private connectors = new Map<string, SVGLineElement>();
  private tree: TalentTree | null = null;
  private conditionEditor: ConditionEditor;
  private tooltipEl: HTMLElement;
  private summaryEl: HTMLElement | null = null;
  private rankPopover: HTMLElement | null = null;
  private hoveredNode: TalentNode | null = null;
  private lastHoverEvent: MouseEvent | null = null;

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
        this.updateConstraintSummary();
        if (this.hoveredNode && this.lastHoverEvent) {
          this.renderTooltip(this.hoveredNode, this.lastHoverEvent);
        }
      }
      if (
        event.type === "count-updated" ||
        event.type === "validation-changed"
      ) {
        this.updateNodeStates();
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

    // Header (hidden by CSS, kept for structure)
    const header = document.createElement("div");
    header.className = "tree-section-header";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = tree.subTreeName ?? `${tree.type} talents`;
    header.appendChild(titleSpan);
    section.appendChild(header);

    // Constraint summary bar
    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "tree-constraint-summary";
    section.appendChild(this.summaryEl);

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

    // Tier gate lines in SVG
    const gateGroup = document.createElementNS(SVG_NS, "g");
    // Gate labels as HTML, outside tree-section (sibling column)
    const gateLabelsEl = document.createElement("div");
    gateLabelsEl.className = "tree-gate-labels";

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

      const label = document.createElement("span");
      label.className = "tier-gate-label";
      label.textContent = `${gate.requiredPoints} pts`;
      label.style.top = `${y}px`;
      gateLabelsEl.appendChild(label);
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

    if (gateLabelsEl.children.length > 0) {
      this.container.appendChild(gateLabelsEl);
    }
    this.container.appendChild(section);

    this.updateNodeStates();
    this.updateConnectors();
    this.updateConstraintSummary();
  }

  private handleClick(node: TalentNode, event: MouseEvent): void {
    // During validation error: any node with a constraint can be cleared
    if (state.hasValidationError) {
      if (state.constraints.has(node.id)) {
        state.removeConstraint(node.id);
      }
      return;
    }

    if (node.freeNode) return;
    const isHeroNonChoice =
      this.tree?.type === "hero" && !(node.type === "choice" && !node.isApex);
    if (isHeroNonChoice) return;

    // Multi-rank or choice nodes get a popover
    const hasDistinctChoices =
      node.type === "choice" &&
      !node.isApex &&
      new Set(node.entries.map((e) => e.name || e.id)).size > 1;

    if (node.maxRanks > 1 || hasDistinctChoices) {
      this.showNodePopover(node, event.clientX, event.clientY);
      return;
    }

    // Simple single-rank nodes: click-to-cycle
    const current = state.constraints.get(node.id);
    if (!current) {
      state.setConstraint({ nodeId: node.id, type: "always" });
    } else if (current.type === "always" && state.isImplied(node.id)) {
      // Promote implied to explicit always
      state.setConstraint({ nodeId: node.id, type: "always" });
    } else if (current.type === "always") {
      state.setConstraint({ nodeId: node.id, type: "never" });
    } else {
      state.removeConstraint(node.id);
    }
  }

  private showNodePopover(node: TalentNode, x: number, y: number): void {
    this.closeRankPopover();
    this.hoveredNode = null;
    this.tooltipEl.innerHTML = "";

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
        this.closeRankPopover();
      });
      popover.appendChild(btn);
    };

    if (state.hasValidationError) {
      // Only allow clearing during validation error
      if (current) {
        addBtn("Clear", null, () => state.removeConstraint(node.id), "clear");
      }
    } else {
      const hasDistinctChoices =
        node.type === "choice" &&
        !node.isApex &&
        new Set(node.entries.map((e) => e.name || e.id)).size > 1;

      if (hasDistinctChoices) {
        // Choice node: one button per entry
        for (let i = 0; i < node.entries.length; i++) {
          const entry = node.entries[i];
          const entryName = entry.name || `Choice ${i + 1}`;
          const active =
            current?.type === "always" && current.entryIndex === i
              ? "active-always"
              : null;
          addBtn(`Always: ${entryName}`, active, () =>
            state.setConstraint({
              nodeId: node.id,
              type: "always",
              entryIndex: i,
            }),
          );
        }

        const anyActive =
          current?.type === "always" && current.entryIndex == null
            ? "active-always"
            : null;
        addBtn("Always (either)", anyActive, () =>
          state.setConstraint({ nodeId: node.id, type: "always" }),
        );
      } else {
        // Multi-rank node: one button per rank level
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
    }

    document.getElementById("dialog-container")!.appendChild(popover);
    this.rankPopover = popover;

    requestAnimationFrame(() => clampToViewport(popover));

    addDismissHandler(popover, () => this.closeRankPopover());
  }

  private closeRankPopover(): void {
    if (this.rankPopover) {
      this.rankPopover.remove();
      this.rankPopover = null;
    }
  }

  private handleContextMenu(node: TalentNode, event: MouseEvent): void {
    if (!this.tree || state.hasValidationError) return;
    this.conditionEditor.open(node, this.tree);
  }

  private handleHover(
    node: TalentNode,
    event: MouseEvent,
    entering: boolean,
  ): void {
    if (!entering) {
      this.hoveredNode = null;
      this.lastHoverEvent = null;
      this.tooltipEl.innerHTML = "";
      return;
    }

    this.hoveredNode = node;
    this.lastHoverEvent = event;
    this.renderTooltip(node, event);
  }

  private renderTooltip(node: TalentNode, event: MouseEvent): void {
    const tooltip = document.createElement("div");
    tooltip.className = "talent-tooltip";

    const name = document.createElement("div");
    name.className = "tooltip-name";
    name.textContent = node.name;
    tooltip.appendChild(name);

    // Spell description — show for each entry on choice nodes, or for the node's primary entry
    const constraint = state.constraints.get(node.id);
    const entries =
      node.type === "choice" && node.entries.length > 1
        ? node.entries
        : node.entries.slice(0, 1);

    for (const entry of entries) {
      if (node.type === "choice" && node.entries.length > 1) {
        const label = document.createElement("div");
        label.className = "tooltip-entry-name";
        label.textContent = entry.name || `Entry ${entry.id}`;
        tooltip.appendChild(label);
      }

      if (entry.spellId) {
        const cached = descriptionCache.get(entry.spellId);
        if (cached !== undefined) {
          if (cached) {
            if (cached.meta) {
              const metaEl = document.createElement("div");
              metaEl.className = "tooltip-meta";
              metaEl.textContent = cached.meta;
              tooltip.appendChild(metaEl);
            }
            const descEl = document.createElement("div");
            descEl.className = "tooltip-desc";
            descEl.textContent = cached.desc;
            tooltip.appendChild(descEl);
          }
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "tooltip-desc";
          placeholder.textContent = "Loading...";
          tooltip.appendChild(placeholder);
          this.fetchDescription(entry.spellId, placeholder, tooltip, event);
        }
      }
    }

    if (node.maxRanks > 1) {
      const rank = document.createElement("div");
      rank.className = "tooltip-detail";
      rank.textContent = `Max ranks: ${node.maxRanks}`;
      tooltip.appendChild(rank);
    }

    if (constraint) {
      const statusDiv = document.createElement("div");
      statusDiv.className = `tooltip-status status-${constraint.type}`;
      statusDiv.textContent = this.constraintLabel(constraint, node);
      tooltip.appendChild(statusDiv);
    }

    this.tooltipEl.innerHTML = "";
    this.tooltipEl.appendChild(tooltip);

    this.positionTooltip(tooltip, event);
  }

  private fetchDescription(
    spellId: number,
    placeholder: HTMLElement,
    tooltip: HTMLElement,
    event: MouseEvent,
  ): void {
    electronAPI.fetchSpellTooltip(spellId).then((result) => {
      descriptionCache.set(spellId, result);
      if (this.hoveredNode && placeholder.isConnected) {
        if (result) {
          if (result.meta) {
            const metaEl = document.createElement("div");
            metaEl.className = "tooltip-meta";
            metaEl.textContent = result.meta;
            placeholder.before(metaEl);
          }
          placeholder.textContent = result.desc;
        } else {
          placeholder.remove();
        }
        this.positionTooltip(tooltip, event);
      }
    });
  }

  private positionTooltip(tooltip: HTMLElement, event: MouseEvent): void {
    const pad = 12;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    requestAnimationFrame(() => {
      const rect = tooltip.getBoundingClientRect();
      // Flip to opposite side of cursor if overflowing
      if (rect.bottom > window.innerHeight) {
        top = event.clientY - rect.height - pad;
      }
      if (rect.right > window.innerWidth) {
        left = event.clientX - rect.width - pad;
      }
      // Final clamp to ensure it stays in viewport
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width;
      }
      if (top + rect.height > window.innerHeight) {
        top = window.innerHeight - rect.height;
      }
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
  }

  private constraintLabel(constraint: Constraint, node: TalentNode): string {
    if (constraint.type === "never") return "never";
    if (constraint.type === "conditional") return "conditional";
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
      const node = this.tree.nodes.get(nodeId)!;
      const constraint = state.constraints.get(nodeId);
      const isHeroNonChoice =
        this.tree.type === "hero" && !(node.type === "choice" && !node.isApex);
      let nodeState: NodeState;
      if (node.freeNode && !constraint) {
        nodeState = "free";
      } else if (isHeroNonChoice && constraint?.type === "always") {
        nodeState = "free";
      } else if (constraint?.type === "always" && state.isImplied(nodeId)) {
        nodeState = "implied";
      } else {
        nodeState = constraint?.type ?? "available";
      }
      const hasError = state.triggerNodeId === nodeId;
      view.setState(nodeState, constraint, hasError);
    }
  }

  private updateConnectors(): void {
    if (!this.tree) return;

    const neverNodes = new Set<number>();
    for (const [nodeId, constraint] of state.constraints) {
      if (constraint.type === "never") neverNodes.add(nodeId);
    }
    const reachable = computeReachable(this.tree, neverNodes);

    for (const [key, line] of this.connectors) {
      const [fromIdStr, toIdStr] = key.split("-");
      const fromId = Number(fromIdStr);
      const toId = Number(toIdStr);
      const fromConstraint = state.constraints.get(fromId);
      const toConstraint = state.constraints.get(toId);

      line.classList.remove("active", "possible", "impossible");

      const fromReachable = reachable.has(fromId);
      const toReachable = reachable.has(toId);

      if (!fromReachable || !toReachable) {
        line.classList.add("impossible");
      } else if (fromConstraint?.type === "always") {
        line.classList.add("possible");
      } else if (fromConstraint || toConstraint) {
        line.classList.add("active");
      }
    }
  }

  private updateConstraintSummary(): void {
    if (!this.tree || !this.summaryEl) return;

    let always = 0;
    let never = 0;
    let conditional = 0;

    for (const node of this.tree.nodes.values()) {
      const constraint = state.constraints.get(node.id);
      if (!constraint) continue;
      const isHeroNonChoice =
        this.tree!.type === "hero" && !(node.type === "choice" && !node.isApex);
      if (isHeroNonChoice && constraint.type === "always") continue;
      const cost = node.freeNode ? 0 : (constraint.exactRank ?? node.maxRanks);
      if (constraint.type === "always") always += cost;
      else if (constraint.type === "never") never += cost;
      else if (constraint.type === "conditional") conditional += cost;
    }

    const parts: string[] = [];
    if (always > 0) parts.push(`${always} pts required`);
    if (never > 0) parts.push(`${never} pts blocked`);
    if (conditional > 0) parts.push(`${conditional} pts conditional`);

    this.summaryEl.textContent = parts.length > 0 ? parts.join(", ") : "";
  }
}
