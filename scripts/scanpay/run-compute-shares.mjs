// Populate finance_scanpay_dispute.computedShare for matched disputes by porting
// the canonical engine (src/lib/dispute-share.ts computeDisputeAllocation) and
// resolving inputs exactly like dispute-service.ts. Same formula the sync uses.
import { readFileSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g, "");
const n = (v) => { const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? x : 0; };
const round2 = (x) => Math.round(x * 100) / 100;

// Verbatim port of computeDisputeAllocation.
function allocate({ jobAmount, grossTip, partsCost, disputeAmount, technicianPercent, providerPercent, areaManagerPoolPercent, cardFeePercent = 5 }) {
  const cardNet = 1 - cardFeePercent / 100;
  const netTip = grossTip * cardNet;
  const netJob = jobAmount * cardNet;
  const operationalProfit = Math.max(0, netJob - partsCost);
  const tipRecovered = Math.min(disputeAmount, netTip);
  const remaining = Math.max(0, disputeAmount - netTip);
  const operationalRecovered = Math.min(remaining, operationalProfit);
  const partsLoss = Math.min(Math.max(0, remaining - operationalProfit), partsCost);
  const techRate = technicianPercent / 100;
  const providerRate = providerPercent / 100;
  const amPoolRate = areaManagerPoolPercent / 100;
  const companyPercent = Math.max(0, 100 - providerPercent - areaManagerPoolPercent);
  const companyRate = companyPercent / 100;
  const providerCharge = operationalRecovered * providerRate;
  const technicianPortion = tipRecovered + operationalRecovered * techRate + partsLoss;
  const areaManagerOwnPortion = operationalRecovered * (amPoolRate - techRate);
  const companyCharge = operationalRecovered * companyRate;
  const amLedgerCharge = technicianPortion + areaManagerOwnPortion;
  return {
    providerCharge: round2(providerCharge), technicianPortion: round2(technicianPortion),
    areaManagerOwnPortion: round2(areaManagerOwnPortion), companyCharge: round2(companyCharge),
    amLedgerCharge: round2(amLedgerCharge), partsLoss: round2(partsLoss),
    jobCollected: round2(jobAmount + grossTip), jobAmount: round2(jobAmount), grossTip: round2(grossTip),
  };
}

const client = new MongoClient(uri); await client.connect();
const db = client.db("ag");
const Job = db.collection("Job"), Loc = db.collection("Location"), Prov = db.collection("Provider"), Tech = db.collection("Technician"), Rate = db.collection("finance_technician_rate"), SC = db.collection("finance_scanpay_dispute");

async function effectivePct(techName) {
  if (!techName) return 0;
  const ov = await Rate.findOne({ _id: techName });
  if (ov && Number.isFinite(Number(ov.dispute_pct))) return Number(ov.dispute_pct);
  const t = await Tech.findOne({ _id: techName });
  return n(t?.profitPercent);
}

const recs = await SC.find({ matchedJobId: { $ne: null } }).toArray();
let computed = 0, errored = 0;
const samples = [];
for (const r of recs) {
  const id = r.matchedJobId;
  const or = [{ _id: id }]; if (/^[0-9a-fA-F]{24}$/.test(id)) or.push({ _id: new ObjectId(id) });
  const job = await Job.findOne({ $or: or });
  let share = null, error = null;
  if (!job) error = `Job not found: ${id}`;
  else {
    const location = job.location ?? "";
    const loc = location ? await Loc.findOne({ _id: location }) : null;
    if (!location) error = "Job has no location";
    else if (!loc) error = `No Location record for "${location}"`;
    else if (!(loc.areaManagerName ?? "").trim()) error = `No Area Manager assigned to "${location}"`;
    else if (n(loc.managerProfitPercent) <= 0) error = `Location "${location}" has no managerProfitPercent`;
    else {
      const grossTip = n(job.tipsCard) + n(job.tipsFinance) + n(job.tipsCompanyCash) + n(job.tipsCheck);
      const partsCost = n(job.techParts) + n(job.companyParts) + n(job.lmParts);
      const ta = n(job.totalAmount);
      const jobAmount = ta > 0 ? ta : n(job.totalPaidCard) + n(job.totalPaidCompanyCheck) + n(job.totalPaidFinance) + n(job.totalPaidCompanyCash) + n(job.techPaidCash) + n(job.lmCash) + n(job.lmCheck);
      const providerPercent = n((await Prov.findOne({ _id: job.provider }))?.profitPercent);
      const technicianPercent = await effectivePct(job.tech ?? "");
      share = allocate({ jobAmount, grossTip, partsCost, disputeAmount: n(r.amount), technicianPercent, providerPercent, areaManagerPoolPercent: n(loc.managerProfitPercent) });
      if (samples.length < 6) samples.push({ inv: r.invoiceNumber, amt: r.amount, tech: job.tech, prov: job.provider, techPct: technicianPercent, provPct: providerPercent, amPct: n(loc.managerProfitPercent), jobAmount, grossTip, partsCost, ...share });
    }
  }
  await SC.updateOne({ _id: r._id }, { $set: { computedShare: share, computeError: error } });
  if (share) computed++; else errored++;
}
console.log(`matched disputes: ${recs.length} · computed ${computed} · errored ${errored}`);
console.log("\nsamples (verify amLedger = techPortion + amOwn):");
for (const s of samples) console.log(JSON.stringify(s));
await client.close();
