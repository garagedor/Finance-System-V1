// Shared CRUD endpoint helper for finance portal API routes.
//
// Each portal collection follows the same shape: list (GET), create (POST),
// update (PUT), delete (DELETE). This helper factors out the boilerplate
// so each route file becomes a 5-line wrapper.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit, diffSummary } from "@/lib/audit";
import type { AuditKind } from "@/types/rbac";
import type { Filter } from "mongodb";

type CollName = keyof typeof FINANCE_COLLECTIONS;

interface CrudOpts<TRow> {
  collection: CollName;
  idPrefix: string;                                       // e.g. "exp", "inc"
  /** Optional override: build the Mongo filter from query params. */
  buildFilter?: (sp: URLSearchParams) => Filter<TRow>;
  /** Optional sort spec; default: { _id: -1 } */
  sort?: Record<string, 1 | -1>;
  /** Validate + normalize a POST/PUT body. Returns the doc to write or throws. */
  normalize?: (body: Record<string, unknown>, mode: "create" | "update") => Record<string, unknown>;
  /** Audit log kind for this collection. When set, every CRUD mutation
   *  appends to finance_audit. When undefined, no auditing happens. */
  auditKind?: AuditKind;
  /** Build a friendly one-line label for the audit summary from a row.
   *  Defaults to `row.name ?? row._id`. */
  auditLabel?: (row: Record<string, unknown>) => string;
}

export function makeCrud<TRow extends { _id: string }>(opts: CrudOpts<TRow>) {
  return {
    async GET(req: NextRequest) {
      const session = await readPortalSession();
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      // coll() is synchronous; this primes the Mongo connection so coll()
      // can return the collection handle without throwing
      // "Finance DB not initialized".
      await ensureFinanceIndexes();
      const sp = req.nextUrl.searchParams;
      const filter = opts.buildFilter ? opts.buildFilter(sp) : ({} as Filter<TRow>);
      const sort = opts.sort ?? { _id: -1 };
      const limit = Math.min(Number(sp.get("limit") ?? 200), 1000);
      const skip = Math.max(Number(sp.get("skip") ?? 0), 0);
      const c = coll<TRow>(FINANCE_COLLECTIONS[opts.collection]);
      const [rows, total] = await Promise.all([
        c.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
        c.countDocuments(filter),
      ]);
      return NextResponse.json({ rows, total, limit, skip });
    },

    async POST(req: NextRequest) {
      const session = await readPortalSession();
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      try {
        await ensureFinanceIndexes();
        const body = (await req.json()) as Record<string, unknown>;
        const normalized = opts.normalize
          ? opts.normalize(body, "create")
          : body;
        const doc = {
          _id: newId(opts.idPrefix),
          ...normalized,
          created_at: new Date().toISOString(),
          created_by: session.name,
        };
        const c = coll(FINANCE_COLLECTIONS[opts.collection]);
        await c.insertOne(doc as unknown as TRow);
        if (opts.auditKind) {
          const label = opts.auditLabel ? opts.auditLabel(doc) : labelOf(doc);
          await audit({
            kind: opts.auditKind,
            target_id: doc._id,
            before: null,
            after: doc,
            summary: `Created ${opts.auditKind}: ${label}`,
            changed_by: session.name,
          });
        }
        return NextResponse.json({ row: doc }, { status: 201 });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Create failed" },
          { status: 400 }
        );
      }
    },

    async PUT(req: NextRequest) {
      const session = await readPortalSession();
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      try {
        await ensureFinanceIndexes();
        const body = (await req.json()) as Record<string, unknown> & { _id?: string };
        const id = body._id;
        if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });
        const { _id: _, ...rest } = body;
        const normalized = opts.normalize ? opts.normalize(rest, "update") : rest;
        const c = coll(FINANCE_COLLECTIONS[opts.collection]);
        const before = opts.auditKind
          ? await c.findOne({ _id: id } as unknown as Filter<TRow>)
          : null;
        const r = await c.updateOne(
          { _id: id } as unknown as Filter<TRow>,
          { $set: { ...normalized, updated_at: new Date().toISOString(), updated_by: session.name } }
        );
        if (r.matchedCount === 0) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (opts.auditKind) {
          const after = await c.findOne({ _id: id } as unknown as Filter<TRow>);
          const beforeObj = before as unknown as Record<string, unknown> | null;
          const afterObj = after as unknown as Record<string, unknown> | null;
          const label = opts.auditLabel
            ? opts.auditLabel(afterObj ?? {})
            : labelOf(afterObj ?? beforeObj ?? {});
          await audit({
            kind: opts.auditKind,
            target_id: id,
            before,
            after,
            summary: `Updated ${opts.auditKind} "${label}": ${diffSummary(beforeObj, afterObj)}`,
            changed_by: session.name,
          });
        }
        return NextResponse.json({ ok: true });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Update failed" },
          { status: 400 }
        );
      }
    },

    async DELETE(req: NextRequest) {
      const session = await readPortalSession();
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      await ensureFinanceIndexes();
      const sp = req.nextUrl.searchParams;
      const id = sp.get("_id");
      if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });
      const c = coll(FINANCE_COLLECTIONS[opts.collection]);
      const before = opts.auditKind
        ? await c.findOne({ _id: id } as unknown as Filter<TRow>)
        : null;
      const r = await c.deleteOne({ _id: id } as unknown as Filter<TRow>);
      if (opts.auditKind && before) {
        const beforeObj = before as unknown as Record<string, unknown>;
        const label = opts.auditLabel ? opts.auditLabel(beforeObj) : labelOf(beforeObj);
        await audit({
          kind: opts.auditKind,
          target_id: id,
          before,
          after: null,
          summary: `Deleted ${opts.auditKind} "${label}"`,
          changed_by: session.name,
        });
      }
      return NextResponse.json({ deletedCount: r.deletedCount });
    },
  };
}

function labelOf(row: Record<string, unknown>): string {
  const name = row.name ?? row.title ?? row.label ?? row.merchant_name ?? row._id;
  const amount = row.amount;
  if (typeof amount === "number" && amount !== 0) {
    return `${String(name)} $${amount.toLocaleString()}`;
  }
  return String(name ?? "(unnamed)");
}
