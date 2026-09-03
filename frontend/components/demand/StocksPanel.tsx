"use client";
import { useEffect, useState } from "react";
import { ComposedChart, Bar, BarChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { MONTH_ABBR, MONTH_ABBR as MONTHS, chgTone } from "@/lib/formatters";

type Region = "eu" | "japan" | "usa";

interface MonthlyEntry {
  period?: string;
  month?: string;
  value_raw?: number;
  value_mt?: number;
  note?: string;
  arabica_washed_mt?: number | null;
  arabica_unwashed_mt?: number | null;
  robusta_mt?: number | null;
  other_mt?: number | null;
  // ICE-certified stock at European warehouses (subset of the ECF type total),
  // joined in by the 3.4 ECF flow. Present only for recent months.
  cert_eu_robusta_mt?: number | null;
  cert_eu_arabica_mt?: number | null;
}

export interface EcfData {
  source: string;
  last_updated: string;
  monthly: MonthlyEntry[];
  latest_bags: number;
  latest_m_bags: number | null;
  source_url?: string | null;
  latest_post?: string | null;
  latest_pdf?: string | null;
  yearly_pdfs?: { year: string; pdf_url: string }[];
}

interface PsdAnnualEntry {
  year: string;
  imports_mt?: number | null;
  consumption_mt?: number | null;
  stocks_mt?: number | null;
  begin_stocks_mt?: number | null;
  exports_mt?: number | null;
  production_mt?: number | null;
}

interface PsdData {
  source: string;
  last_updated: string;
  annual: PsdAnnualEntry[];
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
}

interface ProducerEntry {
  latest_year: string | null;
  latest_production_mt: number | null;
  latest_exports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
  annual: PsdAnnualEntry[];
}

interface StocksPayload {
  generated_at: string;
  // ECF is its own flow now (read from /data/ecf_history.json), no longer here.
  eu: PsdData | null;
  japan: PsdData | null;
  usa: PsdData | null;
  producers: Record<string, ProducerEntry> | null;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

function fmtPeriod(p: string): string {
  const m = p.match(/(\d{4})-(\d{2})/);
  if (m) return `${MONTH_ABBR[parseInt(m[2]) - 1]}-${m[1].slice(2)}`;
  return p.slice(0, 7);
}

function fmtThousands(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(decimals)}k`;
  return String(Math.round(n));
}

function deltaArrow(v: number | null): { symbol: string; cls: string } {
  if (v == null) return { symbol: "—", cls: "text-slate-500" };
  if (v > 0) return { symbol: `+${v.toFixed(1)}%`, cls: "text-emerald-400" };
  if (v < 0) return { symbol: `${v.toFixed(1)}%`, cls: "text-red-400" };
  return { symbol: "0%", cls: "text-slate-400" };
}

// ── ECF Monthly Panel ─────────────────────────────────────────────────────────

const kMT = (x?: number | null) => (x != null ? Math.round(x / 1000) : null);

// Years present in the series (newest first), restricted to entries that carry
// the field selected by `has`.
function yearsWith(monthly: MonthlyEntry[], has: (m: MonthlyEntry) => boolean): number[] {
  // Plain array + includes (no Set spread — repo's TS target predates es2015
  // iteration, so [...set] fails to compile).
  const ys: number[] = [];
  for (const m of monthly) {
    const mt = (m.period ?? m.month ?? "").match(/^(\d{4})-\d{2}$/);
    if (mt && has(m)) {
      const y = parseInt(mt[1]);
      if (!ys.includes(y)) ys.push(y);
    }
  }
  return ys.sort((a, b) => b - a);
}

type SeasonRow = Record<string, number | string | null>;

// Pivot the flat monthly series into 12 month rows (Jan→Dec), one set of keys
// per year (`y<YEAR>_<measure>`). Years are emitted newest-first by the caller
// so the stacked columns render newest-left within each month.
function seasonalRows(
  monthly: MonthlyEntry[], years: number[],
  pick: (m: MonthlyEntry) => Record<string, number | null>,
): SeasonRow[] {
  const byPeriod = new Map<string, MonthlyEntry>();
  for (const m of monthly) byPeriod.set(m.period ?? m.month ?? "", m);
  return MONTHS.map((mon, i) => {
    const row: SeasonRow = { month: mon };
    for (const y of years) {
      const e = byPeriod.get(`${y}-${String(i + 1).padStart(2, "0")}`);
      if (!e) continue;
      for (const [k, v] of Object.entries(pick(e))) row[`y${y}_${k}`] = v;
    }
    return row;
  });
}

const SEASON_TT_LABELS: Record<string, string> = {
  total: "Total", washed: "Arabica Washed", unwashed: "Arabica Unwashed",
  robusta: "Robusta", cert: "ICE-certified (EU)", rest: "Rest of ECF",
};
function seasonTooltip(v: unknown, name: unknown): [string, string] {
  const m = String(name ?? "").match(/^y(\d{4})_(\w+)$/);
  const txt = `${Number(v).toLocaleString()}k MT`;
  return m ? [txt, `${m[1]} · ${SEASON_TT_LABELS[m[2]] ?? m[2]}`] : [txt, String(name)];
}

// Newest year full-opacity, older years progressively fainter.
const yearOpacity = (idx: number) => Math.max(0.35, 1 - idx * 0.22);

// Linear interpolate two #rrggbb colours (t 0→1).
function hexLerp(a: string, b: string, t: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const mix = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
    .toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

function YearWindowButtons({ n, set }: { n: number; set: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[3, 5, 7].map(v => (
        <button key={v} onClick={() => set(v)}
          className={`text-[8px] px-1.5 py-0.5 rounded ${n === v
            ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
          {v}Y
        </button>
      ))}
    </div>
  );
}

