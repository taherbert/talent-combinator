import type { Specialization, TalentNode } from "../shared/types";
import { BASE64_CHARS } from "./hash-base64";

export class BitWriter {
  private bits: number[] = [];

  write(value: number, bitCount: number): void {
    for (let i = 0; i < bitCount; i++) {
      this.bits.push((value >> i) & 1);
    }
  }

  toBase64(): string {
    const chars: string[] = [];
    for (let i = 0; i < this.bits.length; i += 6) {
      let val = 0;
      for (let b = 0; b < 6; b++) {
        if (i + b < this.bits.length) val |= (this.bits[i + b] & 1) << b;
      }
      chars.push(BASE64_CHARS[val]);
    }
    return chars.join("");
  }
}

export interface EncodeInput {
  version?: number; // 1 or 2; defaults to 2 (current game client)
  specId: number;
  treeHashBytes: number[];
  // nodeId → { ranks, entryIndex?, isPurchased }
  selections: Map<number, NodeSelection>;
}

export interface NodeSelection {
  ranks: number;
  entryIndex?: number;
  isPurchased: boolean;
}

/**
 * Encodes a full talent loadout into a WoW talent import string.
 *
 * `nodes` must be the full sorted node list for the spec (class + all specs'
 * spec/hero nodes + subTree stubs + system stubs) — same set used by the decoder.
 */
export function encodeTalentHash(
  input: EncodeInput,
  nodes: TalentNode[],
): string {
  const writer = new BitWriter();
  const sortedNodes = [...nodes].sort((a, b) => a.id - b.id);

  // Header: version (8) + specId (16) + treeHash (128)
  writer.write(input.version ?? 2, 8);
  writer.write(input.specId, 16);
  for (let i = 0; i < 16; i++) {
    writer.write(input.treeHashBytes[i] ?? 0, 8);
  }

  for (const node of sortedNodes) {
    const sel = input.selections.get(node.id);
    if (!sel) {
      writer.write(0, 1); // not selected
      continue;
    }

    writer.write(1, 1); // isSelected
    writer.write(sel.isPurchased ? 1 : 0, 1); // isPurchased

    if (!sel.isPurchased) continue; // free/granted — no more bits

    const isPartiallyRanked = sel.ranks < node.maxRanks;
    writer.write(isPartiallyRanked ? 1 : 0, 1);
    if (isPartiallyRanked) writer.write(sel.ranks, 6);

    const isChoice = sel.entryIndex !== undefined;
    writer.write(isChoice ? 1 : 0, 1);
    if (isChoice) writer.write(sel.entryIndex!, 2);
  }

  return writer.toBase64();
}

export interface EntryLookupInfo {
  nodeId: number;
  entryIndex?: number;
}

/**
 * Builds a map from entryId → { nodeId, entryIndex } for fast build→node mapping.
 * For single nodes, entryIndex is undefined. For choice nodes, it's the 0-based index.
 */
export function buildEntryLookup(
  tree: Iterable<TalentNode>,
): Map<number, EntryLookupInfo> {
  const lookup = new Map<number, EntryLookupInfo>();
  for (const node of tree) {
    for (let i = 0; i < node.entries.length; i++) {
      const entry = node.entries[i];
      lookup.set(entry.id, {
        nodeId: node.id,
        entryIndex: node.type === "choice" ? i : undefined,
      });
    }
  }
  return lookup;
}

function makeStub(id: number): TalentNode {
  return {
    id,
    name: "",
    icon: "",
    type: "single",
    maxRanks: 1,
    entries: [],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: true,
    entryNode: true,
    isApex: false,
  };
}

/**
 * Assembles the full node list needed for hash encoding/decoding.
 *
 * The WoW hash format encodes every node returned by C_Traits.GetTreeNodes:
 * class nodes, all specs' spec/hero nodes (including other specs of the same
 * class), subTree selection nodes, and system nodes.
 */
export function buildAllNodesForSpec(sameClassSpecs: Specialization[]): {
  allNodes: TalentNode[];
  allNodeMap: Map<number, TalentNode>;
} {
  const allNodeMap = new Map<number, TalentNode>();
  for (const s of sameClassSpecs) {
    for (const node of s.classTree.nodes.values())
      allNodeMap.set(node.id, node);
    for (const node of s.specTree.nodes.values()) allNodeMap.set(node.id, node);
    for (const heroTree of s.heroTrees)
      for (const node of heroTree.nodes.values()) allNodeMap.set(node.id, node);
    for (const stn of s.subTreeNodes) allNodeMap.set(stn.id, makeStub(stn.id));
    for (const sid of s.systemNodeIds) allNodeMap.set(sid, makeStub(sid));
  }
  return { allNodes: [...allNodeMap.values()], allNodeMap };
}
