// "Provider statistics by location" spreadsheet (owner-only Statistics export).
//
// Tabs: Overview · By Provider & Location · By Location & Provider · one tab
// per provider (by location + jobs by status + techs by location). Layout is
// the owner's own design (2026-11-02): yellow merged title, navy header row,
// centered cells, light-blue total rows; Overview boxed with a medium border.
//
// Every number comes from computeStats — the same aggregation as the
// Statistics page — so the sheet and the page can never disagree. Pulled
// numbers are blue; percentages, averages and totals are live formulas (with
// cached results, so the file reads correctly even before Excel recalculates).

import ExcelJS from 'exceljs';
import type { StatsResult } from '@/app/api/stats/route';

export type ProviderStats = { name: string; all: StatsResult; byLoc: Array<{ location: string; stats: StatsResult }> };
export type ProviderStatsInput = { startDate: string; endDate: string; providers: ProviderStats[] };

// ── Design tokens (from the owner's saved file) ──────────────────────────────
const FONT = 'Arial';
const NAVY = 'FF1F3A5F';
const YELLOW = 'FFFFFF00';
const TOTAL = 'FFE8EEF6';
const GRAND = 'FFC9D6EA';
const BLUE = 'FF0000FF';
const LINE = 'FFBBBBBB';
const MONEY = '$#,##0.00;($#,##0.00);"-"';
const PCT = '0.0%;(0.0%);"-"';
const COUNT = '0;-0;"-"';
const ROW_H = 22.5;

const HEADS = ['Jobs', 'Closed', 'X close', 'Closed %', 'Closed + X close %', 'Total Paid', 'Total Profit',
  'Profit w/o Penalty', 'Jobs Profit', 'Avg Ticket', 'Avg w/o Penalty', 'Avg Closed Job'];

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : iso;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const count = (s: StatsResult, status: string) => s.byStatus.find((x) => x.key === status)?.count ?? 0;

/** The seven pulled numbers for one row; everything else is a formula. */
type Inputs = { jobs: number; closed: number; xclose: number; paid: number; profit: number; profitNoPenalty: number; jobsProfit: number };
const inputsOf = (s: StatsResult): Inputs => ({
  jobs: s.summary.count,
  closed: count(s, 'Closed'),
  xclose: count(s, 'X close'),
  paid: r2(s.summary.totalPaid),
  profit: r2(s.summary.totalProfit),
  profitNoPenalty: r2(s.summary.avgTicketWithoutPenalty * s.summary.count),
  jobsProfit: r2(s.summary.jobsProfit),
});
const addInputs = (a: Inputs, b: Inputs): Inputs => ({
  jobs: a.jobs + b.jobs, closed: a.closed + b.closed, xclose: a.xclose + b.xclose,
  paid: r2(a.paid + b.paid), profit: r2(a.profit + b.profit),
  profitNoPenalty: r2(a.profitNoPenalty + b.profitNoPenalty), jobsProfit: r2(a.jobsProfit + b.jobsProfit),
});
const ZERO: Inputs = { jobs: 0, closed: 0, xclose: 0, paid: 0, profit: 0, profitNoPenalty: 0, jobsProfit: 0 };
const div = (a: number, b: number) => (b ? a / b : 0);

function sheetName(wb: ExcelJS.Workbook, raw: string): string {
  const base = (raw.replace(/[[\]*?/\\:]/g, '').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; wb.getWorksheet(name); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  return name;
}

/** Yellow merged title (with the dates on a second line), as in the owner's design. */
function title(ws: ExcelJS.Worksheet, text: string, sub: string, lastCol: number, rows: number, size: number) {
  ws.mergeCells(1, 1, rows, lastCol);
  const c = ws.getCell(1, 1);
  c.value = `${text}\n${sub}`;
  c.font = { name: FONT, size, bold: true };
  c.fill = fill(YELLOW);
  c.alignment = center;
  for (let r = 1; r <= rows; r++) ws.getRow(r).height = rows === 4 ? 18 : r === 2 ? 15 : ROW_H;
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[]) {
  labels.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill(NAVY);
    c.alignment = center;
  });
  ws.getRow(row).height = 32;
}

