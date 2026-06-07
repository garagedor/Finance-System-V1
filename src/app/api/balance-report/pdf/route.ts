// Server-side PDF endpoint for the Balance Report (Tech + Location modes).
//
// Renders an OFFICIAL printable report from the underlying data — not a
// screenshot of the dashboard. Same calculation pipeline as the main
// balance-report route (calcJobBalances), so every number on the PDF
// matches the on-screen report exactly.
//
// Layout responsibilities live in src/components/pdf/{Tech,Location}ReportPdf.tsx
// — this route just gathers data and pipes a React-PDF render into a Buffer
// response with download headers.

import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { JobRow, Location, Technician } from '../../../../types/job';
import type { User } from '../../../../types/user';
import {
    calcJobBalances,
    toNumber,
} from '../../utils/calculations';
import { TechReportPdf } from '../../../../components/pdf/TechReportPdf';
import { LocationReportPdf } from '../../../../components/pdf/LocationReportPdf';
import type { PdfReportData, PdfRow, PdfTotals } from '../../../../components/pdf/types';

// Force Node runtime — @react-pdf/renderer requires Node APIs that aren't
// available in Edge. PDFs aren't latency-sensitive enough to justify Edge.
export const runtime = 'nodejs';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const TECH_COLLECTION = 'Technician';
const LOCATION_COLLECTION = 'Location';
const USER_COLLECTION = 'User';

type Mode = 'tech' | 'location';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
    if (cachedClient) return cachedClient;
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    cachedClient = client;
    return client;
}

const buildRowsAndTotals = (
    jobs: any[],
    techMap: Map<string, Technician>,
    locationPct: number,
    mode: Mode,
    userRoleMap: Map<string, string>,
): { rows: PdfRow[]; totals: PdfTotals } => {
    const rows: PdfRow[] = [];
    const totals: PdfTotals = {
        rowCount: 0,
        paidSum: 0, techParts: 0, companyParts: 0, lmParts: 0,
        lmCash: 0, lmCheck: 0, paymentFee: 0, totalProfit: 0,
        shareAmount: 0, techPaidCash: 0, tipsTotal: 0,
        balance: 0, balanceWithTips: 0,
    };

    jobs.forEach((job: any) => {
        const techId = job.tech || '';
        const techDoc = techId ? techMap.get(techId) : undefined;
        const techPct = techDoc?.profitPercent ?? 0;

        const calc = calcJobBalances(job, techPct, locationPct);
        const shareAmount = mode === 'location' ? calc.locationShare : calc.techShare;
        const balance = mode === 'location' ? calc.locationBalance : calc.techBalance;
        const balanceWithTips = mode === 'location' ? calc.locationBalanceWithTips : calc.techBalanceWithTips;

        // Mirror the row's paymentMethod derivation from /api/balance-report
        // so the PDF column reads the same value as the on-screen table.
        const paymentFields = [
            { label: 'Cash',          value: toNumber(job.techPaidCash || 0) },
            { label: 'Card',          value: toNumber(job.totalPaidCard || 0) },
            { label: 'Company Check', value: toNumber(job.totalPaidCompanyCheck || 0) },
            { label: 'Finance',       value: toNumber(job.totalPaidFinance || 0) },
            { label: 'Company Cash',  value: toNumber(job.totalPaidCompanyCash || 0) },
            { label: 'LM Cash',       value: toNumber(job.lmCash || 0) },
            { label: 'LM Check',      value: toNumber(job.lmCheck || 0) },
        ].filter((p) => p.value > 0);
        const paymentMethod =
            paymentFields.length > 1 ? 'Split' :
            paymentFields.length === 1 ? paymentFields[0].label : '—';

        const approvalsRaw = Array.isArray(job.approvals)
            ? job.approvals
            : (typeof job.approvals === 'string' ? job.approvals.split(',') : []);
        const approvals = Array.from(
            new Set(approvalsRaw.map((a: any) => String(a).trim()).filter(Boolean))
        ).map((name) => ({
            name: String(name),
            role: userRoleMap.get(String(name)) || 'simple',
        }));

        const row: PdfRow = {
            id: job._id?.toString() || '',
            date: job.date || '',
            address: job.address || '',
            tech: job.tech || '',
            location: job.location || '',
            status: job.status || '',
            paymentMethod,
            paidSum: toNumber(calc.jobTotal),
            techParts: toNumber(job.techParts || 0),
            companyParts: toNumber(job.companyParts || 0),
            lmParts: toNumber(job.lmParts || 0),
            lmCash: toNumber(job.lmCash || 0),
            lmCheck: toNumber(job.lmCheck || 0),
            paymentFee: toNumber(calc.paymentFee),
            totalProfit: toNumber(calc.totalProfit),
            shareAmount: toNumber(shareAmount),
            techPaidCash: toNumber(job.techPaidCash || 0),
            tipsTotal: toNumber(calc.tipsTotal),
            balance: toNumber(balance),
            balanceWithTips: toNumber(balanceWithTips),
            approvals,
        };
        rows.push(row);

        totals.rowCount += 1;
        totals.paidSum += row.paidSum;
        totals.techParts += row.techParts;
        totals.companyParts += row.companyParts;
        totals.lmParts += row.lmParts;
        totals.lmCash += row.lmCash;
        totals.lmCheck += row.lmCheck;
        totals.paymentFee += row.paymentFee;
        totals.totalProfit += row.totalProfit;
        totals.shareAmount += row.shareAmount;
        totals.techPaidCash += row.techPaidCash;
        totals.tipsTotal += row.tipsTotal;
        totals.balance += row.balance;
        totals.balanceWithTips += row.balanceWithTips;
    });

    return { rows, totals };
};

