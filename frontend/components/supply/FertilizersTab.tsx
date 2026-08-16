"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, LineChart, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import VietnamFertilizerContext from "@/components/supply/VietnamFertilizerContext";
import { MONTH_ABBR } from "@/lib/formatters";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FertPrice { name: string; price_usd_mt: number; mom_pct: number; sparkline: number[]; }
interface BrazilImportMonth {
  month: string;
  urea_kt: number; kcl_kt: number;
  map_kt?: number; dap_kt?: number; an_kt?: number; as_kt?: number; superp_kt?: number;
  map_dap_kt: number; total_kt: number;
  urea_price_usd_mt: number | null; kcl_price_usd_mt: number | null; map_dap_price_usd_mt: number | null;
}
interface VnFertMonth { month: string; urea_kt: number; kcl_kt: number; npk_kt: number; dap_kt: number; total_kt: number; }
interface VnFertContext { source: string; note: string; key_suppliers: Record<string,string>; price_sensitivity: string; monthly?: VnFertMonth[]; }
interface ComtradeRow { reporter: string; reporter_code: string; period: string; hs_code: string; qty_mt: number; value_usd: number; }
interface GlobalFertData {
  updated: string;
  global_exports: Record<string, ComtradeRow[]>;
  country_imports: Record<string, Record<string, ComtradeRow[]>>;
  static_seed: { global_exports_2024: Record<string, { country: string; qty_mt_k: number }[]> };
}
interface OriginCountry { code: string; name: string; kg_kt: number; share: number; }
interface OriginEntry { countries: OriginCountry[]; states: { name: string; kg_kt: number }[]; }
type ImportOrigins = Record<string, Record<string, OriginEntry>>;
const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

const FERT_TYPES = ["urea_kt","kcl_kt","map_kt","dap_kt","an_kt","as_kt","superp_kt"] as const;
type FertType = typeof FERT_TYPES[number];

const FERT_COLORS: Record<FertType, string> = {
  urea_kt: "#3b82f6", kcl_kt: "#8b5cf6", map_kt: "#10b981",
  dap_kt: "#06b6d4", an_kt: "#f59e0b", as_kt: "#ec4899", superp_kt: "#84cc16",
};
const FERT_LABELS: Record<FertType, string> = {
  urea_kt: "Urea", kcl_kt: "KCl", map_kt: "MAP",
  dap_kt: "DAP", an_kt: "AN", as_kt: "AS", superp_kt: "Superp",
};

function brazilGetTypes(m: BrazilImportMonth): Record<FertType, number> {
  return {
    urea_kt: m.urea_kt ?? 0, kcl_kt: m.kcl_kt ?? 0,
    map_kt: m.map_kt ?? 0, dap_kt: m.dap_kt ?? 0,
    an_kt: m.an_kt ?? 0, as_kt: m.as_kt ?? 0, superp_kt: m.superp_kt ?? 0,
  };
}

function BrazilStackedTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const byYear: Record<string, Record<string, number>> = {};
  for (const entry of payload) {
    if (!entry.value || entry.value <= 0) continue;
    const parts = entry.dataKey.split("_");
    const yr = parts[0];
    if (!/^\d{4}$/.test(yr)) continue;
    const type = parts.slice(1).join("_");
    if (!byYear[yr]) byYear[yr] = {};
    byYear[yr][type] = entry.value;
  }
  if (!Object.keys(byYear).length) return null;
  return (
    <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"8px 10px", fontSize:10 }}>
      <div style={{ color:"#94a3b8", marginBottom:6, fontWeight:"bold" }}>{label}</div>
      {Object.entries(byYear).sort().map(([yr, types]) => {
        const total = Object.values(types).reduce((s,v) => s+v, 0);
        return (
          <div key={yr} style={{ marginBottom:4 }}>
            <div style={{ color:"#e2e8f0", fontWeight:"bold", marginBottom:2 }}>{yr}: {total.toFixed(0)} kt</div>
            {FERT_TYPES.filter(t => (types[t] ?? 0) > 0).map(t => (
              <div key={t} style={{ color:FERT_COLORS[t], paddingLeft:8 }}>
                {FERT_LABELS[t]}: {(types[t] ?? 0).toFixed(0)} kt
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const HS_META: Record<string, { label: string; color: string }> = {
  "3102": { label: "Nitrogen / Urea",  color: "#3b82f6" },
  "3104": { label: "Potash (KCl)",     color: "#8b5cf6" },
  "3105": { label: "DAP / MAP / NPK",  color: "#10b981" },
};

function fmtMo(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_ABBR[+m-1]}-${y.slice(2)}`;
}

// ── Price spark card ───────────────────────────────────────────────────────────

function PriceCard({ item }: { item: FertPrice }) {
  const up = item.mom_pct > 0;
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[9px] text-slate-400 mb-0.5 uppercase tracking-wide">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/MT</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">FOB implied · Brazil</div>
      <div className="h-8 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Line type="monotone" dataKey="v" stroke={up ? "#ef4444" : "#22c55e"} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`text-[10px] font-semibold ${up ? "text-red-400" : "text-green-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>
    </div>
  );
}

// ── Brazil import chart — seasonal grouped stacked view ───────────────────────

function BrazilImportChart({ monthly }: { monthly: BrazilImportMonth[] }) {
  const [view, setView] = useState<"monthly" | "cumulative">("monthly");

  const { byKey, sortedYears, lastMonthIdx } = useMemo(() => {
    const byKey: Record<string, BrazilImportMonth> = {};
    const years = new Set<string>();
    const lastMonthIdx: Record<string, number> = {};
    for (const m of monthly) {
      byKey[m.month] = m;
      const [yr, mo] = m.month.split("-");
      years.add(yr);
      const moIdx = parseInt(mo) - 1;
      if (!(yr in lastMonthIdx) || moIdx > lastMonthIdx[yr]) lastMonthIdx[yr] = moIdx;
    }
    return { byKey, sortedYears: Array.from(years).sort(), lastMonthIdx };
  }, [monthly]);

  const latestYear = sortedYears[sortedYears.length - 1];
  const latest = monthly[monthly.length - 1];

  const chartData = useMemo(() => {
    if (view === "monthly") {
      return MONTH_ABBR.map((label, i) => {
        const row: Record<string, string | number | null> = { month: label };
        const yearTotals: number[] = [];
        for (const yr of sortedYears) {
          const m = byKey[`${yr}-${String(i + 1).padStart(2, "0")}`];
          if (m) {
            const types = brazilGetTypes(m);
            for (const t of FERT_TYPES) row[`${yr}_${t}`] = types[t] || null;
            yearTotals.push(m.total_kt);
          } else {
            for (const t of FERT_TYPES) row[`${yr}_${t}`] = null;
          }
        }
        const vals = yearTotals.filter(v => v > 0);
        row.min_range = vals.length > 1 ? Math.min(...vals) : null;
        row.max_range = vals.length > 1 ? Math.max(...vals) : null;
        return row;
      }).filter(row => sortedYears.some(yr => (row as Record<string, unknown>)[`${yr}_urea_kt`] != null));
    } else {
      const cum: Record<string, Record<FertType, number>> = {};
      for (const yr of sortedYears) cum[yr] = { urea_kt:0, kcl_kt:0, map_kt:0, dap_kt:0, an_kt:0, as_kt:0, superp_kt:0 };
      return MONTH_ABBR.map((label, i) => {
        const row: Record<string, string | number | null> = { month: label };
        for (const yr of sortedYears) {
          const m = byKey[`${yr}-${String(i + 1).padStart(2, "0")}`];
          if (m) { const t = brazilGetTypes(m); for (const k of FERT_TYPES) cum[yr][k] += t[k]; }
          if (i <= (lastMonthIdx[yr] ?? -1)) {
            for (const t of FERT_TYPES) row[`${yr}_${t}`] = Math.round(cum[yr][t]) || null;
          } else {
            for (const t of FERT_TYPES) row[`${yr}_${t}`] = null;
          }
        }
        return row;
      });
    }
  }, [view, byKey, sortedYears, lastMonthIdx]);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Brazil Fertilizer Imports</div>
          <div className="text-[8px] text-slate-600 mt-0.5">Comex Stat · HS 31 · kt · {sortedYears[0]}–{latestYear}</div>
        </div>
        <div className="flex items-center gap-2">
          {latest && (
            <div className="text-right">
              <div className="text-[8px] text-slate-500">Latest ({fmtMo(latest.month)})</div>
              <div className="text-sm font-bold text-amber-400">{latest.total_kt.toLocaleString()} kt</div>
            </div>
          )}
          <div className="flex gap-0.5">
            {(["monthly", "cumulative"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-[8px] font-bold transition-colors ${
                  view === v ? "bg-slate-600 text-slate-100" : "text-slate-500 hover:text-slate-400"
                }`}>
                {v === "monthly" ? "Monthly" : "Cumul."}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
            <Tooltip content={<BrazilStackedTooltip />} />
            {sortedYears.flatMap((yr, i) => {
              const opacity = Math.max(0.4, 1 - (sortedYears.length - 1 - i) * 0.25);
              return FERT_TYPES.map(t => (
                <Bar key={`${yr}_${t}`} dataKey={`${yr}_${t}`} stackId={yr}
                  fill={FERT_COLORS[t]} opacity={opacity} isAnimationActive={false} />
              ));
            })}
            {view === "monthly" && <>
              <Line dataKey="min_range" stroke="#334155" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
              <Line dataKey="max_range" stroke="#475569" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
            </>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-2 border-t border-slate-700 pt-2">
        <div className="flex flex-wrap gap-2">
          {FERT_TYPES.map(t => (
            <span key={t} className="flex items-center gap-1 text-[7px] text-slate-500">
              <span className="w-2 h-2 rounded-sm" style={{ background: FERT_COLORS[t] }} />
              {FERT_LABELS[t]}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {sortedYears.map((yr, i) => {
            const opacity = Math.max(0.4, 1 - (sortedYears.length - 1 - i) * 0.25);
            return (
              <span key={yr} className="flex items-center gap-1 text-[7px] text-slate-500">
                <span className="w-2 h-2 rounded-sm bg-slate-400" style={{ opacity }} />{yr}
              </span>
            );
          })}
          {view === "monthly" && (
            <span className="flex items-center gap-1 text-[7px] text-slate-600">
              <span className="w-3 h-px border-t border-dashed border-slate-500 inline-block" />yr range
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Brazil import country-of-origin breakdown ─────────────────────────────────

const ORIGIN_LABEL_ORDER = ["Urea", "KCl", "MAP", "DAP", "AN", "AS", "Superphosphate"];
const ORIGIN_COLORS: Record<string, string> = {
  Urea: "#3b82f6", KCl: "#8b5cf6", MAP: "#10b981",
  DAP: "#06b6d4", AN: "#f59e0b", AS: "#ec4899", Superphosphate: "#84cc16",
};

function BrazilOriginsPanel({ origins }: { origins: ImportOrigins }) {
  const labels = ORIGIN_LABEL_ORDER.filter(l => origins[l]);
  const availYears = Array.from(new Set(labels.flatMap(l => Object.keys(origins[l] ?? {})))).sort();
  const latestYear = availYears[availYears.length - 1];
  const [year, setYear] = useState(latestYear);

  if (!latestYear) return null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">
          Brazil Imports · Origin Countries
        </div>
        <div className="flex gap-0.5">
          {availYears.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-2 py-0.5 rounded text-[8px] font-bold transition-colors ${
                year === y ? "bg-slate-600 text-slate-100" : "text-slate-500 hover:text-slate-400"
              }`}>
              {y}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {labels.map(label => {
          const entry = origins[label]?.[year];
          if (!entry?.countries?.length) return null;
          return (
            <div key={label}>
              <div className="text-[9px] font-bold mb-1 uppercase" style={{ color: ORIGIN_COLORS[label] ?? "#64748b" }}>
                {label}
              </div>
              <div className="space-y-0.5">
                {entry.countries.map(c => (
                  <div key={c.code} className="flex items-center gap-1.5">
                    <div className="h-1.5 rounded-full flex-shrink-0" style={{
                      width: `${Math.max(8, c.share)}%`,
                      maxWidth: "60%",
                      background: ORIGIN_COLORS[label] ?? "#64748b",
                      opacity: 0.7,
                    }} />
                    <span className="text-[8px] text-slate-300 truncate">{c.name}</span>
                    <span className="text-[8px] text-slate-500 font-mono ml-auto flex-shrink-0">{c.share}%</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Global exports: stacked annual reference + live 3104 trend ────────────────

function GlobalExportsPanel({ data }: { data: GlobalFertData }) {
  // 2024 annual static_seed totals per HS code
  const seedTotals = Object.entries(data.static_seed.global_exports_2024).map(([hs, rows]) => ({
    hs,
    label: HS_META[hs]?.label ?? hs,
    color: HS_META[hs]?.color ?? "#64748b",
    total_mt_k: rows.reduce((s, r) => s + r.qty_mt_k, 0),
  }));

  // Live 3104 monthly data (most reliable HS code in Comtrade)
  const live3104 = useMemo(() => {
    const rows3104 = data.global_exports["3104"] ?? [];
    const byPeriod: Record<string, number> = {};
    for (const r of rows3104) {
      byPeriod[r.period] = (byPeriod[r.period] ?? 0) + r.qty_mt;
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, qty_mt]) => ({
        period: `${MONTH_ABBR[parseInt(period.slice(4)) - 1]}-${period.slice(2,4)}`,
        qty_kt: Math.round(qty_mt / 1000),
      }));
  }, [data]);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">
          Global Export Volume · HS 3102 / 3104 / 3105
        </div>
        <div className="text-[8px] text-slate-600 mt-0.5">
          2024 annual reference · UN Comtrade static seed
          {data.updated && (
            <span className="ml-2 text-slate-700">· updated {new Date(data.updated).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}</span>
          )}
        </div>
      </div>

      {/* 2024 stacked overview: total by HS code */}
      <div className="space-y-1.5">
        {seedTotals.map(({ hs, label, color, total_mt_k }) => (
          <div key={hs} className="space-y-0.5">
            <div className="flex items-center justify-between text-[8px]">
              <span className="text-slate-400"><span className="font-mono text-slate-500">{hs}</span> {label}</span>
              <span className="font-mono text-slate-300">{total_mt_k.toLocaleString()}k MT</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${Math.min(100, total_mt_k / Math.max(...seedTotals.map(s => s.total_mt_k)) * 100)}%`,
                background: color,
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Live 3104 monthly trend (only reliable live code) */}
      {live3104.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <div className="text-[9px] text-slate-400 mb-2">
            3104 (Potash) live monthly exports — top reporters · UN Comtrade
            <span className="text-slate-600 ml-1">· other HS codes not yet available from public endpoint</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={live3104} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="period" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(0)} kt`, "Potash exports"]} />
                <Bar dataKey="qty_kt" fill="#8b5cf6" opacity={0.85} radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Static 2024 top exporters per HS */}
      <div className="border-t border-slate-700 pt-3 space-y-3">
        <div className="text-[8px] text-slate-500 uppercase tracking-wide">Top exporters by product · 2024</div>
        {Object.entries(data.static_seed.global_exports_2024).map(([hs, rows]) => (
          <div key={hs}>
            <div className="text-[8px] font-bold mb-1" style={{ color: HS_META[hs]?.color }}>
              {hs} · {HS_META[hs]?.label}
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
              {rows.map((r, i) => (
                <div key={r.country} className="flex items-center gap-1 text-[8px]">
                  <span className="text-slate-600 font-mono w-3">{i+1}</span>
                  <span className="text-slate-300 truncate">{r.country}</span>
                  <span className="text-slate-500 font-mono ml-auto">{r.qty_mt_k.toLocaleString()}k</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Key global exporters: horizontal bar chart ────────────────────────────────

function KeyExporterChart({ data }: { data: GlobalFertData }) {
  const [selected, setSelected] = useState<string>("3102");
  const rows = data.static_seed.global_exports_2024[selected] ?? [];
  const maxVal = Math.max(...rows.map(r => r.qty_mt_k));
  const { color } = HS_META[selected] ?? { color: "#64748b" };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Key Global Exporters</div>
          <div className="text-[8px] text-slate-600 mt-0.5">2024 annual · UN Comtrade · kt</div>
        </div>
        <div className="flex gap-1">
          {Object.entries(HS_META).map(([code]) => (
            <button key={code} onClick={() => setSelected(code)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                selected === code ? "text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"
              }`}
              style={selected === code ? { background: HS_META[code].color } : {}}>
              {code}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-slate-400">{HS_META[selected]?.label}</div>

      {/* Horizontal bar chart */}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.country} className="space-y-0.5">
            <div className="flex items-center justify-between text-[8px]">
              <span className="flex items-center gap-1.5">
                <span className="text-slate-600 font-mono w-3 text-right">{i+1}</span>
                <span className="text-slate-300">{r.country}</span>
              </span>
              <span className="font-mono text-slate-400">{r.qty_mt_k.toLocaleString()}k MT</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${(r.qty_mt_k / maxVal) * 100}%`, background: color, opacity: 1 - i * 0.1 }} />
            </div>
          </div>
        ))}
      </div>

      <div className="text-[8px] text-slate-600 italic border-t border-slate-700 pt-2">
        Source: UN Comtrade static reference · 2024 annual data · live updates planned via comtradeapicall
      </div>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function FertilizersTab() {
  const [prices, setPrices]         = useState<FertPrice[] | null>(null);
  const [brazil, setBrazil]         = useState<BrazilImportMonth[] | null>(null);
  const [vnFert, setVnFert]         = useState<VnFertContext | null>(null);
  const [pricesAsOf, setPricesAsOf] = useState<string>("");
  const [globalFert, setGlobalFert] = useState<GlobalFertData | null>(null);
  const [origins, setOrigins] = useState<ImportOrigins | null>(null);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then(r => r.json())
      .then(d => {
        setPrices(d.fertilizer?.items ?? null);
        setBrazil(d.fertilizer?.imports?.monthly ?? null);
        setPricesAsOf(d.fertilizer?.prices_as_of ?? "");
        setOrigins(d.fertilizer?.import_origins ?? null);
      })
      .catch((err) => console.error("[FertilizersTab] farmer_economics fetch failed:", err));
    fetch("/data/vietnam_supply.json")
      .then(r => r.json())
      .then(d => setVnFert(d.fertilizer_context ?? null))
      .catch((err) => console.error("[FertilizersTab] vietnam_supply fetch failed:", err));
    fetch("/data/global_fertilizers.json")
      .then(r => r.json())
      .then(setGlobalFert)
      .catch((err) => console.error("[FertilizersTab] global_fertilizers fetch failed:", err));
  }, []);

  return (
    <div className="space-y-5">

      {/* Global price panel */}
      <div>
        <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
          Global Fertilizer Prices · FOB Brazil
        </h2>
        {prices ? (
          <div className="flex gap-3">
            {prices.map(p => <PriceCard key={p.name} item={p} />)}
          </div>
        ) : (
          <div className="text-slate-600 text-xs italic">Loading prices…</div>
        )}
        {pricesAsOf && (
          <div className="text-[8px] text-slate-600 mt-1">As of {pricesAsOf} · Comex Stat implied FOB</div>
        )}
      </div>

      {/* Brazil imports — seasonal view */}
      <div>
        <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
          Brazil Imports · HS 31
        </h2>
        {brazil ? (
          <BrazilImportChart monthly={brazil} />
        ) : (
          <div className="text-slate-600 text-xs italic">Loading…</div>
        )}
      </div>

      {/* Brazil import origins */}
      {origins && <BrazilOriginsPanel origins={origins} />}

      {/* Vietnam imports */}
      {vnFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Vietnam Imports · HS 31
          </h2>
          <VietnamFertilizerContext context={vnFert} />
        </div>
      )}

      {/* Global exports panel */}
      {globalFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Global Export Volume · HS 3102 / 3104 / 3105
          </h2>
          <GlobalExportsPanel data={globalFert} />
        </div>
      )}

      {/* Key exporters bar chart */}
      {globalFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Key Global Exporters · HS 3102 / 3104 / 3105
          </h2>
          <KeyExporterChart data={globalFert} />
        </div>
      )}

    </div>
  );
}
