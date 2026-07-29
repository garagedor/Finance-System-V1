// The speech-writing layer. The spoken narration is DIFFERENT from the on-screen
// evidence: short, conversational, listenable — never markdown/symbols/emoji/URLs.
// The model writes the narration; these helpers clean + segment it deterministically.

/** Strip anything that shouldn't be read aloud. */
export function cleanNarration(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // code fences
    .replace(/https?:\/\/\S+/g, "") // URLs
    .replace(/\p{Extended_Pictographic}/gu, "") // emoji
    .replace(/^[ \t]*(?:[-*•+]|\d+[.)])[ \t]+/gm, "") // list markers (bullet/numbered)
    .replace(/[*_`#>|~]+/g, "") // markdown
    .replace(/\s+[-–—]\s+/g, ", ") // stray dashes → natural pause
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/** Split narration into short speakable segments (start fast, interruptible). */
export function segmentNarration(text: string, maxLen = 220): string[] {
  const clean = cleanNarration(text);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]?/g) ?? [clean];
  const segs: string[] = [];
  let cur = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (cur && (cur + " " + s).length > maxLen) {
      segs.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) segs.push(cur.trim());
  return segs.slice(0, 12); // cap spoken length
}

/** Auto-detect narration language (Hebrew block → he, else en). */
export function detectLang(text: string): "en" | "he" {
  return /[֐-׿]/.test(text) ? "he" : "en";
}
