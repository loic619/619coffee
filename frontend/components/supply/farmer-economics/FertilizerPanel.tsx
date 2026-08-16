"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, LineChart } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { FarmerEconomicsData, FertilizerItem, FertilizerImportMonth } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";
import { MONTH_ABBR } from "@/lib/formatters";
import { useDataFreshness } from "@/lib/useDataFreshness";

function fmtMonth(m: string): string {
  const [yr, mo] = m.split("-");
  return `${MONTH_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

// ── Fertilizer type palette (matches Hedgepoint PDF stacking order) ───────────
const FERT_COLORS: Record<string, string> = {
  urea_kt:   "#3b82f6",   // blue
  kcl_kt:    "#8b5cf6",   // violet
  map_kt:    "#10b981",   // emerald
  dap_kt:    "#06b6d4",   // cyan
  an_kt:     "#f59e0b",   // amber
  as_kt:     "#ec4899",   // pink
  superp_kt: "#84cc16",   // lime
};

const FERT_LABELS: Record<string, string> = {
  urea_kt:   "Urea",
  kcl_kt:    "KCl",
  map_kt:    "MAP",
  dap_kt:    "DAP",
  an_kt:     "AN",
  as_kt:     "AS",
  superp_kt: "Superphosphate",
};

const FERT_KEYS = ["urea_kt", "kcl_kt", "map_kt", "dap_kt", "an_kt", "as_kt", "superp_kt"] as const;

// ── Build monthly chart data: current year Jan–Dec stacked ────────────────────
function buildMonthlyChart(monthly: FertilizerImportMonth[]) {
  const thisYear = new Date().getFullYear();
  const byLabel: Record<string, FertilizerImportMonth> = {};
  for (const m of monthly) {
    const yr = parseInt(m.month.split("-")[0]);
    if (yr === thisYear) byLabel[m.month] = m;
  }
  return MONTH_ABBR.map((label, i) => {
    const key = `${thisYear}-${String(i + 1).padStart(2, "0")}`;
    const row = byLabel[key];
    return {
      month: label,
      urea_kt:   row?.urea_kt    ?? null,
      kcl_kt:    row?.kcl_kt     ?? null,
      map_kt:    row?.map_kt     ?? null,
      dap_kt:    row?.dap_kt     ?? null,
      an_kt:     row?.an_kt      ?? null,
      as_kt:     row?.as_kt      ?? null,
      superp_kt: row?.superp_kt  ?? null,
    };
  });
}

// ── Build cumulative YTD comparison (this year vs prior year) ─────────────────
function buildCumulativeChart(monthly: FertilizerImportMonth[]) {
  const thisYear  = new Date().getFullYear();
  const priorYear = thisYear - 1;

  const totByYrMo: Record<string, number> = {};
  for (const m of monthly) {
    totByYrMo[m.month] = m.total_kt;
  }

  let cumThis = 0, cumPrior = 0;
  return MONTH_ABBR.map((label, i) => {
    const moStr = String(i + 1).padStart(2, "0");
    const keyThis  = `${thisYear}-${moStr}`;
    const keyPrior = `${priorYear}-${moStr}`;

    const hasThis  = keyThis  in totByYrMo;
    const hasPrior = keyPrior in totByYrMo;

    if (hasThis)  cumThis  += totByYrMo[keyThis]  ?? 0;
    if (hasPrior) cumPrior += totByYrMo[keyPrior] ?? 0;

    return {
      month:     label,
      thisYear:  hasThis  ? Math.round(cumThis)  : null,
      priorYear: hasPrior ? Math.round(cumPrior) : null,
    };
  });
}

// ── Build 18-month dual-axis chart (price + volume) ───────────────────────────
function buildPriceChart(monthly: FertilizerImportMonth[]) {
  return monthly.slice(-18).map((m) => ({
    month:      fmtMonth(m.month),
    urea_kt:    m.urea_kt,
    kcl_kt:     m.kcl_kt,
    map_dap_kt: m.map_dap_kt,
    urea_price: m.urea_price_usd_mt,
    kcl_price:  m.kcl_price_usd_mt,
    map_price:  m.map_dap_price_usd_mt,
  }));
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

// ── Price KPI card ────────────────────────────────────────────────────────────
function FertCard({ item }: { item: FertilizerItem }) {
  const delta     = fertCostDelta(item);
  const priceRose = item.mom_pct > 0;
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[10px] text-slate-400 mb-0.5">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/mt</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">FOB implied · Brazil</div>
      <div className="h-10 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`$${v}/mt`, item.name]} labelFormatter={() => ""} />
            <Line type="monotone" dataKey="v" stroke={priceRose ? "#ef4444" : "#22c55e"} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`text-[10px] font-semibold mb-1 ${priceRose ? "text-red-400" : "text-green-400"}`}>
        {priceRose ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>
      <div className={`text-[9px] font-semibold px-1.5 py-0.5 rounded inline-block ${
        delta > 0 ? "bg-red-950 text-red-300" : delta < 0 ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-500"
      }`}>
        {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {delta > 0 ? "+" : ""}{delta.toFixed(1)}/bag est.
      </div>
    </div>
  );
}

interface Props { fertilizer: FarmerEconomicsData["fertilizer"] }

export default function FertilizerPanel({ fertilizer }: Props) {
  const net     = netFertImpact(fertilizer.items);
  const imports = fertilizer.imports;
  const freshness = useDataFreshness(imports?.last_updated ?? undefined, 48);

  const monthly      = imports?.monthly ?? [];
  const monthlyChart = buildMonthlyChart(monthly);
  const cumulChart   = buildCumulativeChart(monthly);
  const priceChart   = buildPriceChart(monthly);
  const thisYear     = new Date().getFullYear();

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">

      {/* Header */}
      <div className="text-[10px] text-slate-400 uppercase tracking-wide flex items-baseline justify-between">
        <span>Fertilizer Prices · Brazil</span>
        {fertilizer.prices_as_of && (
          <span className="text-[8px] text-slate-600 normal-case font-normal flex items-center gap-1">
            {freshness === "stale" && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}
            Comex Stat · FOB implied · {fertilizer.prices_as_of}
          </span>
        )}
      </div>

      {/* Price KPI cards */}
      <div className="flex gap-3">
        {fertilizer.items.map((item) => <FertCard key={item.name} item={item} />)}
      </div>

      {/* Net cost impact */}
      <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-700">
        Net input cost impact:{" "}
        <span className={`font-bold ${net > 0 ? "text-amber-400" : "text-green-400"}`}>
          {net > 0 ? "+" : ""}{net.toFixed(1)}/bag vs last month
        </span>
        {" "}· Next application: {fertilizer.next_application}
      </div>

      {/* ── Stacked monthly bar: all 7 types ─────────────────────────────── */}
      <div className="pt-2 border-t border-slate-700">
        <div className="text-[9px] text-slate-400 mb-2 flex items-center justify-between">
          <span>Monthly Imports {thisYear} (kt) · All Types</span>
          <span className="text-slate-600">Source: MDIC / ComexStat</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
          {FERT_KEYS.map(k => (
            <div key={k} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: FERT_COLORS[k] }} />
              <span className="text-[7px] text-slate-500">{FERT_LABELS[k]}</span>
            </div>
          ))}
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyChart} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(0)} kt`, FERT_LABELS[String(name)] ?? String(name)]}
              />
              {FERT_KEYS.map(k => (
                <Bar key={k} dataKey={k} name={k} stackId="a" fill={FERT_COLORS[k]} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Cumulative YTD comparison ─────────────────────────────────────── */}
      <div className="pt-2 border-t border-slate-700">
        <div className="text-[9px] text-slate-400 mb-1 flex items-center justify-between">
          <span>Cumulative Imports YTD (kt) — {thisYear} vs {thisYear - 1}</span>
        </div>
        <div className="flex gap-4 mb-1.5">
          <div className="flex items-center gap-1"><div className="w-4 h-0.5 bg-amber-400" /><span className="text-[7px] text-slate-500">{thisYear}</span></div>
          <div className="flex items-center gap-1"><div className="w-4 h-0.5 bg-slate-500" /><span className="text-[7px] text-slate-500">{thisYear - 1}</span></div>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulChart} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}M`} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [`${Number(v).toLocaleString()} kt`, String(name)]}
              />
              <Line type="monotone" dataKey="priorYear" name={String(thisYear - 1)} stroke="#64748b" strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="thisYear"  name={String(thisYear)}     stroke="#f59e0b" strokeWidth={2}   dot={{ r: 2.5, fill: "#f59e0b", strokeWidth: 0 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 18-month price + volume dual-axis ────────────────────────────── */}
      {priceChart.length > 0 && (
        <div className="pt-2 border-t border-slate-700">
          <div className="text-[9px] text-slate-400 mb-1 flex justify-between">
            <span>18-month Imports (kt) &amp; FOB Price ($/mt)</span>
          </div>
          <div className="flex gap-3 mb-1 flex-wrap">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-blue-500" /><span className="text-[7px] text-slate-500">Urea kt</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-500" /><span className="text-[7px] text-slate-500">KCl kt</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-emerald-500" /><span className="text-[7px] text-slate-500">MAP+DAP kt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-300" /><span className="text-[7px] text-slate-500">Urea $/mt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-violet-300" /><span className="text-[7px] text-slate-500">KCl $/mt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-emerald-300" /><span className="text-[7px] text-slate-500">MAP $/mt</span></div>
          </div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={priceChart} margin={{ top: 2, right: 28, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis yAxisId="vol" orientation="left"  tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="prc" orientation="right" tick={{ fontSize: 7, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name?: string | number) => {
                    const s = String(name ?? "");
                    if (s.includes("price")) return [`$${Number(v).toFixed(0)}/mt`, s];
                    return [`${Number(v).toFixed(0)} kt`, s];
                  }}
                />
                <Bar yAxisId="vol" dataKey="urea_kt"    name="Urea kt"   stackId="vol" fill="#3b82f6" />
                <Bar yAxisId="vol" dataKey="kcl_kt"     name="KCl kt"    stackId="vol" fill="#8b5cf6" />
                <Bar yAxisId="vol" dataKey="map_dap_kt" name="MAP+DAP kt" stackId="vol" fill="#10b981" />
                <Line yAxisId="prc" dataKey="urea_price" name="Urea price" type="monotone" stroke="#93c5fd" strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="prc" dataKey="kcl_price"  name="KCl price"  type="monotone" stroke="#c4b5fd" strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="prc" dataKey="map_price"  name="MAP price"  type="monotone" stroke="#6ee7b7" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="text-[7px] text-slate-700 border-t border-slate-700 pt-2">
        Source: MDIC/ComexStat · NCM codes per Hedgepoint methodology · FOB implied price = FOB value ÷ net weight.
        Country/port breakdown requires schema extension — not yet available.
      </div>
    </div>
  );
}
