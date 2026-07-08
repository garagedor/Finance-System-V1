// "Add CRM Balance Report" → one ledger entry.
//
// Tech report:     pulls /api/balance-report for one technician.
// Location report: TRUE roll-up — finds every technician in the area and sums
//                  each one's location-mode report. Either way we reuse the
//                  existing endpoint so the numbers can't drift, and the
//                  headline is summed over CLOSED jobs (matching the report UI).

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, getDb, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { LedgerEntryRecord, LedgerRecord, LedgerReportMeta } from "@/types/finance-ledger";

interface ReportRow {
  id?: string;
  date?: string;
  address?: string;
  tech?: string;
  status?: string;
  balance?: number;
  balanceWithTips?: number;
}

interface TechReport {
  closed: ReportRow[];
  balance: number;
  balanceWithTips: number;
  profit: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Pull one technician's Balance Report and sum its CLOSED-job headline. */
async function fetchTechReport(
  origin: string,
  tech: string,
  mode: "tech" | "location",
  start: string,
  end: string,
  cookie: string,
): Promise<TechReport> {
  const url =
    `${origin}/api/balance-report` +
    `?tech=${encodeURIComponent(tech)}&mode=${mode}` +
    `&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
  // Forward the caller's session cookie — /api/* is auth-gated by middleware,
  // so this server-to-server call must carry the logged-in user's session.
  const r = await fetch(url, { cache: "no-store", headers: cookie ? { cookie } : undefined });
  if (!r.ok) throw new Error(`Balance report failed for "${tech}" (HTTP ${r.status})`);
  const snap = (await r.json()) as { rows?: ReportRow[]; totals?: { profit?: number } };
  const rows = Array.isArray(snap.rows) ? snap.rows : [];
  const closed = rows.filter((j) => (j.status ?? "") === "Closed");
  return {
    closed,
    balance: closed.reduce((s, j) => s + (Number(j.balance) || 0), 0),
    balanceWithTips: closed.reduce((s, j) => s + (Number(j.balanceWithTips) || 0), 0),
    profit: Number(snap.totals?.profit) || 0,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    await ensureFinanceIndexes();

    const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: id });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    const body = (await req.json()) as Record<string, unknown>;
    const mode = body.mode === "location" ? "location" : "tech";
    const subject = String(body.subject_name ?? "").trim();
    const start = String(body.period_start ?? "").trim();
    const end = String(body.period_end ?? "").trim();
    const includeTips = body.include_tips === true || body.include_tips === "true";

    if (!subject) return NextResponse.json({ error: "Subject (tech / location) is required" }, { status: 400 });
    if (!start || !end) return NextResponse.json({ error: "Date range is required" }, { status: 400 });

    const origin = req.nextUrl.origin;
    const cookie = req.headers.get("cookie") ?? "";
    let balance = 0;
    let balanceWithTips = 0;
    let profit = 0;
    let closedRows: ReportRow[] = [];
    let techBreakdown: NonNullable<LedgerReportMeta["techs"]> | null = null;

    if (mode === "tech") {
      const rep = await fetchTechReport(origin, subject, "tech", start, end, cookie);
      balance = rep.balance;
      balanceWithTips = rep.balanceWithTips;
      profit = rep.profit;
      closedRows = rep.closed;
    } else {
      // TRUE location roll-up: every technician whose CRM location matches.
      const db = await getDb();
      const allTechs = await db.collection("Technician").find({}).toArray();
      const techNames = allTechs
        .filter((t) => String((t as { location?: unknown }).location ?? "").trim().toLowerCase() === subject.toLowerCase())
        .map((t) => String((t as { _id?: unknown; name?: unknown })._id ?? (t as { name?: unknown }).name ?? ""))
        .filter(Boolean);

      if (techNames.length === 0) {
        return NextResponse.json(
          { error: `No technicians found in location "${subject}".` },
          { status: 404 },
        );
      }

      const reports = await Promise.all(
        techNames.map((name) =>
          fetchTechReport(origin, name, "location", start, end, cookie)
            .then((rep) => ({ name, rep }))
            .catch(() => ({ name, rep: null as TechReport | null })),
        ),
      );

      techBreakdown = [];
      for (const { name, rep } of reports) {
        if (!rep) continue;
        balance += rep.balance;
        balanceWithTips += rep.balanceWithTips;
        profit += rep.profit;
        closedRows = closedRows.concat(rep.closed);
        techBreakdown.push({
          name,
          balance: round2(rep.balance),
          balance_with_tips: round2(rep.balanceWithTips),
          job_count: rep.closed.length,
        });
      }
      techBreakdown.sort((a, b) => a.balance - b.balance);
    }

    const meta: LedgerReportMeta = {
      mode,
      subject_name: subject,
      period_start: start,
      period_end: end,
      balance: round2(balance),
      balance_with_tips: round2(balanceWithTips),
      include_tips: includeTips,
      job_count: closedRows.length,
      profit: round2(profit),
      tech_count: techBreakdown ? techBreakdown.length : null,
      techs: techBreakdown ?? undefined,
      jobs: closedRows.map((j) => ({
        id: String(j.id ?? ""),
        date: String(j.date ?? "").slice(0, 10),
        address: String(j.address ?? ""),
        tech: String(j.tech ?? ""),
        balance: round2(Number(j.balance) || 0),
        balance_with_tips: round2(Number(j.balanceWithTips) || 0),
      })),
    };

    const amount = round2(includeTips ? balanceWithTips : balance);
    const label = mode === "location" ? "Location" : "Tech";
    const subjectNote = mode === "location" && meta.tech_count != null
      ? `${subject} (${meta.tech_count} techs)`
      : subject;
    const doc: LedgerEntryRecord = {
      _id: newId("len"),
      ledger_id: id,
      type: "report",
      date: end,
      amount,
      description: `CRM ${label} Report · ${subjectNote} · ${start} → ${end}` +
        (includeTips ? " (incl. tips)" : ""),
      report_meta: meta,
      source: "crm",
      created_at: new Date().toISOString(),
      created_by: session.name,
    };

    await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).insertOne(doc);
    return NextResponse.json({ row: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to add CRM report" },
      { status: 400 },
    );
  }
}
