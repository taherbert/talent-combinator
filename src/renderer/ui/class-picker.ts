import { state } from "../state";
import type { Specialization } from "../../shared/types";

export class ClassPicker {
  private el: HTMLElement;
  private activeSpecKey = "";

  constructor(container: HTMLElement) {
    this.el = container;
    state.subscribe((event) => {
      if (event.type === "data-loaded") this.render(event.data.specs);
    });
  }

  private render(specs: Specialization[]): void {
    // Group specs by class
    const groups = new Map<string, Specialization[]>();
    for (const spec of specs) {
      let group = groups.get(spec.className);
      if (!group) {
        group = [];
        groups.set(spec.className, group);
      }
      group.push(spec);
    }

    this.el.innerHTML = "";
    const list = document.createElement("div");
    list.className = "class-list";

    for (const [className, classSpecs] of groups) {
      const group = document.createElement("div");
      group.className = "class-group";

      const header = document.createElement("button");
      header.className = "class-group-header";
      header.textContent = className;
      header.addEventListener("click", () => {
        const specList = group.querySelector(".spec-list") as HTMLElement;
        if (specList) {
          specList.style.display =
            specList.style.display === "none" ? "" : "none";
        }
      });
      group.appendChild(header);

      const specList = document.createElement("div");
      specList.className = "spec-list";

      for (const spec of classSpecs) {
        const item = document.createElement("button");
        item.className = "spec-item";
        item.textContent = spec.specName;
        item.dataset.key = `${spec.className}-${spec.specName}`;

        item.addEventListener("click", () => {
          this.selectSpec(spec);
        });

        specList.appendChild(item);
      }

      group.appendChild(specList);
      list.appendChild(group);
    }

    this.el.appendChild(list);
  }

  private selectSpec(spec: Specialization): void {
    const key = `${spec.className}-${spec.specName}`;
    if (this.activeSpecKey === key) return;

    // Update visual state
    const prev = this.el.querySelector(".spec-item.active");
    if (prev) prev.classList.remove("active");

    const next = this.el.querySelector(`[data-key="${key}"]`);
    if (next) next.classList.add("active");

    this.activeSpecKey = key;

    // Update header label
    const label = document.getElementById("spec-label");
    if (label) label.textContent = `${spec.className} - ${spec.specName}`;

    state.selectSpec(spec);
  }
}
