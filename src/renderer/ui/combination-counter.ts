import { state } from "../state";
import type { TalentTree, TreeCounts } from "../../shared/types";
import { MAX_PROFILESETS, COUNT_THRESHOLDS } from "../../shared/constants";
import { diagnoseZeroBuilds } from "../../shared/validation";

const MAX_PROFILESETS_BIG = BigInt(MAX_PROFILESETS);
const GREEN_THRESHOLD_BIG = BigInt(COUNT_THRESHOLDS.green);
const NO_BUILDS_MSG = "No valid builds — check constraints";

export class CombinationCounter {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private breakdownEl: HTMLElement;
  private warningEl: HTMLElement;
  private timingEl: HTMLElement;
  private errorsEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;

    // Validation errors — full-width centered banner
    this.errorsEl = document.createElement("div");
    this.errorsEl.className = "validation-errors";
    this.el.appendChild(this.errorsEl);

    // Count + breakdown inline
    const countDisplay = document.createElement("div");
    countDisplay.className = "count-display";

    this.countEl = document.createElement("span");
    this.countEl.className = "count-value";
    countDisplay.appendChild(this.countEl);

    this.breakdownEl = document.createElement("span");
    this.breakdownEl.className = "count-breakdown";
    countDisplay.appendChild(this.breakdownEl);

    this.timingEl = document.createElement("span");
    this.timingEl.className = "count-timing";
    countDisplay.appendChild(this.timingEl);

    this.warningEl = document.createElement("span");
    this.warningEl.className = "count-warning";
    countDisplay.appendChild(this.warningEl);

    this.el.appendChild(countDisplay);

    this.countEl.textContent = "";
    this.breakdownEl.textContent = "";
    this.warningEl.textContent = "";
    this.timingEl.textContent = "";

    state.subscribe((event) => {
      if (event.type === "count-updated") {
        this.update(event.counts);
      }
      if (event.type === "validation-errors") {
        this.showErrors(event.errors);
      }
    });
  }

  private showErrors(errors: string[]): void {
    this.errorsEl.innerHTML = "";
    if (errors.length === 0) return;

    for (const msg of errors) {
      const line = document.createElement("div");
      line.className = "validation-error-line";
      line.textContent = msg;
      this.errorsEl.appendChild(line);
    }
  }

  private update(counts: TreeCounts): void {
    const total = counts.totalCount;

    this.countEl.textContent = total.toLocaleString();
    this.countEl.className = "count-value";

    if (total === 0n) {
      this.countEl.classList.add("red");
      this.warningEl.textContent = this.diagnose(counts);
    } else if (total > MAX_PROFILESETS_BIG) {
      this.countEl.classList.add("red");
      this.warningEl.textContent = `Exceeds Raidbots limit of ${MAX_PROFILESETS.toLocaleString()}. Add more constraints.`;
    } else if (total > GREEN_THRESHOLD_BIG) {
      this.countEl.classList.add("yellow");
      this.warningEl.textContent = "";
    } else {
      this.countEl.classList.add("green");
      this.warningEl.textContent = "";
    }

    // Per-tree breakdown
    const parts: string[] = [];
    parts.push(`Class: ${counts.classCount.toLocaleString()}`);
    parts.push(`Spec: ${counts.specCount.toLocaleString()}`);
    if (counts.heroCount > 0n || state.activeHeroTree) {
      parts.push(`Hero: ${counts.heroCount.toLocaleString()}`);
    }
    this.breakdownEl.textContent = parts.join(" \u00d7 ");

    // Timing from details
    const details = counts.details;
    const times = [
      details?.class?.durationMs,
      details?.spec?.durationMs,
      details?.hero?.durationMs,
    ].filter((t): t is number => t != null);
    if (times.length > 0) {
      const maxMs = Math.max(...times);
      this.timingEl.textContent =
        maxMs < 1 ? "(<1ms)" : `(${Math.round(maxMs)}ms)`;
    } else {
      this.timingEl.textContent = "";
    }
  }

  private diagnose(counts: TreeCounts): string {
    const spec = state.activeSpec;
    if (!spec) return NO_BUILDS_MSG;

    const trees: { tree: TalentTree; count: bigint; label: string }[] = [
      { tree: spec.classTree, count: counts.classCount, label: "Class" },
      { tree: spec.specTree, count: counts.specCount, label: "Spec" },
    ];
    const heroTree = state.activeHeroTree;
    if (heroTree) {
      trees.push({ tree: heroTree, count: counts.heroCount, label: "Hero" });
    }

    const messages: string[] = [];
    for (const { tree, count, label } of trees) {
      if (count !== 0n) continue;
      const constraints = state.getConstraintsForTree(tree);
      const diag = diagnoseZeroBuilds(tree, constraints);
      if (diag) messages.push(`${label}: ${diag.message}`);
    }

    return messages.length > 0 ? messages.join(" | ") : NO_BUILDS_MSG;
  }
}
