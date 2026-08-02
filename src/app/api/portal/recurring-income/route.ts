import { makeCrud } from "../crud-helper";
import type { RecurringIncomeRecord } from "@/types/finance";
import { firstDueDate } from "@/lib/recurring-schedule";

const crud = makeCrud<RecurringIncomeRecord>({
  collection: "recurringIncome",
  idPrefix: "rincome",
  auditKind: "recurring_income",
  sort: { name: 1 },
  normalize: (body, mode) => {
    const frequency = String(body.frequency ?? "monthly") as RecurringIncomeRecord["frequency"];
    const start_date = String(body.start_date ?? new Date().toISOString().slice(0, 10));
    const dayOfMonth = body.day_of_month !== undefined && body.day_of_month !== null && body.day_of_month !== ""
      ? Number(body.day_of_month)
      : undefined;
    const dayOfWeek = body.day_of_week !== undefined && body.day_of_week !== null && body.day_of_week !== ""
      ? Number(body.day_of_week)
      : undefined;
    const customInterval = body.custom_interval_days !== undefined && body.custom_interval_days !== null && body.custom_interval_days !== ""
      ? Number(body.custom_interval_days)
      : undefined;
    // For new templates, compute the first due-date from start_date + rules.
    // For updates: trust the incoming next_due_date (or recompute if the rule changed).
    const next = mode === "create"
      ? firstDueDate({ frequency, start_date, day_of_month: dayOfMonth, day_of_week: dayOfWeek })
      : (body.next_due_date ? String(body.next_due_date)
          : firstDueDate({ frequency, start_date, day_of_month: dayOfMonth, day_of_week: dayOfWeek }));
    return {
      name: String(body.name ?? ""),
      source: String(body.source ?? "manual"),
      amount: Number(body.amount ?? 0),
      description: body.description ?? null,
      category: body.category ?? null,
      payment_method: body.payment_method ?? null,
      related_area: body.related_area ?? null,
      related_person_id: body.related_person_id ?? null,
      notes: body.notes ?? null,
      frequency,
      custom_interval_days: customInterval ?? null,
      day_of_month: dayOfMonth ?? null,
      day_of_week: dayOfWeek ?? null,
      start_date,
      end_date: body.end_date ?? null,
      next_due_date: next,
      active: body.active !== false,
      total_generated: mode === "create" ? 0 : Number(body.total_generated ?? 0),
    };
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
