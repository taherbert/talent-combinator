import { state } from "../state";
import type { Build, Specialization, TalentTree } from "../../shared/types";
import { MAX_PROFILESETS } from "../../shared/constants";
import { generateTreeBuilds } from "../../shared/build-counter";
import {
  encodeTalentHash,
  buildEntryLookup,
  buildAllNodesForSpec,
} from "../hash-encoder";
import type { EncodeInput, NodeSelection } from "../hash-encoder";

declare const electronAPI: import("../../shared/types").ElectronAPI;

const TREE_TYPE_NAMES: Record<string, string> = {
  class: "class_talents",
  spec: "spec_talents",
  hero: "hero_talents",
};

type ExportFormat = "simc" | "hash";

export class ExportPanel {
  private generateBtn: HTMLButtonElement;
  private dialogContainer: HTMLElement;
  private format: ExportFormat = "simc";
  private simcBtn!: HTMLButtonElement;
  private hashBtn!: HTMLButtonElement;
  private lastTotal = 0n;

  constructor(counterBar: HTMLElement) {
    const actionsEl = document.createElement("div");
    actionsEl.className = "export-actions";

    const toggle = document.createElement("div");
    toggle.className = "format-toggle";

    this.simcBtn = document.createElement("button");
    this.simcBtn.className = "format-toggle-btn active";
    this.simcBtn.textContent = "SimC Profilesets";
    this.simcBtn.addEventListener("click", () => this.setFormat("simc"));

    this.hashBtn = document.createElement("button");
    this.hashBtn.className = "format-toggle-btn";
    this.hashBtn.textContent = "Talent Hashes";
    this.hashBtn.addEventListener("click", () => this.setFormat("hash"));

    toggle.append(this.simcBtn, this.hashBtn);
    actionsEl.appendChild(toggle);

    this.generateBtn = document.createElement("button");
    this.generateBtn.className = "btn btn-primary";
    this.generateBtn.textContent = "Generate";
    this.generateBtn.disabled = true;
    this.generateBtn.addEventListener("click", () => this.generate());
    actionsEl.appendChild(this.generateBtn);

    counterBar.appendChild(actionsEl);
    this.dialogContainer = document.getElementById("dialog-container")!;

    state.subscribe((event) => {
      if (event.type === "count-updated") {
        this.lastTotal = event.counts.totalCount;
        this.updateButtonState();
      }
    });
  }

  private setFormat(format: ExportFormat): void {
    this.format = format;
    this.simcBtn.classList.toggle("active", format === "simc");
    this.hashBtn.classList.toggle("active", format === "hash");
    this.updateButtonState();
  }

  private updateButtonState(): void {
    const total = this.lastTotal;
    const MAX_BIG = BigInt(MAX_PROFILESETS);
    this.generateBtn.disabled = total <= 0n || total > MAX_BIG;
  }

  private async generate(): Promise<void> {
    this.generateBtn.disabled = true;
    this.generateBtn.textContent = "Generating...";

    try {
      const spec = state.activeSpec;
      if (!spec) return;

      const trees: TalentTree[] = [spec.classTree, spec.specTree];
      const heroTree = state.activeHeroTree;
      if (heroTree) trees.push(heroTree);

      const allBuilds = trees.map((tree) => {
        const constraints = state.getConstraintsForTree(tree);
        return generateTreeBuilds(tree, constraints);
      });

      if (this.format === "simc") {
        const output = this.generateProfilesets(allBuilds, trees);
        this.showExportDialog(output, "simc");
      } else {
        const output = this.generateHashes(allBuilds, trees, spec);
        this.showExportDialog(output, "hash");
      }
    } finally {
      this.generateBtn.disabled = false;
      this.generateBtn.textContent = "Generate";
    }
  }

  private generateProfilesets(
    allBuilds: Build[][],
    trees: TalentTree[],
  ): string {
    if (allBuilds.some((b) => b.length === 0)) return "";

    const treeTypes = trees.map((t) => TREE_TYPE_NAMES[t.type]);
    const lines: string[] = [];
    let index = 0;
    const indices = new Array(allBuilds.length).fill(0);

    while (true) {
      const name = String(index).padStart(4, "0");
      const parts: string[] = [];

      for (let i = 0; i < allBuilds.length; i++) {
        const build = allBuilds[i][indices[i]];
        const encoded = this.encodeBuild(build);
        if (i === 0) {
          parts.push(`profileset.build_${name}=${treeTypes[i]}=${encoded}`);
        } else {
          parts.push(`profileset.build_${name}+=${treeTypes[i]}=${encoded}`);
        }
      }

      lines.push(parts.join("\n"));
      index++;

      let carry = true;
      for (let i = allBuilds.length - 1; i >= 0 && carry; i--) {
        indices[i]++;
        if (indices[i] < allBuilds[i].length) {
          carry = false;
        } else {
          indices[i] = 0;
        }
      }
      if (carry) break;
    }

    return lines.join("\n");
  }

