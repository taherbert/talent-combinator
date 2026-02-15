import { state } from "./state";
import { ClassPicker } from "./ui/class-picker";
import { TalentTreeView } from "./ui/talent-tree";
import { CombinationCounter } from "./ui/combination-counter";
import { ExportPanel } from "./ui/export-panel";
import type {
  Constraint,
  Specialization,
  TalentNode,
  TalentTree,
  TreeCountDetail,
  Loadout,
} from "../shared/types";
import { SOLVER_DEBOUNCE_MS } from "../shared/constants";
import { validateTree } from "../shared/validation";

declare const electronAPI: import("../shared/types").ElectronAPI;

const headerEl = document.querySelector(".header")!;
const sidebar = document.getElementById("sidebar")!;
const sidebarToggle = document.getElementById("sidebar-toggle")!;
const sidebarBackdrop = document.getElementById("sidebar-backdrop")!;
const mainContent = document.getElementById("main-content")!;
const counterBar = document.getElementById("counter-bar")!;

// Components self-manage via DOM attachment and state subscriptions
void new ClassPicker(sidebar);
void new CombinationCounter(counterBar);
void new ExportPanel(counterBar);

let countDebounceTimer: ReturnType<typeof setTimeout> | null = null;
type CountKey = "classCount" | "specCount" | "heroCount";
const cachedDetails: Record<CountKey, TreeCountDetail> = {
  classCount: { count: 1n, durationMs: 0 },
  specCount: { count: 1n, durationMs: 0 },
  heroCount: { count: 1n, durationMs: 0 },
};
const dirtyTrees = new Set<CountKey>();

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

let activeTreeTab = "class";

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
    "Click to cycle: <em class='c-green'>always</em> &rarr; <em class='c-red'>never</em> &rarr; clear",
    "Right-click for <em>conditional</em> (AND/OR)",
  ].join(" &middot; ");
  mainContent.appendChild(instructions);

  // Tab bar
  const tabs = document.createElement("div");
  tabs.className = "tree-tabs";

  type TabEntry = { key: string; label: string; tree: TalentTree };
  const tabEntries: TabEntry[] = [
    { key: "class", label: "Class", tree: classTree },
  ];
  if (heroTree) {
    tabEntries.push({
      key: "hero",
      label: "Hero",
      tree: heroTree,
    });
  }
  tabEntries.push({ key: "spec", label: "Spec", tree: specTree });

  const containers = new Map<string, HTMLElement>();
  const tabBtns: HTMLButtonElement[] = [];

  for (const entry of tabEntries) {
    const btn = document.createElement("button");
    btn.className = "tree-tab";
    btn.textContent = entry.label;
    btn.dataset.key = entry.key;
    tabBtns.push(btn);
    tabs.appendChild(btn);

    const container = document.createElement("div");
    container.className = "tree-view-container";
    container.style.display = "none";
    new TalentTreeView(container).render(entry.tree);
    containers.set(entry.key, container);
  }

  // Hero tree selector (shown below tabs when hero tab is active)
  let heroSelector: HTMLElement | null = null;
  if (heroTree) {
    const spec = state.activeSpec!;
    if (spec.heroTrees.length > 1) {
      heroSelector = document.createElement("div");
      heroSelector.className = "hero-selector";
      heroSelector.style.display = "none";
      for (const ht of spec.heroTrees) {
        const btn = document.createElement("button");
        btn.textContent = ht.subTreeName || "Hero Tree";
        if (ht === heroTree) btn.classList.add("active");
        btn.addEventListener("click", () => {
          activeTreeTab = "hero";
          state.selectHeroTree(ht);
        });
        heroSelector.appendChild(btn);
      }
    }
  }

  function activateTab(key: string): void {
    activeTreeTab = key;
    for (const [k, c] of containers) {
      c.style.display = k === key ? "" : "none";
    }
    for (const btn of tabBtns) {
      btn.classList.toggle("active", btn.dataset.key === key);
    }
    if (heroSelector) {
      heroSelector.style.display = key === "hero" ? "" : "none";
    }
  }

  for (const btn of tabBtns) {
    btn.addEventListener("click", () => activateTab(btn.dataset.key!));
  }

  mainContent.appendChild(tabs);
  if (heroSelector) mainContent.appendChild(heroSelector);
  for (const container of containers.values()) {
    mainContent.appendChild(container);
  }

  // Restore last active tab, or default to class
  const validKeys = tabEntries.map((e) => e.key);
  if (!validKeys.includes(activeTreeTab)) activeTreeTab = "class";
  activateTab(activeTreeTab);

  scheduleCount();
}