export function EcfPanel({ ecf }: { ecf: EcfData }) {
  const monthly = ecf.monthly;

  // Build period → value_mt map for YoY lookup
  const byPeriod = new Map<string, number>();
  for (const m of monthly) {
    const p = m.period ?? m.month ?? "";
    if (p && m.value_mt != null) byPeriod.set(p, m.value_mt);
  }

  const chartData = monthly.map(m => {
    const p = m.period ?? m.month ?? "";
    const mt = m.value_mt ?? null;
    let yoy: number | null = null;
    if (mt != null && p.match(/(\d{4})-(\d{2})/)) {
      const match = p.match(/(\d{4})-(\d{2})/)!;
      const prevPeriod = `${parseInt(match[1]) - 1}-${match[2]}`;
      const prevMt = byPeriod.get(prevPeriod);
      if (prevMt != null) yoy = ((mt - prevMt) / prevMt) * 100;
    }
    return {
      period: fmtPeriod(p),
      mt: mt != null ? Math.round(mt / 1000) : null,
      washed:   m.arabica_washed_mt   != null ? Math.round(m.arabica_washed_mt   / 1000) : null,
      unwashed: m.arabica_unwashed_mt != null ? Math.round(m.arabica_unwashed_mt / 1000) : null,
      robusta:  m.robusta_mt          != null ? Math.round(m.robusta_mt          / 1000) : null,
      other:    m.other_mt            != null ? Math.round(m.other_mt            / 1000) : null,
      // Months without a type split (pre-2020 PDFs) still have a total — show it
      // as a single neutral column so the early history isn't blank.
      totalOnly: (m.arabica_washed_mt == null && m.arabica_unwashed_mt == null &&
                  m.robusta_mt == null && m.other_mt == null && mt != null)
                 ? Math.round(mt / 1000) : null,
      yoy,
    };
  }).filter(d => d.mt != null);

  const latest = chartData[chartData.length - 1];
  const latestMt = ecf.latest_bags ? ecf.latest_bags * 0.06 / 1000 : null;
  const latestBagsM = ecf.latest_m_bags ?? (ecf.latest_bags ? +(ecf.latest_bags / 1_000_000).toFixed(1) : null);
  const yoyArrow = latest?.yoy != null ? deltaArrow(latest.yoy) : null;

  // ── Seasonal (month-of-year) views ─────────────────────────────────────────
  const [nYears, setNYears] = useState(3);                 // 3Y default
  const [cmpType, setCmpType] = useState<"robusta" | "arabica">("robusta");

  // Chart 1: one stacked-by-type column per year, newest-left, within each
  // calendar month. Pre-2020 months (no type split) show a single total bar.
  const years1 = yearsWith(monthly, m => m.value_mt != null).slice(0, nYears);
  const seasonal1 = seasonalRows(monthly, years1, m => {
    const hasType = m.arabica_washed_mt != null || m.arabica_unwashed_mt != null
                    || m.robusta_mt != null;
    return {
      total:    hasType ? null : kMT(m.value_mt),
      washed:   kMT(m.arabica_washed_mt),
      unwashed: kMT(m.arabica_unwashed_mt),
      robusta:  kMT(m.robusta_mt),
    };
  });

  // Chart 2: ECF type stock with the ICE-certified-EU subset as a lighter base,
  // for the toggled type, one column per year (newest-left) per month.
  const certKey = cmpType === "robusta" ? "cert_eu_robusta_mt" : "cert_eu_arabica_mt";
  const totKey  = cmpType === "robusta" ? "robusta_mt" : "arabica_washed_mt";
  const years2 = yearsWith(monthly, m => m[certKey] != null).slice(0, nYears);
  const hasCert = years2.length > 0;
  const seasonal2 = seasonalRows(monthly, years2, m => {
    const cert = m[certKey] ?? null;
    const tot  = m[totKey] ?? null;
    return {
      cert: kMT(cert),
      rest: tot != null && cert != null ? Math.max(0, kMT(tot)! - kMT(cert)!) : kMT(tot),
    };
  });

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          ECF European Port Stocks
        </div>
        <div className="text-[8px] text-slate-600">ECF · {ecf.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest stocks</div>
          <div className="text-white font-bold">{latestBagsM != null ? `${latestBagsM}M` : "—"}</div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">In MT</div>
          <div className="text-white font-bold">
            {latestMt != null ? `${Math.round(latestMt)}k` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">metric tons</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">vs Prior Year</div>
          {yoyArrow ? (
            <div className={`font-bold text-[11px] ${yoyArrow.cls}`}>{yoyArrow.symbol}</div>
          ) : (
            <div className="text-slate-600 text-[10px] italic">building…</div>
          )}
          <div className="text-[9px] text-slate-600">YoY Δ</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[9px] text-slate-400 uppercase tracking-wide">
          Seasonality — stock by type, by year
        </div>
        <YearWindowButtons n={nYears} set={setNYears} />
      </div>
      {years1.length > 0 ? (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={seasonal1} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }}
                     axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false}
                     tickLine={false} tickFormatter={v => `${v}k`} />
              <Tooltip contentStyle={TT_STYLE} formatter={seasonTooltip} />
              {years1.flatMap((y, idx) => {
                const op = yearOpacity(idx);
                return [
                  <Bar key={`${y}_t`} dataKey={`y${y}_total`}    stackId={`y${y}`} fill="#475569" fillOpacity={op} />,
                  <Bar key={`${y}_w`} dataKey={`y${y}_washed`}   stackId={`y${y}`} fill="#b91c1c" fillOpacity={op} />,
                  <Bar key={`${y}_u`} dataKey={`y${y}_unwashed`} stackId={`y${y}`} fill="#ec4899" fillOpacity={op} />,
                  <Bar key={`${y}_r`} dataKey={`y${y}_robusta`}  stackId={`y${y}`} fill="#6b4423" fillOpacity={op} radius={[2,2,0,0]} />,
                ];
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-36 flex items-center justify-center text-[10px] text-slate-600 italic">
          No ECF data yet.
        </div>
      )}

      <div className="flex items-center gap-x-2 gap-y-0.5 text-[8px] text-slate-500 flex-wrap">
        <span>Per month: newest left → oldest right{years1.length ? ` (${years1.join(" · ")})` : ""}; older years fade.</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#b91c1c" }} />Arabica washed</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#ec4899" }} />Arabica unwashed</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#6b4423" }} />Robusta</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#475569" }} />Total (pre-2020)</span>
      </div>

      {hasCert && (() => {
        // Newest year = the type's base colour (robusta brown / arabica red);
        // older years tint toward orange so each year reads clearly.
        const baseDark  = cmpType === "robusta" ? "#6b4423" : "#b91c1c";
        const baseLight = cmpType === "robusta" ? "#cd9b6a" : "#fca5a5";
        const ORANGE_DARK = "#c2410c";
        const ORANGE_LIGHT = "#fdba74";
        const span = Math.max(1, years2.length - 1);
        return (
          <div className="space-y-1 pt-1 border-t border-slate-700/60">
            <div className="flex items-center justify-between">
              <div className="text-[9px] text-slate-400 uppercase tracking-wide">
                ECF vs ICE-certified at EU ports
              </div>
              <div className="flex gap-1">
                {(["robusta", "arabica"] as const).map(t => (
                  <button key={t} onClick={() => setCmpType(t)}
                    className={`text-[8px] px-1.5 py-0.5 rounded ${cmpType === t
                      ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {t === "robusta" ? "Robusta" : "Washed Arabica"}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={seasonal2} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }}
                         axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false}
                         tickLine={false} tickFormatter={v => `${v}k`} />
                  <Tooltip contentStyle={TT_STYLE} formatter={seasonTooltip} />
                  {years2.flatMap((y, idx) => {
                    const t = idx / span;            // newest 0 → oldest 1
                    const l = hexLerp(baseLight, ORANGE_LIGHT, t);
                    const d = hexLerp(baseDark, ORANGE_DARK, t);
                    return [
                      <Bar key={`${y}_c`} dataKey={`y${y}_cert`} stackId={`y${y}`} fill={l} />,
                      <Bar key={`${y}_r`} dataKey={`y${y}_rest`} stackId={`y${y}`} fill={d} radius={[2,2,0,0]} />,
                    ];
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-x-2 text-[8px] text-slate-500 flex-wrap">
              <span>Column = ECF {cmpType === "robusta" ? "Robusta" : "Washed Arabica"}; newest left{years2.length ? ` (${years2.join(" · ")})` : ""}; older years tint orange.</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: baseLight }} />ICE-certified (EU)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: baseDark }} />Rest of ECF</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: ORANGE_DARK }} />older years</span>
            </div>
          </div>
        );
      })()}

      <div className="text-[9px] text-slate-500 space-y-0.5">
        {ecf.latest_post && (
          <div>
            Latest report:{" "}
            <a href={ecf.latest_post} target="_blank" rel="noopener noreferrer"
               className="text-indigo-400 hover:text-indigo-300 underline">post</a>
            {ecf.latest_pdf && (
              <>{" · "}<a href={ecf.latest_pdf} target="_blank" rel="noopener noreferrer"
                         className="text-indigo-400 hover:text-indigo-300 underline">PDF</a></>
            )}
          </div>
        )}
        {ecf.yearly_pdfs && ecf.yearly_pdfs.length > 0 && (
          <div>
            Yearly PDFs:{" "}
            {ecf.yearly_pdfs.slice(0, 6).map((y, i) => (
              <span key={y.year}>
                {i > 0 && " · "}
                <a href={y.pdf_url} target="_blank" rel="noopener noreferrer"
                   className="text-slate-400 hover:text-slate-200 underline">{y.year}</a>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PSD Analytical Panel ──────────────────────────────────────────────────────

const REGION_LABELS: Record<Region, string> = { eu: "European Union", japan: "Japan", usa: "United States" };
const REGION_ACCENT: Record<Region, string> = { eu: "#10b981", japan: "#0ea5e9", usa: "#f59e0b" };
const REGION_BAR: Record<Region, string>    = { eu: "#059669", japan: "#0284c7", usa: "#d97706" };

function PsdAnalyticalPanel({ eu, japan, usa }: { eu: PsdData | null; japan: PsdData | null; usa: PsdData | null }) {
  const [region, setRegion] = useState<Region>("eu");
  const sources: Record<Region, PsdData | null> = { eu, japan, usa };
  const data = sources[region];
  const accent = REGION_ACCENT[region];
  const barColor = REGION_BAR[region];

  if (!data) return null;

  const annual = (data.annual ?? []).filter(p => p.imports_mt != null);

  // Main 24-year chart data
  const mainChart = annual.map(p => ({
    year: p.year,
    imports: Math.round((p.imports_mt ?? 0) / 1000),
    consumption: p.consumption_mt != null ? Math.round(p.consumption_mt / 1000) : null,
    stocks: p.stocks_mt != null ? Math.round(p.stocks_mt / 1000) : null,
  }));

  // Delta chart: YoY changes for last 12 years
  const deltaYears = annual.slice(-13);
  const deltaChart = deltaYears.slice(1).map((entry, i) => {
    const prev = deltaYears[i];
    const dImports = ((entry.imports_mt ?? 0) - (prev.imports_mt ?? 0)) / 1000;
    const dConsumption = ((entry.consumption_mt ?? 0) - (prev.consumption_mt ?? 0)) / 1000;
    const dStocks = ((entry.stocks_mt ?? 0) - (prev.stocks_mt ?? 0)) / 1000;
    return {
      year: entry.year.slice(2),
      dImports:    +dImports.toFixed(1),
      dConsumption: +-dConsumption.toFixed(1),  // negative: more consumption = negative stock impact
      dStocks:     +dStocks.toFixed(1),
    };
  });

  // KPIs: latest vs prior year
  const latest = annual[annual.length - 1];
  const prev   = annual[annual.length - 2];

  function kpiDelta(curr: number | null | undefined, prior: number | null | undefined) {
    if (curr == null || prior == null || prior === 0) return null;
    return ((curr - prior) / prior) * 100;
  }

  const importsDelta  = kpiDelta(latest?.imports_mt, prev?.imports_mt);
  const consumDelta   = kpiDelta(latest?.consumption_mt, prev?.consumption_mt);
  const stocksDelta   = kpiDelta(latest?.stocks_mt, prev?.stocks_mt);
  const stocksToUse   = (latest?.stocks_mt != null && latest?.consumption_mt != null && latest.consumption_mt > 0)
    ? (latest.stocks_mt / latest.consumption_mt) * 12 : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      {/* Header + region tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">USDA PSD — Annual Stock Analysis</div>
          <div className="text-[8px] text-slate-600 mt-0.5">{REGION_LABELS[region]} · {data.last_updated}</div>
        </div>
        <div className="flex gap-1">
          {(["eu","japan","usa"] as Region[]).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide transition-colors ${
                region === r
                  ? "bg-slate-600 text-white"
                  : "bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200"
              }`}
            >
              {r === "eu" ? "EU" : r === "japan" ? "Japan" : "USA"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports {latest?.year}</div>
          <div className="font-bold" style={{ color: accent }}>{fmtThousands(latest?.imports_mt)}</div>
          {importsDelta != null && (
            <div className={`text-[9px] ${chgTone(importsDelta)}`}>
              {importsDelta >= 0 ? "+" : ""}{importsDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Consumption {latest?.year}</div>
          <div className="text-white font-bold">{fmtThousands(latest?.consumption_mt)}</div>
          {consumDelta != null && (
            <div className={`text-[9px] ${consumDelta >= 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {consumDelta >= 0 ? "+" : ""}{consumDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">End Stocks {latest?.year}</div>
          <div className="text-violet-300 font-bold">{fmtThousands(latest?.stocks_mt)}</div>
          {stocksDelta != null && (
            <div className={`text-[9px] ${chgTone(stocksDelta)}`}>
              {stocksDelta >= 0 ? "+" : ""}{stocksDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Stock-to-Use</div>
          <div className="text-amber-300 font-bold">
            {stocksToUse != null ? `${stocksToUse.toFixed(1)} mo` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">months coverage</div>
        </div>
      </div>

      {/* Main 24-year trend chart */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">Annual Series — imports · consumption · ending stocks</div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mainChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <XAxis
                dataKey="year"
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}k`}
              />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [
                  `${Number(v).toLocaleString()}k MT`,
                  name === "imports" ? "Imports" : name === "consumption" ? "Consumption" : "End Stocks",
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 8, paddingTop: 4 }}
                formatter={(v: string) => (
                  v === "imports" ? "Imports" : v === "consumption" ? "Consumption" : "End Stocks"
                )}
              />
              <Bar dataKey="imports" fill={barColor} opacity={0.75} radius={[1,1,0,0]} name="imports" />
              <Line dataKey="consumption" type="monotone" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="consumption" strokeDasharray="4 2" />
              <Line dataKey="stocks" type="monotone" stroke="#a78bfa" strokeWidth={2} dot={false} name="stocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Δ Stocks waterfall — last 12 years */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">
          YoY Δ Stock Drivers (k MT) — blue = import swing · orange = consumption drag · line = net stock Δ
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v > 0 ? "+" : ""}${v}k`}
              />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const n = Number(v);
                  const label =
                    name === "dImports" ? "Import swing" :
                    name === "dConsumption" ? "Consumption drag" :
                    "Net Δ stocks";
                  return [`${n >= 0 ? "+" : ""}${n.toFixed(1)}k MT`, label];
                }}
              />
              <Bar dataKey="dImports" fill="#3b82f6" opacity={0.8} radius={[2,2,0,0]} name="dImports" />
              <Bar dataKey="dConsumption" fill="#f97316" opacity={0.8} radius={[2,2,0,0]} name="dConsumption" />
              <Line dataKey="dStocks" type="monotone" stroke="#e2e8f0" strokeWidth={2} dot={{ r: 2, fill: "#e2e8f0" }} name="dStocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[8px] text-slate-600 mt-1">
          Reading: blue bar above zero = imports grew vs prior year (positive for stocks); orange bar below zero = consumption grew (drains stocks). White line = net stock change.
        </div>
      </div>

      <div className="text-[9px] text-slate-600">
        USDA FAS PSD database — marketing-year figures (Oct–Sep for EU/Japan, Oct–Sep for USA).
        All values in metric tons.
      </div>
    </div>
  );
}

// ── Multi-region Stock-to-Use Comparative ────────────────────────────────────

function StockToUseComparative({ eu, japan, usa }: { eu: PsdData | null; japan: PsdData | null; usa: PsdData | null }) {
  const sources: Record<Region, PsdData | null> = { eu, japan, usa };
  const yearSet = new Set<string>();
  for (const region of Object.values(sources)) {
    for (const r of region?.annual ?? []) yearSet.add(r.year);
  }
  const years = Array.from(yearSet).sort();
  if (years.length < 2) return null;

  function months(p: PsdAnnualEntry | undefined): number | null {
    if (!p?.stocks_mt || !p?.consumption_mt) return null;
    return +((p.stocks_mt / p.consumption_mt) * 12).toFixed(2);
  }

  const chartData = years.map(y => {
    const find = (data: PsdData | null) => data?.annual.find(r => r.year === y);
    return {
      year: y.slice(2),
      eu: months(find(eu)),
      japan: months(find(japan)),
      usa: months(find(usa)),
    };
  });

  const latest = chartData[chartData.length - 1];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Stock-to-Use Comparative</div>
          <div className="text-[8px] text-slate-600 mt-0.5">months of consumption coverage · USDA PSD</div>
        </div>
        <div className="flex gap-3 text-[10px] font-mono">
          <div><span className="text-emerald-400">EU</span> {latest?.eu?.toFixed(1) ?? "—"}mo</div>
          <div><span className="text-sky-400">JP</span> {latest?.japan?.toFixed(1) ?? "—"}mo</div>
          <div><span className="text-amber-400">US</span> {latest?.usa?.toFixed(1) ?? "—"}mo</div>
        </div>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <XAxis dataKey="year" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}mo`} domain={[0, "auto"]} />
            <ReferenceLine y={3} stroke="#dc2626" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: "critical", fontSize: 7, fill: "#dc2626", position: "right" }} />
            <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: "tight",    fontSize: 7, fill: "#f59e0b", position: "right" }} />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const label = name === "eu" ? "EU" : name === "japan" ? "Japan" : "USA";
                return [v == null ? "—" : `${Number(v).toFixed(2)} months`, label];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 8 }} formatter={(v: string) => v === "eu" ? "EU" : v === "japan" ? "Japan" : "USA"} />
            <Line dataKey="eu"    type="monotone" stroke="#10b981" strokeWidth={2} dot={false} connectNulls name="eu" />
            <Line dataKey="japan" type="monotone" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls name="japan" />
            <Line dataKey="usa"   type="monotone" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls name="usa" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-500">
        Lower = tighter pipeline (less buffer between ending stocks and a year of consumption).
        Reference lines: <span className="text-amber-400">5 mo = tight</span>, <span className="text-red-400">3 mo = critical</span>.
      </div>
    </div>
  );
}


// ── Page section ─────────────────────────────────────────────────────────────

export default function StocksPanel() {
  const [data, setData] = useState<StocksPayload | null>(null);
  const [ecf, setEcf] = useState<EcfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ECF is a self-contained flow with its own file; the rest comes from
    // demand_stocks.json. Load both independently so one failing doesn't blank
    // the other.
    Promise.allSettled([
      fetch("/data/demand_stocks.json").then(r => r.json()),
      fetch("/data/ecf_history.json").then(r => r.json()),
    ]).then(([d, e]) => {
      if (d.status === "fulfilled") setData(d.value);
      if (e.status === "fulfilled") setEcf(e.value);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="text-xs text-slate-500 animate-pulse p-4">Loading stocks data...</div>
    );
  }

  const hasEcf = !!(ecf && ecf.monthly && ecf.monthly.length);
  if (!hasEcf && (!data || (!data.eu && !data.japan && !data.usa))) {
    return (
      <div className="bg-slate-900 border-b border-slate-700 p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Consumer Market Stocks</div>
        <div className="text-xs text-slate-500">
          Stock data not yet available — requires scraper run.
        </div>
      </div>
    );
  }

  const hasPsd = !!(data && (data.eu || data.japan || data.usa));

  return (
    <div className="bg-slate-900 border-b border-slate-700 p-4 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Consumer Market Stocks</div>

      {/* Row 1: ECF certified stocks (Japan now lives in its own AJCA tab) */}
      {hasEcf ? (
        <EcfPanel ecf={ecf!} />
      ) : (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
          ECF monthly data pending scraper run
        </div>
      )}

      {/* Row 2: PSD Analytical (full width, EU/Japan/USA tabs) */}
      {hasPsd && data && (
        <PsdAnalyticalPanel eu={data.eu} japan={data.japan} usa={data.usa} />
      )}

      {/* Row 3: Stock-to-Use Comparative (all 3 regions overlaid) */}
      {hasPsd && data && (
        <StockToUseComparative eu={data.eu} japan={data.japan} usa={data.usa} />
      )}
    </div>
  );
}
