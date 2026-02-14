import type {
  TalentNode,
  NodeState,
  Constraint,
  ConstraintType,
} from "../../shared/types";
import { NODE_SIZE } from "../../shared/constants";

const SVG_NS = "http://www.w3.org/2000/svg";

export class TalentNodeView {
  readonly group: SVGGElement;
  private bgShape: SVGElement;
  private rankText: SVGTextElement;
  private nameText: SVGTextElement;
  private conditionBadge: SVGTextElement;
  private _state: NodeState = "available";

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

    // Background shape
    if (node.type === "choice") {
      this.bgShape = this.createOctagon();
    } else {
      this.bgShape = this.createRoundedRect();
    }
    this.bgShape.classList.add("node-bg");
    this.group.appendChild(this.bgShape);

    // Icon placeholder (colored circle for now, real icons require Wowhead URLs)
    const iconBg = document.createElementNS(SVG_NS, "rect");
    iconBg.setAttribute("x", String(-NODE_SIZE / 2 + 4));
    iconBg.setAttribute("y", String(-NODE_SIZE / 2 + 4));
    iconBg.setAttribute("width", String(NODE_SIZE - 8));
    iconBg.setAttribute("height", String(NODE_SIZE - 8));
    iconBg.setAttribute("rx", "4");
    iconBg.setAttribute("fill", "var(--bg-primary)");
    iconBg.classList.add("node-icon");
    this.group.appendChild(iconBg);

    // Rank badge
    this.rankText = document.createElementNS(SVG_NS, "text");
    this.rankText.classList.add("rank-badge");
    this.rankText.setAttribute("x", String(NODE_SIZE / 2 - 2));
    this.rankText.setAttribute("y", String(NODE_SIZE / 2 + 2));
    if (node.maxRanks > 1) {
      this.rankText.textContent = `0/${node.maxRanks}`;
    }
    this.group.appendChild(this.rankText);

    // Condition badge ("?")
    this.conditionBadge = document.createElementNS(SVG_NS, "text");
    this.conditionBadge.classList.add("condition-badge");
    this.conditionBadge.setAttribute("x", "0");
    this.conditionBadge.setAttribute("y", String(-NODE_SIZE / 2 - 4));
    this.conditionBadge.textContent = "?";
    this.conditionBadge.style.display = "none";
    this.group.appendChild(this.conditionBadge);

    // Name label below node
    this.nameText = document.createElementNS(SVG_NS, "text");
    this.nameText.classList.add("node-name");
    this.nameText.setAttribute("x", "0");
    this.nameText.setAttribute("y", String(NODE_SIZE / 2 + 16));
    this.nameText.textContent = this.truncateName(node.name);
    this.group.appendChild(this.nameText);

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
    const c = s * 0.3; // corner cut
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

  private truncateName(name: string): string {
    return name.length > 12 ? name.slice(0, 11) + "\u2026" : name;
  }

  setState(nodeState: NodeState): void {
    this._state = nodeState;
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

  setRank(current: number): void {
    if (this.node.maxRanks > 1) {
      this.rankText.textContent = `${current}/${this.node.maxRanks}`;
    }
  }

  get currentState(): NodeState {
    return this._state;
  }

  get centerX(): number {
    return this.x;
  }
  get centerY(): number {
    return this.y;
  }
}
