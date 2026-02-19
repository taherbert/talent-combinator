import type { TalentNode } from "../shared/types";
import { BASE64_CHARS } from "./hash-base64";

export interface HashSelection {
  nodeId: number;
  ranks: number;
  entryIndex?: number; // choice nodes: 0-based entry index
  free?: boolean; // isPurchased=0: granted/free, does not cost a talent point
}

export interface HashDecodeResult {
  specId: number;
  treeHashBytes: number[];
  selections: HashSelection[];
}

// Bits are packed LSB-first: bit 0 of each 6-bit base64 character is the
// first bit in the stream.
class BitReader {
  private pos = 0;
  private indices: number[];

  constructor(str: string) {
    this.indices = Array.from(str).map((c) => BASE64_CHARS.indexOf(c));
  }

  read(bits: number): number {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      const charIdx = Math.floor(this.pos / 6);
      const bitInChar = this.pos % 6;
      const charVal = this.indices[charIdx] ?? -1;
      if (charVal < 0) break;
      result |= ((charVal >> bitInChar) & 1) << i;
      this.pos++;
    }
    return result;
  }
}

/**
 * Decodes a WoW talent import string into a list of selected node choices.
 *
 * nodes must be all nodes for the spec (class + spec + all hero trees +
 * subTree selection nodes), sorted ascending by nodeId to match the game.
 *
 * Returns null if the string fails to parse (invalid format or version).
 */
export function decodeTalentHash(
  hashStr: string,
  nodes: TalentNode[],
): HashDecodeResult | null {
  const clean = hashStr.trim().replace(/=+$/, "").replace(/\s+/g, "");
  if (!clean) return null;

  const reader = new BitReader(clean);

  const version = reader.read(8);
  if (version !== 1 && version !== 2) return null;

  const specId = reader.read(16);
  const treeHashBytes: number[] = [];
  for (let i = 0; i < 16; i++) treeHashBytes.push(reader.read(8));

  const sortedNodes = [...nodes].sort((a, b) => a.id - b.id);
  const selections: HashSelection[] = [];

  for (const node of sortedNodes) {
    const isSelected = reader.read(1) === 1;
    if (!isSelected) continue;

    const isPurchased = reader.read(1) === 1;
    if (!isPurchased) {
      // Granted node: selected for free, does not consume talent points
      selections.push({ nodeId: node.id, ranks: node.maxRanks, free: true });
      continue;
    }

    const isPartiallyRanked = reader.read(1) === 1;
    const ranks = isPartiallyRanked ? reader.read(6) : node.maxRanks;

    const isChoiceNode = reader.read(1) === 1;
    const entryIndex = isChoiceNode ? reader.read(2) : undefined;

    selections.push({ nodeId: node.id, ranks, entryIndex });
  }

  return { specId, treeHashBytes, selections };
}
