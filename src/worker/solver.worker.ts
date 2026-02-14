import type {
  TalentTree,
  TalentNode,
  Constraint,
  WorkerResponse,
} from "../shared/types";
import { countBuilds, generateBuilds } from "./solver/engine";

// Structured clone converts Maps to plain objects across worker boundaries
function toNumberKeyedMap<V>(raw: unknown): Map<number, V> {
  const map = new Map<number, V>();
  if (raw instanceof Map) {
    for (const [k, v] of raw) map.set(Number(k), v as V);
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) map.set(Number(k), v as V);
  }
  return map;
}

function deserializeConfig(rawConfig: any): {
  tree: TalentTree;
  constraints: Map<number, Constraint>;
} {
  return {
    tree: {
      ...rawConfig.tree,
      nodes: toNumberKeyedMap<TalentNode>(rawConfig.tree.nodes),
    },
    constraints: toNumberKeyedMap<Constraint>(rawConfig.constraints),
  };
}

self.onmessage = (event: MessageEvent) => {
  const { type, config: rawConfig } = event.data;
  const { tree, constraints } = deserializeConfig(rawConfig);

  try {
    if (type === "count") {
      const startTime = performance.now();
      const count = countBuilds(tree, constraints);
      const response: WorkerResponse = {
        type: "count",
        result: { count, durationMs: performance.now() - startTime },
      };
      self.postMessage(response);
    } else if (type === "generate") {
      const result = generateBuilds(tree, constraints, (current) => {
        self.postMessage({
          type: "progress",
          current,
          total: 0,
        } as WorkerResponse);
      });

      const response: WorkerResponse = {
        type: "generate",
        result: {
          ...result,
          builds: result.builds?.map((b) => ({
            entries: Object.fromEntries(b.entries),
          })) as any,
        },
      };
      self.postMessage(response);
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) } as WorkerResponse);
  }
};
