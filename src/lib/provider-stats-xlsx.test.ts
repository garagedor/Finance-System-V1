import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildProviderStatsWorkbook } from './provider-stats-xlsx';
import { isStatsXlsxOwner } from './stats-owner';
import type { StatsResult } from '@/app/api/stats/route';

const stats = (count: number, closed: number, xclose: number, paid: number): StatsResult => ({
  summary: {
    count, totalAmount: paid, totalPaid: paid, totalProfit: paid * 0.9, jobsProfit: paid * 0.85,
    avgTicket: (paid * 0.9) / count, avgTicketWithoutPenalty: (paid * 0.8) / count,
    avgClosedTicket: closed ? (paid * 0.85) / closed : 0, closedRatio: closed / count,
  },
  byTech: [{ key: 'Tech', count, totalAmount: paid, totalPaid: paid }],
  byLocation: [],
  byStatus: [{ key: 'Closed', count: closed }, { key: 'X close', count: xclose }, { key: 'Estimate', count: count - closed - xclose }],
  byProvider: [],
});

test('workbook: tabs, totals and formulas', async () => {
  const chi = stats(10, 4, 1, 1000);
  const mil = stats(6, 3, 0, 600);
  const buf = await buildProviderStatsWorkbook({
    startDate: '2026-10-26', endDate: '2026-11-01',
    providers: [{ name: 'IND', all: stats(16, 7, 1, 1600), byLoc: [{ location: 'Chicago', stats: chi }, { location: 'Milwaukee', stats: mil }] }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Overview', 'By Provider & Location', 'By Location & Provider', 'IND']);

  const ov = wb.getWorksheet('Overview')!;
  assert.match(String(ov.getCell('A1').value), /Dates: 10\/26\/2026 – 11\/1\/2026/);
  assert.equal(ov.getCell('A6').value, 'IND');
  assert.equal(ov.getCell('B6').value, 16);
  const f = ov.getCell('F6').value as { formula: string; result: number };
  assert.equal(f.formula, 'IF(B6=0,0,(C6+D6)/B6)');
  assert.equal(f.result, 0.5); // (7 + 1) / 16

  const ind = wb.getWorksheet('IND')!;
  const total = ind.getCell('B5').value as { formula: string; result: number };
  assert.equal(total.formula, 'SUM(B6:B7)');
  assert.equal(total.result, 16);
  assert.equal(ind.getCell('A6').value, 'Chicago');

  const grand = wb.getWorksheet('By Location & Provider')!;
  const last = grand.lastRow!.number;
  assert.equal(grand.getCell(last, 1).value, 'Grand total');
  assert.equal((grand.getCell(last, 3).value as { result: number }).result, 16);
});

test('only the owner account passes the check', () => {
  assert.equal(isStatsXlsxOwner({ userId: '6a0161a0c3c7bac5ce75fae3', name: 'yehonatan' }), true);
  assert.equal(isStatsXlsxOwner({ _id: '6a0161a0c3c7bac5ce75fae3', name: 'yehonatan' }), true);
  assert.equal(isStatsXlsxOwner({ userId: '69528cbb7b4dc549a879136a', name: 'admin' }), false);
  assert.equal(isStatsXlsxOwner({ userId: 'other', name: 'yehonatan' }), false);
  assert.equal(isStatsXlsxOwner(null), false);
});
