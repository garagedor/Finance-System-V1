import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { hasAnthropicKey } from "@/lib/ai/model";
import { runAssistant } from "@/lib/ai/engine";
import type { ChatMessage } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the agent loop may make several tool calls

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session || !session.active) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.type !== "admin" && !session.permissions.includes("system:ai:view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "AI engine not configured. Add ANTHROPIC_API_KEY to .env.local and restart the server." },
      { status: 503 },
    );
  }

  let body: { executive?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const ctx = {
    session: {
      userId: session.userId,
      name: session.name,
      type: session.type,
      permissions: session.permissions,
    },
  };

  try {
    const result = await runAssistant({
      executive: typeof body.executive === "string" ? body.executive : undefined,
      messages,
      ctx,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI engine error" },
      { status: 500 },
    );
  }
}
