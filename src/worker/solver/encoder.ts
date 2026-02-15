import type { Build } from "../../shared/types";

export function encodeBuild(build: Build): string {
  const sorted = Array.from(build.entries.entries()).sort(([a], [b]) => a - b);
  const parts: string[] = [];
  for (const [entryId, points] of sorted) {
    if (points > 0) {
      parts.push(`${entryId}:${points}`);
    }
  }
  return parts.join("/");
}
