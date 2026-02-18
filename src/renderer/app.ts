import { state } from "./state";
import { ClassPicker } from "./ui/class-picker";
import { TalentTreeView } from "./ui/talent-tree";
import { CombinationCounter } from "./ui/combination-counter";
import { ExportPanel } from "./ui/export-panel";
import { countTreeBuilds } from "../shared/build-counter";
import { decodeTalentHash, type HashSelection } from "./hash-decoder";
import type {
  Constraint,
  CountResult,
  Specialization,
  TalentNode,
  TalentTree,
  Loadout,
} from "../shared/types";
import { SOLVER_DEBOUNCE_MS } from "../shared/constants";

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
const cachedDetails: Record<CountKey, CountResult> = {
  classCount: { count: 1n, durationMs: 0, warnings: [] },
  specCount: { count: 1n, durationMs: 0, warnings: [] },
  heroCount: { count: 1n, durationMs: 0, warnings: [] },
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

function runCount(): void {
  const spec = state.activeSpec;
  if (!spec) return;

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

  for (const { tree, key } of treesToCount) {
    const constraints = state.getConstraintsForTree(tree);
    try {
      cachedDetails[key] = countTreeBuilds(tree, constraints);
    } catch (err) {
      console.error(`[count] ${key} failed:`, err);
      cachedDetails[key] = { count: 0n, durationMs: 0, warnings: [] };
    }
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

  // No implied-predecessor computation needed: every non-choice node is
  // explicitly user-owned, so there are no gaps to infer.
  for (const node of toSelect) {
    state.setConstraintQuiet({ nodeId: node.id, type: "always" });
  }
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
        autoSelectHeroNodes(event.tree);
        renderTrees(spec.classTree, spec.specTree, event.tree);
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

      if (key) scheduleCount(key);
      break;
    }
    case "constraint-removed": {
      const tree = findTreeForNode(event.nodeId);
      if (tree) recomputeImpliedForTree(tree);

      const key = detectTreeKey(event.nodeId);
      if (key) scheduleCount(key);
      break;
    }
  }
});

// --- Import talent hash ---

function showImportHashDialog(
  nodes: TalentNode[],
): Promise<HashSelection[] | null> {
  return new Promise((resolve) => {
    const dialogContainer = document.getElementById("dialog-container")!;
    let resolved = false;

    const finish = (val: HashSelection[] | null): void => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(val);
    };

    const overlay = document.createElement("div");
    overlay.className = "export-dialog";

    const content = document.createElement("div");
    content.className = "export-dialog-content";
    content.style.cssText = "width: 500px; max-height: 60vh;";

    const dialogHeader = document.createElement("div");
    dialogHeader.className = "export-dialog-header";
    const title = document.createElement("h2");
    title.textContent = "Import Talent Hash";
    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-secondary";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => finish(null));
    dialogHeader.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "export-dialog-body";

    const label = document.createElement("p");
    label.textContent =
      "Paste a WoW talent import string. All selected talents will be added as must-have constraints.";
    label.style.cssText =
      "margin-bottom: 12px; color: var(--text-muted); font-size: 12px;";

    const textarea = document.createElement("textarea");
    textarea.className = "export-output";
    textarea.style.cssText = "min-height: 80px; resize: vertical;";
    textarea.placeholder = "BQEAAAAAAAAAAAAAAAAAAAAFBg...";

    const errorMsg = document.createElement("p");
    errorMsg.style.cssText =
      "color: var(--color-red, #e74c3c); font-size: 12px; margin-top: 8px; display: none;";

    body.append(label, textarea, errorMsg);

    const footer = document.createElement("div");
    footer.className = "export-dialog-footer";
    footer.style.cssText =
      "display: flex; justify-content: flex-end; gap: 8px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => finish(null));

    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-primary";
    importBtn.textContent = "Import";
    importBtn.addEventListener("click", () => {
      const val = textarea.value.trim();
      if (!val) {
        errorMsg.textContent = "Please paste a talent string.";
        errorMsg.style.display = "block";
        return;
      }
      const selections = decodeTalentHash(val, nodes);
      if (selections === null) {
        errorMsg.textContent =
          "Invalid talent string. Make sure the correct spec is selected and paste the full import string from the game.";
        errorMsg.style.display = "block";
        return;
      }
      if (selections.length === 0) {
        errorMsg.textContent =
          "No talents found in this string. Make sure you are importing a build with at least one selected talent.";
        errorMsg.style.display = "block";
        return;
      }
      finish(selections);
    });

    footer.append(cancelBtn, importBtn);

    content.append(dialogHeader, body, footer);
    overlay.appendChild(content);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(null);
    });

    dialogContainer.appendChild(overlay);
    textarea.focus();
  });
}

async function importTalentHash(): Promise<void> {
  const spec = state.activeSpec;
  if (!spec) return;

  // The game encodes subTreeNodes (hero-tree selection nodes) in the bit
  // stream alongside regular talent nodes, sorted by nodeId. We must include
  // them so subsequent node bits are read at the correct positions.
  const subTreeStubs: TalentNode[] = spec.subTreeNodes.map((stn) => ({
    id: stn.id,
    name: "",
    icon: "",
    type: "choice" as const,
    maxRanks: 1,
    entries: [],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: false,
    entryNode: false,
    isApex: false,
  }));

  const allNodes: TalentNode[] = [
    ...spec.classTree.nodes.values(),
    ...spec.specTree.nodes.values(),
    ...spec.heroTrees.flatMap((t) => [...t.nodes.values()]),
    ...subTreeStubs,
  ];

  const selections = await showImportHashDialog(allNodes);
  if (!selections?.length) return;

  // Detect hero tree from the subTree selection node's entryIndex, which maps
  // directly to the chosen hero spec via traitSubTreeId.
  const subTreeNodeIds = new Set(spec.subTreeNodes.map((s) => s.id));
  let detectedHeroTree: TalentTree | null = null;
  for (const sel of selections) {
    const stn = spec.subTreeNodes.find((s) => s.id === sel.nodeId);
    if (stn && sel.entryIndex !== undefined) {
      const traitSubTreeId = stn.entries[sel.entryIndex]?.traitSubTreeId;
      if (traitSubTreeId != null) {
        detectedHeroTree =
          spec.heroTrees.find((ht) => ht.subTreeId === traitSubTreeId) ?? null;
        break;
      }
    }
  }

  // Reset spec state (clears constraints, auto-selects first hero tree)
  state.selectSpec(spec);

  // Switch to the detected hero tree if different from the auto-selected one
  if (detectedHeroTree && detectedHeroTree !== state.activeHeroTree) {
    state.selectHeroTree(detectedHeroTree);
  }

  // Apply talent constraints — skip subTree selection nodes
  const talentNodeIds = new Set(
    allNodes.filter((n) => !subTreeNodeIds.has(n.id)).map((n) => n.id),
  );

  for (const sel of selections) {
    if (!talentNodeIds.has(sel.nodeId)) continue;

    const constraint: Constraint = {
      nodeId: sel.nodeId,
      type: "always",
      entryIndex: sel.entryIndex,
    };
    state.setConstraint(constraint);
  }
}

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

// Header save/load/import buttons
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

const headerImportBtn = document.createElement("button");
headerImportBtn.className = "btn btn-secondary btn-sm";
headerImportBtn.textContent = "Import Hash";
headerImportBtn.addEventListener("click", () => void importTalentHash());
headerActions.appendChild(headerImportBtn);

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
