"use client";
// Standardized Supply & Demand balance — same visual format as the Ethiopia
// (StoneX) S&D, but fed by USDA PSD per-origin data from demand_stocks.json, so
// every origin renders an identical balance view. Self-contained (own fetch).
import { useEffect, useState } from "react";
import React from "react";
import { ComposedChart, Bar, Cell, Line, LabelList, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ErrorBar } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import CropEstimateEditor from "./CropEstimateEditor";

interface AnnualRow {
  year: string;
  begin_stocks_mt?: number;
  production_mt?: number;
  imports_mt?: number;
  exports_mt?: number;
  consumption_mt?: number;
  stocks_mt?: number;
}

/** Subset of BrazilProjection consumed for the projected S&D row. Kept
 *  local + minimal so this generic component doesn't depend on Brazil-tab
 *  types. */
export interface SDForecast {
  crop_year:     string;     // "26/27" — used as the row's Year column.
  exports_bags:  number;     // sum of monthly_curve, in 60-kg bags
  safeguard?:    boolean;
}

/** Multi-source enrichment (option-in): when the calling tab has a richer
 *  per-source production estimate (e.g. Vietnam's vn_farmer_economics
 *  carries USDA + MAE + ICO numbers), pass it here to:
 *    • show production as `avg (min–max)` in the table for matching crops,
 *    • render an error bar on the production line over the same crops,
 *    • append any season the USDA backbone doesn't carry (typically the
 *      next crop's forecast) as a forecast row.
 *  Values are in MILLION 60-kg bags to match the upstream balance-sheet JSON. */
export interface MultiSourceSeason {
  /** Full crop-year label, e.g. "2024/25". */
  cropYear: string;
  /** Marks the row visually as italic and includes it in the chart with
   *  a striped pattern overlay. */
  forecast: boolean;
  /** sourceKey → million 60-kg bags. */
  production: Record<string, number>;
  /** Analyst override for the DISPLAYED production figure (million
   *  bags). Default (absent) = average of the source values. Set via
   *  the admin editor's "Final" row. */
  final?: number;
  /** Million 60-kg bags. */
  exports?:     number;
  /** Million 60-kg bags. */
  consumption?: number;
}

export interface MultiSourceOverlay {
  /** Sources for the production spread, in legend order. */
  sources: { key: string; label: string; color: string }[];
  seasons: MultiSourceSeason[];
}

/** Realised customs/monthly exports keyed by crop year — when present,
 *  overrides USDA PSD's annual exports number on the matching rows so
 *  the S&D table never disagrees with the per-origin Exports sub-tab.
 *  Crops that have no monthly data on file fall back to USDA. The
 *  in-progress crop reports `isPartial: true` and the row is split into
 *  realised YTD + the multi-source / projection-derived remaining
 *  budget. Values are in thousand 60-kg bags ("kbags"). */
