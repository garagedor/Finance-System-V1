import { NextRequest, NextResponse } from "next/server";
import { readSession, type RbacSession } from "@/lib/rbac";
import { resolveTts } from "@/lib/ai/live/voice/server";
import { getVoiceSettings, VOICE_DEFAULTS, type VoiceSettings } from "@/lib/ai/live/voice/settings";
import { detectLang } from "@/lib/ai/live/voice/narration";
import { appendVoiceUsage } from "@/lib/ai/live/session-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function canUse(s: RbacSession): boolean {
  return s.type === "admin" || s.permissions.includes("system:ai:live") || s.permissions.includes("system:ai:view");
}

// Streams premium TTS audio for ONE narration segment. The provider API key
// stays server-side; the browser receives only the proxied audio stream.
export async function POST(req: NextRequest) {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUse(s)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = resolveTts();
  if (!provider) {
    return NextResponse.json({ error: "Premium voice not configured", fallback: true }, { status: 503 });
  }

  let body: { segment?: unknown; voiceId?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const segment = typeof body.segment === "string" ? body.segment.slice(0, 1200) : "";
  if (!segment.trim()) return NextResponse.json({ error: "No text" }, { status: 400 });

  // Settings tune the delivery, but audio playback must NOT depend on a DB read.
  // If Atlas flakes (transient TLS drop), fall back to defaults and still speak.
  let settings: VoiceSettings = VOICE_DEFAULTS;
  try {
    settings = await getVoiceSettings();
  } catch {
    // keep defaults — the request usually carries its own voiceId anyway
  }
  const voiceId = (typeof body.voiceId === "string" && body.voiceId) || settings.voiceId;
  if (!voiceId) {
    return NextResponse.json({ error: "No voice selected — choose one in Voice Settings", fallback: true }, { status: 503 });
  }
  const lang = typeof body.lang === "string" ? body.lang : settings.lang === "auto" ? detectLang(segment) : settings.lang;

  try {
    const audio = await provider.stream(segment, {
      voiceId,
      lang,
      settings: { stability: settings.stability, style: settings.style, speed: settings.speed },
      signal: req.signal, // client abort (barge-in) cancels the upstream request
    });
    // Usage logging is best-effort — never let a DB hiccup break audio.
    void Promise.resolve(
      appendVoiceUsage({
        userName: s.name,
        chars: segment.length,
        estCost: provider.estimateCost(segment.length),
        provider: provider.id,
        voiceId,
      }),
    ).catch(() => {});
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "TTS error", fallback: true }, { status: 502 });
  }
}
