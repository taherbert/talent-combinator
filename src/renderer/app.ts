import { state } from "./state";
import { ClassPicker } from "./ui/class-picker";
import { TalentTreeView } from "./ui/talent-tree";
import { CombinationCounter } from "./ui/combination-counter";
import { ExportPanel } from "./ui/export-panel";
import type { Specialization, TalentTree, TreeCounts } from "../shared/types";
import { SOLVER_DEBOUNCE_MS } from "../shared/constants";

declare const electronAPI: import("../shared/types").ElectronAPI;

const sidebar = document.getElementById("sidebar")!;
const sidebarToggle = document.getElementById("sidebar-toggle")!;
const sidebarBackdrop = document.getElementById("sidebar-backdrop")!;
const mainContent = document.getElementById("main-content")!;
const counterBar = document.getElementById("counter-bar")!;

// Components self-manage via DOM attachment and state subscriptions
void new ClassPicker(sidebar);
void new CombinationCounter(counterBar);
void new ExportPanel(counterBar);

let countWorkers: Worker[] = [];
let countDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// --- Sidebar toggle ---

function openSidebar(): void {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("visible");
}

function closeSidebar(): void {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("visible");
}

sidebarToggle.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

sidebarBackdrop.addEventListener("click", closeSidebar);

// --- Splash screen ---

function showSplash(specs: Specialization[]): void {
  mainContent.innerHTML = "";

  const splash = document.createElement("div");
  splash.className = "splash-screen";

  const title = document.createElement("h2");
  title.textContent = "Select a Specialization";
  splash.appendChild(title);

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

  const grid = document.createElement("div");
  grid.className = "splash-grid";

  for (const [className, classSpecs] of groups) {
    const card = document.createElement("div");
    card.className = "splash-class-group";

    const name = document.createElement("div");
    name.className = "splash-class-name";
    name.textContent = className;
    card.appendChild(name);

    const list = document.createElement("div");
    list.className = "splash-spec-list";

    for (const spec of classSpecs) {
      const btn = document.createElement("button");
      btn.className = "splash-spec-btn";
      btn.textContent = spec.specName;
      btn.addEventListener("click", () => state.selectSpec(spec));
      list.appendChild(btn);
    }

    card.appendChild(list);
    grid.appendChild(card);
  }

  splash.appendChild(grid);
  mainContent.appendChild(splash);
}

// --- Tree rendering ---

function renderTrees(
  classTree: TalentTree,
  specTree: TalentTree,
  heroTree: TalentTree | null,
): void {
  mainContent.innerHTML = "";
  counterBar.classList.add("visible");
  sidebarToggle.classList.add("visible");
  closeSidebar();

  // Instructions bar
  const instructions = document.createElement("div");
  instructions.className = "instructions-bar";
  instructions.innerHTML = [
    "<strong>Controls:</strong>",
    "Left-click to cycle: <em>Available</em> \u2192 <em class='c-green'>Always</em> \u2192 <em class='c-red'>Never</em> \u2192 <em>Available</em>",
    "Right-click for conditional (AND/OR)",
  ].join(" &middot; ");
  mainContent.appendChild(instructions);

  // Hero tree selector (above trees if multiple hero options)
  if (heroTree) {
    const spec = state.activeSpec!;
    if (spec.heroTrees.length > 1) {
      const selector = document.createElement("div");
      selector.className = "hero-selector";
      for (const ht of spec.heroTrees) {
        const btn = document.createElement("button");
        btn.textContent = ht.subTreeName || "Hero Tree";
        if (ht === heroTree) btn.classList.add("active");
        btn.addEventListener("click", () => state.selectHeroTree(ht));
        selector.appendChild(btn);
      }
      mainContent.appendChild(selector);
    }
  }

  // Tree container — class, hero, spec side-by-side
  const treeRow = document.createElement("div");
  treeRow.className = "tree-row";

  const classContainer = document.createElement("div");
  classContainer.className = "tree-column";
  new TalentTreeView(classContainer).render(classTree);
  treeRow.appendChild(classContainer);

  if (heroTree) {
    const heroContainer = document.createElement("div");
    heroContainer.className = "tree-column";
    new TalentTreeView(heroContainer).render(heroTree);
    treeRow.appendChild(heroContainer);
  }

  const specContainer = document.createElement("div");
  specContainer.className = "tree-column";
  new TalentTreeView(specContainer).render(specTree);
  treeRow.appendChild(specContainer);

  mainContent.appendChild(treeRow);

  scheduleCount();
}

function serializeTree(tree: TalentTree): object {
  return { ...tree, nodes: Object.fromEntries(tree.nodes) };
}

function scheduleCount(): void {
  if (countDebounceTimer) clearTimeout(countDebounceTimer);
  countDebounceTimer = setTimeout(runCount, SOLVER_DEBOUNCE_MS);
}

function runCount(): void {
  for (const w of countWorkers) w.terminate();
  countWorkers = [];

  const spec = state.activeSpec;
  if (!spec) return;

  const trees: { tree: TalentTree; key: keyof TreeCounts }[] = [
    { tree: spec.classTree, key: "classCount" },
    { tree: spec.specTree, key: "specCount" },
  ];

  const heroTree = state.activeHeroTree;
  if (heroTree) {
    trees.push({ tree: heroTree, key: "heroCount" });
  }

  const counts: TreeCounts = {
    classCount: 1,
    specCount: 1,
    heroCount: 1,
    totalCount: 0,
  };

  let pending = trees.length;

  for (const { tree, key } of trees) {
    const worker = new Worker(
      new URL("../worker/solver.worker.ts", import.meta.url),
      { type: "module" },
    );

    const constraints = state.getConstraintsForTree(tree);
    worker.postMessage({
      type: "count",
      config: {
        tree: serializeTree(tree),
        constraints: Object.fromEntries(constraints),
      },
    });

    worker.onmessage = (event) => {
      if (event.data.type === "count") {
        counts[key] = event.data.result.count;
        pending--;
        if (pending === 0) {
          counts.totalCount =
            counts.classCount * counts.specCount * counts.heroCount;
          state.updateCounts(counts);
        }
        worker.terminate();
      } else if (event.data.type === "error") {
        console.error(`Solver error for ${key}:`, event.data.message);
        pending--;
        worker.terminate();
      }
    };

    countWorkers.push(worker);
  }
}

state.subscribe((event) => {
  switch (event.type) {
    case "spec-selected": {
      const spec = event.spec;
      const heroTree = spec.heroTrees[0] ?? null;
      if (heroTree) state.selectHeroTree(heroTree);
      renderTrees(spec.classTree, spec.specTree, heroTree);
      break;
    }
    case "hero-tree-selected": {
      const spec = state.activeSpec;
      if (spec) {
        renderTrees(spec.classTree, spec.specTree, event.tree);
      }
      break;
    }
    case "constraint-changed":
    case "constraint-removed":
      scheduleCount();
      break;
  }
});

async function init(): Promise<void> {
  try {
    const data = await electronAPI.fetchTalentData();
    state.setSpecs(data.specs, data.version, data.cached);
    showSplash(data.specs);
  } catch (err) {
    mainContent.innerHTML = "";
    const errorDiv = document.createElement("div");
    errorDiv.className = "empty-state";
    const p1 = document.createElement("p");
    p1.textContent = "Failed to load talent data";
    const p2 = document.createElement("p");
    p2.style.cssText = "color: var(--text-muted); font-size: 12px;";
    p2.textContent = err instanceof Error ? err.message : String(err);
    errorDiv.append(p1, p2);
    mainContent.appendChild(errorDiv);
  }
}

init();