function runValidation(): void {
  const spec = state.activeSpec;
  if (!spec) return;

  const errors: string[] = [];
  const trees = [spec.classTree, spec.specTree];
  const heroTree = state.activeHeroTree;
  if (heroTree) trees.push(heroTree);

  for (const tree of trees) {
    const treeConstraints = state.getConstraintsForTree(tree);
    const treeErrors = validateTree(tree, treeConstraints);
    const label = tree.type.charAt(0).toUpperCase() + tree.type.slice(1);
    for (const err of treeErrors) {
      errors.push(`${label}: ${err.message}`);
    }
  }

  state.setValidationErrors(errors);
}

// --- Counting ---

function detectTreeKey(nodeId: number): CountKey | null {
  const spec = state.activeSpec;
  if (!spec) return null;
  if (spec.classTree.nodes.has(nodeId)) return "classCount";
  if (spec.specTree.nodes.has(nodeId)) return "specCount";
  const heroTree = state.activeHeroTree;
  if (heroTree?.nodes.has(nodeId)) return "heroCount";
  return null;
}

function scheduleCount(affectedTree?: CountKey): void {
  if (affectedTree) {
    dirtyTrees.add(affectedTree);
  } else {
    dirtyTrees.add("classCount");
    dirtyTrees.add("specCount");
    dirtyTrees.add("heroCount");
  }
  if (countDebounceTimer) clearTimeout(countDebounceTimer);
  countDebounceTimer = setTimeout(runCount, SOLVER_DEBOUNCE_MS);
}

function publishCounts(): void {
  const classCount = cachedDetails.classCount.count;
  const specCount = cachedDetails.specCount.count;
  const heroCount = cachedDetails.heroCount.count;
  state.updateCounts({
    classCount,
    specCount,
    heroCount,
    totalCount: classCount * specCount * heroCount,
    details: {
      class: cachedDetails.classCount,
      spec: cachedDetails.specCount,
      hero: cachedDetails.heroCount,
    },
  });
}

let countWorkers: Worker[] = [];
let countGeneration = 0;

function countTreeInWorker(
  tree: TalentTree,
  constraints: Map<number, Constraint>,
): { worker: Worker; promise: Promise<TreeCountDetail> } {
  const worker = new Worker(
    new URL("../worker/solver.worker.ts", import.meta.url),
    { type: "module" },
  );

  const promise = new Promise<TreeCountDetail>((resolve) => {
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "count") {
        resolve({
          count: BigInt(data.result.count),
          durationMs: data.result.durationMs,
        });
        worker.terminate();
      } else if (data.type === "error") {
        console.error("Solver error:", data.message);
        resolve({ count: 0n, durationMs: 0 });
        worker.terminate();
      }
    };
    worker.onerror = () => {
      resolve({ count: 0n, durationMs: 0 });
      worker.terminate();
    };
  });

  worker.postMessage({
    type: "count",
    config: {
      tree: { ...tree, nodes: Object.fromEntries(tree.nodes) },
      constraints: Object.fromEntries(constraints),
    },
  });

  return { worker, promise };
}

async function runCount(): Promise<void> {
  const spec = state.activeSpec;
  if (!spec) return;

  // Cancel any in-progress counting
  for (const w of countWorkers) w.terminate();
  countWorkers = [];
  const generation = ++countGeneration;

  const allTrees: { tree: TalentTree; key: CountKey }[] = [
    { tree: spec.classTree, key: "classCount" },
    { tree: spec.specTree, key: "specCount" },
  ];

  const heroTree = state.activeHeroTree;
  if (heroTree) {
    allTrees.push({ tree: heroTree, key: "heroCount" });
  }

  const treesToCount = allTrees.filter(({ key }) => dirtyTrees.has(key));
  dirtyTrees.clear();

  if (treesToCount.length === 0) return;

  const jobs = treesToCount.map(({ tree, key }) => {
    const constraints = state.getConstraintsForTree(tree);
    const { worker, promise } = countTreeInWorker(tree, constraints);
    return { key, worker, promise };
  });

  countWorkers = jobs.map((j) => j.worker);

  const results = await Promise.all(
    jobs.map(async (j) => ({ key: j.key, detail: await j.promise })),
  );

  // Discard stale results if a newer count was started
  if (generation !== countGeneration) return;

  countWorkers = [];
  for (const { key, detail } of results) {
    cachedDetails[key] = detail;
  }
  publishCounts();
}

// --- Implied predecessors ---

function computeImpliedPredecessors(
  nodeId: number,
  tree: TalentTree,
): number[] {
  const implied: number[] = [];
  let current = tree.nodes.get(nodeId);

  while (
    current &&
    !current.entryNode &&
    !current.freeNode &&
    current.prev.length > 0
  ) {
    // Filter out "never" predecessors
    const available = current.prev.filter(
      (id) => state.constraints.get(id)?.type !== "never",
    );
    if (available.length !== 1) break; // Multiple paths — user must choose

    const prevId = available[0];
    const prev = tree.nodes.get(prevId);
    if (!prev) break;

    if (!state.isUserOwned(prevId)) {
      implied.push(prevId);
    }
    current = prev;
  }
  return implied;
}

