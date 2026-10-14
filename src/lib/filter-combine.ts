// How table filters combine (owner rule 2026-10-14: "x + x + x").
//
// Several filters on the SAME field add up — "Status is Closed" + "Status is
// Estimate" shows both closed and estimate jobs, instead of nothing (no job
// can be both). Filters on DIFFERENT fields still narrow each other down
// (Status is Closed AND Tech is Yaniv).
//
// Range filters (> < >= <= and date ranges) on the same field still narrow
// each other, so "Amount > 100" + "Amount < 500" keeps meaning 100–500.
//
// With the OR switch every filter is alternative, exactly as before.

export type FilterPart = {
  field: string;
  /** A ready Mongo condition for this rule, e.g. { status: { $eq: 'Closed' } }. */
  condition: Record<string, any>;
  /** True for >, <, >=, <= and date-range rules. */
  range: boolean;
};

const RANGE_OPERATORS = new Set(['gt', 'lt', 'gte', 'lte']);
export const isRangeOperator = (op: string | undefined) => RANGE_OPERATORS.has(op ?? '');

/** Turn filter parts into a list of conditions that must ALL hold. */
export function combineFilterParts(parts: FilterPart[], logic: string | null | undefined): Record<string, any>[] {
  if (parts.length === 0) return [];
  if (String(logic ?? 'AND').toUpperCase() === 'OR') {
    return [parts.length === 1 ? parts[0].condition : { $or: parts.map((p) => p.condition) }];
  }
  const out: Record<string, any>[] = [];
  const choices = new Map<string, Record<string, any>[]>();
  for (const p of parts) {
    if (p.range) {
      out.push(p.condition);
      continue;
    }
    const list = choices.get(p.field) ?? [];
    list.push(p.condition);
    choices.set(p.field, list);
  }
  for (const list of choices.values()) {
    out.push(list.length === 1 ? list[0] : { $or: list });
  }
  return out;
}