/**
 * One stats row. `off` = number of label columns before "Jobs" (1 or 2).
 * `sums` (optional) = row ranges to SUM for the pulled columns (total rows).
 */
function statsRow(
  ws: ExcelJS.Worksheet, row: number, off: number, labels: string[], v: Inputs,
  opts: { total?: 'sub' | 'grand'; sums?: string; size?: number } = {},
) {
  const col = (i: number) => ws.getColumn(off + i).letter; // i: 1 = Jobs … 12 = Avg Closed Job
  const L = (i: number) => `${col(i)}${row}`;
  const size = opts.size ?? 11;
  labels.forEach((t, i) => (ws.getCell(row, i + 1).value = t));

  const pulled: Array<[number, number]> = [[1, v.jobs], [2, v.closed], [3, v.xclose], [6, v.paid], [7, v.profit], [8, v.profitNoPenalty], [9, v.jobsProfit]];
  for (const [i, val] of pulled) {
    const c = ws.getCell(row, off + i);
    c.value = opts.sums ? { formula: opts.sums.replace(/#/g, col(i)), result: val } : val;
  }
  const f = (i: number, formula: string, result: number) => (ws.getCell(row, off + i).value = { formula, result });
  f(4, `IF(${L(1)}=0,0,${L(2)}/${L(1)})`, div(v.closed, v.jobs));
  f(5, `IF(${L(1)}=0,0,(${L(2)}+${L(3)})/${L(1)})`, div(v.closed + v.xclose, v.jobs));
  f(10, `IF(${L(1)}=0,0,${L(7)}/${L(1)})`, div(v.profit, v.jobs));
  f(11, `IF(${L(1)}=0,0,${L(8)}/${L(1)})`, div(v.profitNoPenalty, v.jobs));
  f(12, `IF(${L(2)}=0,0,${L(9)}/${L(2)})`, div(v.jobsProfit, v.closed));

  const last = off + 12;
  for (let c = 1; c <= last; c++) {
    const cell = ws.getCell(row, c);
    const i = c - off;
    const isPulled = !opts.total && [1, 2, 3, 6, 7, 8, 9].includes(i);
    cell.font = { name: FONT, size, bold: !!opts.total, color: isPulled ? { argb: BLUE } : undefined };
    cell.alignment = center;
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
    if (opts.total) cell.fill = fill(opts.total === 'grand' ? GRAND : TOTAL);
    if (i === 4 || i === 5) cell.numFmt = PCT;
    if (i >= 6) cell.numFmt = MONEY;
  }
  ws.getRow(row).height = ROW_H;
}

function widths(ws: ExcelJS.Worksheet, first: number[], rest = 14, total = 14) {
  first.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let c = first.length + 1; c <= total; c++) ws.getColumn(c).width = rest;
}

/** Medium outline around a block (the owner's Overview box). */
function box(ws: ExcelJS.Worksheet, top: number, bottom: number, lastCol: number) {
  for (let r = top; r <= bottom; r++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      const b = { ...(cell.border ?? {}) };
      if (c === 1) b.left = { style: 'medium' };
      if (c === lastCol) b.right = { style: 'medium' };
      if (r === top) b.top = { style: 'medium' };
      if (r === bottom) b.bottom = { style: 'medium' };
      cell.border = b;
    }
  }
}

