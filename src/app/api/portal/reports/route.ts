import { makeCrud } from "../crud-helper";
import type { SavedReportRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<SavedReportRecord>({
  collection: "report",
  idPrefix: "rpt",
  auditKind: "report",
  sort: { generated_at: -1 },
  buildFilter: (sp) => {
    const f: Filter<SavedReportRecord> = {};
    const type = sp.get("type");
    if (type) f.type = type as SavedReportRecord["type"];
    const subject = sp.get("subject_id");
    if (subject) f.subject_id = subject;
    return f;
  },
  normalize: (body) => ({
    type: body.type ?? "tech_report",
    title: String(body.title ?? "Untitled report"),
    subject_id: body.subject_id ?? null,
    subject_name: body.subject_name ?? null,
    period_start: String(body.period_start ?? ""),
    period_end: String(body.period_end ?? ""),
    generated_at: new Date().toISOString(),
    snapshot: body.snapshot ?? null,
    status: body.status === "paid" ? "paid" : "unpaid",
    notes: body.notes ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
