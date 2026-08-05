"use client";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
// Build-time OI snapshot: the committed oi_history.json the daily export
// refreshes every deploy. Importing it (rather than a hand-maintained constant)
// means the pre-fetch initial paint is always current as of the last deploy.
import OI_SNAPSHOT_RAW from "@/public/data/oi_history.json";
// Rename-proof: new owner/repo first, old as fallback (raw.githubusercontent
// serves renamed repos via redirect, but only until the old username is
// re-registered — so prefer the canonical name).
const GITHUB_OI_URLS = [
  "https://raw.githubusercontent.com/loic619/619coffee/main/data/oi_history.json",
  "https://raw.githubusercontent.com/loicscanu-ctrl/Coffee-intel-map/main/data/oi_history.json",
];

/** Fetch the first URL that answers OK (per-candidate failures fall through). */
async function fetchFirstOk(urls: string[]): Promise<Response> {
  let lastErr: unknown = new Error("no candidates");
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) return r;
      lastErr = new Error(`${u} → ${r.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

interface OIEntry { symbol: string; oi: number; chg: number; }
interface DayData  { date: string; contracts: OIEntry[]; }

interface CotWeeklyRow {
  date: string;
  ny:  CotMarket | null;
  ldn: CotMarket | null;
}
interface CotMarket {
  pmpu_long: number | null;   pmpu_short: number | null;
  swap_long: number | null;   swap_short: number | null;   swap_spread: number | null;
  mm_long: number | null;     mm_short: number | null;     mm_spread: number | null;
  other_long: number | null;  other_short: number | null;  other_spread: number | null;
  nr_long: number | null;     nr_short: number | null;
  // Old/Other crop split — Arabica (NY) only
  pmpu_long_old: number | null;    pmpu_short_old: number | null;
  swap_long_old: number | null;    swap_short_old: number | null;    swap_spread_old: number | null;
  mm_long_old: number | null;      mm_short_old: number | null;      mm_spread_old: number | null;
  other_long_old: number | null;   other_short_old: number | null;   other_spread_old: number | null;
  nr_long_old: number | null;      nr_short_old: number | null;
  pmpu_long_other: number | null;  pmpu_short_other: number | null;
  swap_long_other: number | null;  swap_short_other: number | null;  swap_spread_other: number | null;
  mm_long_other: number | null;    mm_short_other: number | null;    mm_spread_other: number | null;
  other_long_other: number | null; other_short_other: number | null; other_spread_other: number | null;
  nr_long_other: number | null;    nr_short_other: number | null;
}

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6,
  N:7, Q:8, U:9, V:10, X:11, Z:12,
};

function symSortKey(sym: string): number {
  const m = sym.match(/^(?:KC|RM)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return 9999;
  const month = LETTER_TO_MONTH[m[1].toUpperCase()] ?? 0;
  const year  = parseInt(m[2], 10);
  return year * 100 + month;
}

function shortSym(sym: string) {
  return sym.replace(/^(RM|KC)/, "");
}

// Old crop = KC contracts expiring before Oct 2026 (current 2025/26 crop year ends Sep 2026)
function kcCropGroup(sym: string): "old" | "other" {
  const m = sym.match(/^KC([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return "other";
  const month = LETTER_TO_MONTH[m[1].toUpperCase()] ?? 0;
  const year  = 2000 + parseInt(m[2], 10);
  return (year * 12 + month) < (2026 * 12 + 10) ? "old" : "other";
}

function fmtChg(chg: number | null): string {
  if (chg === null) return "—";
  return (chg > 0 ? "+" : "") + chg.toLocaleString();
}

function fmtNum(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString();
}

// ── Build-time OI snapshot ────────────────────────────────────────────────────
// Seeds the table's first paint from the committed oi_history.json (refreshed by
// the daily export, so it advances on every deploy — no hand-maintained, quickly
// stale constant). The runtime fetches below enrich it with anything newer.
// `chg` is recomputed from day-over-day OI in the component, so the snapshot's
// lack of a `chg` field is irrelevant.
const OI_SNAPSHOT = OI_SNAPSHOT_RAW as unknown as Record<"arabica" | "robusta", DayData[]>;

// ── COT rows config ────────────────────────────────────────────────────────────

type CotRowDef = { label: string; key: keyof CotMarket; section: "long" | "short" | "spread" };

function makeCotRows(suffix: "" | "_old" | "_other"): CotRowDef[] {
  const s = suffix;
  return [
    { label: "PMPU Long",   key: `pmpu_long${s}`  as keyof CotMarket, section: "long"   },
    { label: "Swap Long",   key: `swap_long${s}`  as keyof CotMarket, section: "long"   },
    { label: "MM Long",     key: `mm_long${s}`    as keyof CotMarket, section: "long"   },
    { label: "Other Long",  key: `other_long${s}` as keyof CotMarket, section: "long"   },
    ...(s !== "_old" && s !== "_other" ? [{ label: "NR Long", key: "nr_long" as keyof CotMarket, section: "long" as const }] :
       [{ label: "NR Long", key: `nr_long${s}` as keyof CotMarket, section: "long" as const }]),
    { label: "PMPU Short",  key: `pmpu_short${s}` as keyof CotMarket, section: "short"  },
    { label: "Swap Short",  key: `swap_short${s}` as keyof CotMarket, section: "short"  },
    { label: "MM Short",    key: `mm_short${s}`   as keyof CotMarket, section: "short"  },
    { label: "Other Short", key: `other_short${s}`as keyof CotMarket, section: "short"  },
    ...(s !== "_old" && s !== "_other" ? [{ label: "NR Short", key: "nr_short" as keyof CotMarket, section: "short" as const }] :
       [{ label: "NR Short", key: `nr_short${s}` as keyof CotMarket, section: "short" as const }]),
    { label: "Swap Spread", key: `swap_spread${s}`  as keyof CotMarket, section: "spread" },
    { label: "MM Spread",   key: `mm_spread${s}`    as keyof CotMarket, section: "spread" },
    { label: "Other Spread",key: `other_spread${s}` as keyof CotMarket, section: "spread" },
  ];
}

const COT_ROWS_ALL   = makeCotRows("");
const COT_ROWS_OLD   = makeCotRows("_old");
const COT_ROWS_OTHER = makeCotRows("_other");

// ── Derive "All" = Old + Other (base _All fields have a swap_short/spread bug) ─

function makeAllMarket(c: CotMarket): CotMarket {
  const add = (a: number | null, b: number | null): number | null =>
    a != null && b != null ? a + b : a ?? b;
  return {
    ...c,
    pmpu_long:    add(c.pmpu_long_old,    c.pmpu_long_other),
    pmpu_short:   add(c.pmpu_short_old,   c.pmpu_short_other),
    swap_long:    add(c.swap_long_old,    c.swap_long_other),
    swap_short:   add(c.swap_short_old,   c.swap_short_other),
    swap_spread:  add(c.swap_spread_old,  c.swap_spread_other),
    mm_long:      add(c.mm_long_old,      c.mm_long_other),
    mm_short:     add(c.mm_short_old,     c.mm_short_other),
    mm_spread:    add(c.mm_spread_old,    c.mm_spread_other),
    other_long:   add(c.other_long_old,   c.other_long_other),
    other_short:  add(c.other_short_old,  c.other_short_other),
    other_spread: add(c.other_spread_old, c.other_spread_other),
    nr_long:      add(c.nr_long_old,      c.nr_long_other),
    nr_short:     add(c.nr_short_old,     c.nr_short_other),
  };
}

// ── COT daily estimate ────────────────────────────────────────────────────────
// Best model per category (backtest v3, 863 weeks 2007-2026):
//   MM, Other, NR  → Proportional OI scaling: net × OI(d)/OI(anchor)
//   PMPU, Swap     → Baseline: last known value (no change)
// Uncertainty per trading day since last COT: MM ±870, PMPU ±860, Swap ±245, Other ±265, NR ±120

const COT_DAILY_UNCERTAINTY = { mm: 870, pmpu: 860, swap: 245, other: 265, nr: 120 } as const;

function calDaysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

interface CotEstRow {
  label: string;
  cat: keyof typeof COT_DAILY_UNCERTAINTY;
  // proportional OI scale, or fixed baseline
  method: "prop_oi" | "baseline";
}

const COT_EST_ROWS: CotEstRow[] = [
  { label: "MM net (est.)",    cat: "mm",    method: "prop_oi"  },
  { label: "PMPU net (est.)",  cat: "pmpu",  method: "baseline" },
  { label: "Swap net (est.)",  cat: "swap",  method: "baseline" },
  { label: "Other net (est.)", cat: "other", method: "prop_oi"  },
  { label: "NR net (est.)",    cat: "nr",    method: "prop_oi"  },
];

function CotEstimateSection({ days, totals, cotByDateRef, sortedCotDates }: {
  days: DayData[];
  totals: { oi: number }[];
  cotByDateRef: Map<string, CotMarket>;   // arabica → cotByDateAll, robusta → cotByDate
  sortedCotDates: string[];
}) {
  const [open, setOpen] = useState(false);

  // For each OI day, find the anchor COT entry (most recent COT date ≤ that day)
  function getAnchor(dayDate: string): {
    cotDate: string; cot: CotMarket; anchorOI: number; daysSince: number;
  } | null {
    const cotDate = sortedCotDates.filter(d => d <= dayDate).at(-1);
    if (!cotDate) return null;
    const cot = cotByDateRef.get(cotDate);
    if (!cot) return null;
    // find OI total for anchor date from days array
    const anchorDayIdx = days.findIndex(d => d.date === cotDate);
    const anchorOI = anchorDayIdx >= 0 ? totals[anchorDayIdx].oi : 0;
    return { cotDate, cot, anchorOI, daysSince: calDaysBetween(cotDate, dayDate) };
  }

  function netFor(cot: CotMarket, cat: CotEstRow["cat"]): number | null {
    const l = cot[`${cat}_long` as keyof CotMarket] as number | null;
    const s = cot[`${cat}_short` as keyof CotMarket] as number | null;
    if (l == null || s == null) return null;
    return l - s;
  }

  function estimate(dayIdx: number, row: CotEstRow): { val: number | null; uncertainty: number; daysSince: number; isActual: boolean } {
    const dayDate = days[dayIdx]?.date;
    if (!dayDate) return { val: null, uncertainty: 0, daysSince: 0, isActual: false };
    const anchor = getAnchor(dayDate);
    if (!anchor) return { val: null, uncertainty: 0, daysSince: 0, isActual: false };
    const { cotDate, cot, anchorOI, daysSince } = anchor;
    const isActual = dayDate === cotDate;
    const lastNet = netFor(cot, row.cat);
    if (lastNet == null) return { val: null, uncertainty: 0, daysSince, isActual };
    let val: number | null = lastNet;
    if (!isActual && row.method === "prop_oi" && anchorOI > 0) {
      const curOI = totals[dayIdx]?.oi ?? 0;
      val = curOI > 0 ? Math.round(lastNet * curOI / anchorOI) : lastNet;
    }
    const uncertainty = daysSince * COT_DAILY_UNCERTAINTY[row.cat];
    return { val, uncertainty, daysSince, isActual };
  }

  // When isActual=true, reconstruct what the estimate *would* have been using the prior COT anchor
  function getEstimateForActual(dayIdx: number, row: CotEstRow, actualCotDate: string): number | null {
    const prevCotDate = sortedCotDates.filter(d => d < actualCotDate).at(-1);
    if (!prevCotDate) return null;
    const prevCot = cotByDateRef.get(prevCotDate);
    if (!prevCot) return null;
    const prevNet = netFor(prevCot, row.cat);
    if (prevNet == null) return null;
    if (row.method === "prop_oi") {
      const prevAnchorIdx = days.findIndex(d => d.date === prevCotDate);
      const prevAnchorOI = prevAnchorIdx >= 0 ? totals[prevAnchorIdx].oi : 0;
      const curOI = totals[dayIdx]?.oi ?? 0;
      if (prevAnchorOI > 0 && curOI > 0) return Math.round(prevNet * curOI / prevAnchorOI);
    }
    return prevNet;
  }

  // Header shows MM net estimate for most recent day (computed but currently unused in display)
  void estimate(0, COT_EST_ROWS[0]);
  const anchor0     = getAnchor(days[0]?.date ?? "");

  return (
    <>
      {/* Outer toggle row */}
      <tr
        className="cursor-pointer select-none border-t border-dashed border-amber-900/50 bg-amber-950/10 hover:bg-amber-950/20 font-semibold"
        onClick={() => setOpen(p => !p)}
      >
        <td className="px-2 py-1 sticky left-0 bg-slate-900 text-[10px] font-bold uppercase tracking-widest text-amber-500/80 whitespace-nowrap">
          <span className="mr-1.5 text-[9px]">{open ? "▼" : "▶"}</span>
          COT Est. (intraweek)
        </td>
        {days.map((d, i) => {
          const mmEst = estimate(i, COT_EST_ROWS[0]);
          const anchor = getAnchor(d.date);
          let daysLabel = "";
          if (anchor && !mmEst.isActual) {
            daysLabel = `+${mmEst.daysSince}d`;
          } else if (mmEst.isActual && anchor) {
            const estVal = getEstimateForActual(i, COT_EST_ROWS[0], anchor.cotDate);
            const delta = mmEst.val != null && estVal != null ? mmEst.val - estVal : null;
            daysLabel = delta != null ? `Δ${delta > 0 ? "+" : ""}${(delta / 1000).toFixed(1)}k` : "actual";
          }
          return (<>
            <td key={d.date + "-est-val"} className="text-right px-2 py-1 border-l border-slate-800 text-amber-400/70 text-[10px] font-mono">
              {mmEst.val != null ? mmEst.val.toLocaleString() : "—"}
            </td>
            <td key={d.date + "-est-lag"} className="text-right px-2 py-1 text-[9px] text-slate-600 whitespace-nowrap">
              {daysLabel}
            </td>
          </>);
        })}
      </tr>

      {open && (
        <>
          {/* Legend row */}
          <tr className="bg-slate-900 border-b border-slate-800">
            <td className="px-2 py-1 sticky left-0 bg-slate-900 text-[9px] text-slate-600 italic whitespace-nowrap">
              {anchor0 ? `Anchor: ${anchor0.cotDate}` : ""}
            </td>
            {days.map((_, i) => {
              const anchor = getAnchor(days[i]?.date ?? "");
              return (<>
                <td key={i + "-leg-val"} className="text-center px-1 py-1 border-l border-slate-800 text-[9px] text-slate-600 italic">
                  {anchor ? `COT ${anchor.cotDate.slice(5)}` : "—"}
                </td>
                <td key={i + "-leg-unc"} className="text-center px-1 py-1 text-[9px] text-slate-700 italic">
                  {getAnchor(days[i]?.date ?? "")?.cotDate === days[i]?.date ? "Δvs.est" : "±unc"}
                </td>
              </>);
            })}
          </tr>

          {/* One row per category */}
          {COT_EST_ROWS.map(row => (
            <tr key={row.cat} className="border-b border-slate-800/60 hover:bg-slate-800/30">
              <td className="px-2 py-1 sticky left-0 bg-slate-900 text-slate-400 italic text-[11px] whitespace-nowrap">
                {row.label}
                <span className="ml-1 text-[9px] text-slate-600 not-italic">
                  {row.method === "prop_oi" ? "∝OI" : "=last"}
                </span>
              </td>
              {days.map((d, i) => {
                const { val, uncertainty, isActual } = estimate(i, row);
                const anchor = isActual ? getAnchor(d.date) : null;
                const estVal = isActual && anchor ? getEstimateForActual(i, row, anchor.cotDate) : null;
                const delta = isActual && val != null && estVal != null ? val - estVal : null;
                return (<>
                  <td key={d.date + row.cat + "-v"}
                    className={`text-right px-2 py-1 border-l border-slate-800 font-mono
                      ${val == null ? "text-slate-700" : isActual ? "text-slate-200" : "text-amber-300/70 italic"}`}>
                    {val != null ? val.toLocaleString() : "—"}
                  </td>
                  <td key={d.date + row.cat + "-u"}
                    className={`text-right px-2 py-1 text-[9px] font-mono whitespace-nowrap ${
                      delta != null ? (delta > 0 ? "text-red-400" : delta < 0 ? "text-green-400" : "text-slate-600") : "text-slate-600"
                    }`}>
                    {!isActual && val != null ? `±${(uncertainty / 1000).toFixed(1)}k`
                     : delta != null ? `Δ${delta > 0 ? "+" : ""}${delta.toLocaleString()}`
                     : ""}
                  </td>
                </>);
              })}
            </tr>
          ))}

          {/* Net speculative = MM + Other - PMPU short bias  (informational) */}
          <tr className="border-t border-slate-700 bg-slate-800/30 font-semibold">
            <td className="px-2 py-1 sticky left-0 bg-slate-900 text-amber-400/80 text-[10px] uppercase tracking-wider whitespace-nowrap">
              Spec. net (MM+Oth)
            </td>
            {days.map((d, i) => {
              const mm    = estimate(i, COT_EST_ROWS[0]);
              const other = estimate(i, COT_EST_ROWS[3]);
              const specNet = mm.val != null && other.val != null ? mm.val + other.val : null;
              const unc = (mm.uncertainty + other.uncertainty);
              const isActual = mm.isActual;
              return (<>
                <td key={d.date + "-spec-v"}
                  className={`text-right px-2 py-1 border-l border-slate-800 font-mono font-bold
                    ${specNet == null ? "text-slate-700" : specNet > 0 ? "text-emerald-400/80" : "text-red-400/80"}`}>
                  {specNet != null ? specNet.toLocaleString() : "—"}
                </td>
                <td key={d.date + "-spec-u"}
                  className="text-right px-2 py-1 text-[9px] text-slate-600 font-mono">
                  {specNet != null && !isActual ? `±${(unc / 1000).toFixed(1)}k` : ""}
                </td>
              </>);
            })}
          </tr>

          {/* Footnote */}
          <tr className="border-b border-slate-800">
            <td colSpan={1 + days.length * 2}
              className="px-2 py-1 text-[9px] text-slate-600 italic sticky left-0 bg-slate-900">
              ∝OI = Proportional OI scaling (backtest MAE: MM 4,327 · Other 1,319 · NR 598 lots) ·
              =last = Last known value (PMPU MAE 4,295 · Swap 1,216) · Uncertainty grows ±870 lots/day for MM
            </td>
          </tr>
        </>
      )}
    </>
  );
}

// ── OI contract row ───────────────────────────────────────────────────────────

function OIContractRow({ sym, days, getOI, getOIChg }: {
  sym: string; days: DayData[];
  getOI: (i: number, sym: string) => number | null;
  getOIChg: (i: number, sym: string) => number | null;
}) {
  return (
    <tr className="border-b border-slate-800 hover:bg-slate-800/40">
      <td className="px-2 py-1 text-slate-300 font-medium sticky left-0 bg-slate-900">{shortSym(sym)}</td>
      {days.map((d, i) => {
        const oi  = getOI(i, sym);
        const chg = getOIChg(i, sym);
        return (<>
          <td key={d.date + sym + "-oi"} className="text-right px-2 py-1 text-slate-200 border-l border-slate-800">
            {oi !== null ? oi.toLocaleString() : "—"}
          </td>
          <td key={d.date + sym + "-chg"} className={`text-right px-2 py-1 font-medium ${chg === null ? "text-slate-600" : chg > 0 ? "bg-green-900/40 text-green-300" : chg < 0 ? "bg-red-900/40 text-red-300" : "text-slate-500"}`}>
            {chg !== null ? fmtChg(chg) : "—"}
          </td>
        </>);
      })}
    </tr>
  );
}

// ── OI group header — acts as toggle AND subtotal row with per-date numbers ────

function OIGroupHeader({ label, open, onToggle, days, accent, computeSubtotal }: {
  label: string; open: boolean; onToggle: () => void;
  days: DayData[]; accent: "amber" | "sky" | "slate";
  computeSubtotal: (i: number) => { oi: number; chg: number | null };
}) {
  const c = accent === "amber"
    ? { text: "text-amber-400/90", rowBg: "bg-amber-950/20" }
    : accent === "sky"
    ? { text: "text-sky-400/90",   rowBg: "bg-sky-950/20"   }
    : { text: "text-slate-300",    rowBg: "bg-slate-800/30"  };
  return (
    <tr className={`cursor-pointer select-none border-t border-slate-700 font-semibold hover:brightness-110 ${c.rowBg}`} onClick={onToggle}>
      <td className={`px-2 py-1 sticky left-0 bg-slate-900 ${c.text} text-[11px] uppercase tracking-widest whitespace-nowrap`}>
        <span className="mr-1.5 text-[9px]">{open ? "▼" : "▶"}</span>
        {label}
      </td>
      {days.map((_, i) => {
        const { oi, chg } = computeSubtotal(i);
        return (<>
          <td key={i + label + "-oi"} className={`text-right px-2 py-1 border-l border-slate-800 ${c.text}`}>
            {oi ? oi.toLocaleString() : "—"}
          </td>
          <td key={i + label + "-chg"} className={`text-right px-2 py-1 text-[11px] ${chg === null ? "text-slate-600" : chg > 0 ? "bg-green-900/30 text-green-400" : chg < 0 ? "bg-red-900/30 text-red-400" : "text-slate-500"}`}>
            {fmtChg(chg)}
          </td>
        </>);
      })}
    </tr>
  );
}

// ── COT outer group header — toggle AND per-date net position (L−S) ──────────

function CotOuterGroupHeader({ label, open, onToggle, rows, days, cotByDate, sortedCotDates, accent }: {
  label: string; open: boolean; onToggle: () => void;
  rows: CotRowDef[]; days: DayData[];
  cotByDate: Map<string, CotMarket>; sortedCotDates: string[];
  accent: "amber" | "sky" | "slate";
}) {
  const longs   = rows.filter(r => r.section === "long");
  const spreads = rows.filter(r => r.section === "spread");

  // Show L+Sp (= S+Sp = total OI for this crop class) — always positive, never 0
  function getLPlusSp(date: string): number | null {
    const cot = cotByDate.get(date);
    if (!cot) return null;
    const l  = longs.reduce<number|null>((s,r) => { const v = cot[r.key] as number|null; return v==null?s:(s??0)+v; }, null);
    const sp = spreads.reduce<number|null>((s,r) => { const v = cot[r.key] as number|null; return v==null?s:(s??0)+v; }, null);
    if (l == null) return null;
    return l + (sp ?? 0);
  }
  function getWoW(date: string): number | null {
    const cur = getLPlusSp(date);
    if (cur == null) return null;
    const idx = sortedCotDates.indexOf(date);
    if (idx <= 0) return null;
    const prev = getLPlusSp(sortedCotDates[idx - 1]);
    return prev != null ? cur - prev : null;
  }

  const rowColors: Record<string, string> = {
    amber: "text-amber-500 bg-amber-950/20",
    sky:   "text-sky-400 bg-sky-950/20",
    slate: "text-slate-400 bg-slate-800/30",
  };
  const textColors: Record<string, string> = {
    amber: "text-amber-500",
    sky:   "text-sky-400",
    slate: "text-slate-400",
  };
  return (
    <tr className={`cursor-pointer select-none hover:brightness-125 border-t border-slate-700 font-semibold ${rowColors[accent]}`} onClick={onToggle}>
      <td className={`px-2 py-0.5 sticky left-0 bg-slate-900 font-bold uppercase tracking-widest text-[10px] ${textColors[accent]}`}>
        <span className="mr-1.5 text-[9px]">{open ? "▼" : "▶"}</span>
        {label}
      </td>
      {days.map(d => {
        const val = getLPlusSp(d.date);
        const wow = getWoW(d.date);
        return (<>
          <td key={d.date + label + "-val"} className={`text-right px-2 py-0.5 border-l border-slate-800 text-[10px] ${val == null ? "text-slate-700" : "text-slate-300"}`}>
            {val != null ? val.toLocaleString() : "—"}
          </td>
          <td key={d.date + label + "-wow"} className={`text-right px-2 py-0.5 text-[10px] ${wow == null ? "text-slate-700" : wow > 0 ? "bg-green-900/40 text-green-300" : wow < 0 ? "bg-red-900/40 text-red-300" : "text-slate-500"}`}>
            {wow != null ? fmtChg(wow) : "—"}
          </td>
        </>);
      })}
    </tr>
  );
}

// ── COT inner group header — toggle AND per-date section subtotal ─────────────

function CotInnerGroupHeader({ label, open, onToggle, sectionRows, days, cotByDate, sortedCotDates }: {
  label: string; open: boolean; onToggle: () => void;
  sectionRows: CotRowDef[]; days: DayData[];
  cotByDate: Map<string, CotMarket>; sortedCotDates: string[];
}) {
  function getSum(date: string): number | null {
    const cot = cotByDate.get(date);
    if (!cot) return null;
    return sectionRows.reduce<number|null>((s, r) => {
      const v = cot[r.key] as number|null;
      return v == null ? s : (s ?? 0) + v;
    }, null);
  }
  function getWoW(date: string): number | null {
    const cur = getSum(date);
    if (cur == null) return null;
    const idx = sortedCotDates.indexOf(date);
    if (idx <= 0) return null;
    const prev = getSum(sortedCotDates[idx - 1]);
    return prev != null ? cur - prev : null;
  }
  return (
    <tr className="cursor-pointer select-none hover:bg-slate-700/30 bg-slate-800/20 border-t border-slate-800 font-semibold" onClick={onToggle}>
      <td className="px-3 py-0.5 sticky left-0 bg-slate-900 text-[9px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
        <span className="mr-1.5">{open ? "▼" : "▶"}</span>
        {label}
      </td>
      {days.map(d => {
        const val = getSum(d.date);
        const wow = getWoW(d.date);
        return (<>
          <td key={d.date + label + "-val"} className={`text-right px-2 py-0.5 border-l border-slate-800 text-[10px] ${val != null ? "text-slate-300" : "text-slate-700"}`}>
            {val != null ? val.toLocaleString() : "—"}
          </td>
          <td key={d.date + label + "-wow"} className={`text-right px-2 py-0.5 text-[10px] ${wow == null ? "text-slate-700" : wow > 0 ? "bg-green-900/40 text-green-300" : wow < 0 ? "bg-red-900/40 text-red-300" : "text-slate-500"}`}>
            {wow != null ? fmtChg(wow) : "—"}
          </td>
        </>);
      })}
    </tr>
  );
}

// ── COT section renderer (longs + shorts + spreading + sanity) ───────────────

function CotSection({ rows, days, cotByDate, getCotWoW, sortedCotDates }: {
  rows: CotRowDef[]; days: DayData[];
  cotByDate: Map<string, CotMarket>;
  getCotWoW: (date: string, key: keyof CotMarket) => number | null;
  sortedCotDates: string[];
}) {
  const [openLongs,   setOpenLongs]   = useState(false);
  const [openShorts,  setOpenShorts]  = useState(false);
  const [openSpreads, setOpenSpreads] = useState(false);

  const longs   = rows.filter(r => r.section === "long");
  const shorts  = rows.filter(r => r.section === "short");
  const spreads = rows.filter(r => r.section === "spread");

  function sanityFor(date: string): { longPlusSpread: number | null; shortPlusSpread: number | null } {
    const cot = cotByDate.get(date);
    if (!cot) return { longPlusSpread: null, shortPlusSpread: null };
    const sumLongs   = longs.reduce<number|null>((s,r) => { const v = cot[r.key] as number|null; return v==null?s:(s??0)+v; }, null);
    const sumShorts  = shorts.reduce<number|null>((s,r) => { const v = cot[r.key] as number|null; return v==null?s:(s??0)+v; }, null);
    const sumSpreads = spreads.reduce<number|null>((s,r) => { const v = cot[r.key] as number|null; return v==null?s:(s??0)+v; }, null);
    return {
      longPlusSpread:  sumLongs  != null ? (sumLongs  + (sumSpreads ?? 0)) : null,
      shortPlusSpread: sumShorts != null ? (sumShorts + (sumSpreads ?? 0)) : null,
    };
  }

  return (
    <>
      <CotInnerGroupHeader label="Longs" open={openLongs} onToggle={() => setOpenLongs(p => !p)} sectionRows={longs} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} />
      {openLongs && longs.map(r => <CotRow key={String(r.key)} rowLabel={r.label} cotKey={r.key} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} />)}

      <CotInnerGroupHeader label="Shorts" open={openShorts} onToggle={() => setOpenShorts(p => !p)} sectionRows={shorts} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} />
      {openShorts && shorts.map(r => <CotRow key={String(r.key)} rowLabel={r.label} cotKey={r.key} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} />)}

      <CotInnerGroupHeader label="Spreading" open={openSpreads} onToggle={() => setOpenSpreads(p => !p)} sectionRows={spreads} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} />
      {openSpreads && spreads.map(r => <CotRow key={String(r.key)} rowLabel={r.label} cotKey={r.key} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} />)}

      {/* Sanity check: Long+Spread = Short+Spread — always visible */}
      <tr className="border-t border-slate-600 bg-slate-800/50">
        <td className="px-2 py-1 text-[10px] text-slate-500 italic sticky left-0 bg-slate-900 whitespace-nowrap">✓ L+Sp = S+Sp</td>
        {days.map((d) => {
          const { longPlusSpread, shortPlusSpread } = sanityFor(d.date);
          const ok = longPlusSpread != null && shortPlusSpread != null && longPlusSpread === shortPlusSpread;
          const na = longPlusSpread == null;
          return (<>
            <td key={d.date + "-san-l"}
                className={`text-right px-2 py-1 border-l border-slate-800 text-[10px] ${na ? "text-slate-700" : ok ? "text-emerald-500" : "text-red-400"}`}>
              {longPlusSpread != null ? longPlusSpread.toLocaleString() : "—"}
            </td>
            <td key={d.date + "-san-r"}
                className={`text-right px-2 py-1 text-[10px] ${na ? "text-slate-700" : ok ? "text-emerald-500" : "text-red-400"}`}>
              {shortPlusSpread != null ? shortPlusSpread.toLocaleString() : "—"}
            </td>
          </>);
        })}
      </tr>
    </>
  );
}

// ── CotRow sub-component ──────────────────────────────────────────────────────

function CotRow({ rowLabel, cotKey, days, cotByDate, getCotWoW }: {
  rowLabel: string;
  cotKey: keyof CotMarket;
  days: DayData[];
  cotByDate: Map<string, CotMarket>;
  getCotWoW: (date: string, key: keyof CotMarket) => number | null;
}) {
  return (
    <tr className="border-b border-slate-800 hover:bg-slate-800/40">
      <td className="px-2 py-1 text-slate-400 sticky left-0 bg-slate-900 whitespace-nowrap">
        {rowLabel}
      </td>
      {days.map(d => {
        const cot = cotByDate.get(d.date) ?? null;
        const val = cot ? (cot[cotKey] as number | null) : null;
        const wow = cot ? getCotWoW(d.date, cotKey) : null;
        return (
          <>
            <td key={d.date + cotKey + "-val"}
                className={`text-right px-2 py-1 border-l border-slate-800 ${val !== null ? "text-slate-200" : "text-slate-700"}`}>
              {fmtNum(val)}
            </td>
            <td key={d.date + cotKey + "-wow"}
                className={`text-right px-2 py-1 ${
                  wow === null ? "text-slate-700" :
                  wow > 0      ? "bg-green-900/40 text-green-300" :
                  wow < 0      ? "bg-red-900/40 text-red-300" :
                                  "text-slate-500"
                }`}>
              {wow !== null ? fmtChg(wow) : "—"}
            </td>
          </>
        );
      })}
    </tr>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function OIHistoryTable({ market }: { market: "robusta" | "arabica" }) {
  const [days, setDays] = useState<DayData[]>(OI_SNAPSHOT[market] ?? []);
  const [cotByDate, setCotByDate] = useState<Map<string, CotMarket>>(new Map());
  const [openOiOld,   setOpenOiOld]   = useState(false);
  const [openOiOther, setOpenOiOther] = useState(false);
  const [openOiAll,   setOpenOiAll]   = useState(false);
  const [openCotOld,   setOpenCotOld]   = useState(false);
  const [openCotOther, setOpenCotOther] = useState(false);
  const [openCotAll,   setOpenCotAll]   = useState(false);

  useEffect(() => {
    function mergeSources(sources: DayData[][]): DayData[] {
      const dateMap = new Map<string, DayData>();
      for (const source of sources.slice().reverse()) {
        for (const day of source) {
          const existing = dateMap.get(day.date);
          if (!existing) {
            dateMap.set(day.date, { ...day, contracts: [...day.contracts] });
          } else {
            const existingSyms = new Set(existing.contracts.map(c => c.symbol));
            day.contracts.forEach(c => { if (!existingSyms.has(c.symbol)) existing.contracts.push(c); });
          }
        }
      }
      return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    }

    // The build-time snapshot is already current as of the last deploy and is
    // applied as the initial state, so the table never sits on a stale date
    // while these fetches resolve. allSettled (not Promise.all) means a slow or
    // unreachable live backend can't gate the merge — each source enriches the
    // snapshot as it lands, and one failure never blocks the others.
    Promise.allSettled([
      // Committed static export — the source of truth for this static site.
      fetch("/data/oi_history.json")
        .then(r => r.json())
        .then((j: Record<string, DayData[]>) => j[market] ?? []),
      fetch(`${API_URL}/api/futures/oi-history?market=${market}&days=14`)
        .then(r => r.json()),
      fetchFirstOk(GITHUB_OI_URLS)
        .then(r => r.json())
        .then((j: Record<string, DayData[]>) => j[market] ?? []),
    ]).then(results => {
      const ok = (r: PromiseSettledResult<unknown>): DayData[] =>
        r.status === "fulfilled" && Array.isArray(r.value) ? (r.value as DayData[]) : [];
      const [staticDays, localDays, githubDays] = results.map(ok);
      // Freshest committed file first so it wins on overlapping dates; the API,
      // GitHub raw, and build-time snapshot only backfill dates/symbols it lacks.
      // Defensive 14-day cap so a future fetch_oi_json.py drift can't balloon
      // the table; mergeSources sorts newest-first, so .slice(0, 14) keeps the
      // most recent fortnight.
      const merged = mergeSources([staticDays, localDays, githubDays, OI_SNAPSHOT[market] ?? []]).slice(0, 14);
      if (merged.length) setDays(merged);
    });
  }, [market]);

  useEffect(() => {
    fetch("/data/cot_recent.json")
      .then(r => r.json())
      .then((rows: CotWeeklyRow[]) => {
        const mk2 = market === "arabica" ? "ny" : "ldn";
        const map = new Map<string, CotMarket>();
        for (const row of rows) {
          const m = row[mk2];
          if (m) map.set(row.date, m);
        }
        setCotByDate(map);
      })
      .catch((err) => console.error("[OIHistoryTable] cot fetch failed:", err));
  }, [market]);

  const symbols = Array.from(
    new Set(days.flatMap(d => d.contracts.map(c => c.symbol)))
  ).sort((a, b) => symSortKey(a) - symSortKey(b));

  const oldSyms   = market === "arabica" ? symbols.filter(s => kcCropGroup(s) === "old")   : [];
  const otherSyms = market === "arabica" ? symbols.filter(s => kcCropGroup(s) === "other") : [];

  function groupSubtotal(dayIdx: number, syms: string[]): { oi: number; chg: number | null } {
    const oi = syms.reduce((s, sym) => s + (getOI(dayIdx, sym) ?? 0), 0);
    const chg = syms.reduce<number | null>((acc, sym) => {
      const c = getOIChg(dayIdx, sym);
      return c === null ? acc : (acc ?? 0) + c;
    }, null);
    return { oi, chg };
  }

  function getOI(dayIdx: number, sym: string): number | null {
    const c = days[dayIdx]?.contracts.find(x => x.symbol === sym);
    return c ? c.oi : null;
  }

  function getOIChg(dayIdx: number, sym: string): number | null {
    const cur  = getOI(dayIdx, sym);
    const prev = getOI(dayIdx + 1, sym);
    if (cur === null || prev === null) return null;
    return cur - prev;
  }

  const totals = days.map((d, i) => {
    const totalOI  = d.contracts.reduce((s, c) => s + c.oi, 0);
    const totalChg = symbols.reduce<number | null>((acc, sym) => {
      const chg = getOIChg(i, sym);
      return chg === null ? acc : (acc ?? 0) + chg;
    }, null);
    return { oi: totalOI, chg: totalChg };
  });

  const sortedCotDates = Array.from(cotByDate.keys()).sort();

  function getCotWoW(date: string, key: keyof CotMarket): number | null {
    const cur = cotByDate.get(date)?.[key] ?? null;
    const idx = sortedCotDates.indexOf(date);
    if (idx <= 0 || cur === null) return null;
    const prev = cotByDate.get(sortedCotDates[idx - 1])?.[key] ?? null;
    if (prev === null) return null;
    return (cur as number) - (prev as number);
  }

  // For Arabica "All" group: derive from Old+Other to avoid broken base swap_short/spread fields
  const cotByDateAll: Map<string, CotMarket> = market === "arabica"
    ? new Map(Array.from(cotByDate.entries()).map(([d, c]) => [d, makeAllMarket(c)]))
    : cotByDate;

  function getCotWoWAll(date: string, key: keyof CotMarket): number | null {
    const cur = cotByDateAll.get(date)?.[key] ?? null;
    const idx = sortedCotDates.indexOf(date);
    if (idx <= 0 || cur === null) return null;
    const prev = cotByDateAll.get(sortedCotDates[idx - 1])?.[key] ?? null;
    if (prev === null) return null;
    return (cur as number) - (prev as number);
  }

  const label = market === "robusta" ? "LDN OI" : "NY OI";

  return (
    <div className="overflow-x-auto mt-2">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="text-left text-slate-400 px-2 py-1 sticky left-0 bg-slate-900 min-w-[56px]">
              contract
            </th>
            {days.map(d => (
              <th key={d.date} colSpan={2} className="text-center text-slate-400 px-1 py-1 border-l border-slate-800 whitespace-nowrap">
                {d.date}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-700 text-slate-500">
            <th className="sticky left-0 bg-slate-900" />
            {days.map(d => (
              <>
                <th key={d.date + "-oi"}  className="text-right px-2 py-0.5 border-l border-slate-800 font-normal whitespace-nowrap">{label}</th>
                <th key={d.date + "-chg"} className="text-right px-2 py-0.5 font-normal whitespace-nowrap">OI Chg</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {market === "arabica" ? (
            <>
              {/* Old crop group — header IS the subtotal row */}
              <OIGroupHeader label="Old Crop" open={openOiOld} onToggle={() => setOpenOiOld(p => !p)} days={days} accent="amber" computeSubtotal={i => groupSubtotal(i, oldSyms)} />
              {openOiOld && oldSyms.map(sym => <OIContractRow key={sym} sym={sym} days={days} getOI={getOI} getOIChg={getOIChg} />)}

              {/* Other crop group — header IS the subtotal row */}
              <OIGroupHeader label="Other / New Crop" open={openOiOther} onToggle={() => setOpenOiOther(p => !p)} days={days} accent="sky" computeSubtotal={i => groupSubtotal(i, otherSyms)} />
              {openOiOther && otherSyms.map(sym => <OIContractRow key={sym} sym={sym} days={days} getOI={getOI} getOIChg={getOIChg} />)}
            </>
          ) : (
            <>
              <OIGroupHeader label="All Contracts" open={openOiAll} onToggle={() => setOpenOiAll(p => !p)} days={days} accent="slate" computeSubtotal={i => groupSubtotal(i, symbols)} />
              {openOiAll && symbols.map(sym => <OIContractRow key={sym} sym={sym} days={days} getOI={getOI} getOIChg={getOIChg} />)}
            </>
          )}

          {/* Total row */}
          <tr className="border-t-2 border-slate-600 font-bold">
            <td className="px-2 py-1 text-slate-200 sticky left-0 bg-slate-900">Total</td>
            {totals.map((t, i) => (
              <>
                <td key={i + "-tot-oi"}
                    className="text-right px-2 py-1 text-white border-l border-slate-800">
                  {t.oi.toLocaleString()}
                </td>
                <td key={i + "-tot-chg"}
                    className={`text-right px-2 py-1 ${
                      t.chg === null ? "text-slate-600" :
                      t.chg > 0     ? "bg-green-900/40 text-green-300" :
                      t.chg < 0     ? "bg-red-900/40 text-red-300" :
                                      "text-slate-500"
                    }`}>
                  {fmtChg(t.chg)}
                </td>
              </>
            ))}
          </tr>

          {/* COT section header */}
          <tr className="border-t border-slate-700 bg-slate-800/40">
            <td colSpan={1 + days.length * 2}
                className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-400 sticky left-0 bg-slate-900">
              COT Positions (weekly)
            </td>
          </tr>

          {market === "arabica" ? (
            <>
              {/* Old crop sub-group */}
              <CotOuterGroupHeader label="Old Crop" open={openCotOld} onToggle={() => setOpenCotOld(p => !p)} rows={COT_ROWS_OLD} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} accent="amber" />
              {openCotOld && <CotSection rows={COT_ROWS_OLD} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} sortedCotDates={sortedCotDates} />}

              {/* Other crop sub-group */}
              <CotOuterGroupHeader label="Other / New Crop" open={openCotOther} onToggle={() => setOpenCotOther(p => !p)} rows={COT_ROWS_OTHER} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} accent="sky" />
              {openCotOther && <CotSection rows={COT_ROWS_OTHER} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} sortedCotDates={sortedCotDates} />}

              {/* All sub-group — uses derived cotByDateAll (Old+Other) to fix base field data issues */}
              <CotOuterGroupHeader label="All" open={openCotAll} onToggle={() => setOpenCotAll(p => !p)} rows={COT_ROWS_ALL} days={days} cotByDate={cotByDateAll} sortedCotDates={sortedCotDates} accent="slate" />
              {openCotAll && <CotSection rows={COT_ROWS_ALL} days={days} cotByDate={cotByDateAll} getCotWoW={getCotWoWAll} sortedCotDates={sortedCotDates} />}
            </>
          ) : (
            <>
              <CotOuterGroupHeader label="All" open={openCotAll} onToggle={() => setOpenCotAll(p => !p)} rows={COT_ROWS_ALL} days={days} cotByDate={cotByDate} sortedCotDates={sortedCotDates} accent="slate" />
              {openCotAll && <CotSection rows={COT_ROWS_ALL} days={days} cotByDate={cotByDate} getCotWoW={getCotWoW} sortedCotDates={sortedCotDates} />}
            </>
          )}

          {/* COT intraweek estimate — proportional OI + baseline per category */}
          <CotEstimateSection
            days={days}
            totals={totals}
            cotByDateRef={market === "arabica" ? cotByDateAll : cotByDate}
            sortedCotDates={sortedCotDates}
          />
        </tbody>
      </table>
    </div>
  );
}
