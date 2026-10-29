/** In-memory double of the narrow collection API config-store.ts uses (tests only). */
import type { Filter, StoreCollection, ArenaStore } from "../config-store";

const matches = (doc: Record<string, unknown>, filter: Filter) =>
  Object.entries(filter).every(([k, v]) => doc[k] === v);

function sorter(s: Record<string, 1 | -1>) {
  return (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [k, dir] of Object.entries(s)) {
      const x = a[k] as number | string, y = b[k] as number | string;
      if (x < y) return -dir;
      if (x > y) return dir;
    }
    return 0;
  };
}

export class MemoryCollection<T extends { _id: string }> implements StoreCollection<T> {
  readonly docs: T[] = [];
  async insertOne(doc: T) {
    if (this.docs.some((d) => d._id === doc._id)) throw new Error(`E11000 duplicate key ${doc._id}`);
    this.docs.push(structuredClone(doc));
  }
  async findOne(filter: Filter, options?: { sort?: Record<string, 1 | -1> }) {
    let hits = this.docs.filter((d) => matches(d as never, filter));
    if (options?.sort) hits = [...hits].sort(sorter(options.sort) as never);
    return hits[0] ? structuredClone(hits[0]) : null;
  }
  find(filter: Filter) {
    const hits = this.docs.filter((d) => matches(d as never, filter));
    return { sort: (s: Record<string, 1 | -1>) => ({ toArray: async () => structuredClone([...hits].sort(sorter(s) as never)) }) };
  }
  async updateOne(filter: Filter, update: { $set: Partial<T> }) {
    const d = this.docs.find((x) => matches(x as never, filter));
    if (!d) return { matchedCount: 0 };
    Object.assign(d, structuredClone(update.$set));
    return { matchedCount: 1 };
  }
}

export function memoryStore(): ArenaStore & { [k: string]: MemoryCollection<never> } {
  return {
    settings: new MemoryCollection(),
    templates: new MemoryCollection(),
    ruleVersions: new MemoryCollection(),
    competitions: new MemoryCollection(),
    notices: new MemoryCollection(),
    audit: new MemoryCollection(),
  } as never;
}
