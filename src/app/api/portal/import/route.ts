// CSV import endpoint. Two phases: preview (dry_run=1) returns parsed +
// validated rows without inserting; commit inserts rows + writes audit.
//
// Target collections: expenses or income. Column mapping comes from the
// caller — UI lets the user map CSV headers to fields explicitly.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import { audit } from "@/lib/audit";
import type { ExpenseRecord, ManualIncomeRecord } from "@/types/finance";

type Target = "expense" | "income";

interface ImportBody {
  target: Target;
  dry_run?: boolean;
  /** Mapping from CSV header → entity field. */
  mapping: Record<string, string>;
  rows: Record<string, string>[];
}

interface ValidatedRow {
  ok: boolean;
  errors: string[];
  doc: Record<string, unknown>;
  source_row: number;
}

const ALLOWED_FIELDS: Record<Target, string[]> = {
  expense: ["date", "amount", "category", "vendor_name", "payment_method", "notes", "status"],
  income: ["date", "amount", "source", "customer_name", "payment_method", "notes"],
};

export async function POST(req: NextRequest) {
  const perm = "finance:expenses:create"; // We'll re-check below if income
  const session = await requirePermission(perm);
  if (session instanceof NextResponse) return session;

  await ensureFinanceIndexes();
  const body = (await req.json()) as ImportBody;

  if (body.target !== "expense" && body.target !== "income") {
    return NextResponse.json({ error: "target must be 'expense' or 'income'" }, { status: 400 });
  }

  // For income, swap to the income-create permission.
  if (body.target === "income") {
    const s2 = await requirePermission("finance:income:create");
    if (s2 instanceof NextResponse) return s2;
  }

  const allowed = new Set(ALLOWED_FIELDS[body.target]);
  const mapping = body.mapping ?? {};
  const validated: ValidatedRow[] = body.rows.map((csvRow, i) => {
    const errors: string[] = [];
    const doc: Record<string, unknown> = {};
    for (const [csvHeader, field] of Object.entries(mapping)) {
      if (!field || !allowed.has(field)) continue;
      const raw = csvRow[csvHeader]?.trim() ?? "";
      if (field === "amount") {
        // Tolerate "$1,234.56" / "1234.56" / "-100"
        const cleaned = raw.replace(/[$,]/g, "").trim();
        const n = Number(cleaned);
        if (cleaned === "" || Number.isNaN(n)) {
          errors.push(`row ${i + 2}: amount '${raw}' is not a number`);
        } else {
          doc.amount = n;
        }
      } else if (field === "date") {
        // Tolerate YYYY-MM-DD or M/D/YYYY or MM/DD/YY
        const iso = normaliseDate(raw);
        if (!iso) errors.push(`row ${i + 2}: date '${raw}' is unparseable`);
        else doc.date = iso;
      } else if (raw !== "") {
        doc[field] = raw;
      }
    }
    if (!doc.date) errors.push(`row ${i + 2}: date is required`);
    if (typeof doc.amount !== "number") errors.push(`row ${i + 2}: amount is required`);
    return { ok: errors.length === 0, errors, doc, source_row: i };
  });

  const validCount = validated.filter((v) => v.ok).length;
  const errorCount = validated.length - validCount;
  const allErrors = validated.flatMap((v) => v.errors);

  if (body.dry_run !== false) {
    return NextResponse.json({
      preview: true,
      total_rows: validated.length,
      valid: validCount,
      errors: errorCount,
      error_messages: allErrors.slice(0, 25),
      sample: validated.slice(0, 5),
    });
  }

  if (errorCount > 0) {
    return NextResponse.json(
      { error: `Refusing to import: ${errorCount} row(s) have errors. Fix them or unmap the columns first.`, error_messages: allErrors.slice(0, 25) },
      { status: 400 }
    );
  }
  if (validCount === 0) {
    return NextResponse.json({ error: "No valid rows to import" }, { status: 400 });
  }

  const now = new Date().toISOString();
  if (body.target === "expense") {
    const c = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
    const docs = validated
      .filter((v) => v.ok)
      .map((v) => ({
        _id: newId("exp"),
        ...v.doc,
        category: (v.doc.category as string) ?? "misc",
        status: (v.doc.status as string) ?? "unpaid",
        created_at: now,
        created_by: session.name,
        imported_from_csv: true,
      })) as unknown as ExpenseRecord[];
    if (docs.length > 0) await c.insertMany(docs);
    await audit({
      kind: "expense",
      target_id: docs[0]?._id ?? "(batch)",
      before: null,
      after: { batch_size: docs.length },
      summary: `CSV import: created ${docs.length} expense(s)`,
      changed_by: session.name,
      action: "csv_import",
    });
    return NextResponse.json({ ok: true, inserted: docs.length });
  } else {
    const c = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
    const docs = validated
      .filter((v) => v.ok)
      .map((v) => ({
        _id: newId("inc"),
        ...v.doc,
        source: (v.doc.source as string) ?? "manual",
        created_at: now,
        created_by: session.name,
        imported_from_csv: true,
      })) as unknown as ManualIncomeRecord[];
    if (docs.length > 0) await c.insertMany(docs);
    await audit({
      kind: "income",
      target_id: docs[0]?._id ?? "(batch)",
      before: null,
      after: { batch_size: docs.length },
      summary: `CSV import: created ${docs.length} income row(s)`,
      changed_by: session.name,
      action: "csv_import",
    });
    return NextResponse.json({ ok: true, inserted: docs.length });
  }
}

function normaliseDate(raw: string): string | null {
  if (!raw) return null;
  // YYYY-MM-DD passthrough
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // M/D/YYYY or MM/DD/YYYY
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Last resort: Date.parse
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}
