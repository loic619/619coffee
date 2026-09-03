"use client";
import { useMemo, useState } from "react";
import { chgTone } from "@/lib/formatters";

// Domestic-consumption ranking, rebuilt.
//
// Replaces the old Recharts bar (which nested <Bar> inside <Bar> and so drew
// one identical series per country — the "13 same values" bug). A hand-drawn
// bar list is the right tool here: 40+ rows, each needing a 3-year history and
// two annotations, is a table with bars, not a chart with labels.
//
// Countries cluster into the three demand groups the backend tags:
//   producing  — origin countries drinking their own coffee
//   historical — mature demand (Europe, North America, Japan, Oceania)
//   growing    — emerging consumer markets
// A leaf marks markets where the hot-drink culture is tea-dominant: a low
// per-capita number there is a starting line, not a ceiling.

export interface AnnualEntry { year: string; consumption_mt?: number | null }
export interface Market {
  short: string; name: string; latest_year: string | null;
  consumption_mt: number | null; population: number | null; per_capita_kg: number | null;
  group?: "producing" | "historical" | "growing";
  tea_culture?: boolean;
  annual: AnnualEntry[];
}

const GROUPS = [
  { id: "historical", label: "Historical demand", blurb: "Mature markets — Europe, North America, Japan, Oceania", color: "#0ea5e9" },
  { id: "growing",    label: "Growing demand",    blurb: "Emerging consumer markets", color: "#f59e0b" },
  { id: "producing",  label: "Producing countries", blurb: "Origins drinking their own coffee", color: "#16a34a" },
] as const;

