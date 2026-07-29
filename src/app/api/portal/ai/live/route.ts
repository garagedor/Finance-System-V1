import { NextRequest, NextResponse } from "next/server";
import { readSession, type RbacSession } from "@/lib/rbac";
import { hasAnthropicKey } from "@/lib/ai/model";
import { buildLivePlan } from "@/lib/ai/live/orchestrator";
import { appendLiveSession } from "@/lib/ai/live/session-log";
import type { ChatMessage } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function canUseLive(s: RbacSession): boolean {
  return (
    s.type === "admin" ||
    s.permissions.includes("system:ai:live") ||
    s.permissions.includes("system:ai:view")
  );
}

export async function POST(req: NextRequest) {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseLive(s)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasAnthropicKey()) {
    return NextResponse.json({ error: "AI engine not configured (no ANTHROPIC_API_KEY)." }, { status: 503 });
  }

  let body: { executive?: unknown; messages?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? (body.messages as unknown[]).filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === "object" &&
          ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
          typeof (m as ChatMessage).content === "string",
      )
    : [];
  if (messages.length === 0) return NextResponse.json({ error: "No messages provided" }, { status: 400 });

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "session";
  const ctx = {
    session: { userId: s.userId, name: s.name, type: s.type, permissions: s.permissions },
  };

  try {
    const plan = await buildLivePlan({
      executive: typeof body.executive === "string" ? body.executive : undefined,
      messages,
      ctx,
    });
    // fire-and-forget audit
    appendLiveSession({
      sessionId,
      userName: s.name,
      command: messages[messages.length - 1]?.content ?? "",
      leadPersona: plan.leadPersona,
      toolsUsed: (plan.trace?.toolsUsed ?? []).map((t) => t.name),
      model: plan.trace?.model,
      provider: plan.trace?.provider,
      usage: plan.trace?.usage
        ? { inputTokens: plan.trace.usage.inputTokens, outputTokens: plan.trace.usage.outputTokens }
        : undefined,
    });
    return NextResponse.json(plan);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Live engine error" }, { status: 500 });
  }
}
