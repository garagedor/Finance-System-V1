import "server-only";

// Minimal Telegram sender for owner alerts (e.g. the report-drift monitor).
// Config via env: TELEGRAM_BOT_TOKEN (from @BotFather) + TELEGRAM_CHAT_ID (the
// chat/user id to message). Both must be set; otherwise sends are skipped (never
// throws) so callers can treat Telegram as best-effort and fall back to email.

export function telegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(
  text: string,
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set" };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, reason: `Telegram HTTP ${r.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "telegram send failed" };
  }
}