  private generateHashes(
    allBuilds: Build[][],
    trees: TalentTree[],
    spec: Specialization,
  ): string {
    if (allBuilds.some((b) => b.length === 0)) return "";

    const specId = spec.specId;
    if (specId == null) return "";
    const treeHashBytes = state.getTreeHash(specId) ?? new Array(16).fill(0);

    const entryLookups = trees.map((tree) =>
      buildEntryLookup(tree.nodes.values()),
    );

    const sameClassSpecs = state.specs.filter(
      (s) => s.className === spec.className,
    );
    const { allNodes, allNodeMap } = buildAllNodesForSpec(sameClassSpecs);

    const heroTree = state.activeHeroTree;
    let subTreeNodeId: number | undefined;
    let subTreeEntryIndex: number | undefined;
    if (heroTree?.subTreeId != null) {
      for (const s of sameClassSpecs) {
        for (const stn of s.subTreeNodes) {
          const idx = stn.entries.findIndex(
            (e) => e.traitSubTreeId === heroTree.subTreeId,
          );
          if (idx >= 0) {
            subTreeNodeId = stn.id;
            subTreeEntryIndex = idx;
            break;
          }
        }
        if (subTreeNodeId != null) break;
      }
    }

    // Free/granted nodes from the active spec's trees only — selected but
    // not purchased. Other specs' free nodes remain unselected (0 bit).
    const freeNodeIds = new Set<number>();
    for (const tree of trees) {
      for (const node of tree.nodes.values()) {
        if (node.freeNode || node.entryNode) freeNodeIds.add(node.id);
      }
    }

    const lines: string[] = [];
    const indices = new Array(allBuilds.length).fill(0);
    let index = 0;

    while (true) {
      const selections = new Map<number, NodeSelection>();

      // Free/granted nodes — selected but not purchased
      for (const nodeId of freeNodeIds) {
        const node = allNodeMap.get(nodeId);
        if (node) {
          selections.set(nodeId, {
            ranks: node.maxRanks,
            isPurchased: false,
          });
        }
      }

      // SubTreeNode selection (hero tree choice)
      if (subTreeNodeId != null && subTreeEntryIndex != null) {
        selections.set(subTreeNodeId, {
          ranks: 1,
          entryIndex: subTreeEntryIndex,
          isPurchased: true,
        });
      }

      for (let i = 0; i < allBuilds.length; i++) {
        const build = allBuilds[i][indices[i]];
        const lookup = entryLookups[i];
        for (const [entryId, points] of build.entries) {
          if (points <= 0) continue;
          const info = lookup.get(entryId);
          if (!info) continue;
          selections.set(info.nodeId, {
            ranks: points,
            entryIndex: info.entryIndex,
            isPurchased: true,
          });
        }
      }

      const input: EncodeInput = { specId, treeHashBytes, selections };
      const hash = encodeTalentHash(input, allNodes);
      const name = String(index).padStart(4, "0");
      lines.push(`profileset.build_${name}=talents=${hash}`);
      index++;

      let carry = true;
      for (let i = allBuilds.length - 1; i >= 0 && carry; i--) {
        indices[i]++;
        if (indices[i] < allBuilds[i].length) {
          carry = false;
        } else {
          indices[i] = 0;
        }
      }
      if (carry) break;
    }

    return lines.join("\n");
  }

  private encodeBuild(build: Build): string {
    return Array.from(build.entries.entries())
      .filter(([, points]) => points > 0)
      .sort(([a], [b]) => a - b)
      .map(([id, points]) => `${id}:${points}`)
      .join("/");
  }

  private showExportDialog(output: string, format: ExportFormat): void {
    const isHash = format === "hash";
    const dialog = document.createElement("div");
    dialog.className = "export-dialog";

    const content = document.createElement("div");
    content.className = "export-dialog-content";

    const header = document.createElement("div");
    header.className = "export-dialog-header";

    const title = document.createElement("h2");
    title.textContent = isHash ? "Export Talent Hashes" : "Export Profilesets";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-secondary";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => dialog.remove());
    header.appendChild(closeBtn);

    content.appendChild(header);

    const body = document.createElement("div");
    body.className = "export-dialog-body";

    const textarea = document.createElement("textarea");
    textarea.className = "export-output";
    textarea.readOnly = true;
    textarea.value = output;
    body.appendChild(textarea);
    content.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "export-dialog-footer";

    const count = output
      .split("\n")
      .filter((l) => l.startsWith("profileset.") && !l.includes("+=")).length;
    const stats = document.createElement("span");
    stats.className = "export-stats";
    stats.textContent = `${count.toLocaleString()} profilesets`;
    footer.appendChild(stats);

    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; gap: 8px;";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-secondary";
    copyBtn.textContent = "Copy to Clipboard";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(output);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy to Clipboard"), 1500);
    });
    actions.appendChild(copyBtn);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save to File";
    saveBtn.addEventListener("click", async () => {
      const spec = state.activeSpec;
      let defaultName: string;
      if (spec && isHash) {
        defaultName = `${spec.className}_${spec.specName}_hashes.txt`;
      } else if (spec) {
        defaultName = `${spec.className}_${spec.specName}_profiles.simc`;
      } else if (isHash) {
        defaultName = "hashes.txt";
      } else {
        defaultName = "profiles.simc";
      }
      await electronAPI.saveFile(output, defaultName);
    });
    actions.appendChild(saveBtn);

    footer.appendChild(actions);
    content.appendChild(footer);
    dialog.appendChild(content);

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.remove();
    });

    this.dialogContainer.appendChild(dialog);
  }
}
