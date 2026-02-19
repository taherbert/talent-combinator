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
  private iconEl: SVGImageElement | null = null;
  private iconUrls = new Map<number, string>();
  private readonly clipId: string;
  private readonly iconOffset: number;
  private readonly iconSize: number;

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
    this.clipId = `clip-${node.id}`;
    this.iconOffset = -NODE_SIZE / 2 + ICON_INSET;
    this.iconSize = NODE_SIZE - ICON_INSET * 2;

    this.group = document.createElementNS(SVG_NS, "g");
    this.group.classList.add("talent-node");
    this.group.setAttribute("transform", `translate(${x}, ${y})`);

    // Background shape — octagon for real choice nodes, rounded rect for everything else
    const isVisualChoice = node.type === "choice" && !node.isApex;
    const bgShape = isVisualChoice
      ? this.createOctagon()
      : this.createRoundedRect();
    bgShape.classList.add("node-bg");
    this.group.appendChild(bgShape);

    // Placeholder icon
    this.addPlaceholderIcon();

    // Clip path for icon
    const defs = document.createElementNS(SVG_NS, "defs");
    const clipPath = document.createElementNS(SVG_NS, "clipPath");
    clipPath.setAttribute("id", this.clipId);
    const clipRect = document.createElementNS(SVG_NS, "rect");
    clipRect.setAttribute("x", String(this.iconOffset));
    clipRect.setAttribute("y", String(this.iconOffset));
    clipRect.setAttribute("width", String(this.iconSize));
    clipRect.setAttribute("height", String(this.iconSize));
    clipRect.setAttribute("rx", "5");
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    this.group.appendChild(defs);

    // Condition badge ("?") — created before rank badge so badge paints on top
    this.conditionBadge = document.createElementNS(SVG_NS, "text");
    this.conditionBadge.classList.add("condition-badge");
    this.conditionBadge.setAttribute("x", "0");
    this.conditionBadge.setAttribute("y", String(-NODE_SIZE / 2 - 4));
    this.conditionBadge.textContent = "?";
    this.conditionBadge.style.display = "none";
    this.group.appendChild(this.conditionBadge);

    // Multi-rank badge — top-right, appended last so it paints on top of icon
    if (node.maxRanks > 1) {
      this.rankBadge = document.createElementNS(SVG_NS, "g");
      this.rankBadge.classList.add("rank-badge-group");

      const pillW = 24;
      const pillH = 14;
      const pillX = NODE_SIZE / 2 - pillW + 4;
      const pillY = -NODE_SIZE / 2 + 2;

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

    // Choice indicator — top-left pill matching rank badge style
    if (node.type === "choice" && !node.isApex) {
      this.group.classList.add("choice-node");
      const badge = document.createElementNS(SVG_NS, "g");
      badge.classList.add("choice-badge");

      const pillW = 24;
      const pillH = 14;
      const pillX = -(NODE_SIZE / 2) - 4;
      const pillY = -NODE_SIZE / 2 + 2;

      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("x", String(pillX));
      bg.setAttribute("y", String(pillY));
      bg.setAttribute("width", String(pillW));
      bg.setAttribute("height", String(pillH));
      bg.setAttribute("rx", "4");
      bg.classList.add("choice-pill-bg");
      badge.appendChild(bg);

      const cx = pillX + pillW / 2;
      const cy = pillY + pillH / 2;
      const arrow = document.createElementNS(SVG_NS, "path");
      arrow.setAttribute(
        "d",
        `M ${cx - 7},${cy} L ${cx + 7},${cy}` +
          ` M ${cx + 4},${cy - 3} L ${cx + 7},${cy} L ${cx + 4},${cy + 3}` +
          ` M ${cx - 4},${cy - 3} L ${cx - 7},${cy} L ${cx - 4},${cy + 3}`,
      );
      arrow.classList.add("choice-pill-arrow");
      badge.appendChild(arrow);

      this.group.appendChild(badge);
    }

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

    // Preload icons
    this.preloadIcons();

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

  private preloadIcons(): void {
    const { node } = this;

    // Default icon (node-level or first entry)
    const defaultIconName = node.icon || node.entries[0]?.icon;
    if (defaultIconName) {
      this.probeIcon(defaultIconName, -1);
    }

    // Per-entry icons for choice nodes
    if (node.type === "choice") {
      for (let i = 0; i < node.entries.length; i++) {
        const entryIcon = node.entries[i].icon;
        if (entryIcon) {
          this.probeIcon(entryIcon, i);
        }
      }
    }
  }

  private probeIcon(iconName: string, entryIndex: number): void {
    const normalized = iconName.toLowerCase().replace(/ /g, "_");
    const url = `${ICON_CDN_URL}/${normalized}.jpg`;
    const probe = new Image();
    probe.onload = () => {
      this.iconUrls.set(entryIndex, url);
      // Show default icon on first successful load
      if (!this.iconEl && (entryIndex === -1 || !this.iconUrls.has(-1))) {
        this.showIcon(url);
      }
    };
    probe.src = url;
  }

  private showIcon(url: string): void {
    const svgImg = document.createElementNS(SVG_NS, "image");
    svgImg.setAttributeNS(XLINK_NS, "href", url);
    svgImg.setAttribute("x", String(this.iconOffset));
    svgImg.setAttribute("y", String(this.iconOffset));
    svgImg.setAttribute("width", String(this.iconSize));
    svgImg.setAttribute("height", String(this.iconSize));
    svgImg.setAttribute("clip-path", `url(#${this.clipId})`);
    svgImg.classList.add("node-icon");
    // Insert before conditionBadge — rank badge is after, so it paints on top
    this.group.insertBefore(svgImg, this.conditionBadge);
    this.iconEl = svgImg;
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
    this.group.appendChild(iconBg);
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

  setState(
    nodeState: NodeState,
    constraint?: Constraint,
    hasError?: boolean,
  ): void {
    this.group.classList.remove(
      "locked",
      "available",
      "always",
      "never",
      "conditional",
      "implied",
      "free",
    );
    this.group.classList.add(nodeState);
    this.group.classList.toggle("error", !!hasError);
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

    // Swap icon for choice nodes when entryIndex changes
    if (this.iconEl && constraint?.entryIndex != null) {
      const entryUrl = this.iconUrls.get(constraint.entryIndex);
      if (entryUrl) {
        this.iconEl.setAttributeNS(XLINK_NS, "href", entryUrl);
      }
    } else if (this.iconEl && constraint?.entryIndex == null) {
      const defaultUrl = this.iconUrls.get(-1);
      if (defaultUrl) {
        this.iconEl.setAttributeNS(XLINK_NS, "href", defaultUrl);
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