export interface RealizedExportsOverlay {
  byCropYear: Record<string, {
    kbags:        number;
    isPartial:    boolean;
    /** "YYYY-MM" of the most recent monthly observation in this crop year. */
    latestMonth?: string;
    /** Feed-derived estimate of the still-unshipped months (avg of each
     *  missing calendar month's last ≤3 prior-year values). Fallback for
     *  the remaining segment when the analyst budget is already exceeded
     *  by realised YTD — without it "remaining" clamps to 0 mid-crop. */
    seasonalRemainingKbags?: number;
  }>;
  /** Display name surfaced on the table footnote, e.g. "Vietnam Customs". */
  sourceLabel: string;
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const MT_PER_KBAG = 60;                         // 1 thousand 60-kg bags = 60 MT
const MBAGS_PER_KBAGS = 1 / 1000;               // 1 thousand bags  = 0.001 million bags
const kbags = (mt: number | undefined) => Math.round((mt ?? 0) / MT_PER_KBAG);
const chgCls = (v: number) => (v >= 0 ? "text-emerald-400" : "text-red-400");

type SDUnit = "kbags" | "tons";
// Internal data lives in thousand 60-kg bags ("kbags"); the toggle converts to
// metric tons on display only (× 60). Keeping a single source of truth in
// kbags avoids drift between the chart, tooltip, table and segment labels.
const _toMt = (kbagsValue: number) => kbagsValue * MT_PER_KBAG;
// Bags mode DISPLAYS in millions ("12.3M" instead of "12,300") — the
// natural scale for annual balances; internal data stays in kbags.
const _unitLong  = (u: SDUnit) => u === "tons" ? "metric tons" : "million 60-kg bags";
// Suffix that follows an already-formatted _fmtVal value ("12.3M bags",
// "738,000 MT") — the M magnitude lives in the value itself.
const _unitShort = (u: SDUnit) => u === "tons" ? "MT" : "bags";
/** One display formatter for every surface (table cells, tooltips,
 *  segment labels): "12.3M" in bags mode, "738,000" in MT mode. */
const _fmtVal = (u: SDUnit, kbagsValue: number) =>
  u === "tons"
    ? Math.round(_toMt(kbagsValue)).toLocaleString()
    : `${(kbagsValue / 1000).toFixed(1)}M`;
// Segment labels need to stay short; values too small to matter at the
// millions scale (< 0.05M bags / < 1 kbag·60MT) render empty.
const _segLabel = (u: SDUnit) => (v: unknown) => {
  const n = Number(v);
  if (!n || Math.abs(n) < (u === "tons" ? 1 : 50)) return "";
  return _fmtVal(u, n);
};

// ── Equation strip + production-spread helpers ──────────────────────────────
// These two were the standout features of the old VnBalanceSheetPanel; they
// are inlined here so any origin that provides a `multiSource` overlay gets
// the equation header + per-source spread block "for free". Stand-alone
// components keep the main render readable.

function Eq({ label, value, sign, color, sub }: {
  label: string; value: string; sign?: string; color: string; sub?: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {sign && <span className="text-slate-500 text-lg font-light shrink-0">{sign}</span>}
      <div className="bg-slate-900 border rounded-lg px-3 py-2 flex-1 min-w-0"
        style={{ borderColor: color + "55" }}>
        <div className="text-[8px] uppercase tracking-wide font-bold mb-0.5" style={{ color }}>
          {label}
        </div>
        <div className="text-sm font-extrabold truncate" style={{ color }}>
          {value}
        </div>
        {sub && <div className="text-[7px] text-slate-600 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function ProductionSpread({
  cropYear, isForecast, sources, finalMBags,
}: {
  cropYear: string; isForecast: boolean;
  sources: { key: string; label: string; color: string; mBags: number }[];
  /** Analyst "Final" override — highlighted in the footer when set. */
  finalMBags?: number;
}) {
  if (sources.length === 0) return null;
  const values = sources.map(s => s.mBags);
  const min   = Math.min(...values);
  const max   = Math.max(...values);
  const range = max - min || 1;
  const avg   = values.reduce((s, v) => s + v, 0) / values.length;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">
        Production estimates · {cropYear}{isForecast ? " (f)" : ""}
      </div>
      {sources.map(s => {
        // Min source still gets a visible nub; everything above scales linearly.
        const pct = ((s.mBags - min) / range) * 100;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="text-[8px] font-bold w-11 shrink-0" style={{ color: s.color }}>
              {s.label}
            </span>
            <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="h-full rounded-full"
                style={{ width: `${Math.max(pct, 8)}%`, background: s.color }} />
            </div>
            <span className="text-[8px] font-mono text-slate-300 w-10 text-right">
              {s.mBags.toFixed(1)}
            </span>
          </div>
        );
      })}
      <div className="flex justify-between text-[7px] text-slate-600 border-t border-slate-800 pt-1.5 mt-1">
        <span>Spread: {(max - min).toFixed(1)} M bags</span>
        <span>
          Avg: <span className="text-slate-400 font-bold">{avg.toFixed(1)}</span>
          {finalMBags != null && (
            <span className="ml-2" title="Analyst final — the displayed production figure">
              Final: <span className="text-emerald-400 font-bold">{finalMBags.toFixed(1)}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** Convert USDA PSD year ("2025") → display label "25/26" when
 *  `cropYearMonths` is set. USDA's PSD CSV stores the **starting** year
 *  of the marketing year (year 2024 = MY 2024/25 = July 2024 → June 2025
 *  for Brazil; Oct 2024 → Sep 2025 for Vietnam/Uganda; Apr 2024 → Mar
 *  2025 for Indonesia). Verified by cross-checking demand_stocks against
 *  USDA WMT Dec 2025: Brazil year 2025 → 63.0 M bags matches WMT's
 *  MY 2025/26 figure, year 2024 → 65.0 M bags matches MY 2024/25. */
function cropYearShort(usdaYear: string, cropYearMonths?: string): string {
  if (!cropYearMonths) return usdaYear.slice(-2);
  const start = parseInt(usdaYear, 10);
  if (!Number.isFinite(start)) return usdaYear.slice(-2);
  return `${String(start).slice(-2)}/${String(start + 1).slice(-2)}`;
}

/** Full marketing-year label for hover tooltips. */
function cropYearLong(usdaYear: string, cropYearMonths?: string): string {
  if (!cropYearMonths) return `Year ${usdaYear}`;
  const start = parseInt(usdaYear, 10);
  if (!Number.isFinite(start)) return `Year ${usdaYear}`;
  return `MY ${start}/${String(start + 1).slice(-2)} (${cropYearMonths})`;
}

/** Optional `projection` lets callers (currently only the Brazil tab) append a
 *  forward-looking row for the in-progress crop year. The row is rendered
 *  faded/italic with an asterisk on the year label so it's visibly a forecast.
 *  We only override Exports (the field our engine actually projects) — Opening
 *  carries over from the last realized year and the other columns are blanked
 *  rather than guessed.
 *
 *  The forecast row is added to BOTH the stacked-bar chart and the bottom
 *  table so the two stay in sync.
 *
 *  `cropYearMonths` (e.g. "Oct–Sep") switches the Year column from USDA's
 *  ending-year shorthand ("25") to a crop-year span ("24/25") and adds a
 *  hover tooltip with the full MY window.
 *
 *  `multiSource` overlays per-source production estimates onto matching
 *  crops — `avg (min–max)` in the table + an error bar on the production
 *  line. Seasons in `multiSource` that don't match a USDA backbone row are
 *  appended as forecast rows, even if no `projection` is supplied.
 */
export default function SupplyDemandBalance({
  origin, label, years = 12, projection,
  cropYearMonths, multiSource, realizedExports, editOrigin,
}: {
  origin: string; label: string; years?: number;
  projection?: { crop_year: string; annual_target: number; monthly_curve?: { value: number }[]; safeguard_triggered?: boolean } | null;
  cropYearMonths?: string;
  multiSource?: MultiSourceOverlay | null;
  realizedExports?: RealizedExportsOverlay | null;
  /** Key into the admin crop-estimate editor's origin map (e.g. "brazil").
   *  When set, a ✎ button appears next to the unit toggle opening the
   *  password-gated estimate editor. Omit for origins with no balance-sheet
   *  seed (Honduras). */
  editOrigin?: string;
}) {
  const [rows, setRows] = useState<AnnualRow[] | null>(null);
  const [error, setError] = useState(false);
  const [unit, setUnit] = useState<SDUnit>("kbags");

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const annual = d?.producers?.[origin]?.annual;
        if (Array.isArray(annual) && annual.length) setRows(annual);
        else setError(true);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [origin]);

  if (error) return <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">USDA PSD supply & demand data unavailable for {label}.</div>;
  if (!rows) return <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading supply &amp; demand…</div>;

  // Two lookups, both keyed on USDA-PSD START years (= the integer
  // that prefixes the "YYYY/YY" crop-year string). USDA's PSD CSV
  // already uses START years too, so the row mapper below can match
  // straight against `r.year` without any +1 / -1 dance.
  //   msByCropYear["2025/26"] → season  (used by the projection branch,
  //     whose `crop_year` field is the short "26/27" form)
  //   msByUsdaYear["2025"]    → season  (used by per-row matching)
  const msByCropYear = new Map<string, MultiSourceSeason>(
    (multiSource?.seasons ?? []).map(s => [s.cropYear, s]),
  );
  const msByUsdaYear = new Map<string, MultiSourceSeason>(
    (multiSource?.seasons ?? []).flatMap(s => {
      const startStr = s.cropYear.split("/")[0];
      const startInt = parseInt(startStr ?? "", 10);
      return Number.isFinite(startInt) ? [[String(startInt), s] as const] : [];
    }),
  );

  type Row = {
    year: string;            // USDA START year (for matching), e.g. "2025"
    yearLabel: string;       // displayed in the table, e.g. "24/25"
    yearTooltip: string;     // hover label
    opening: number;
    production: number;      // single-source kbags
    exports: number;         // kbags — realised portion when realizedExports overrides
    exportsRemaining: number;// kbags — projected leftover when crop is in-progress
    exportsSource:    "usda" | "realized" | "realized+forecast";
    /** How exportsRemaining was derived — "seasonal" flags the fallback
     *  used when the analyst budget is already met by realised YTD. */
    remainingSource?: "budget" | "seasonal";
    consumption: number;
    ending: number;
    stockBuild: number;
    stockDraw: number;
    isForecast: boolean;
    // multi-source production overlay, in kbags
    prodAvg?: number;
    /** True when prodAvg is the analyst "Final" override, not the avg. */
    prodIsFinal?: boolean;
    prodMin?: number;
    prodMax?: number;
    prodSources?: { key: string; label: string; value_kbags: number; color: string }[];
  };

  /** Resolve a USDA START year ("2025") to the crop-year key the
   *  realizedExports overlay uses ("2025/26"). Returns null when the
   *  caller hasn't supplied `cropYearMonths`. */
  const cropKeyOf = (usdaYearStr: string): string | null => {
    const start = parseInt(usdaYearStr, 10);
    if (!Number.isFinite(start) || !cropYearMonths) return null;
    return `${start}/${String(start + 1).slice(-2)}`;
  };

  const buildMultiSourceFields = (season: MultiSourceSeason | undefined): Partial<Row> => {
    if (!season || !multiSource) return {};
    const values = multiSource.sources
      .map(s => ({ key: s.key, label: s.label, color: s.color, mBags: season.production[s.key] }))
      .filter(s => Number.isFinite(s.mBags));
    if (values.length === 0) return {};
    const kbagsArr = values.map(v => Math.round((v.mBags as number) / MBAGS_PER_KBAGS));
    const avg = kbagsArr.reduce((s, v) => s + v, 0) / kbagsArr.length;
    // Analyst "Final" override wins as the displayed figure; the min/max
    // whisker range widens to include it so the error bar never inverts.
    const finalKbags = season.final != null
      ? Math.round(season.final / MBAGS_PER_KBAGS)
      : null;
    const displayed = finalKbags ?? Math.round(avg);
    return {
      prodAvg: displayed,
      prodIsFinal: finalKbags != null,
      prodMin: Math.min(...kbagsArr, displayed),
      prodMax: Math.max(...kbagsArr, displayed),
      prodSources: values.map((v, i) => ({
        key: v.key, label: v.label, color: v.color, value_kbags: kbagsArr[i],
      })),
    };
  };

  /** Remaining-forecast kbags for an in-progress crop. The analyst budget
   *  (multi-source exports / projection / USDA) wins while it still exceeds
   *  realised YTD; once realised shipments have met or beaten a (stale)
   *  budget, fall back to the feed's own seasonality estimate of the
   *  missing months — a crop with unshipped months must never show 0
   *  remaining (Vietnam 2025/26: realised 25,610 vs ICO budget 25,500 with
   *  Aug+Sep still to ship). Every branch that splits realised/remaining
   *  routes through here so the chart, table and equation strip agree. */
  const remainingFor = (
    realised: { kbags: number; seasonalRemainingKbags?: number },
    budgetTotalKbags: number,
  ): { kbags: number; source: "budget" | "seasonal" } => {
    const fromBudget = budgetTotalKbags - realised.kbags;
    if (fromBudget > 0) return { kbags: fromBudget, source: "budget" };
    return { kbags: realised.seasonalRemainingKbags ?? 0, source: "seasonal" };
  };

  // First calendar month of the crop year, from the display string
  // ("Oct–Sep" → 10, "Apr–Mar" → 4); calendar years (no mapping) → 1.
  const MONTH_NUM: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  const cropStartMonth = cropYearMonths
    ? MONTH_NUM[cropYearMonths.slice(0, 3)] ?? 1
    : 1;

  const recent: Row[] = rows.slice(-years).map(r => {
    const opening = kbags(r.begin_stocks_mt);
    const ending  = kbags(r.stocks_mt);
    const delta   = ending - opening;
    const year    = r.year ?? "";
    const ms      = msByUsdaYear.get(year);
    const usdaExports = kbags(r.exports_mt);
    // Realized customs data wins on years where it's complete; older
    // years with missing months fall back to USDA PSD. Realised partial
    // years (typically the current in-progress crop) get the YTD value
    // in `exports` and the forecast remainder in `exportsRemaining`.
    const cropKey = cropKeyOf(year);
    const realized = cropKey ? realizedExports?.byCropYear[cropKey] : undefined;
    // USDA PSD carries the FORWARD marketing year too (e.g. MY 2026/27
    // published mid-2026), so not-yet-started crops flow through this
    // backbone path. They must never render as realized: zero shipped,
    // the whole export budget in "remaining", row striped as forecast.
    const startYearInt = parseInt(year, 10);
    const notStarted = Number.isFinite(startYearInt) &&
      new Date(startYearInt, cropStartMonth - 1, 1) > new Date();
    let exportsKbags     = usdaExports;
    let remainingKbags   = 0;
    let remainingSource: Row["remainingSource"];
    let exportsSource: Row["exportsSource"] = "usda";
    if (realized) {
      if (!realized.isPartial) {
        exportsKbags  = realized.kbags;
        exportsSource = "realized";
      } else {
        // Partial: prefer the multi-source forecast for the total, otherwise
        // the USDA PSD figure; seasonal fallback once the budget is met.
        const forecastTotalKbags = ms?.exports != null
          ? Math.round(ms.exports / MBAGS_PER_KBAGS)
          : usdaExports;
        const rem = remainingFor(realized, forecastTotalKbags);
        exportsKbags    = realized.kbags;
        remainingKbags  = rem.kbags;
        remainingSource = rem.source;
        exportsSource   = "realized+forecast";
      }
    } else if (notStarted) {
      // Nothing can have shipped yet — the multi-source export budget
      // (else USDA's projection) is entirely "remaining".
      exportsKbags    = 0;
      remainingKbags  = ms?.exports != null
        ? Math.round(ms.exports / MBAGS_PER_KBAGS)
        : usdaExports;
      remainingSource = "budget";
    }
    return {
      year,
      yearLabel:   `${cropYearShort(year, cropYearMonths)}${notStarted ? "*" : ""}`,
      yearTooltip: notStarted
        ? `Forecast · ${cropYearLong(year, cropYearMonths)}`
        : cropYearLong(year, cropYearMonths),
      opening, production: kbags(r.production_mt),
      exports:           exportsKbags,
      exportsRemaining:  remainingKbags,
      remainingSource,
      exportsSource,
      consumption: kbags(r.consumption_mt), ending,
      stockBuild: Math.max(delta, 0), stockDraw: Math.min(delta, 0),
      isForecast: notStarted,
      ...buildMultiSourceFields(ms),
    };
  });

  // Append in-progress crop year as a faded row. `projection` (annual_target
  // in 60kg bags ÷ 1000 → kbags) wins when present. Otherwise, if multiSource
  // carries a forecast season the USDA backbone doesn't know about yet,
  // append it so the chart and table both show the forward outlook.
  const usdaYearsSeen = new Set(recent.map(r => r.year));
  // Per-crop-year realised lookup helper for the forecast rows below.
  const realisedForCrop = (cropKey: string) =>
    realizedExports?.byCropYear[cropKey];

  // Snapshot of the last USDA-backbone row's stocks + consumption so the
  // projection / multiSource / realised-feed forecast branches can carry
  // them forward without each other's writes (e.g. the projection branch
  // setting consumption=0 used to poison the realised-feed fall-through's
  // `lastRealizedRow.consumption` lookup).
  const lastUsdaRow = recent[recent.length - 1];
  const carryConsumption = lastUsdaRow?.consumption ?? 0;
  const carryEnding      = lastUsdaRow?.ending      ?? 0;

  if (projection && projection.crop_year) {
    const lastRealized = recent[recent.length - 1];
    const projectedKbags = Math.round(projection.annual_target / 1000);
    // Brazil's projection emits crop_year either short ("26/27") or
    // full ("2026/27"). Normalise to the USDA START year as a 4-digit
    // string so the row's identity stays consistent with USDA-backbone
    // rows. Match seeds both ways to pick up production ranges.
    const projStartRaw = projection.crop_year.split("/")[0] ?? "";
    const projStartYear = projStartRaw.length === 4
      ? projStartRaw
      : `20${projStartRaw.padStart(2, "0")}`;
    const ms = msByCropYear.get(projection.crop_year)
            ?? msByUsdaYear.get(projStartYear);
    // The realised overlay keys its byCropYear map using the same
    // "YYYY/YY" form as multiSource seeds — normalise the projection's
    // short "26/27" to the long form for the lookup.
    const projCropKey = cropKeyOf(projStartYear) ?? projection.crop_year;
    const realisedYTD = realisedForCrop(projCropKey);
    const realizedKbags  = realisedYTD?.kbags ?? 0;
    const projRem = realisedYTD ? remainingFor(realisedYTD, projectedKbags) : null;
    recent.push({
      year:        projStartYear,
      yearLabel:   `${cropYearShort(projStartYear, cropYearMonths)}*`,
      yearTooltip: `Forecast · ${cropYearLong(projStartYear, cropYearMonths)}`,
      opening:     lastRealized?.ending ?? carryEnding,
      production:  0,
      exports:           realisedYTD ? realizedKbags : 0,
      exportsRemaining:  projRem ? projRem.kbags : projectedKbags,
      remainingSource:   projRem?.source,
      exportsSource:     realisedYTD ? "realized+forecast" : "usda",
      // Carry the last realised USDA consumption forward — projection
      // engines don't ship per-year consumption, but the equation strip
      // and the chart's blue segment both need a non-zero value to stay
      // aligned with the Demand tab's per-country consumption chart.
      consumption: carryConsumption,
      ending:      0,
      stockBuild:  0,
      stockDraw:   0,
      isForecast:  true,
      ...buildMultiSourceFields(ms),
    });
  } else if (multiSource) {
    for (const s of multiSource.seasons) {
      if (!s.forecast) continue;
      const startYearInt = parseInt(s.cropYear.split("/")[0] ?? "", 10);
      if (!Number.isFinite(startYearInt)) continue;
      const usdaStart = String(startYearInt);   // canonical row identity
      if (usdaYearsSeen.has(usdaStart)) continue;
      // Mark this crop as already handled so the realised-only fall-through
      // below doesn't double-append it.
      usdaYearsSeen.add(usdaStart);
      const fields = buildMultiSourceFields(s);
      // If the balance sheet doesn't carry exports for this forecast crop,
      // proxy with the latest USDA-realised annual exports so the
      // in-progress crop's remaining segment isn't 0. Same fallback the
      // realised-feed branch uses below.
      const totalKbags = s.exports != null
        ? Math.round(s.exports / MBAGS_PER_KBAGS)
        : (lastUsdaRow?.exports ?? 0);
      const realisedYTD = realisedForCrop(s.cropYear);
      const realizedKbags  = realisedYTD?.kbags ?? 0;
      const msRem = realisedYTD ? remainingFor(realisedYTD, totalKbags) : null;
      recent.push({
        year:        usdaStart,
        yearLabel:   `${cropYearShort(usdaStart, cropYearMonths)}*`,
        yearTooltip: `Forecast · ${cropYearLong(usdaStart, cropYearMonths)}`,
        opening:     carryEnding,
        production:  fields.prodAvg ?? 0,
        exports:           realisedYTD ? realizedKbags : 0,
        exportsRemaining:  msRem ? msRem.kbags : totalKbags,
        remainingSource:   msRem?.source,
        exportsSource:     realisedYTD ? "realized+forecast" : "usda",
        // Consumption flows from USDA PSD (same source as the per-country
        // consumption chart on the Demand tab) — carry the latest realised
        // PSD value forward as the forecast crop's estimate so the equation
        // strip and the consumption chart never disagree.
        consumption: carryConsumption,
        ending:      0,
        stockBuild:  0,
        stockDraw:   0,
        isForecast:  true,
        ...fields,
      });
    }
  }

  // Realised-feed fall-through — append crops the realisedExports overlay
  // already covers but USDA / projection / multiSource haven't surfaced yet.
  // Gives Indonesia / Uganda / etc. their in-progress crop visibility even
  // without a forecast engine, and shows complete-but-not-yet-USDA crops
  // (e.g. Brazil 25/26 between USDA 24/25 and the projection's 26/27) so
  // there are no holes in the chart's crop-year axis. Bounded to crops
  // that END AFTER the last realised USDA row — Brazil's Cecafé feed
  // reaches back to 1990 and we don't want to repopulate the table with
  // empty pre-USDA rows.
  if (realizedExports && cropYearMonths) {
    // Canonical "covered" set: USDA START year as int. r.year is now
    // always the start year — for backbone rows, projection rows, and
    // multiSource forecast rows alike (all normalised above).
    const coveredStart = new Set<number>();
    for (const r of recent) {
      const sy = parseInt(r.year, 10);
      if (Number.isFinite(sy)) coveredStart.add(sy);
    }
    // Highest USDA start year we have a backbone row for (rows is the
    // unsliced PSD array, so this captures the actual newest realised
    // year even when `years` limits the visible window).
    const latestUsdaStart = rows.reduce(
      (max, r) => Math.max(max, parseInt(r.year ?? "", 10) || 0),
      0,
    );
    for (const cy of Object.keys(realizedExports.byCropYear).sort()) {
      const startYear = parseInt(cy.split("/")[0], 10);
      if (!Number.isFinite(startYear)) continue;
      // Skip if already covered (USDA backbone / projection / multiSource)
      // or if the crop ends at-or-before USDA's latest backbone row.
      if (coveredStart.has(startYear) || startYear <= latestUsdaStart) continue;
      const realised = realizedExports.byCropYear[cy];
      // Use lastUsdaRow's exports as the rough total for the in-progress
      // crop's "remaining" estimate (the only data we have on annual
      // export size without a dedicated forecast engine).
      const lastExports = lastUsdaRow?.exports ?? 0;
      const ftRem = realised.isPartial ? remainingFor(realised, lastExports) : null;
      // Pull production from the matching multiSource season if there
      // is one — solves the "Brazil 25/26 shows production = 0" gap
      // where the fall-through used to set production to 0 and ignore
      // the seed's USDA / CONAB numbers for the same crop.
      const ms = msByUsdaYear.get(String(startYear)) ?? msByCropYear.get(cy);
      const msFields = buildMultiSourceFields(ms);
      recent.push({
        year:        String(startYear),
        yearLabel:   `${cropYearShort(String(startYear), cropYearMonths)}${realised.isPartial ? "*" : ""}`,
        yearTooltip: realised.isPartial
          ? `In progress · ${cropYearLong(String(startYear), cropYearMonths)}`
          : `Realised · ${cropYearLong(String(startYear), cropYearMonths)}`,
        // Opening + consumption carry from the USDA backbone snapshot
        // rather than `recent[last]` so an earlier projection / multiSource
        // push with consumption=0 can't poison this row.
        opening:     carryEnding,
        // multiSource-derived production wins when the seed has a season
        // for this crop; otherwise stays 0 (USDA has no row for it yet).
        production:  msFields.prodAvg ?? 0,
        exports:           realised.kbags,
        exportsRemaining:  ftRem?.kbags ?? 0,
        remainingSource:   ftRem?.source,
        exportsSource:     realised.isPartial ? "realized+forecast" : "realized",
        consumption: carryConsumption,
        ending:      0,
        stockBuild:  0,
        stockDraw:   0,
        // Complete realised crops render solid; in-progress crops stripe.
        isForecast:  realised.isPartial,
        ...msFields,
      });
    }
  }

  // Ensure chronological order. r.year is now always the USDA start
  // year as a 4-digit string, so a plain numeric comparison sorts
  // backbone, projection, multiSource and fall-through rows uniformly.
  recent.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));

  // Production line + error-bar data. We feed every row (history + forecast)
  // into the chart so the projection sits visibly to the right of the
  // realized data. The error bar leans on multi-source range when present,
  // and the bar/cell `isForecast` flag drives the striped fill via a Cell.
  const chartData = recent.map(r => ({
    year:        r.yearLabel,
    yearTooltip: r.yearTooltip,
    opening:     r.opening,
    exports:           r.exports,
    exportsRemaining:  r.exportsRemaining,
    consumption: r.consumption,
    stockBuild:  r.stockBuild,
    stockDraw:   r.stockDraw,
    production:  r.prodAvg ?? r.production,
    prod_err: r.prodAvg != null && r.prodMin != null && r.prodMax != null
      ? [r.prodAvg - r.prodMin, r.prodMax - r.prodAvg]
      : undefined,
    isForecast:  r.isForecast,
  }));

  const seriesPattern = (kind: "exp" | "open" | "cons" | "build" | "draw") =>
    `url(#sd-stripe-${kind})`;
  const stripedCellFill = (i: number, native: string, kind: "exp" | "open" | "cons" | "build" | "draw") =>
    chartData[i].isForecast ? seriesPattern(kind) : native;

  // ── Equation strip + production spread inputs ───────────────────────────
  // Both panels lean on the LATEST multi-source season (forecast preferred,
  // else the most recent realized one). Numbers come in million 60-kg bags
  // off the wire — we convert to the active unit at render time so the
  // "k bags ↔ MT" toggle drives every surface.
  const focusSeason = multiSource && multiSource.seasons.length
    ? (multiSource.seasons.slice().reverse().find(s => s.forecast)
       ?? multiSource.seasons[multiSource.seasons.length - 1])
    : null;
  const focusSourceValues = (multiSource && focusSeason)
    ? multiSource.sources
        .map(s => ({ ...s, mBags: focusSeason.production[s.key] }))
        .filter(s => Number.isFinite(s.mBags))
    : [];
  // The analyst "Final" override (editor's Final row) replaces the plain
  // average as the displayed figure everywhere: equation strip, spread
  // block footer, chart line and table cell all derive from it.
  const focusIsFinal = focusSeason?.final != null;
  const focusProdAvg = focusIsFinal
    ? (focusSeason!.final as number)
    : focusSourceValues.length
      ? focusSourceValues.reduce((a, s) => a + (s.mBags as number), 0) / focusSourceValues.length
      : 0;
  // Equation strip values stay in million-bag space because that's the
  // natural scale for an annual balance — even when the unit toggle is on
  // tons we'd be looking at fractions of a million MT, so the {value}M
  // formatter on `_eqValue` below adapts the suffix without losing legibility.
  const _eqValue = (mBags: number): string => {
    if (unit === "tons") return `${(mBags * 60 / 1000).toFixed(2)}M`;
    return `${mBags.toFixed(1)}M`;
  };
  const _eqUnit  = unit === "tons" ? "MT" : "60-kg bags";
  // Equation strip reads its EXPORTS and CONSUMPTION from the in-built
  // `recent` table — that table prefers realized customs data when
  // present and USDA PSD when not, so the strip cannot disagree with the
  // bar chart or the table below it.
  const focusRow = focusSeason
    ? recent.find(r => r.year === String(parseInt(focusSeason.cropYear.split("/")[0] ?? "", 10)))
    : undefined;
  // Convert kbags → M bags so the equation strip stays in the natural
  // annual-balance scale the legacy panel used.
  const kbagsToMbags = (k: number) => k * MBAGS_PER_KBAGS;
  const focusExportsRealized = focusRow ? kbagsToMbags(focusRow.exports)          : 0;
  const focusExportsRemain   = focusRow ? kbagsToMbags(focusRow.exportsRemaining) : 0;
  const focusExports         = focusExportsRealized + focusExportsRemain;
  const focusConsumption     = focusRow ? kbagsToMbags(focusRow.consumption)      : 0;
  const focusNetStocks       = focusProdAvg - focusExports - focusConsumption;
  const focusDeficit         = focusNetStocks < 0;

  return (
    <div className="space-y-3">
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            {label} — Supply &amp; Demand ({_unitLong(unit)})
            {cropYearMonths && (
              <span className="ml-2 text-slate-600 normal-case">
                · crop year ({cropYearMonths})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              {(["kbags", "tons"] as SDUnit[]).map(u => (
                <button key={u} onClick={() => setUnit(u)}
                  className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                    unit === u ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                  }`}
                  title={u === "tons" ? "Display in metric tons" : "Display in million 60-kg bags"}>
                  {u === "tons" ? "MT" : "M bags"}
                </button>
              ))}
            </div>
            {editOrigin && <CropEstimateEditor origin={editOrigin} />}
            <div className="text-[8px] text-slate-600">
              USDA FAS PSD
              {multiSource && multiSource.sources.length > 0 && (
                <span className="ml-1">
                  · +{multiSource.sources.map(s => s.label).join(" / ")} range
                </span>
              )}
              {realizedExports && (
                <span className="ml-1">
                  · exports linked to {realizedExports.sourceLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Equation strip (Production avg − Exports − Consumption = Net stocks).
            Renders only when a multi-source overlay is wired in, using its latest
            forecast row when available, otherwise the most recent realized one.
            Lifted from the legacy VnBalanceSheetPanel so the formula is now a
            first-class feature of the generic balance card. */}
        {focusSeason && focusSourceValues.length > 0 && (
          <div className="flex items-stretch gap-1">
            <Eq
              label={focusIsFinal ? "Production (final)" : "Production avg"}
              value={_eqValue(focusProdAvg)}
              color="#22c55e"
              sub={focusIsFinal
                ? `Analyst final · ${focusSeason.cropYear}${focusSeason.forecast ? " (f)" : ""}`
                : `${multiSource!.sources.map(s => s.label).join(" / ")} · ${focusSeason.cropYear}${focusSeason.forecast ? " (f)" : ""}`}
            />
            <Eq
              label="Exports"
              value={_eqValue(focusExports)}
              sign="−"
              color="#ef4444"
              sub={focusExportsRemain > 0
                ? (focusExportsRealized > 0
                    ? `${focusExportsRealized.toFixed(1)} realised + ${focusExportsRemain.toFixed(1)} est.`
                    : "Annual budget (est.) — crop not started")
                : (realizedExports ? `${realizedExports.sourceLabel} (realised)` : `Annual exports · ${_eqUnit}`)}
            />
            <Eq
              label="Local Consumption"
              value={_eqValue(focusConsumption)}
              sign="−"
              color="#f97316"
              sub="USDA PSD · matches Demand tab"
            />
            <Eq
              label="Net Stocks"
              value={`${focusNetStocks >= 0 ? "+" : "−"}${_eqValue(Math.abs(focusNetStocks))}`}
              sign="="
              color={focusDeficit ? "#f87171" : "#34d399"}
              sub={focusDeficit ? "Supply deficit" : "Supply surplus"}
            />
          </div>
        )}

        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
              {/* Striped patterns for the forecast row's stacked bars — same
                  visual language as the per-origin MonthlyVolumeChart
                  seasonality stripes, so a quick glance flags the year as
                  projected. */}
              <defs>
                {([
                  { id: "sd-stripe-open",  c: "#64748b" },
                  { id: "sd-stripe-exp",   c: "#f59e0b" },
                  { id: "sd-stripe-cons",  c: "#3b82f6" },
                  { id: "sd-stripe-build", c: "#22c55e" },
                  { id: "sd-stripe-draw",  c: "#ef4444" },
                ] as const).map(p => (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse"
                           width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={p.c} fillOpacity="0.18" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={p.c} strokeWidth="2" />
                  </pattern>
                ))}
              </defs>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={v => unit === "tons"
                  ? `${(_toMt(v) / 1e6).toFixed(1)}M`
                  : `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT}
                labelFormatter={(label: unknown, items) => {
                  const t = items?.[0]?.payload?.yearTooltip;
                  return typeof t === "string" ? t : String(label);
                }}
                formatter={(v: unknown, n) => {
                  if (n === "Production range") {
                    // The error-bar series's nominal value IS the avg already;
                    // the +/- pair is passed via dataKey="prod_err" and isn't
                    // surfaced here directly.
                    return [null, null];
                  }
                  return [`${_fmtVal(unit, Number(v))} ${unit === "tons" ? "MT" : "bags"}`, String(n)];
                }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"     stackId="a" fill="#64748b">
                {chartData.map((_, i) => <Cell key={`o-${i}`} fill={stripedCellFill(i, "#64748b", "open")} />)}
                <LabelList dataKey="opening"     position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="exports"     name="Exports"     stackId="a" fill="#f59e0b">
                {chartData.map((_, i) => <Cell key={`e-${i}`} fill={stripedCellFill(i, "#f59e0b", "exp")} />)}
                <LabelList dataKey="exports"     position="center" fontSize={8} fill="#1e293b" formatter={_segLabel(unit)} />
              </Bar>
              {/* Remaining-budget portion of the in-progress crop's exports.
                  Always striped (so it visibly splits the bar), zero on all
                  rows except the one carrying realizedExports.isPartial. */}
              <Bar dataKey="exportsRemaining" name="Exports (forecast remaining)" stackId="a" fill="url(#sd-stripe-exp)">
                <LabelList dataKey="exportsRemaining" position="center" fontSize={8} fill="#1e293b" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="consumption" name="Consumption" stackId="a" fill="#3b82f6">
                {chartData.map((_, i) => <Cell key={`c-${i}`} fill={stripedCellFill(i, "#3b82f6", "cons")} />)}
                <LabelList dataKey="consumption" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="stockBuild"  name="Stock build" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]}>
                {chartData.map((_, i) => <Cell key={`b-${i}`} fill={stripedCellFill(i, "#22c55e", "build")} />)}
                <LabelList dataKey="stockBuild" position="center" fontSize={8} fill="#0b1220" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="stockDraw"   name="Stock draw"  stackId="a" fill="#ef4444">
                {chartData.map((_, i) => <Cell key={`d-${i}`} fill={stripedCellFill(i, "#ef4444", "draw")} />)}
                <LabelList dataKey="stockDraw" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Line dataKey="production" name="Production"  type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }}>
                <ErrorBar dataKey="prod_err" width={4} stroke="#a78bfa" strokeWidth={1} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 leading-relaxed">
          Each column stacks Opening + Exports + Consumption + stock change. Green = stock build; red below axis = destock.
          The purple Production line is a reference — any gap above the stack is imports + non-bean (roast/soluble) disappearance
          &amp; adjustments. Source: USDA FAS PSD (green-bean balance).
          {multiSource && (
            <span className="ml-1">
              · Whiskers on the production line show the spread across{" "}
              {multiSource.sources.map(s => (
                <span key={s.key} style={{ color: s.color }} className="font-semibold">{s.label}</span>
              )).reduce<React.ReactNode[]>((acc, el, i, arr) =>
                i === arr.length - 1 ? [...acc, el] : [...acc, el, ", "], [])
              }.
            </span>
          )}
        </div>

        {/* Per-source production spread for the focus crop — same layout the
            old VnBalanceSheetPanel shipped, but now driven by the same prop
            the rest of the card consumes. Hidden when no multi-source row
            exists for the focus crop. */}
        {focusSeason && focusSourceValues.length > 0 && (
          <ProductionSpread
            cropYear={focusSeason.cropYear}
            isForecast={focusSeason.forecast}
            finalMBags={focusSeason.final}
            sources={focusSourceValues.map(s => ({
              key: s.key, label: s.label, color: s.color, mBags: s.mBags as number,
            }))}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 px-1 text-right font-medium">Open</th>
                <th className="py-1 px-1 text-right font-medium">Prod</th>
                <th className="py-1 px-1 text-right font-medium">Exports</th>
                <th className="py-1 px-1 text-right font-medium">Cons</th>
                <th className="py-1 pl-1 text-right font-medium">End</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => {
                const isLatestRealized = !r.isForecast && i === recent.findLastIndex(x => !x.isForecast);
                const rowCls = r.isForecast ? "text-slate-500 italic"
                                            : isLatestRealized ? "text-amber-300" : "text-slate-300";
                const fmt = (kbagsValue: number) => _fmtVal(unit, kbagsValue);
                const dash = (n: number) => r.isForecast && n === 0 ? "—" : fmt(n);
                // Multi-source production cell: avg with min–max range underneath,
                // and a tooltip enumerating each source's value.
                const prodCell = (() => {
                  if (r.prodAvg == null) {
                    return <span>{dash(r.production)}</span>;
                  }
                  const tip = [
                    ...(r.prodIsFinal ? [`Analyst final: ${fmt(r.prodAvg)} ${_unitShort(unit)}`] : []),
                    ...(r.prodSources ?? []).map(s =>
                      `${s.label}: ${fmt(s.value_kbags)} ${_unitShort(unit)}`),
                  ].join("\n");
                  return (
                    <span title={tip} className="cursor-help">
                      <span className={r.prodIsFinal ? "text-emerald-300" : undefined}>{fmt(r.prodAvg)}</span>
                      <span className="text-slate-500 text-[8px] ml-1">
                        ({fmt(r.prodMin ?? 0)}–{fmt(r.prodMax ?? 0)})
                      </span>
                    </span>
                  );
                })();
                // Exports cell: for the in-progress crop, surface the
                // realised + remaining split so a reader can tell what's
                // been customs-confirmed vs. what's still a forecast.
                // Tooltip names the realised source explicitly.
                const exportsCell = (() => {
                  // Crop not started: nothing shipped, the whole budget is
                  // still ahead — show the estimate alone, never a realised
                  // figure.
                  if (r.exportsRemaining > 0 && r.exports === 0) {
                    return (
                      <span title="Crop not started — full export budget remaining" className="cursor-help">
                        <span className="text-slate-500">—</span>
                        <span className="text-slate-500 text-[8px] ml-1">+{fmt(r.exportsRemaining)} est.</span>
                      </span>
                    );
                  }
                  if (r.exportsRemaining > 0 && r.exports > 0) {
                    // Seasonal remainders are flagged so the reader knows the
                    // analyst budget was already met and the estimate comes
                    // from the feed's own monthly seasonality instead.
                    const remainNote = r.remainingSource === "seasonal"
                      ? " (seasonal est. — budget already met)"
                      : "";
                    const tip = realizedExports
                      ? `${fmt(r.exports)} realised (${realizedExports.sourceLabel}${r.exportsSource === "realized+forecast" ? `, through ${realisedForCrop(cropKeyOf(r.year) ?? r.year)?.latestMonth ?? "—"}` : ""}) + ${fmt(r.exportsRemaining)} forecast remaining${remainNote}`
                      : `${fmt(r.exports)} realised + ${fmt(r.exportsRemaining)} forecast remaining${remainNote}`;
                    return (
                      <span title={tip} className="cursor-help">
                        <span>{fmt(r.exports)}</span>
                        <span className="text-slate-500 text-[8px] ml-1">+{fmt(r.exportsRemaining)} est.</span>
                      </span>
                    );
                  }
                  if (r.exportsSource === "realized" && realizedExports) {
                    return (
                      <span title={`Realised (${realizedExports.sourceLabel})`} className="cursor-help">
                        {fmt(r.exports)}
                      </span>
                    );
                  }
                  return <span>{fmt(r.exports)}</span>;
                })();
                return (
                  <tr key={r.year + "_" + r.yearLabel} className={`border-t border-slate-700/50 ${rowCls}`}>
                    <td className="py-0.5 pr-2" title={r.yearTooltip}>{r.yearLabel}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.opening)}</td>
                    <td className="py-0.5 px-1 text-right">{prodCell}</td>
                    <td className="py-0.5 px-1 text-right">{exportsCell}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.consumption)}</td>
                    <td className={`py-0.5 pl-1 text-right ${r.isForecast ? "" : chgCls(r.ending - r.opening)}`}>{dash(r.ending)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(projection || (multiSource?.seasons ?? []).some(s => s.forecast)) && (
            <div className="text-[8px] text-slate-600 italic mt-1">
              * Forecast row — italic; striped bars in the chart.
              {projection?.safeguard_triggered && (
                <span className="ml-1 text-amber-500 not-italic font-semibold">Safeguard active.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
