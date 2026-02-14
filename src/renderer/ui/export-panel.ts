import { state } from "../state";
import type { SolverResult, Build, TalentTree } from "../../shared/types";
import { MAX_PROFILESETS } from "../../shared/constants";

declare const electronAPI: import("../../shared/types").ElectronAPI;

const TREE_TYPE_NAMES: Record<string, string> = {
  class: "class_talents",
  spec: "spec_talents",
  hero: "hero_talents",
};

export class ExportPanel {
  private generateBtn: HTMLButtonElement;
  private dialogContainer: HTMLElement;

  constructor(counterBar: HTMLElement) {
    const actionsEl = document.createElement("div");
    actionsEl.className = "export-actions";

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
        const total = event.counts.totalCount;
        this.generateBtn.disabled = total === 0 || total > MAX_PROFILESETS;
      }
    });
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

      const treeResults = await Promise.all(
        trees.map((tree) => this.solveTree(tree)),
      );
      const startTime = performance.now();
      const output = this.generateProfilesets(treeResults, trees);
      const duration = performance.now() - startTime;

      this.showExportDialog(output, duration);
    } finally {
      this.generateBtn.disabled = false;
      this.generateBtn.textContent = "Generate";
    }
  }

  private solveTree(tree: TalentTree): Promise<SolverResult> {
    return new Promise((resolve) => {
      const worker = new Worker(
        new URL("../../worker/solver.worker.ts", import.meta.url),
        { type: "module" },
      );

      const constraints = state.getConstraintsForTree(tree);

      worker.postMessage({
        type: "generate",
        config: {
          tree: { ...tree, nodes: Object.fromEntries(tree.nodes) },
          constraints: Object.fromEntries(constraints),
        },
      });

      worker.onmessage = (event) => {
        if (event.data.type === "generate") {
          resolve(event.data.result);
          worker.terminate();
        }
      };
    });
  }

  private generateProfilesets(
    results: SolverResult[],
    trees: TalentTree[],
  ): string {
    const allBuilds = results.map((r) => r.builds ?? []);
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
          parts.push(`profileset."build_${name}"=${treeTypes[i]}=${encoded}`);
        } else {
          parts.push(
            `profileset."build_${name}"+="${treeTypes[i]}=${encoded}"`,
          );
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

  private encodeBuild(build: Build): string {
    // Entries arrive as plain objects from worker serialization
    const rawEntries: [number, number][] =
      build.entries instanceof Map
        ? Array.from(build.entries.entries())
        : Object.entries(build.entries).map(([k, v]) => [
            Number(k),
            v as number,
          ]);

    return rawEntries
      .filter(([, points]) => points > 0)
      .sort(([a], [b]) => a - b)
      .map(([id, points]) => `${id}:${points}`)
      .join("/");
  }

  private showExportDialog(output: string, durationMs: number): void {
    const dialog = document.createElement("div");
    dialog.className = "export-dialog";

    const content = document.createElement("div");
    content.className = "export-dialog-content";

    const header = document.createElement("div");
    header.className = "export-dialog-header";
    header.innerHTML = `
      <h2>Export Profilesets</h2>
      <button class="btn btn-secondary" id="close-export">&times;</button>
    `;
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

    const lineCount = output
      .split("\n")
      .filter((l) => l.startsWith("profileset.")).length;
    const stats = document.createElement("span");
    stats.className = "export-stats";
    stats.textContent = `${lineCount} profilesets · Generated in ${durationMs.toFixed(0)}ms`;
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
      const defaultName = spec
        ? `${spec.className}_${spec.specName}_profiles.simc`
        : "profiles.simc";
      await electronAPI.saveFile(output, defaultName);
    });
    actions.appendChild(saveBtn);

    footer.appendChild(actions);
    content.appendChild(footer);
    dialog.appendChild(content);

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.remove();
    });
    content.querySelector("#close-export")!.addEventListener("click", () => {
      dialog.remove();
    });

    this.dialogContainer.appendChild(dialog);
  }
}
