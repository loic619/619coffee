// Shared number / date / ago formatters. Extracted to deduplicate ~15 sites
// that each had their own `fmt`-style helper. Each function returns "—" for
// null / undefined / non-finite input so callers can pass DB values straight
// through without a guard.

export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Units — the canonical spellings ─────────────────────────────────────────
// Six spellings for two units were live at once (¢/lb, c/lb, cents/lb, cts/lb;
// USD/t, USD/mt, USD/MT). In a tool where a unit mix-up is a wrong trade that
// is the cheapest trust win there is. Display code uses these; do not spell a
// unit inline. (Parser token lists that match SOURCE strings — e.g. the spot
// offer unit matcher — are deliberately not routed through here.)
export const UNIT_CENTS_LB = "¢/lb";     // ICE Arabica (KC) and NY-basis differentials
export const UNIT_USD_MT   = "USD/MT";   // ICE Robusta (RC) and metric-tonne pricing

// Number grouping is pinned to en-US everywhere. A bare toLocaleString() follows
// the visitor's browser, so a European user saw 1.234,5 where every other
// figure on the page assumed 1,234.5 — the same digits reading as a different
// number depending on who is looking.
const LOCALE = "en-US";

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(LOCALE);
}

// Rounded count formatter (en-US grouping). Used for certified-stocks tile
// readouts where decimals are noise.
export function fmtNumRounded(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString(LOCALE);
}

// Signed change with thousand-separators: "+150" / "-30" / "—".
export function fmtChg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + n.toLocaleString(LOCALE);
}

// Signed percentage: "+1.5%" / "-0.3%" / "—".
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

// Signed COT attribution: "+0.42B" / "-1.20B" / "—".
export function fmtAttr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "B";
}

// Lot count with a k-suffix above 1000: 1500 → "2k", 850 → "850". Used by the
// COT gauge readouts (CotGauges / Gauges) which had identical local copies.
export function fmtLotK(v: number): string {
  return Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + "k" : String(Math.round(v));
}

// ISO timestamp → "Xm ago" / "Xh ago" / "Xd ago".
export function fmtAgo(iso: string): string {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return "—";
  if (h < 1)  return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// "YYYY-MM-DD" → "MM/DD" for tight chart axes.
export function fmtDateLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

// "YYYY-MM" → "MMM-YY" (e.g. "2026-03" → "Mar-26"). Returns the input
// unchanged on parse failure so callers don't render "undefined-undefined".
export function fmtMonth(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  const mo = parseInt(m[2], 10) - 1;
  if (mo < 0 || mo > 11) return ym;
  return `${MONTH_ABBR[mo]}-${m[1].slice(2)}`;
}
