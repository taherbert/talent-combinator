import type {
  TalentTree,
  TalentNode,
  Constraint,
  WorkerRequest,
  WorkerResponse,
} from "../shared/types";
import { countBuilds, generateBuilds } from "./solver/engine";

// Deserialize tree data from main thread (Maps come as plain objects)
function deserializeTree(raw: any): TalentTree {
  const nodes = new Map<number, TalentNode>();
  const rawNodes = raw.nodes;

  if (rawNodes instanceof Map) {
    for (const [k, v] of rawNodes) {
      nodes.set(Number(k), v as TalentNode);
    }
  } else {
    for (const [k, v] of Object.entries(rawNodes)) {
      nodes.set(Number(k), v as TalentNode);
    }
  }

  return {
    ...raw,
    nodes,
  };
}

function deserializeConstraints(raw: any): Map<number, Constraint> {
  const constraints = new Map<number, Constraint>();
  if (raw instanceof Map) {
    for (const [k, v] of raw) {
      constraints.set(Number(k), v as Constraint);
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      constraints.set(Number(k), v as Constraint);
    }
  }
  return constraints;
}

self.onmessage = (event: MessageEvent) => {
  const request = event.data as WorkerRequest;
  const tree = deserializeTree(request.config.tree);
  const constraints = deserializeConstraints(request.config.constraints);

  try {
    if (request.type === "count") {
      const startTime = performance.now();
      const count = countBuilds(tree, constraints);
      const response: WorkerResponse = {
        type: "count",
        result: { count, durationMs: performance.now() - startTime },
      };
      self.postMessage(response);
    } else if (request.type === "generate") {
      const result = generateBuilds(tree, constraints, (current) => {
        const progress: WorkerResponse = {
          type: "progress",
          current,
          total: 0,
        };
        self.postMessage(progress);
      });

      // Convert Build Maps to plain objects for serialization
      const serializedBuilds = result.builds?.map((b) => ({
        entries: Object.fromEntries(b.entries),
      }));

      const response: WorkerResponse = {
        type: "generate",
        result: {
          ...result,
          builds: serializedBuilds as any,
        },
      };
      self.postMessage(response);
    }
  } catch (err) {
    const response: WorkerResponse = {
      type: "error",
      message: String(err),
    };
    self.postMessage(response);
  }
};
