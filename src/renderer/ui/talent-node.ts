import type { TalentNode, NodeState, Constraint } from "../../shared/types";
import { NODE_SIZE, ICON_CDN_URL } from "../../shared/constants";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const ICON_INSET = 3;
const PLACEHOLDER_INSET = 4;

export class TalentNodeView {
  readonly group: SVGGElement;
  private conditionBadge: SVGTextElement;
  private rankBadge: SVGGElement | null = null;
  private rankText: SVGTextElement | null = null;

  constructor(
    readonly node: TalentNode,
    private x: number,
    private y: number,
    private onClick: (node: TalentNode, event: MouseEvent) => void,
    private onContextMenu: (node: TalentNode, event: MouseEvent) => void,
    private onHover: (
      node: TalentNode,
      event: MouseEvent,
      entering: boolean,
    ) => void,
  ) {
    this.group = document.createElementNS(SVG_NS, "g");
    this.group.classList.add("talent-node");
    this.group.setAttribute("transform", `translate(${x}, ${y})`);

    const bgShape =
      node.type === "choice" ? this.createOctagon() : this.createRoundedRect();
    bgShape.classList.add("node-bg");
    this.group.appendChild(bgShape);

    // Talent icon
    const iconName = node.icon || node.entries[0]?.icon;
    if (iconName) {
      const clipId = `clip-${node.id}`;
      const defs = document.createElementNS(SVG_NS, "defs");
      const clipPath = document.createElementNS(SVG_NS, "clipPath");
      clipPath.setAttribute("id", clipId);
      const iconOffset = -NODE_SIZE / 2 + ICON_INSET;
      const iconSize = NODE_SIZE - ICON_INSET * 2;

      const clipRect = document.createElementNS(SVG_NS, "rect");
      clipRect.setAttribute("x", String(iconOffset));
      clipRect.setAttribute("y", String(iconOffset));
      clipRect.setAttribute("width", String(iconSize));
      clipRect.setAttribute("height", String(iconSize));
      clipRect.setAttribute("rx", "5");
      clipPath.appendChild(clipRect);
      defs.appendChild(clipPath);
      this.group.appendChild(defs);

      const img = document.createElementNS(SVG_NS, "image");
      img.setAttributeNS(XLINK_NS, "href", `${ICON_CDN_URL}/${iconName}.jpg`);
      img.setAttribute("x", String(iconOffset));
      img.setAttribute("y", String(iconOffset));
      img.setAttribute("width", String(iconSize));
      img.setAttribute("height", String(iconSize));
      img.setAttribute("clip-path", `url(#${clipId})`);
      img.classList.add("node-icon");
      img.addEventListener("error", () => {
        img.remove();
        this.addPlaceholderIcon();
      });
      this.group.appendChild(img);
    } else {
      this.addPlaceholderIcon();
    }

    // Multi-rank badge (prominent pill)
    if (node.maxRanks > 1) {
      this.rankBadge = document.createElementNS(SVG_NS, "g");
      this.rankBadge.classList.add("rank-badge-group");

      const pillW = 24;
      const pillH = 14;
      const pillX = NODE_SIZE / 2 - pillW + 4;
      const pillY = NODE_SIZE / 2 - pillH + 2;

      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("x", String(pillX));
      bg.setAttribute("y", String(pillY));
      bg.setAttribute("width", String(pillW));
      bg.setAttribute("height", String(pillH));
      bg.setAttribute("rx", "4");
      bg.classList.add("rank-pill-bg");
      this.rankBadge.appendChild(bg);

      this.rankText = document.createElementNS(SVG_NS, "text");
      this.rankText.classList.add("rank-pill-text");
      this.rankText.setAttribute("x", String(pillX + pillW / 2));
      this.rankText.setAttribute("y", String(pillY + pillH / 2 + 1));
      this.rankText.textContent = `${node.maxRanks}`;
      this.rankBadge.appendChild(this.rankText);

      this.group.appendChild(this.rankBadge);
    }

    // Condition badge ("?")
    this.conditionBadge = document.createElementNS(SVG_NS, "text");
    this.conditionBadge.classList.add("condition-badge");
    this.conditionBadge.setAttribute("x", "0");
    this.conditionBadge.setAttribute("y", String(-NODE_SIZE / 2 - 4));
    this.conditionBadge.textContent = "?";
    this.conditionBadge.style.display = "none";
    this.group.appendChild(this.conditionBadge);

    // Name label below node
    const displayName = node.name || "Unknown";
    const nameText = document.createElementNS(SVG_NS, "text");
    nameText.classList.add("node-name");
    nameText.setAttribute("x", "0");
    nameText.setAttribute("y", String(NODE_SIZE / 2 + 12));
    nameText.textContent =
      displayName.length > 12
        ? displayName.slice(0, 11) + "\u2026"
        : displayName;
    this.group.appendChild(nameText);

    // Events
    this.group.addEventListener("click", (e) => this.onClick(node, e));
    this.group.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.onContextMenu(node, e);
    });
    this.group.addEventListener("mouseenter", (e) =>
      this.onHover(node, e, true),
    );
    this.group.addEventListener("mouseleave", (e) =>
      this.onHover(node, e, false),
    );
  }

  private addPlaceholderIcon(): void {
    const offset = -NODE_SIZE / 2 + PLACEHOLDER_INSET;
    const size = NODE_SIZE - PLACEHOLDER_INSET * 2;

    const iconBg = document.createElementNS(SVG_NS, "rect");
    iconBg.setAttribute("x", String(offset));
    iconBg.setAttribute("y", String(offset));
    iconBg.setAttribute("width", String(size));
    iconBg.setAttribute("height", String(size));
    iconBg.setAttribute("rx", "4");
    iconBg.setAttribute("fill", "var(--bg-primary)");
    iconBg.classList.add("node-icon");
    this.group.insertBefore(iconBg, this.conditionBadge);
  }

  private createRoundedRect(): SVGRectElement {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(-NODE_SIZE / 2));
    rect.setAttribute("y", String(-NODE_SIZE / 2));
    rect.setAttribute("width", String(NODE_SIZE));
    rect.setAttribute("height", String(NODE_SIZE));
    rect.setAttribute("rx", "8");
    return rect;
  }

  private createOctagon(): SVGPolygonElement {
    const poly = document.createElementNS(SVG_NS, "polygon");
    const s = NODE_SIZE / 2;
    const c = s * 0.3;
    const points = [
      `${-s + c},${-s}`,
      `${s - c},${-s}`,
      `${s},${-s + c}`,
      `${s},${s - c}`,
      `${s - c},${s}`,
      `${-s + c},${s}`,
      `${-s},${s - c}`,
      `${-s},${-s + c}`,
    ].join(" ");
    poly.setAttribute("points", points);
    return poly;
  }

  setState(nodeState: NodeState, constraint?: Constraint): void {
    this.group.classList.remove(
      "locked",
      "available",
      "always",
      "never",
      "conditional",
    );
    this.group.classList.add(nodeState);
    this.conditionBadge.style.display =
      nodeState === "conditional" ? "" : "none";

    // Update rank badge text for multi-rank nodes
    if (this.rankText && this.node.maxRanks > 1) {
      if (constraint?.type === "always" && constraint.exactRank != null) {
        this.rankText.textContent = `${constraint.exactRank}/${this.node.maxRanks}`;
      } else {
        this.rankText.textContent = `${this.node.maxRanks}`;
      }
    }
  }

  get centerX(): number {
    return this.x;
  }
  get centerY(): number {
    return this.y;
  }
}
