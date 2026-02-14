import type { TalentNode, NodeState } from "../../shared/types";
import { NODE_SIZE, ICON_CDN_URL } from "../../shared/constants";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export class TalentNodeView {
  readonly group: SVGGElement;
  private conditionBadge: SVGTextElement;

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

    // Talent icon from Wowhead CDN
    const iconName = node.icon || node.entries[0]?.icon;
    if (iconName) {
      const clipId = `clip-${node.id}`;
      const defs = document.createElementNS(SVG_NS, "defs");
      const clipPath = document.createElementNS(SVG_NS, "clipPath");
      clipPath.setAttribute("id", clipId);
      const clipRect = document.createElementNS(SVG_NS, "rect");
      clipRect.setAttribute("x", String(-NODE_SIZE / 2 + 3));
      clipRect.setAttribute("y", String(-NODE_SIZE / 2 + 3));
      clipRect.setAttribute("width", String(NODE_SIZE - 6));
      clipRect.setAttribute("height", String(NODE_SIZE - 6));
      clipRect.setAttribute("rx", "5");
      clipPath.appendChild(clipRect);
      defs.appendChild(clipPath);
      this.group.appendChild(defs);

      const img = document.createElementNS(SVG_NS, "image");
      img.setAttributeNS(XLINK_NS, "href", `${ICON_CDN_URL}/${iconName}.jpg`);
      img.setAttribute("x", String(-NODE_SIZE / 2 + 3));
      img.setAttribute("y", String(-NODE_SIZE / 2 + 3));
      img.setAttribute("width", String(NODE_SIZE - 6));
      img.setAttribute("height", String(NODE_SIZE - 6));
      img.setAttribute("clip-path", `url(#${clipId})`);
      img.classList.add("node-icon");
      this.group.appendChild(img);
    } else {
      // Fallback: dark placeholder
      const iconBg = document.createElementNS(SVG_NS, "rect");
      iconBg.setAttribute("x", String(-NODE_SIZE / 2 + 4));
      iconBg.setAttribute("y", String(-NODE_SIZE / 2 + 4));
      iconBg.setAttribute("width", String(NODE_SIZE - 8));
      iconBg.setAttribute("height", String(NODE_SIZE - 8));
      iconBg.setAttribute("rx", "4");
      iconBg.setAttribute("fill", "var(--bg-primary)");
      iconBg.classList.add("node-icon");
      this.group.appendChild(iconBg);
    }

    // Rank badge (only for multi-rank talents)
    if (node.maxRanks > 1) {
      const rankText = document.createElementNS(SVG_NS, "text");
      rankText.classList.add("rank-badge");
      rankText.setAttribute("x", String(NODE_SIZE / 2 - 2));
      rankText.setAttribute("y", String(NODE_SIZE / 2 + 2));
      rankText.textContent = `${node.maxRanks}`;
      this.group.appendChild(rankText);
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
    nameText.setAttribute("y", String(NODE_SIZE / 2 + 16));
    nameText.textContent =
      displayName.length > 14
        ? displayName.slice(0, 13) + "\u2026"
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

  setState(nodeState: NodeState): void {
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
  }

  get centerX(): number {
    return this.x;
  }
  get centerY(): number {
    return this.y;
  }
}
