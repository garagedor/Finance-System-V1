import { makeCrud } from "../crud-helper";
import type { TaskRecord, TaskStatus, TaskPriority } from "@/types/finance";
import type { Filter } from "mongodb";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

const asStatus = (v: unknown): TaskStatus =>
  STATUSES.includes(v as TaskStatus) ? (v as TaskStatus) : "todo";
const asPriority = (v: unknown): TaskPriority =>
  PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : "medium";

const crud = makeCrud<TaskRecord>({
  collection: "task",
  idPrefix: "task",
  auditKind: "task",
  sort: { order: 1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<TaskRecord> = {};
    const status = sp.get("status");
    if (status && STATUSES.includes(status as TaskStatus)) f.status = status as TaskStatus;
    const assignee = sp.get("assignee_id");
    if (assignee) f.assignee_id = assignee;
    return f;
  },
  normalize: (body, mode) => {
    // On a drag (status/order-only PUT) we don't want to wipe unsent fields, so
    // only include keys the caller actually sent. On create we set sane defaults.
    const out: Record<string, unknown> = {};
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    if (mode === "create" || has("title")) out.title = String(body.title ?? "").trim();
    if (mode === "create" || has("status")) out.status = asStatus(body.status);
    if (mode === "create" || has("priority")) out.priority = asPriority(body.priority);
    if (mode === "create" || has("order")) out.order = Number(body.order ?? 0) || 0;

    if (has("description")) out.description = body.description ? String(body.description) : null;
    if (has("assignee_id")) out.assignee_id = body.assignee_id ? String(body.assignee_id) : null;
    if (has("assignee_name")) out.assignee_name = body.assignee_name ? String(body.assignee_name) : null;
    if (has("due_date")) out.due_date = body.due_date ? String(body.due_date) : null;

    if (mode === "create" && !out.title) throw new Error("Title is required");
    return out;
  },
  auditLabel: (row) => String(row.title ?? row._id),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