function findTreeForNode(nodeId: number): TalentTree | null {
  const spec = state.activeSpec;
  if (!spec) return null;
  if (spec.classTree.nodes.has(nodeId)) return spec.classTree;
  if (spec.specTree.nodes.has(nodeId)) return spec.specTree;
  const heroTree = state.activeHeroTree;
  if (heroTree?.nodes.has(nodeId)) return heroTree;
  return null;
}

function recomputeImpliedForTree(tree: TalentTree): void {
  state.clearAllImpliedInTree(tree);
  for (const [nodeId, constraint] of state.constraints) {
    if (tree.nodes.has(nodeId) && constraint.type === "always") {
      const implied = computeImpliedPredecessors(nodeId, tree);
      state.setImpliedConstraints(nodeId, implied);
    }
  }
}

// --- Auto-select hero nodes ---

function isRealChoice(node: TalentNode): boolean {
  return node.type === "choice" && !node.isApex;
}

function autoSelectHeroNodes(tree: TalentTree): void {
  const toSelect: TalentNode[] = [];
  for (const node of tree.nodes.values()) {
    if (state.constraints.has(node.id)) continue;
    if (!isRealChoice(node)) toSelect.push(node);
  }
  if (toSelect.length === 0) return;

  // Batch: set constraints and compute implied predecessors without
  // emitting individual events (avoids N separate validations).
  for (const node of toSelect) {
    state.setConstraintQuiet({ nodeId: node.id, type: "always" });
  }
  for (const node of toSelect) {
    const implied = computeImpliedPredecessors(node.id, tree);
    state.setImpliedConstraints(node.id, implied);
  }

  runValidation();
  scheduleCount("heroCount");
}

// --- Event handling ---

state.subscribe((event) => {
  switch (event.type) {
    case "spec-selected": {
      const spec = event.spec;
      const heroTree = spec.heroTrees[0] ?? null;
      if (heroTree) {
        state.selectHeroTree(heroTree);
        // hero-tree-selected handler renders + auto-selects
      } else {
        renderTrees(spec.classTree, spec.specTree, null);
      }
      break;
    }
    case "hero-tree-selected": {
      const spec = state.activeSpec;
      if (spec) {
        renderTrees(spec.classTree, spec.specTree, event.tree);
        autoSelectHeroNodes(event.tree);
      }
      break;
    }
    case "constraint-changed": {
      const nodeId = event.constraint.nodeId;
      const key = detectTreeKey(nodeId);

      if (state.isImplied(nodeId)) {
        state.promoteImpliedToUser(nodeId);
      }

      const tree = findTreeForNode(nodeId);
      if (tree) recomputeImpliedForTree(tree);

      runValidation();
      if (key) scheduleCount(key);
      break;
    }
    case "constraint-removed": {
      const tree = findTreeForNode(event.nodeId);
      if (tree) recomputeImpliedForTree(tree);

      runValidation();
      const key = detectTreeKey(event.nodeId);
      if (key) scheduleCount(key);
      break;
    }
  }
});

// --- Save/Load ---

async function saveLoadout(): Promise<void> {
  const spec = state.activeSpec;
  if (!spec) return;

  const loadout: Loadout = {
    version: 1,
    className: spec.className,
    specName: spec.specName,
    heroTreeName: state.activeHeroTree?.subTreeName,
    constraints: Array.from(state.constraints.values()),
  };

  await electronAPI.saveLoadout(loadout);
}

async function loadLoadout(): Promise<void> {
  const loadout = await electronAPI.loadLoadout();
  if (!loadout) return;

  const spec = state.specs.find(
    (s) => s.className === loadout.className && s.specName === loadout.specName,
  );
  if (!spec) return;

  // Select spec (clears existing constraints)
  state.selectSpec(spec);

  // Select hero tree
  if (loadout.heroTreeName) {
    const heroTree = spec.heroTrees.find(
      (ht) => ht.subTreeName === loadout.heroTreeName,
    );
    if (heroTree) state.selectHeroTree(heroTree);
  }

  // Restore constraints
  for (const constraint of loadout.constraints) {
    state.setConstraint(constraint);
  }
}

// Header save/load buttons
const headerActions = document.createElement("div");
headerActions.className = "header-actions";

const headerLoadBtn = document.createElement("button");
headerLoadBtn.className = "btn btn-secondary btn-sm";
headerLoadBtn.textContent = "Load";
headerLoadBtn.addEventListener("click", loadLoadout);
headerActions.appendChild(headerLoadBtn);

const headerSaveBtn = document.createElement("button");
headerSaveBtn.className = "btn btn-secondary btn-sm";
headerSaveBtn.textContent = "Save";
headerSaveBtn.addEventListener("click", saveLoadout);
headerActions.appendChild(headerSaveBtn);

headerEl.appendChild(headerActions);

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
