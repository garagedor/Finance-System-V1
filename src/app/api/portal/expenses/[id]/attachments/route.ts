// Attach a receipt to an expense (POST multipart/form-data) or remove one
// (DELETE ?url=...). Files live under public/uploads/. The expense row gets
// an `attachments[]` array of { url, filename, content_type, bytes,
// uploaded_at, uploaded_by }.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { saveUpload, deleteUpload, type SavedFile } from "@/lib/uploads";
import { audit } from "@/lib/audit";
import type { Filter } from "mongodb";

interface ExpenseLike {
  _id: string;
  name?: string;
  vendor_name?: string;
  amount?: number;
  attachments?: Array<SavedFile & { uploaded_at: string; uploaded_by: string }>;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await requirePermission("finance:expenses:edit");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const { id } = await ctx.params;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }

  let saved: SavedFile;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    saved = await saveUpload({
      buffer: buf,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 }
    );
  }

  const expColl = coll<ExpenseLike>(FINANCE_COLLECTIONS.expense);
  const existing = await expColl.findOne({ _id: id } as unknown as Filter<ExpenseLike>);
  if (!existing) {
    await deleteUpload(saved.url); // cleanup orphan
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  const entry = {
    ...saved,
    uploaded_at: new Date().toISOString(),
    uploaded_by: session.name,
  };
  await expColl.updateOne(
    { _id: id } as unknown as Filter<ExpenseLike>,
    { $push: { attachments: entry } as unknown as never }
  );
  await audit({
    kind: "expense",
    target_id: id,
    before: null,
    after: { added_attachment: saved.filename },
    summary: `Attached "${saved.filename}" to expense`,
    changed_by: session.name,
    action: "attach_receipt",
  });
  return NextResponse.json({ attachment: entry });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await requirePermission("finance:expenses:edit");
  if (session instanceof NextResponse) return session;
  const { id } = await ctx.params;
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const expColl = coll<ExpenseLike>(FINANCE_COLLECTIONS.expense);
  await expColl.updateOne(
    { _id: id } as unknown as Filter<ExpenseLike>,
    { $pull: { attachments: { url } as never } as unknown as never }
  );
  await deleteUpload(url);
  await audit({
    kind: "expense",
    target_id: id,
    before: { removed_attachment: url },
    after: null,
    summary: `Removed attachment from expense`,
    changed_by: session.name,
    action: "detach_receipt",
  });
  return NextResponse.json({ ok: true });
}
