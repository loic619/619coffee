"use client";
/**
 * ReportBuilder — the "Shopping Cart for intelligence" on the Daily Brief.
 *
 * Left:  categorized toggles (the cart) sourced from the chart registry.
 * Right: the live ReportCanvas (the preview + the react-to-print target).
 * Top:   "Build Report" → browser-native print dialog (Save as PDF). Native
 *        print keeps Recharts SVG razor-sharp and the file tiny.
 */
import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { REPORT_REGISTRY, REPORT_CATEGORIES, REPORT_PRESETS } from "@/lib/report/registry";
import { useReportStore } from "@/lib/report/store";
import { PRINT_CSS_LIGHT, PRINT_CSS_DARK, REPORT_FONTS, fontCss, type ReportFontId } from "@/lib/report/printStyles";
import { PRODUCT_NAME } from "@/lib/brand";
import ReportCanvas from "./ReportCanvas";

type PrintTheme = "light" | "dark";

/** Bucket items by a key, preserving first-seen (registry) order of both the
 *  buckets and the items within them. Key `undefined` = "no group". */
function orderedBy<T>(arr: T[], key: (t: T) => string | undefined): [string | undefined, T[]][] {
  const out: [string | undefined, T[]][] = [];
  const idx = new Map<string | undefined, number>();
  for (const it of arr) {
    const k = key(it);
    if (!idx.has(k)) { idx.set(k, out.length); out.push([k, []]); }
    out[idx.get(k)!][1].push(it);
  }
  return out;
}

