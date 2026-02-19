import { state } from "../state";
import type { TreeCounts, CountResult, CountWarning } from "../../shared/types";
import { MAX_PROFILESETS, COUNT_THRESHOLDS } from "../../shared/constants";

const MAX_PROFILESETS_BIG = BigInt(MAX_PROFILESETS);
const GREEN_THRESHOLD_BIG = BigInt(COUNT_THRESHOLDS.green);

const MAGNITUDE_LABELS: [bigint, string][] = [
  [1_000_000_000_000_000n, "Quadrillions"],
  [1_000_000_000_000n, "Trillions"],
  [1_000_000_000n, "Billions"],
  [1_000_000n, "Millions"],
  [100_000n, "Thousands"],
];

function formatCount(n: bigint): string {
  for (const [threshold, label] of MAGNITUDE_LABELS) {
    if (n >= threshold) return `${label} of builds`;
  }
  return n.toLocaleString();
}

export class CombinationCounter {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private breakdownEl: HTMLElement;
  private warningEl: HTMLElement;
  private timingEl: HTMLElement;
  private errorsEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;

    // Warnings banner — full-width centered
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

    state.subscribe((event) => {
      if (event.type === "count-updated") {
        this.update(event.counts);
      }
      if (event.type === "validation-changed") {
        this.updateValidationDisplay();
      }
    });
  }

  private update(counts: TreeCounts): void {
    const total = counts.totalCount;

    this.countEl.textContent = formatCount(total);
    this.countEl.className = "count-value";

    // Collect warnings from all tree details
    const warnings = this.collectWarnings(counts);
    this.showWarnings(warnings);

    if (total === 0n) {
      this.countEl.classList.add("red");
      if (warnings.length === 0 && !state.hasValidationError) {
        this.warningEl.textContent = "No valid builds — check constraints";
      } else {
        this.warningEl.textContent = "";
      }
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
    parts.push(`Class: ${formatCount(counts.classCount)}`);
    parts.push(`Spec: ${formatCount(counts.specCount)}`);
    if (counts.heroCount > 0n || state.activeHeroTree) {
      parts.push(`Hero: ${formatCount(counts.heroCount)}`);
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

  private collectWarnings(counts: TreeCounts): CountWarning[] {
    const details = counts.details;
    if (!details) return [];

    const warnings: CountWarning[] = [];
    const entries: [string, CountResult | undefined][] = [
      ["Class", details.class],
      ["Spec", details.spec],
      ["Hero", details.hero],
    ];

    for (const [label, detail] of entries) {
      if (!detail) continue;
      for (const w of detail.warnings) {
        warnings.push({ ...w, message: `${label}: ${w.message}` });
      }
    }

    return warnings;
  }

  private updateValidationDisplay(): void {
    this.errorsEl.innerHTML = "";
    if (state.hasValidationError) {
      const line = document.createElement("div");
      line.className = "validation-error-line";
      line.textContent = state.validationError!;
      this.errorsEl.appendChild(line);
    }
  }

  private showWarnings(warnings: CountWarning[]): void {
    // Validation errors take precedence — shown via updateValidationDisplay
    if (state.hasValidationError) return;

    this.errorsEl.innerHTML = "";
    if (warnings.length === 0) return;

    for (const w of warnings) {
      const line = document.createElement("div");
      line.className =
        w.severity === "error"
          ? "validation-error-line"
          : "validation-warning-line";
      line.textContent = w.message;
      this.errorsEl.appendChild(line);
    }
  }
}