const kt = (mt: number | null | undefined) => (mt == null ? null : mt / 1000);
const fmtKt = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} Mt` : `${Math.round(v).toLocaleString()} kt`);

/** Last n consumption points (oldest→newest) for a market. */
function history(m: Market, n = 4): { year: number; kt: number }[] {
  return m.annual
    .filter(a => a.consumption_mt != null && a.consumption_mt > 0)
    .map(a => ({ year: Number(a.year), kt: (a.consumption_mt as number) / 1000 }))
    .sort((a, b) => a.year - b.year)
    .slice(-n);
}

function Sparkbars({ pts, color }: { pts: { year: number; kt: number }[]; color: string }) {
  if (pts.length < 2) return <div className="w-14" />;
  const max = Math.max(...pts.map(p => p.kt)) || 1;
  return (
    <div className="w-14 h-4 flex items-end gap-[2px] shrink-0" title={pts.map(p => `${p.year}: ${Math.round(p.kt)} kt`).join(" · ")}>
      {pts.map((p, i) => (
        <div key={p.year} className="flex-1 rounded-[1px]"
          style={{ height: `${Math.max(8, (p.kt / max) * 100)}%`, background: color, opacity: 0.25 + 0.75 * (i / (pts.length - 1)) }} />
      ))}
    </div>
  );
}

export default function ConsumptionRanking({ markets }: { markets: Market[] }) {
  const [sortBy, setSortBy] = useState<"volume" | "growth">("volume");
  const [teaOnly, setTeaOnly] = useState(false);

  const rows = useMemo(() => markets.map(m => {
    const h = history(m);
    const cur = h.length ? h[h.length - 1] : null;
    const prev = h.length > 1 ? h[h.length - 2] : null;
    const dKt = cur && prev ? cur.kt - prev.kt : null;
    const dPct = cur && prev && prev.kt ? (cur.kt / prev.kt - 1) * 100 : null;
    return {
      ...m,
      group: m.group ?? "growing",
      hist: h,
      curKt: cur?.kt ?? kt(m.consumption_mt) ?? 0,
      curYear: cur?.year ?? (m.latest_year ? Number(m.latest_year) : null),
      dKt, dPct,
    };
  }).filter(r => r.curKt > 0), [markets]);

  const grand = rows.reduce((s, r) => s + r.curKt, 0);

  if (!rows.length) return null;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Domestic consumption by market (kt/yr)
          </div>
          <div className="text-[10px] text-slate-500">
            Latest USDA PSD year · bar = today, ticks = last 4 years, right = change vs prior year
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px]">
          <button onClick={() => setTeaOnly(v => !v)}
            className={`px-2 py-0.5 rounded border ${teaOnly ? "border-emerald-500/60 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            🍃 tea-culture only
          </button>
          <div className="flex rounded overflow-hidden border border-slate-700">
            {([["volume", "By volume"], ["growth", "By growth"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setSortBy(k)}
                className={`px-2 py-0.5 ${sortBy === k ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
            ))}
          </div>
          <span className="font-mono text-slate-400">Σ {fmtKt(grand)}</span>
        </div>
      </div>

      <div className="space-y-3">
        {GROUPS.map(g => {
          let list = rows.filter(r => r.group === g.id);
          if (teaOnly) list = list.filter(r => r.tea_culture);
          if (!list.length) return null;
          list = [...list].sort((a, b) =>
            sortBy === "volume" ? b.curKt - a.curKt : (b.dPct ?? -999) - (a.dPct ?? -999));
          const groupTotal = list.reduce((s, r) => s + r.curKt, 0);
          // Scale bars within the group so small markets stay readable.
          const max = Math.max(...list.map(r => r.curKt)) || 1;
          return (
            <div key={g.id}>
              <div className="flex items-baseline gap-2 mb-1 pb-1 border-b border-slate-700/60">
                <span className="w-1.5 h-3 rounded-sm" style={{ background: g.color }} />
                <span className="text-[11px] font-semibold text-slate-200">{g.label}</span>
                <span className="text-[9px] text-slate-500">{g.blurb}</span>
                <span className="ml-auto text-[9px] font-mono text-slate-400">
                  {list.length} · {fmtKt(groupTotal)} ({(groupTotal / grand * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="space-y-[3px]">
                {list.map(r => (
                  <div key={r.short} className="flex items-center gap-2 text-[10px] group">
                    <div className="w-28 shrink-0 truncate flex items-center gap-1"
                      title={r.tea_culture ? `${r.name} — tea-dominant hot-drink culture` : r.name}>
                      {r.tea_culture && <span className="text-emerald-400 text-[9px]">🍃</span>}
                      <span className={r.tea_culture ? "text-emerald-300" : "text-slate-300"}>{r.name}</span>
                    </div>
                    <div className="flex-1 h-3.5 bg-slate-900/60 rounded-sm overflow-hidden min-w-[40px]">
                      <div className="h-full rounded-sm transition-all"
                        style={{ width: `${Math.max(1, (r.curKt / max) * 100)}%`, background: g.color, opacity: r.tea_culture ? 0.55 : 0.85 }} />
                    </div>
                    <span className="w-16 text-right font-mono text-slate-200 shrink-0">{fmtKt(r.curKt)}</span>
                    <Sparkbars pts={r.hist} color={g.color} />
                    <span className={`w-16 text-right font-mono shrink-0 ${r.dKt == null ? "text-slate-600" : chgTone(r.dKt)}`}>
                      {r.dKt == null ? "—" : `${r.dKt >= 0 ? "+" : ""}${Math.round(r.dKt * 1000).toLocaleString()} t`}
                    </span>
                    <span className={`w-12 text-right font-mono shrink-0 ${r.dPct == null ? "text-slate-600" : chgTone(r.dPct)}`}>
                      {r.dPct == null ? "—" : `${r.dPct >= 0 ? "+" : ""}${r.dPct.toFixed(1)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[9px] text-slate-500 italic">
        USDA PSD domestic consumption. Bars scale within each group so smaller markets stay legible — compare
        across groups using the numbers, not the bar lengths. 🍃 marks tea-dominant hot-drink cultures, where a
        low per-capita figure reflects a young coffee habit rather than a saturated one.
      </div>
    </div>
  );
}
