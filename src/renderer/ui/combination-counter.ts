import { state } from "../state";
import type { TreeCounts } from "../../shared/types";
import { MAX_PROFILESETS, COUNT_THRESHOLDS } from "../../shared/constants";

export class CombinationCounter {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private breakdownEl: HTMLElement;
  private warningEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;

    const countDisplay = document.createElement("div");
    countDisplay.className = "count-display";

    this.countEl = document.createElement("span");
    this.countEl.className = "count-value green";
    this.countEl.textContent = "0";
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
    });
  }

  private update(counts: TreeCounts): void {
    const total = counts.totalCount;

    this.countEl.textContent = total.toLocaleString();
    this.countEl.className = "count-value";

    if (total > MAX_PROFILESETS) {
      this.countEl.classList.add("red");
      this.warningEl.textContent = `Exceeds Raidbots limit of ${MAX_PROFILESETS.toLocaleString()}. Add more constraints.`;
    } else if (total > COUNT_THRESHOLDS.green) {
      this.countEl.classList.add("yellow");
      this.warningEl.textContent = "";
    } else {
      this.countEl.classList.add("green");
      this.warningEl.textContent = "";
    }

    const parts: string[] = [];
    if (counts.classCount > 0)
      parts.push(`Class: ${counts.classCount.toLocaleString()}`);
    if (counts.specCount > 0)
      parts.push(`Spec: ${counts.specCount.toLocaleString()}`);
    if (counts.heroCount > 0)
      parts.push(`Hero: ${counts.heroCount.toLocaleString()}`);
    this.breakdownEl.textContent = parts.join(" × ");
  }
}
