import { describe, it, expect } from "vitest";
import { decodeTalentHash } from "../../src/renderer/hash-decoder";
import type { TalentNode } from "../../src/shared/types";

// Minimal node stub — decoder only needs id and maxRanks
function node(
  id: number,
  maxRanks = 1,
  type: "single" | "choice" = "single",
): TalentNode {
  return {
    id,
    name: `Node ${id}`,
    icon: "",
    type,
    maxRanks,
    entries: [],
    next: [],
    prev: [],
    reqPoints: 0,
    row: 0,
    col: 0,
    freeNode: false,
    entryNode: false,
    isApex: false,
  };
}

/**
 * Builds a talent hash string from raw bit values using the WoW LSB-first
 * base64 encoding. Allows constructing known-good test vectors.
 *
 * bits[0] is the first bit in the stream (LSB of the first base64 char).
 */
function encodeBits(bits: number[]): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chars: string[] = [];
  for (let i = 0; i < bits.length; i += 6) {
    let val = 0;
    for (let b = 0; b < 6; b++) {
      if (i + b < bits.length) val |= (bits[i + b] & 1) << b;
    }
    chars.push(alphabet[val]);
  }
  return chars.join("");
}

/** Build a header bit array: version (8) + specId (16) + treeHash (128) */
function header(version = 1, specId = 0): number[] {
  const bits: number[] = [];
  for (let i = 0; i < 8; i++) bits.push((version >> i) & 1);
  for (let i = 0; i < 16; i++) bits.push((specId >> i) & 1);
  for (let i = 0; i < 128; i++) bits.push(0); // tree hash zeros
  return bits;
}

// Shorthand to extract just the selections array from a decode result
function sel(hash: string, nodes: ReturnType<typeof node>[]) {
  return decodeTalentHash(hash, nodes)?.selections ?? null;
}

describe("decodeTalentHash", () => {
  it("returns null for empty string", () => {
    expect(decodeTalentHash("", [])).toBeNull();
  });

  it("returns null for unsupported version", () => {
    const bits = header(99);
    const hash = encodeBits([...bits, 0]);
    expect(decodeTalentHash(hash, [node(1)])).toBeNull();
  });

  it("includes specId in result", () => {
    const bits = [...header(1, 577), 0];
    const hash = encodeBits(bits);
    expect(decodeTalentHash(hash, [node(1)])?.specId).toBe(577);
  });

  it("returns empty selections when no nodes are selected", () => {
    const bits = [...header(), 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(1)])).toEqual([]);
  });

  it("decodes a single fully-ranked node (v1)", () => {
    const bits = [...header(), 1, 1, 0, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(1)])).toEqual([{ nodeId: 1, ranks: 1 }]);
  });

  it("decodes a 2-rank node at partial rank 1", () => {
    const rankBits = [1, 0, 0, 0, 0, 0]; // 1 in 6-bit LSB-first
    const bits = [...header(), 1, 1, 1, ...rankBits, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(1, 2)])).toEqual([{ nodeId: 1, ranks: 1 }]);
  });

  it("decodes a choice node with entry index 1", () => {
    const entryBits = [1, 0]; // 1 in 2-bit LSB-first
    const bits = [...header(), 1, 1, 0, 1, ...entryBits];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(2, 1, "choice")])).toEqual([
      { nodeId: 2, ranks: 1, entryIndex: 1 },
    ]);
  });

  it("decodes a choice node with entry index 0", () => {
    const bits = [...header(), 1, 1, 0, 1, 0, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(5, 1, "choice")])).toEqual([
      { nodeId: 5, ranks: 1, entryIndex: 0 },
    ]);
  });

  it("decodes a free/granted node (purchased=0)", () => {
    const bits = [...header(), 1, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(3, 2)])).toEqual([
      { nodeId: 3, ranks: 2, free: true },
    ]);
  });

  it("decodes multiple nodes and skips unselected ones", () => {
    // node1: not selected; node2: selected; node3: selected choice entry 0
    const bits = [...header(), 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0];
    const hash = encodeBits(bits);
    const nodes = [node(1), node(2), node(3, 1, "choice")];
    expect(sel(hash, nodes)).toEqual([
      { nodeId: 2, ranks: 1 },
      { nodeId: 3, ranks: 1, entryIndex: 0 },
    ]);
  });

  it("sorts nodes by ascending id regardless of input order", () => {
    // id=5 selected, id=10 not selected
    const bits = [...header(), 1, 1, 0, 0, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(10), node(5)])).toEqual([{ nodeId: 5, ranks: 1 }]);
  });

  it("strips base64 padding before decoding", () => {
    const bits = [...header(), 1, 1, 0, 0];
    const hash = encodeBits(bits) + "==";
    expect(sel(hash, [node(1)])).toEqual([{ nodeId: 1, ranks: 1 }]);
  });

  it("accepts version 2 strings", () => {
    const bits = [...header(2), 1, 1, 0, 0];
    const hash = encodeBits(bits);
    expect(sel(hash, [node(1)])).toEqual([{ nodeId: 1, ranks: 1 }]);
  });
});
