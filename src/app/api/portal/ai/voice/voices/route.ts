import { NextRequest, NextResponse } from "next/server";
import { readSession, type RbacSession } from "@/lib/rbac";
import { resolveTts, voiceProviderStatus } from "@/lib/ai/live/voice/server";
import { getVoiceSettings, setVoiceSettings, VOICE_DEFAULTS, type VoiceSettings } from "@/lib/ai/live/voice/settings";

export const dynamic = "force-dynamic";

function canView(s: RbacSession): boolean {
  return s.type === "admin" || s.permissions.includes("system:ai:live") || s.permissions.includes("system:ai:view");
}
function canManage(s: RbacSession): boolean {
  return s.type === "admin" || s.permissions.includes("system:ai:manage");
}

// GET: provider status + curated MALE voices + current settings. Never the key.
// Resilient by design: a failure in any one piece (DB read, provider health,
// voice list) degrades that piece rather than 500-ing the whole page.
export async function GET() {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canView(s)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const warnings: string[] = [];

  const status = voiceProviderStatus();

  // Settings read (DB). If it fails, fall back to defaults so the page still loads.
  let settings = VOICE_DEFAULTS;
  try {
    settings = await getVoiceSettings();
  } catch (e) {
    warnings.push(`settings: ${e instanceof Error ? e.message : "read failed"}`);
  }

  let healthy = false;
  let voices: unknown[] = [];
  try {
    const provider = resolveTts();
    if (provider) {
      const h = await provider.healthCheck().catch((e) => ({ ok: false, detail: String(e) }));
      healthy = h.ok;
      const all = await provider.getVoices().catch(() => []);
      // Curate to male voices for the primary executive assistant.
      voices = all.filter((v) => (v.gender ?? "").toLowerCase() === "male");
      if (voices.length === 0) voices = all; // if labels are missing, show all
    }
  } catch (e) {
    warnings.push(`provider: ${e instanceof Error ? e.message : "unavailable"}`);
  }

  return NextResponse.json({
    provider: status.provider,
    configured: status.configured,
    healthy,
    voices,
    warnings,
    settings: {
      voiceId: settings.voiceId ?? null,
      heVoiceId: settings.heVoiceId ?? null,
      lang: settings.lang,
      autoSpeak: settings.autoSpeak,
      speed: settings.speed,
      stability: settings.stability,
      style: settings.style,
      narrationDetail: settings.narrationDetail,
    },
  });
}

// POST: save voice settings (requires manage rights).
export async function POST(req: NextRequest) {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(s)) return NextResponse.json({ error: "Forbidden — requires AI manage permission" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Partial<VoiceSettings> = {};
  if (typeof body.voiceId === "string") patch.voiceId = body.voiceId;
  if (typeof body.heVoiceId === "string") patch.heVoiceId = body.heVoiceId;
  if (body.lang === "auto" || body.lang === "en" || body.lang === "he") patch.lang = body.lang;
  if (typeof body.autoSpeak === "boolean") patch.autoSpeak = body.autoSpeak;
  if (typeof body.speed === "number") patch.speed = Math.max(0.7, Math.min(1.2, body.speed));
  if (typeof body.stability === "number") patch.stability = Math.max(0, Math.min(1, body.stability));
  if (typeof body.style === "number") patch.style = Math.max(0, Math.min(1, body.style));
  if (body.narrationDetail === "concise" || body.narrationDetail === "standard" || body.narrationDetail === "detailed")
    patch.narrationDetail = body.narrationDetail;

  await setVoiceSettings(patch);
  return NextResponse.json({ ok: true });
}
