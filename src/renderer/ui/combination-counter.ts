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
  private errorsEl: HTMLElement;
  private errorsInner: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;

    // Warnings banner — full-width centered, grid collapse for animation
    this.errorsEl = document.createElement("div");
    this.errorsEl.className = "validation-errors";
    this.errorsInner = document.createElement("div");
    this.errorsInner.className = "validation-errors-inner";
    this.errorsEl.appendChild(this.errorsInner);
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
    const warnings = this.collectWarnings(counts);
    this.showWarnings(warnings);

    this.countEl.textContent = formatCount(total);
    this.countEl.className = "count-value";

    let color: string;
    let warning = "";

    if (total === 0n) {
      color = "red";
      if (warnings.length === 0 && !state.hasValidationError) {
        warning = "No valid builds \u2014 check constraints";
      }
    } else if (total > MAX_PROFILESETS_BIG) {
      color = "red";
      warning = `Exceeds Raidbots limit of ${MAX_PROFILESETS.toLocaleString()}. Add more constraints.`;
    } else if (total > GREEN_THRESHOLD_BIG) {
      color = "yellow";
    } else {
      color = "green";
    }

    this.countEl.classList.add(color);
    this.warningEl.textContent = warning;

    const parts = [
      `Class: ${formatCount(counts.classCount)}`,
      `Spec: ${formatCount(counts.specCount)}`,
    ];
    if (counts.heroCount > 0n || state.activeHeroTree) {
      parts.push(`Hero: ${formatCount(counts.heroCount)}`);
    }
    this.breakdownEl.textContent = parts.join(" \u00d7 ");
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
    this.errorsInner.innerHTML = "";
    if (state.hasValidationError) {
      const line = document.createElement("div");
      line.className = "validation-error-line";
      line.textContent = state.validationError!;
      this.errorsInner.appendChild(line);
      this.errorsEl.classList.add("has-errors");
    } else {
      this.errorsEl.classList.remove("has-errors");
    }
  }

  private showWarnings(warnings: CountWarning[]): void {
    if (state.hasValidationError) return;

    this.errorsInner.innerHTML = "";
    if (warnings.length === 0) {
      this.errorsEl.classList.remove("has-errors");
      return;
    }

    for (const w of warnings) {
      const line = document.createElement("div");
      line.className =
        w.severity === "error"
          ? "validation-error-line"
          : "validation-warning-line";
      line.textContent = w.message;
      this.errorsInner.appendChild(line);
    }
    this.errorsEl.classList.add("has-errors");
  }
}
