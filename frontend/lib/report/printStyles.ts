/**
 * Print stylesheets for the Report Builder, injected into react-to-print's
 * print iframe via `pageStyle`. The iframe already inherits the app's compiled
 * Tailwind CSS, so these rules use `!important` to win over the dark-theme
 * classes baked into every chart.
 *
 * LIGHT (default): remaps the slate dark palette to a clean white-paper theme —
 *   dark cards → white, light text → near-black, accents darkened for contrast,
 *   Recharts axis text/grid recoloured for legibility on white. Saves ink and
 *   reads far better on paper than the on-screen dark theme.
 *
 * DARK: keeps the on-screen look, just forcing colour fidelity so the browser
 *   doesn't strip backgrounds.
 */

// ── Typeface ─────────────────────────────────────────────────────────────────
// A briefing that goes to a customer should be able to look like that
// customer's other documents. Three stacks, all resolvable without a webfont
// so the PDF prints identically on any machine: the app's own sans, a book
// serif, and a monospace for the tabular-heavy packages. The stack is applied
// to #report-canvas on screen (preview) and in the print sheet (PDF), so what
// you see is what prints.
export type ReportFontId = "sans" | "serif" | "mono";

export const REPORT_FONTS: Record<ReportFontId, { label: string; stack: string; hint: string }> = {
  sans:  { label: "Sans",  stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
           hint: "Matches the screen — clean, modern" },
  serif: { label: "Serif", stack: `Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Times New Roman", serif`,
           hint: "Reads like a research note or a bank's morning report" },
  mono:  { label: "Mono",  stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
           hint: "Column-aligned figures — for number-dense packages" },
};

export function fontCss(id: ReportFontId): string {
  // Figures stay tabular in every face so columns keep aligning.
  return `#report-canvas, #report-canvas * { font-family: ${REPORT_FONTS[id].stack} !important; }`;
}

const PAGE = `@page { size: A4; margin: 12mm; }`;
const EXACT = `html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;

// Fit-to-A4. The canvas renders at ~A4 content width (700px ≈ 186mm at the 12mm
// @page margin), so it already fits the page 1:1 — render it at full size so
// charts use the whole column. We must NOT force width/height on the Recharts
// SVGs (that dislodges their absolutely-positioned HTML legends and warps the
// plot); we only guard non-chart overflow and keep each card whole across pages.
const FIT = `
  #report-canvas { width: 100% !important; }
  #report-canvas img, #report-canvas table { max-width: 100% !important; }
  #report-canvas section { break-inside: avoid; page-break-inside: avoid; }
`;

export const PRINT_CSS_DARK = `
  ${PAGE}
  @media print {
    ${EXACT}
    ${FIT}
    html, body { background:#0f172a !important; }
  }
`;

export const PRINT_CSS_LIGHT = `
  ${PAGE}
  @media print {
    ${EXACT}
    ${FIT}
    html, body { background:#ffffff !important; }

    /* Surfaces: dark slate/gray backgrounds → white (covers /opacity variants
       like bg-slate-900/60 because the class string still contains the stem). */
    [class*="bg-slate-9"], [class*="bg-slate-8"], [class*="bg-gray-9"] { background-color:#ffffff !important; }
    [class*="bg-slate-700"] { background-color:#f1f5f9 !important; }

    /* Highlight rows (e.g. the ★ Basis line, bg-indigo-950/30) → light blue,
       so they stay called out instead of rendering as muddy grey on white. */
    [class*="bg-indigo-9"] { background-color:#dbeafe !important; }

    /* Text: light → near-black; muted greys → mid-slate (readable on white). */
    [class*="text-white"], [class*="text-slate-100"], [class*="text-slate-200"], [class*="text-slate-300"] { color:#0f172a !important; }
    [class*="text-slate-400"], [class*="text-slate-500"], [class*="text-slate-600"] { color:#475569 !important; }

    /* Accents: brighten-for-dark hues darkened so they stay legible on white. */
    [class*="text-amber-3"], [class*="text-amber-4"], [class*="text-amber-5"] { color:#b45309 !important; }
    [class*="text-emerald-3"], [class*="text-emerald-4"] { color:#059669 !important; }
    [class*="text-red-4"], [class*="text-rose-3"], [class*="text-rose-4"] { color:#dc2626 !important; }
    [class*="text-sky-3"], [class*="text-sky-4"] { color:#0284c7 !important; }
    [class*="text-indigo-3"], [class*="text-indigo-4"] { color:#4f46e5 !important; }

    /* Borders → light grey. */
    [class*="border-slate-"], [class*="border-gray-"] { border-color:#cbd5e1 !important; }

    /* Report chrome: the masthead's thick rule and the executive summary's left
       accent print in strong greys (the generic border mapping above would wash
       them out to hairline-grey). */
    #report-canvas .masthead-rule { border-color:#0f172a !important; }
    #report-canvas .exec-accent { border-left-color:#475569 !important; }

    /* Recharts: axis/legend text → dark, grid + axis lines → light grey. Bar/
       line fills come from inline SVG attributes and are deliberately left as-is. */
    .recharts-text, .recharts-cartesian-axis-tick text, .recharts-label, .recharts-legend-item-text {
      fill:#334155 !important; color:#334155 !important;
    }
    .recharts-cartesian-grid line, .recharts-cartesian-axis line, .recharts-cartesian-axis-tick line {
      stroke:#e2e8f0 !important;
    }
  }
`;