export async function buildProviderStatsWorkbook(input: ProviderStatsInput): Promise<Buffer> {
  const { startDate, endDate, providers } = input;
  const sub = `Dates: ${usDate(startDate)} – ${usDate(endDate)}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = '317 Garage Door CRM';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Overview ───────────────────────────────────────────────────────────────
  const ov = wb.addWorksheet('Overview', { views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }] });
  title(ov, `Providers — Statistics (${providers.length})`, sub, 13, 4, 18);
  header(ov, 5, ['Provider', ...HEADS]);
  let grand = ZERO;
  providers.forEach((p, i) => {
    const v = inputsOf(p.all);
    grand = addInputs(grand, v);
    statsRow(ov, 6 + i, 1, [p.name], v, { size: 12 });
    ov.getCell(6 + i, 1).font = { name: FONT, size: 12, bold: true };
  });
  const ovTotal = 6 + providers.length;
  statsRow(ov, ovTotal, 1, [`All ${providers.length} providers`], grand, { total: 'sub', sums: `SUM(#6:#${ovTotal - 1})`, size: 12 });
  ov.getRow(ovTotal).height = 40.5;
  box(ov, 1, ovTotal, 13);
  widths(ov, [23.6]);

  // ── Grouped tables ─────────────────────────────────────────────────────────
  type Item = { provider: string; location: string; stats: StatsResult };
  const grouped = (name: string, heading: string, groups: Array<{ label: string; items: Item[] }>) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4, zoomScale: 85 }] });
    title(ws, heading, sub, 14, 3, 14);
    header(ws, 4, ['Provider', 'Location', ...HEADS]);
    let row = 5;
    const subRows: number[] = [];
    let all = ZERO;
    for (const g of groups) {
      const top = row;
      const first = row + 1;
      const last = row + g.items.length;
      let t = ZERO;
      g.items.forEach((it, i) => {
        const v = inputsOf(it.stats);
        t = addInputs(t, v);
        statsRow(ws, first + i, 2, [it.provider, it.location], v);
      });
      all = addInputs(all, t);
      statsRow(ws, top, 2, [`${g.label} — total`, ''], t, { total: 'sub', sums: `SUM(#${first}:#${last})` });
      subRows.push(top);
      row = last + 2;
    }
    statsRow(ws, row, 2, ['Grand total', ''], all, { total: 'grand', sums: subRows.map((r) => `#${r}`).join('+') });
    widths(ws, [26.1, 19.8], 13);
  };

  grouped('By Provider & Location', 'Every provider, each location',
    providers.map((p) => ({ label: p.name, items: p.byLoc.map((l) => ({ provider: p.name, location: l.location, stats: l.stats })) })));

  const byLocation = new Map<string, Item[]>();
  for (const p of providers) for (const l of p.byLoc) {
    const list = byLocation.get(l.location) ?? [];
    list.push({ provider: p.name, location: l.location, stats: l.stats });
    byLocation.set(l.location, list);
  }
  const locGroups = [...byLocation.entries()]
    .map(([label, items]) => ({ label, items: items.sort((a, b) => b.stats.summary.count - a.stats.summary.count) }))
    .sort((a, b) => b.items.reduce((n, x) => n + x.stats.summary.count, 0) - a.items.reduce((n, x) => n + x.stats.summary.count, 0));
  grouped('By Location & Provider', 'Every location, each provider', locGroups);

  // ── One tab per provider ───────────────────────────────────────────────────
  for (const p of providers) {
    const ws = wb.addWorksheet(sheetName(wb, p.name), { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
    title(ws, `${p.name} — Statistics by Location`, `Provider: ${p.name} · ${sub}`, 13, 3, 14);
    header(ws, 4, ['Location', ...HEADS]);
    const first = 6;
    const last = first + p.byLoc.length - 1;
    let t = ZERO;
    p.byLoc.forEach((l, i) => {
      const v = inputsOf(l.stats);
      t = addInputs(t, v);
      statsRow(ws, first + i, 1, [l.location], v);
    });
    statsRow(ws, 5, 1, [`All ${p.name}`], t, { total: 'sub', sums: `SUM(#${first}:#${Math.max(first, last)})` });

    // Jobs by status
    const statuses = p.all.byStatus.map((s) => s.key);
    let r = last + 3;
    const sec = (row: number, text: string) => {
      const c = ws.getCell(row, 1);
      c.value = text;
      c.font = { name: FONT, size: 12, bold: true };
      ws.getRow(row).height = ROW_H;
    };
    sec(r - 1, 'Jobs by status');
    header(ws, r, ['Location', ...statuses, 'Total']);
    const sFirst = r + 1;
    p.byLoc.forEach((l, i) => {
      const row = sFirst + i;
      ws.getCell(row, 1).value = l.location;
      let rowTotal = 0;
      statuses.forEach((k, j) => {
        const n = count(l.stats, k);
        rowTotal += n;
        const c = ws.getCell(row, j + 2);
        c.value = n;
        c.font = { name: FONT, color: { argb: BLUE } };
        c.numFmt = COUNT;
      });
      const tc = statuses.length + 2;
      ws.getCell(row, tc).value = { formula: `SUM(B${row}:${ws.getColumn(tc - 1).letter}${row})`, result: rowTotal };
      ws.getCell(row, tc).font = { name: FONT, bold: true };
    });
    const sTotal = sFirst + p.byLoc.length;
    ws.getCell(sTotal, 1).value = `All ${p.name}`;
    for (let c = 2; c <= statuses.length + 2; c++) {
      const letter = ws.getColumn(c).letter;
      const result = c <= statuses.length + 1 ? p.byLoc.reduce((n, l) => n + count(l.stats, statuses[c - 2]), 0) : t.jobs;
      ws.getCell(sTotal, c).value = { formula: `SUM(${letter}${sFirst}:${letter}${sTotal - 1})`, result };
    }
    for (let row = sFirst; row <= sTotal; row++) {
      ws.getRow(row).height = ROW_H;
      for (let c = 1; c <= statuses.length + 2; c++) {
        const cell = ws.getCell(row, c);
        cell.alignment = center;
        cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
        if (!cell.font?.color) cell.font = { name: FONT, bold: row === sTotal || cell.font?.bold };
        if (row === sTotal) { cell.fill = fill(TOTAL); cell.font = { name: FONT, bold: true }; }
      }
    }

    // Techs by location
    r = sTotal + 3;
    sec(r - 1, 'Techs by location');
    header(ws, r, ['Location', 'Technician', 'Jobs', 'Total Paid']);
    let row = r + 1;
    let jobs = 0;
    let paid = 0;
    for (const l of p.byLoc) {
      for (const tech of l.stats.byTech) {
        ws.getCell(row, 1).value = l.location;
        ws.getCell(row, 2).value = tech.key;
        ws.getCell(row, 3).value = tech.count;
        ws.getCell(row, 4).value = r2(tech.totalPaid);
        jobs += tech.count;
        paid += tech.totalPaid;
        row++;
      }
    }
    ws.getCell(row, 1).value = `All ${p.name}`;
    ws.getCell(row, 3).value = { formula: `SUM(C${r + 1}:C${row - 1})`, result: jobs };
    ws.getCell(row, 4).value = { formula: `SUM(D${r + 1}:D${row - 1})`, result: r2(paid) };
    for (let rr = r + 1; rr <= row; rr++) {
      ws.getRow(rr).height = ROW_H;
      for (let c = 1; c <= 4; c++) {
        const cell = ws.getCell(rr, c);
        cell.alignment = center;
        cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
        cell.font = rr === row ? { name: FONT, bold: true } : { name: FONT, color: c >= 3 ? { argb: BLUE } : undefined };
        if (c === 4) cell.numFmt = MONEY;
        if (rr === row) cell.fill = fill(TOTAL);
      }
    }
    widths(ws, [22, 16]);
  }

  // Arial everywhere, including cells left untouched above.
  wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => {
    if (c.font?.name !== FONT) c.font = { ...(c.font ?? {}), name: FONT };
  })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
