// Global search across multiple finance collections. Uses regex matching
// rather than full Mongo text indexes so we can search short strings
// (like merchant names) without setup. Each collection contributes up to
// 5 rows; the UI groups by kind. Permission-aware: each section is only
// queried if the session has the right `:view` permission.

import { NextRequest, NextResponse } from "next/server";
import { readSession, hasPermission } from "@/lib/rbac";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, getDb } from "@/lib/finance-db";

const PER_SECTION = 5;

interface Hit {
  kind: string;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });

  await ensureFinanceIndexes();
  const rx = new RegExp(escapeRegex(q), "i");
  const groups: { kind: string; label: string; hits: Hit[] }[] = [];

  // Expenses
  if (hasPermission(session, "finance:expenses:view")) {
    const rows = await coll(FINANCE_COLLECTIONS.expense)
      .find({ $or: [{ category: rx }, { vendor_name: rx }, { notes: rx }] })
      .sort({ date: -1 })
      .limit(PER_SECTION)
      .toArray();
    if (rows.length > 0) {
      groups.push({
        kind: "expense",
        label: "Expenses",
        hits: rows.map((r) => ({
          kind: "expense",
          id: String(r._id),
          label: `${r.vendor_name ?? r.category ?? "expense"} — $${(r.amount as number) ?? 0}`,
          sublabel: r.date as string,
          href: `/portal/expenses`,
        })),
      });
    }
  }

  // Income
  if (hasPermission(session, "finance:income:view")) {
    const rows = await coll(FINANCE_COLLECTIONS.income)
      .find({ $or: [{ source: rx }, { customer_name: rx }, { notes: rx }] })
      .sort({ date: -1 })
      .limit(PER_SECTION)
      .toArray();
    if (rows.length > 0) {
      groups.push({
        kind: "income",
        label: "Income",
        hits: rows.map((r) => ({
          kind: "income",
          id: String(r._id),
          label: `${r.customer_name ?? r.source ?? "income"} — $${(r.amount as number) ?? 0}`,
          sublabel: r.date as string,
          href: `/portal/income`,
        })),
      });
    }
  }

  // Bank transactions
  if (hasPermission(session, "finance:banking:view")) {
    const rows = await coll(FINANCE_COLLECTIONS.bankTxnSynced)
      .find({ $or: [{ name: rx }, { merchant_name: rx }] })
      .sort({ date: -1 })
      .limit(PER_SECTION)
      .toArray();
    if (rows.length > 0) {
      groups.push({
        kind: "bank_txn",
        label: "Bank transactions",
        hits: rows.map((r) => ({
          kind: "bank_txn",
          id: String(r._id),
          label: `${r.merchant_name ?? r.name ?? "txn"} — $${(r.amount as number) ?? 0}`,
          sublabel: `${r.date} · ${(r.recon_status as string) ?? "unmatched"}`,
          href: `/portal/banking/synced`,
        })),
      });
    }
  }

  // Reports (saved)
  if (hasPermission(session, "finance:reports:view")) {
    const rows = await coll(FINANCE_COLLECTIONS.report)
      .find({ $or: [{ title: rx }, { subject_name: rx }] })
      .sort({ generated_at: -1 })
      .limit(PER_SECTION)
      .toArray();
    if (rows.length > 0) {
      groups.push({
        kind: "report",
        label: "Reports",
        hits: rows.map((r) => ({
          kind: "report",
          id: String(r._id),
          label: r.title as string,
          sublabel: r.subject_name as string,
          href: `/portal/reports/${r._id}`,
        })),
      });
    }
  }

  // CRM jobs (read from main jobs collection)
  if (hasPermission(session, "crm:jobs:view")) {
    const db = await getDb();
    const rows = await db
      .collection("Job")
      .find({ $or: [{ address: rx }, { tech: rx }, { provider: rx }, { location: rx }] })
      .sort({ date: -1 })
      .limit(PER_SECTION)
      .toArray();
    if (rows.length > 0) {
      groups.push({
        kind: "job",
        label: "Jobs",
        hits: rows.map((r) => ({
          kind: "job",
          id: String(r._id),
          label: `${r.address ?? "job"} — $${(r.totalAmount as number) ?? 0}`,
          sublabel: `${r.date ?? ""} · ${r.tech ?? ""} · ${r.status ?? ""}`,
          href: `/tables?entity=jobs&search=${encodeURIComponent(q)}`,
        })),
      });
    }
  }

  return NextResponse.json({ groups });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
