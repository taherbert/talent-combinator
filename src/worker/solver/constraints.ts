import type {
  BooleanExpr,
  Constraint,
  ConstraintType,
} from "../../shared/types";

export function evaluate(
  expr: BooleanExpr,
  selected: Map<number, number>,
): boolean {
  switch (expr.op) {
    case "TALENT_SELECTED":
      return (selected.get(expr.nodeId) ?? 0) >= (expr.minRank ?? 1);
    case "AND":
      return expr.children.every((c) => evaluate(c, selected));
    case "OR":
      return expr.children.some((c) => evaluate(c, selected));
  }
}

export function checkConstraints(
  constraints: Map<number, Constraint>,
  selected: Map<number, number>,
): boolean {
  for (const [nodeId, constraint] of constraints) {
    const points = selected.get(nodeId) ?? 0;

    switch (constraint.type) {
      case "always":
        if (points === 0) return false;
        break;
      case "never":
        if (points > 0) return false;
        break;
      case "conditional":
        if (constraint.condition) {
          const conditionMet = evaluate(constraint.condition, selected);
          if (conditionMet && points === 0) return false;
        }
        break;
    }
  }
  return true;
}

export function getNodesByType(
  constraints: Map<number, Constraint>,
  type: ConstraintType,
): Set<number> {
  const result = new Set<number>();
  for (const [nodeId, constraint] of constraints) {
    if (constraint.type === type) result.add(nodeId);
  }
  return result;
}
