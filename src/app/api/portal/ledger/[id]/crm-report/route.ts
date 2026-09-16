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
import { computeBalanceReport } from "@/app/api/balance-report/route";
import type { LedgerEntryRecord, LedgerRecord, LedgerReportMeta } from "@/types/finance-ledger";

interface ReportRow {
  date?: string;
  status?: string;
  // Every job row carries BOTH balances in its breakdown, so one pass yields the
  // tech AND location amounts regardless of the mode we query.
  breakdown?: {
    techBalance?: number;
    techBalanceWithTips?: number;
    locationBalance?: number;
    locationBalanceWithTips?: number;
  };
}

interface TechClosed {
  date: string;
  techBalance: number;
  techBalanceWithTips: number;
  locationBalance: number;
  locationBalanceWithTips: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Monday-start (Mon–Sun) week bounds, in UTC, for a YYYY-MM-DD date. */
function weekBounds(dateStr: string): { start: string; end: string } {
  const day = dateStr.slice(0, 10);
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { start: day, end: day };
  const sinceMon = (d.getUTCDay() + 6) % 7; // Sun(0)→6, Mon(1)→0 …
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - sinceMon);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}

/** One technician's CLOSED job rows (both balances) + report profit, computed
 *  in-process (no HTTP round-trip; auth enforced by this route's session gate). */
async function fetchTechRows(tech: string, start: string, end: string): Promise<{ closed: TechClosed[]; profit: number }> {
  const snap = await computeBalanceReport({ startDateStr: start, endDateStr: end, techFilter: tech, mode: "location" });
  const rows = Array.isArray(snap.rows) ? (snap.rows as ReportRow[]) : [];
  const closed = rows.filter((j) => (j.status ?? "") === "Closed").map((j) => ({
    date: String(j.date ?? "").slice(0, 10),
    techBalance: Number(j.breakdown?.techBalance) || 0,
    techBalanceWithTips: Number(j.breakdown?.techBalanceWithTips) || 0,
    locationBalance: Number(j.breakdown?.locationBalance) || 0,
    locationBalanceWithTips: Number(j.breakdown?.locationBalanceWithTips) || 0,
  }));
  return { closed, profit: Number(snap.totals?.profit) || 0 };
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
    // Multi-select: `subjects` (array of techs, or locations) → ONE combined
    // entry. Falls back to the legacy single `subject_name`.
    const subjectsRaw = Array.isArray(body.subjects)
      ? body.subjects
      : (body.subject_name != null ? [body.subject_name] : []);
    const subjects = [...new Set(subjectsRaw.map((x) => String(x).trim()).filter(Boolean))];
    const start = String(body.period_start ?? "").trim();
    const end = String(body.period_end ?? "").trim();
    const includeTips = body.include_tips === true || body.include_tips === "true";

    if (subjects.length === 0) return NextResponse.json({ error: "Select at least one technician / location" }, { status: 400 });
    if (!start || !end) return NextResponse.json({ error: "Date range is required" }, { status: 400 });

    // Which technicians the report covers: the selected techs, or every tech in
    // any of the selected locations.
    let techNames: string[];
    if (mode === "tech") {
      techNames = [...subjects];
    } else {
      const db = await getDb();
      const allTechs = await db.collection("Technician").find({}).toArray();
      const wanted = new Set(subjects.map((s) => s.toLowerCase()));
      techNames = [...new Set(
        allTechs
          .filter((t) => wanted.has(String((t as { location?: unknown }).location ?? "").trim().toLowerCase()))
          .map((t) => String((t as { _id?: unknown; name?: unknown })._id ?? (t as { name?: unknown }).name ?? ""))
          .filter(Boolean),
      )];
      if (techNames.length === 0) {
        return NextResponse.json({ error: `No technicians found in the selected location(s): ${subjects.join(", ")}.` }, { status: 404 });
      }
    }

    // Bucket closed jobs into Mon–Sun weeks → per technician → summed tech AND
    // location balances (both come from each job's breakdown).
    type Agg = { tech_balance: number; tech_balance_with_tips: number; location_balance: number; location_balance_with_tips: number; job_count: number };
    const weekEnds = new Map<string, string>();
    const weekMap = new Map<string, Map<string, Agg>>();
    let profit = 0, jobCount = 0;
    let hTech = 0, hTechTips = 0, hLoc = 0, hLocTips = 0;

    const reps = await Promise.all(
      techNames.map((name) => fetchTechRows(name, start, end).then((r) => ({ name, r })).catch(() => ({ name, r: null as { closed: TechClosed[]; profit: number } | null }))),
    );
    for (const { name, r } of reps) {
      if (!r) continue;
      profit += r.profit;
      for (const row of r.closed) {
        const { start: ws, end: we } = weekBounds(row.date);
        weekEnds.set(ws, we);
        let wk = weekMap.get(ws); if (!wk) { wk = new Map(); weekMap.set(ws, wk); }
        let agg = wk.get(name);
        if (!agg) { agg = { tech_balance: 0, tech_balance_with_tips: 0, location_balance: 0, location_balance_with_tips: 0, job_count: 0 }; wk.set(name, agg); }
        agg.tech_balance += row.techBalance;
        agg.tech_balance_with_tips += row.techBalanceWithTips;
        agg.location_balance += row.locationBalance;
        agg.location_balance_with_tips += row.locationBalanceWithTips;
        agg.job_count += 1;
        jobCount += 1;
        hTech += row.techBalance; hTechTips += row.techBalanceWithTips;
        hLoc += row.locationBalance; hLocTips += row.locationBalanceWithTips;
      }
    }

    const weeks = [...weekMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ws, tm]) => ({
        week_start: ws,
        week_end: weekEnds.get(ws) ?? ws,
        techs: [...tm.entries()]
          .map(([name, a]) => ({
            name,
            tech_balance: round2(a.tech_balance),
            tech_balance_with_tips: round2(a.tech_balance_with_tips),
            location_balance: round2(a.location_balance),
            location_balance_with_tips: round2(a.location_balance_with_tips),
            job_count: a.job_count,
          }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      }));

    // Headline uses the ledger's own mode (location ledger → location balance).
    const balance = mode === "location" ? hLoc : hTech;
    const balanceWithTips = mode === "location" ? hLocTips : hTechTips;

    const meta: LedgerReportMeta = {
      mode,
      subject_name: subjects.join(", "),
      period_start: start,
      period_end: end,
      balance: round2(balance),
      balance_with_tips: round2(balanceWithTips),
      include_tips: includeTips,
      job_count: jobCount,
      profit: round2(profit),
      tech_count: mode === "location" ? techNames.length : null,
      weeks,
    };

    const amount = round2(includeTips ? balanceWithTips : balance);
    const label = mode === "location" ? "Location" : "Tech";
    const subjectList = subjects.join(", ");
    const subjectNote = mode === "location" && meta.tech_count != null
      ? `${subjectList} (${meta.tech_count} techs)`
      : subjectList;
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
