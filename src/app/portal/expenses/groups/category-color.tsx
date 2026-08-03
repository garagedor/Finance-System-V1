// Deterministic color per category (free-text, so we hash the name to a fixed
// palette — the same category always gets the same color). Palette is drawn
// from the app's existing dark-theme accent hues so chips feel native.

const PALETTE = [
  "#818cf8", "#34d399", "#fbbf24", "#f87171", "#22d3ee", "#a78bfa",
  "#f472b6", "#a3e635", "#fb923c", "#2dd4bf", "#38bdf8", "#e879f9",
];

export function categoryColor(
  category: string | null | undefined,
  overrides?: Record<string, string> | null,
): { color: string; bg: string } {
  const key = (category || "other").trim().toLowerCase();
  const override = overrides?.[key];
  if (override) return { color: override, bg: override + "22" };
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const color = PALETTE[h % PALETTE.length];
  return { color, bg: color + "22" }; // 0x22 ≈ 13% alpha
}

/** A small pill: colored dot + category label. */
export function CategoryChip({
  category,
  overrides,
}: {
  category: string | null | undefined;
  overrides?: Record<string, string> | null;
}) {
  const { color, bg } = categoryColor(category, overrides);
  const label = category || "other";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "2px 9px", borderRadius: 999, background: bg, color,
        fontSize: 11, fontWeight: 600, textTransform: "capitalize", whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flex: "0 0 auto" }} />
      {label}
    </span>
  );
}

/** Just the colored dot (used beside the editable category input). */
export function CategoryDot({
  category,
  overrides,
}: {
  category: string | null | undefined;
  overrides?: Record<string, string> | null;
}) {
  const { color } = categoryColor(category, overrides);
  return <span style={{ width: 9, height: 9, borderRadius: 999, background: color, flex: "0 0 auto" }} />;
}
