import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { parseSpecializations } from "../../src/main/data/parser";
import { decodeTalentHash } from "../../src/renderer/hash-decoder";
import type { HashDecodeResult } from "../../src/renderer/hash-decoder";
import {
  encodeTalentHash,
  buildEntryLookup,
  buildAllNodesForSpec,
} from "../../src/renderer/hash-encoder";
import type { NodeSelection } from "../../src/renderer/hash-encoder";
import type {
  RawSpecData,
  Specialization,
  TalentTree,
} from "../../src/shared/types";

const DATA_PATH =
  process.env.TALENT_DATA_PATH || "./test/fixtures/talents.json";
const HAS_DATA = existsSync(DATA_PATH);

// Known-good Vengeance DH hash from Wowhead/game client (version 2)
const VENGEANCE_HASH =
  "CUkAAAAAAAAAAAAAAAAAAAAAAAAYMzMjhZkZmBWMDDmZMzYmZmxYGzsNzYbMzyYMDAAAAzyMYYsswEGmZGLAAAAYgBAAzMADAAAgB";

/**
 * Reconstructs the EncodeInput selections from a decoded hash, mirroring
 * what export-panel.ts does during hash generation.
 */
function buildSelectionsFromDecode(
  decoded: HashDecodeResult,
  activeTrees: TalentTree[],
  sameClassSpecs: Specialization[],
): Map<number, NodeSelection> {
  const selections = new Map<number, NodeSelection>();

  // Free/granted nodes from the ACTIVE spec's trees only
  for (const tree of activeTrees) {
    for (const node of tree.nodes.values()) {
      if (node.freeNode || node.entryNode) {
        selections.set(node.id, {
          ranks: node.maxRanks,
          isPurchased: false,
        });
      }
    }
  }

  // SubTreeNode selection (hero tree choice)
  const allSubTreeNodes = sameClassSpecs.flatMap((s) => s.subTreeNodes);
  for (const sel of decoded.selections) {
    const stn = allSubTreeNodes.find((s) => s.id === sel.nodeId);
    if (stn && sel.entryIndex !== undefined) {
      selections.set(sel.nodeId, {
        ranks: 1,
        entryIndex: sel.entryIndex,
        isPurchased: true,
      });
    }
  }

  // Purchased/free talent selections from the hash
  const subTreeAndSystemIds = new Set([
    ...sameClassSpecs.flatMap((s) => s.subTreeNodes.map((n) => n.id)),
    ...sameClassSpecs.flatMap((s) => s.systemNodeIds),
  ]);
  for (const sel of decoded.selections) {
    if (subTreeAndSystemIds.has(sel.nodeId)) continue;
    if (sel.free) {
      selections.set(sel.nodeId, {
        ranks: sel.ranks,
        isPurchased: false,
      });
      continue;
    }
    selections.set(sel.nodeId, {
      ranks: sel.ranks,
      entryIndex: sel.entryIndex,
      isPurchased: true,
    });
  }

  return selections;
}

describe.skipIf(!HAS_DATA)("hash round-trip", () => {
  if (!HAS_DATA) return;

  const rawData: RawSpecData[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const specs = parseSpecializations(rawData);
  const vengeance = specs.find(
    (s) => s.className === "Demon Hunter" && s.specName === "Vengeance",
  )!;
  const sameClassSpecs = specs.filter(
    (s) => s.className === vengeance.className,
  );
  const { allNodes } = buildAllNodesForSpec(sameClassSpecs);

  const decoded = decodeTalentHash(VENGEANCE_HASH, allNodes)!;

  const allSubTreeNodes = sameClassSpecs.flatMap((s) => s.subTreeNodes);
  let activeHeroTree: TalentTree | null = null;
  for (const sel of decoded.selections) {
    const stn = allSubTreeNodes.find((s) => s.id === sel.nodeId);
    if (stn && sel.entryIndex !== undefined) {
      const traitSubTreeId = stn.entries[sel.entryIndex]?.traitSubTreeId;
      if (traitSubTreeId != null) {
        activeHeroTree =
          vengeance.heroTrees.find((ht) => ht.subTreeId === traitSubTreeId) ??
          null;
        break;
      }
    }
  }

  const activeTrees: TalentTree[] = [
    vengeance.classTree,
    vengeance.specTree,
    ...(activeHeroTree ? [activeHeroTree] : []),
  ];

  it("decodes the known hash successfully", () => {
    expect(decoded).not.toBeNull();
    expect(decoded.specId).toBe(581);
    expect(decoded.treeHashBytes).toHaveLength(16);
    expect(decoded.selections.length).toBeGreaterThan(0);
  });

  it("re-encodes to a hash that decodes identically", () => {
    const selections = buildSelectionsFromDecode(
      decoded,
      activeTrees,
      sameClassSpecs,
    );

    const reEncoded = encodeTalentHash(
      {
        version: 2,
        specId: decoded.specId,
        treeHashBytes: decoded.treeHashBytes,
        selections,
      },
      allNodes,
    );
    const reDecoded = decodeTalentHash(reEncoded, allNodes)!;

    expect(reDecoded).not.toBeNull();
    expect(reDecoded.specId).toBe(decoded.specId);
    expect(reDecoded.treeHashBytes).toEqual(decoded.treeHashBytes);
    expect(reDecoded.selections).toEqual(decoded.selections);
  });

  it("produces a hash string that matches the original character-for-character", () => {
    const selections = buildSelectionsFromDecode(
      decoded,
      activeTrees,
      sameClassSpecs,
    );

    const reEncoded = encodeTalentHash(
      {
        version: 2,
        specId: decoded.specId,
        treeHashBytes: decoded.treeHashBytes,
        selections,
      },
      allNodes,
    );

    expect(reEncoded).toBe(VENGEANCE_HASH);
  });

  it("entry lookup maps build entries back to nodes correctly", () => {
    const classLookup = buildEntryLookup(vengeance.classTree.nodes.values());
    const specLookup = buildEntryLookup(vengeance.specTree.nodes.values());

    for (const node of vengeance.classTree.nodes.values()) {
      for (let i = 0; i < node.entries.length; i++) {
        const info = classLookup.get(node.entries[i].id);
        expect(info).toBeDefined();
        expect(info!.nodeId).toBe(node.id);
        if (node.type === "choice") {
          expect(info!.entryIndex).toBe(i);
        } else {
          expect(info!.entryIndex).toBeUndefined();
        }
      }
    }

    for (const node of vengeance.specTree.nodes.values()) {
      for (let i = 0; i < node.entries.length; i++) {
        const info = specLookup.get(node.entries[i].id);
        expect(info).toBeDefined();
        expect(info!.nodeId).toBe(node.id);
      }
    }
  });
});
