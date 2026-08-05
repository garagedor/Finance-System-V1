import "server-only";
import { getDb } from "@/lib/finance-db";

// Mirror a verified ScanPay dispute into the CRM `Dispute` collection so it
// shows on the CRM Disputes report (which joins Dispute → Job for all job info).
// Deterministic _id = scanpay_<disputeId> → idempotent upsert / natural dedup.
// Called on Verify AND by the scheduled sync (so a status change — e.g. Needs
// Response → Lost/Won — flows through to the report automatically).

const day = (iso: string | null | undefined): string => (iso ? String(iso).slice(0, 10) : "");

export async function upsertCrmDispute(opts: {
  disputeId: string;
  jobId: string;
  amount: number;
  disputedAt: string | null;
  statusRaw: string;
  outcome: string;              // won | lost | pending
  resolvedAt: string | null;
  respondBy?: string | null;
}): Promise<void> {
  const db = await getDb();
  const Dispute = db.collection<{ _id: string; [k: string]: unknown }>("Dispute");
  await Dispute.updateOne(
    { _id: `scanpay_${opts.disputeId}` },
    { $set: {
      jobId: opts.jobId,
      totalDisputed: opts.amount,
      disputeDate: day(opts.disputedAt),
      dueDate: day(opts.respondBy),
      status: opts.statusRaw || "",
      dateLost: opts.outcome === "lost" ? day(opts.resolvedAt) : "",
      isTechOffset: false,
      isPrOffset: false,
      scanpayDisputeId: opts.disputeId,
      source: "scanpay",
      updated_at: new Date().toISOString(),
    } },
    { upsert: true },
  );
}

export async function removeCrmDispute(disputeId: string): Promise<void> {
  const db = await getDb();
  await db.collection("Dispute").deleteOne({ _id: `scanpay_${disputeId}` } as never);
}
