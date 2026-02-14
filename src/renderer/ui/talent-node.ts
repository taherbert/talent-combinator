import type { TalentNode, NodeState } from "../../shared/types";
import { NODE_SIZE } from "../../shared/constants";

const SVG_NS = "http://www.w3.org/2000/svg";

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

    const iconBg = document.createElementNS(SVG_NS, "rect");
    iconBg.setAttribute("x", String(-NODE_SIZE / 2 + 4));
    iconBg.setAttribute("y", String(-NODE_SIZE / 2 + 4));
    iconBg.setAttribute("width", String(NODE_SIZE - 8));
    iconBg.setAttribute("height", String(NODE_SIZE - 8));
    iconBg.setAttribute("rx", "4");
    iconBg.setAttribute("fill", "var(--bg-primary)");
    iconBg.classList.add("node-icon");
    this.group.appendChild(iconBg);

    const rankText = document.createElementNS(SVG_NS, "text");
    rankText.classList.add("rank-badge");
    rankText.setAttribute("x", String(NODE_SIZE / 2 - 2));
    rankText.setAttribute("y", String(NODE_SIZE / 2 + 2));
    if (node.maxRanks > 1) {
      rankText.textContent = `0/${node.maxRanks}`;
    }
    this.group.appendChild(rankText);

    this.conditionBadge = document.createElementNS(SVG_NS, "text");
    this.conditionBadge.classList.add("condition-badge");
    this.conditionBadge.setAttribute("x", "0");
    this.conditionBadge.setAttribute("y", String(-NODE_SIZE / 2 - 4));
    this.conditionBadge.textContent = "?";
    this.conditionBadge.style.display = "none";
    this.group.appendChild(this.conditionBadge);

    const nameText = document.createElementNS(SVG_NS, "text");
    nameText.classList.add("node-name");
    nameText.setAttribute("x", "0");
    nameText.setAttribute("y", String(NODE_SIZE / 2 + 16));
    nameText.textContent =
      node.name.length > 12 ? node.name.slice(0, 11) + "\u2026" : node.name;
    this.group.appendChild(nameText);

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