const safeFilename = (s: string): string =>
    String(s || 'Report').replace(/[^A-Za-z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Report';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate') || '';
        const endDate = searchParams.get('endDate') || '';
        const techFilter = searchParams.get('tech') || '';
        const mode = (searchParams.get('mode') as Mode) || 'tech';

        if (!techFilter) {
            // The on-screen Balance Report enforces this too — without a
            // tech (which carries the location pointer), no report can be
            // built. Return 400 instead of an empty PDF.
            return NextResponse.json({ error: 'tech parameter is required' }, { status: 400 });
        }

        const client = await getClient();
        const db = client.db(DB_NAME);
        const jobCol = db.collection<JobRow>(JOB_COLLECTION);
        const techCol = db.collection<Technician>(TECH_COLLECTION);
        const locationCol = db.collection<Location>(LOCATION_COLLECTION);
        const userCol = db.collection<User>(USER_COLLECTION);

        // ── Lookup maps ────────────────────────────────────────────────
        const techDocs = await techCol.find({}).toArray();
        const techMap = new Map<string, Technician>();
        techDocs.forEach((t: any) => {
            const key = t._id?.toString() || '';
            techMap.set(key, { ...(t as Technician), _id: key });
        });

        const userDocs = await userCol.find({}).toArray();
        const userRoleMap = new Map<string, string>();
        userDocs.forEach((u: any) => {
            if (u.name) userRoleMap.set(u.name, u.type || 'simple');
        });

        const techForLocation = techMap.get(techFilter);
        const locationId = techForLocation?.location || '';
        const locationDoc = locationId
            ? await locationCol.findOne({ _id: locationId as any })
            : null;
        const locationPct = (locationDoc as any)?.managerProfitPercent ?? 0;
        const appliedPct = mode === 'location'
            ? locationPct
            : (techForLocation?.profitPercent ?? 0);

        // ── Fetch jobs (same filter as the on-screen report) ───────────
        const match: Record<string, any> = { tech: techFilter };
        if (startDate || endDate) {
            match.date = {};
            if (startDate) match.date.$gte = startDate;
            if (endDate) match.date.$lte = endDate;
        }
        const allJobs = await jobCol
            .aggregate([{ $match: match }, { $sort: { date: -1, _id: -1 } }])
            .toArray();

        // ── PDF body ───────────────────────────────────────────────────
        // The PDF surfaces closed jobs only — matches the on-screen
        // "Closed Jobs Breakdown" table the user prints from.
        const closedJobs = allJobs.filter((j: any) => (j.status || '') === 'Closed');
        const { rows, totals } = buildRowsAndTotals(closedJobs, techMap, locationPct, mode, userRoleMap);

        const subject = mode === 'tech'
            ? techFilter
            : (locationId || '—');

        const reportData: PdfReportData = {
            mode,
            subject,
            startDate,
            endDate,
            appliedPct: toNumber(appliedPct),
            rows,
            totals,
            generatedAt: new Date().toISOString(),
        };

        const element = mode === 'location'
            ? createElement(LocationReportPdf, { data: reportData })
            : createElement(TechReportPdf, { data: reportData });

        const pdfBuffer = await renderToBuffer(element as any);

        const modeLabel = mode === 'tech' ? 'Tech' : 'Location';
        const filename = `${modeLabel}_Report_${safeFilename(subject)}_${startDate}_to_${endDate}.pdf`;

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                // `inline` lets browsers preview the PDF in-tab; the front-end
                // forces download via the anchor `download` attribute when
                // the user explicitly clicks the button.
                'Content-Disposition': `inline; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        console.error('GET /api/balance-report/pdf error', err);
        return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
    }
}
