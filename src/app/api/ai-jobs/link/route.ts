import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { upsertLink, removeLink } from "@/lib/ai-jobs/links-store";

// Manual AI↔production pairing overrides. Writes only to ag.AiJobLink.

export const dynamic = "force-dynamic";

const canWrite = (type?: string) => type === "admin" || type === "office";

export async function PUT(req: NextRequest) {
  const session = await readSession();
  if (!session || !canWrite(session.type)) {
    return NextResponse.json({ error: "Only admin/office can pin pairings" }, { status: 403 });
  }
  const body = await req.json();
  const aiJobId = String(body.aiJobId ?? "").trim();
  const prodJobId = String(body.prodJobId ?? "").trim();
  if (!aiJobId || !prodJobId) return NextResponse.json({ error: "aiJobId and prodJobId required" }, { status: 400 });
  const result = await upsertLink(aiJobId, prodJobId, session.name);
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await readSession();
  if (!session || !canWrite(session.type)) {
    return NextResponse.json({ error: "Only admin/office can remove pairings" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const aiJobId = searchParams.get("aiJobId");
  if (!aiJobId) return NextResponse.json({ error: "Missing aiJobId" }, { status: 400 });
  const result = await removeLink(aiJobId);
  return NextResponse.json(result);
}
