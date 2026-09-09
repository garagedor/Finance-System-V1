import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { listAiJobs, createAiJob, updateAiJob, deleteAiJob } from "@/lib/ai-jobs/jobs-crud";

// Tables AI CRUD over ag.Job_ai for authorized reviewers. Session-authed (the
// middleware already 401s unauthenticated /api calls); writes additionally
// require admin/office. This route NEVER touches ag.Job.

export const dynamic = "force-dynamic";

const canWrite = (type?: string) => type === "admin" || type === "office";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let filters: Array<{ field: string; value: unknown; operator?: string }> = [];
  const filtersRaw = searchParams.get("filters");
  if (filtersRaw) {
    try {
      const parsed = JSON.parse(filtersRaw);
      if (Array.isArray(parsed)) filters = parsed;
    } catch {
      /* ignore malformed filters */
    }
  }
  const res = await listAiJobs({
    page: Number(searchParams.get("page") ?? "1"),
    pageSize: Number(searchParams.get("pageSize") ?? "50"),
    sortBy: searchParams.get("sortBy"),
    sortDir: (searchParams.get("sortDir") as "asc" | "desc") ?? "desc",
    filters,
    filterLogic: (searchParams.get("filterLogic") as "AND" | "OR") ?? "AND",
    search: searchParams.get("search") ?? "",
    limitFirst50: searchParams.get("limitFirst50") === "true",
  });
  return NextResponse.json(res);
}

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session || !canWrite(session.type)) {
    return NextResponse.json({ error: "Only admin/office can add AI rows" }, { status: 403 });
  }
  const body = await req.json();
  const result = await createAiJob(body, session.name);
  return NextResponse.json(result, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const session = await readSession();
  if (!session || !canWrite(session.type)) {
    return NextResponse.json({ error: "Only admin/office can edit AI rows" }, { status: 403 });
  }
  const body = await req.json();
  const id = body._id || body.id;
  if (!id) return NextResponse.json({ error: "Missing _id" }, { status: 400 });
  const result = await updateAiJob(String(id), body, session.name);
  if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await readSession();
  if (!session || !canWrite(session.type)) {
    return NextResponse.json({ error: "Only admin/office can delete AI rows" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const result = await deleteAiJob(id);
  return NextResponse.json(result);
}
