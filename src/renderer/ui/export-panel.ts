import { state } from "../state";
import type {
  SolverResult,
  Build,
  TalentTree,
  TalentNode,
} from "../../shared/types";
import { MAX_PROFILESETS } from "../../shared/constants";

declare const electronAPI: import("../../shared/types").ElectronAPI;

export class ExportPanel {
  private actionsEl: HTMLElement;
  private generateBtn: HTMLButtonElement;
  private dialogContainer: HTMLElement;

  constructor(counterBar: HTMLElement) {
    this.actionsEl = document.createElement("div");
    this.actionsEl.className = "export-actions";

    this.generateBtn = document.createElement("button");
    this.generateBtn.className = "btn btn-primary";
    this.generateBtn.textContent = "Generate";
    this.generateBtn.disabled = true;
    this.generateBtn.addEventListener("click", () => this.generate());
    this.actionsEl.appendChild(this.generateBtn);

    counterBar.appendChild(this.actionsEl);
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

      // Collect builds from solver worker
      const workerPromises = trees.map((tree) => this.solveTree(tree));

      const treeResults = await Promise.all(workerPromises);
      const startTime = performance.now();

      // Generate profileset output via Cartesian product
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
          tree: this.serializeTree(tree),
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

  private serializeTree(tree: TalentTree): object {
    return {
      ...tree,
      nodes: Object.fromEntries(tree.nodes),
    };
  }

  private generateProfilesets(
    results: SolverResult[],
    trees: TalentTree[],
  ): string {
    // Each result has builds. Cartesian product all builds.
    const allBuilds = results.map((r) => r.builds ?? []);
    if (allBuilds.some((b) => b.length === 0)) return "";

    const treeTypes = trees.map((t) =>
      t.type === "class"
        ? "class_talents"
        : t.type === "spec"
          ? "spec_talents"
          : "hero_talents",
    );

    const lines: string[] = [];
    let index = 0;

    // Cartesian product
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

      // Increment indices (rightmost first)
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
    // Format: entry_id:points/entry_id:points/...
    // Handle both Map (local) and plain object (from worker serialization)
    const rawEntries =
      build.entries instanceof Map
        ? Array.from(build.entries.entries())
        : Object.entries(build.entries).map(
            ([k, v]) => [Number(k), v as number] as const,
          );
    const sorted = rawEntries.sort(([a], [b]) => a - b);
    const parts: string[] = [];
    for (const [entryId, points] of sorted) {
      if (points > 0) {
        parts.push(`${entryId}:${points}`);
      }
    }
    return parts.join("/");
  }

  private showExportDialog(output: string, durationMs: number): void {
    const dialog = document.createElement("div");
    dialog.className = "export-dialog";

    const content = document.createElement("div");
    content.className = "export-dialog-content";

    // Header
    const header = document.createElement("div");
    header.className = "export-dialog-header";
    header.innerHTML = `
      <h2>Export Profilesets</h2>
      <button class="btn btn-secondary" id="close-export">&times;</button>
    `;
    content.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "export-dialog-body";

    const textarea = document.createElement("textarea");
    textarea.className = "export-output";
    textarea.readOnly = true;
    textarea.value = output;
    body.appendChild(content);
    content.appendChild(body);
    body.appendChild(textarea);

    // Footer
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
      const name = spec
        ? `${spec.className}_${spec.specName}_profiles.simc`
        : "profiles.simc";
      await electronAPI.saveFile(output, name);
    });
    actions.appendChild(saveBtn);

    footer.appendChild(actions);
    content.appendChild(footer);
    dialog.appendChild(content);

    // Close behavior
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.remove();
    });
    content.querySelector("#close-export")!.addEventListener("click", () => {
      dialog.remove();
    });

    this.dialogContainer.appendChild(dialog);
  }
}