export default function ReportBuilder() {
  const selectedIds = useReportStore((s) => s.selectedIds);
  const toggle = useReportStore((s) => s.toggle);
  const addMany = useReportStore((s) => s.addMany);
  const removeMany = useReportStore((s) => s.removeMany);
  const clear = useReportStore((s) => s.clear);

  // A package is "applied" once all its charts are in the cart; clicking then
  // removes the whole set, otherwise it tops the cart up to the full package.
  const applyPreset = (ids: string[]) => {
    const allIn = ids.every((id) => selectedIds.includes(id));
    if (allIn) removeMany(ids);
    else addMany(ids);
  };

  // Avoid a hydration mismatch: the persisted cart only exists client-side, so
  // gate the selection-dependent UI until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // PDF theme — light reads better on paper (and saves ink); dark matches the
  // on-screen look. The hook reads the latest options each render, so flipping
  // this swaps the injected print stylesheet.
  const [printTheme, setPrintTheme] = useState<PrintTheme>("light");
  // Typeface for the briefing — applied to the preview and the PDF alike, so
  // the customer-facing document can match the house style it is sent under.
  const [font, setFont] = useState<ReportFontId>("sans");

  const canvasRef = useRef<HTMLDivElement>(null);
  const printReport = useReactToPrint({
    contentRef: canvasRef,
    documentTitle: `${PRODUCT_NAME} - Market Briefing - ${new Date().toISOString().slice(0, 10)}`,
    pageStyle: `${printTheme === "light" ? PRINT_CSS_LIGHT : PRINT_CSS_DARK}\n${fontCss(font)}`,
  });

  const count = mounted ? selectedIds.length : 0;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Build a Briefing</h2>
          <p className="text-[11px] text-slate-500">
            Tick the visuals you want, annotate each, then export a print-perfect PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Typeface */}
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="Report typeface">
            {(Object.keys(REPORT_FONTS) as ReportFontId[]).map((id) => (
              <button
                key={id}
                onClick={() => setFont(id)}
                aria-pressed={font === id}
                title={REPORT_FONTS[id].hint}
                style={{ fontFamily: REPORT_FONTS[id].stack }}
                className={`px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  font === id ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {REPORT_FONTS[id].label}
              </button>
            ))}
          </div>
          {/* PDF theme toggle */}
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="PDF theme">
            {(["light", "dark"] as PrintTheme[]).map((t) => (
              <button
                key={t}
                onClick={() => setPrintTheme(t)}
                aria-pressed={printTheme === t}
                title={t === "light" ? "Light PDF — best for printing" : "Dark PDF — matches the screen"}
                className={`px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  printTheme === t ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {count > 0 && (
            <button
              onClick={clear}
              className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-200
                         border border-transparent hover:border-slate-700"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => printReport()}
            disabled={count === 0}
            className="px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed
                       bg-amber-500/10 text-amber-300 border-amber-600/50 hover:bg-amber-500/20"
          >
            Build Report{count > 0 ? ` (${count})` : ""}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 p-4">
        {/* The cart — mirrors the app's tab hierarchy: category → group (origin)
            → subgroup (Exports / S&D / Weather) → visual. Descriptions are
            dropped to keep the list compact. */}
        <div className="space-y-4">
          {/* One-click report packages — tick a whole themed bundle at once.
              Highlighted when every chart in the package is already in the cart
              (click again to remove the set). */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Quick packages</div>
            <div className="flex flex-wrap gap-1.5">
              {REPORT_PRESETS.map((p) => {
                const applied = mounted && p.ids.every((id) => selectedIds.includes(id));
                const partial = mounted && !applied && p.ids.some((id) => selectedIds.includes(id));
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.ids)}
                    aria-pressed={applied}
                    title={p.description}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors
                      ${applied
                        ? "border-amber-600/60 bg-amber-500/15 text-amber-200"
                        : partial
                        ? "border-amber-700/40 bg-amber-500/5 text-amber-300/90"
                        : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:text-slate-100"}`}
                  >
                    <span>{p.label}</span>
                    <span className="rounded px-1 py-0.5 text-[8.5px] font-mono uppercase tracking-wider bg-black/25">
                      {applied ? "✓" : `+${p.ids.length}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {REPORT_CATEGORIES.map((cat) => {
            const items = REPORT_REGISTRY.filter((d) => d.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{cat}</div>
                <div className="space-y-1.5">
                  {orderedBy(items, (d) => d.group).map(([group, gItems]) => (
                    <div key={group ?? "_"} className={group ? "pl-2 border-l border-slate-800/80 space-y-1" : "space-y-1"}>
                      {group && (
                        <div className="text-[11px] font-semibold text-slate-300">{group}</div>
                      )}
                      {orderedBy(gItems, (d) => d.subgroup).map(([sub, sItems]) => (
                        <div key={sub ?? "_"} className={sub ? "pl-2" : ""}>
                          {sub && (
                            <div className="text-[8.5px] uppercase tracking-wider text-slate-600 mb-0.5 mt-1">{sub}</div>
                          )}
                          <div className="space-y-1">
                            {sItems.map((d) => {
                              const checked = mounted && selectedIds.includes(d.id);
                              // Strip the redundant "Origin — " prefix when nested
                              // under that origin's group header.
                              const label = group && d.label.startsWith(`${group} — `)
                                ? d.label.slice(group.length + 3)
                                : d.label;
                              return (
                                <label
                                  key={d.id}
                                  className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors
                                    ${checked
                                      ? "border-amber-600/50 bg-amber-500/5"
                                      : "border-slate-800 bg-slate-950/40 hover:border-slate-700"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(d.id)}
                                    className="accent-amber-500"
                                  />
                                  <span className="text-xs font-medium text-slate-200">{label}</span>
                                  {/* Width badge so the layout footprint is
                                      visible before ticking. */}
                                  <span
                                    className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider border ${
                                      d.width === "half"
                                        ? "text-slate-400 border-slate-700 bg-slate-800/40"
                                        : "text-sky-300 border-sky-800/60 bg-sky-900/20"
                                    }`}
                                  >
                                    {d.width === "half" ? "half" : "full"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* The preview canvas (also the print target). Fixed ~A4 width inside,
            so allow horizontal scroll on narrow screens. */}
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 min-h-[200px] overflow-x-auto">
          <ReportCanvas ref={canvasRef} fontFamily={REPORT_FONTS[font].stack} />
        </div>
      </div>
    </section>
  );
}
