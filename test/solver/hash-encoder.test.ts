import { describe, it, expect } from "vitest";
import {
  BitWriter,
  encodeTalentHash,
  buildEntryLookup,
} from "../../src/renderer/hash-encoder";
import { decodeTalentHash } from "../../src/renderer/hash-decoder";
import type { TalentNode, TalentEntry } from "../../src/shared/types";
import type { NodeSelection } from "../../src/renderer/hash-encoder";

function node(
  id: number,
  maxRanks = 1,
  type: "single" | "choice" = "single",
  entries?: TalentEntry[],
): TalentNode {
  const defaultEntries: TalentEntry[] =
    entries ??
    (type === "choice"
      ? [
          { id: id * 100, name: "A", maxRanks, index: 0, icon: "" },
          { id: id * 100 + 1, name: "B", maxRanks, index: 1, icon: "" },
        ]
      : [{ id: id * 100, name: "Node", maxRanks, index: 0, icon: "" }]);
  return {
    id,
    name: `Node ${id}`,
    icon: "",
    type,
    maxRanks,
    entries: defaultEntries,
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

const TREE_HASH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

describe("BitWriter", () => {
  it("round-trips with BitReader via base64", () => {
    const writer = new BitWriter();
    writer.write(1, 8); // version
    writer.write(577, 16); // specId
    for (let i = 0; i < 16; i++) writer.write(0, 8); // hash
    writer.write(1, 1); // selected
    writer.write(1, 1); // purchased
    writer.write(0, 1); // not partial
    writer.write(0, 1); // not choice

    const hash = writer.toBase64();
    const result = decodeTalentHash(hash, [node(1)]);
    expect(result).not.toBeNull();
    expect(result!.specId).toBe(577);
    expect(result!.selections).toEqual([{ nodeId: 1, ranks: 1 }]);
  });

  it("writes zero-length as no bits", () => {
    const writer = new BitWriter();
    writer.write(0, 0);
    expect(writer.toBase64()).toBe("");
  });
});

describe("encodeTalentHash", () => {
  it("encodes an unselected node", () => {
    const nodes = [node(1)];
    const hash = encodeTalentHash(
      {
        specId: 100,
        treeHashBytes: TREE_HASH,
        selections: new Map(),
      },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded).not.toBeNull();
    expect(decoded!.specId).toBe(100);
    expect(decoded!.selections).toEqual([]);
  });

  it("encodes a single fully-ranked node", () => {
    const nodes = [node(1)];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 1, isPurchased: true }],
    ]);
    const hash = encodeTalentHash(
      { specId: 200, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([{ nodeId: 1, ranks: 1 }]);
  });

  it("encodes a partial rank node", () => {
    const nodes = [node(1, 3)];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 2, isPurchased: true }],
    ]);
    const hash = encodeTalentHash(
      { specId: 300, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([{ nodeId: 1, ranks: 2 }]);
  });

  it("encodes a choice node with entry index", () => {
    const nodes = [node(1, 1, "choice")];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 1, entryIndex: 1, isPurchased: true }],
    ]);
    const hash = encodeTalentHash(
      { specId: 400, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([
      { nodeId: 1, ranks: 1, entryIndex: 1 },
    ]);
  });

  it("encodes a free/granted node (isPurchased=false)", () => {
    const nodes = [node(1, 2)];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 2, isPurchased: false }],
    ]);
    const hash = encodeTalentHash(
      { specId: 500, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([{ nodeId: 1, ranks: 2, free: true }]);
  });

  it("encodes multiple nodes with mixed types", () => {
    const nodes = [node(1), node(2, 3), node(3, 1, "choice"), node(4)];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 1, isPurchased: true }],
      // node 2 unselected
      [3, { ranks: 1, entryIndex: 0, isPurchased: true }],
      [4, { ranks: 1, isPurchased: false }], // free
    ]);
    const hash = encodeTalentHash(
      { specId: 600, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([
      { nodeId: 1, ranks: 1 },
      { nodeId: 3, ranks: 1, entryIndex: 0 },
      { nodeId: 4, ranks: 1, free: true },
    ]);
  });

  it("preserves specId and tree hash bytes", () => {
    const nodes = [node(1)];
    const hash = encodeTalentHash(
      { specId: 12345, treeHashBytes: TREE_HASH, selections: new Map() },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.specId).toBe(12345);
    expect(decoded!.treeHashBytes).toEqual(TREE_HASH);
  });

  it("sorts nodes by id regardless of input order", () => {
    const nodes = [node(10), node(5), node(1)];
    const selections = new Map<number, NodeSelection>([
      [5, { ranks: 1, isPurchased: true }],
    ]);
    const hash = encodeTalentHash(
      { specId: 700, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.selections).toEqual([{ nodeId: 5, ranks: 1 }]);
  });

  it("full encode-decode round-trip with all node types", () => {
    const nodes = [
      node(1), // fully ranked single
      node(2, 5), // partial rank
      node(3, 1, "choice"), // choice entry 0
      node(4, 1, "choice"), // choice entry 1
      node(5), // unselected
      node(6, 2), // free/granted
    ];
    const selections = new Map<number, NodeSelection>([
      [1, { ranks: 1, isPurchased: true }],
      [2, { ranks: 3, isPurchased: true }],
      [3, { ranks: 1, entryIndex: 0, isPurchased: true }],
      [4, { ranks: 1, entryIndex: 1, isPurchased: true }],
      // node 5 unselected
      [6, { ranks: 2, isPurchased: false }],
    ]);
    const hash = encodeTalentHash(
      { specId: 999, treeHashBytes: TREE_HASH, selections },
      nodes,
    );
    const decoded = decodeTalentHash(hash, nodes);
    expect(decoded!.specId).toBe(999);
    expect(decoded!.treeHashBytes).toEqual(TREE_HASH);
    expect(decoded!.selections).toEqual([
      { nodeId: 1, ranks: 1 },
      { nodeId: 2, ranks: 3 },
      { nodeId: 3, ranks: 1, entryIndex: 0 },
      { nodeId: 4, ranks: 1, entryIndex: 1 },
      { nodeId: 6, ranks: 2, free: true },
    ]);
  });
});

describe("buildEntryLookup", () => {
  it("maps entryId to nodeId for single nodes", () => {
    const n = node(10, 1, "single");
    const lookup = buildEntryLookup([n]);
    expect(lookup.get(1000)).toEqual({ nodeId: 10, entryIndex: undefined });
  });

  it("maps entryId to nodeId with entryIndex for choice nodes", () => {
    const n = node(20, 1, "choice");
    const lookup = buildEntryLookup([n]);
    expect(lookup.get(2000)).toEqual({ nodeId: 20, entryIndex: 0 });
    expect(lookup.get(2001)).toEqual({ nodeId: 20, entryIndex: 1 });
  });
});
