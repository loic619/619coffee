"use client";
import { useState } from "react";
import { useFetchJson } from "@/lib/useFetchJson";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface StockMonth {
  period: string;
  by_origin: Record<string, number>;
  by_region: Record<string, number>;
  total_origin?: number | null;
  total_region?: number | null;
}
interface AnnualStock { year: number; ending_stocks_mt: number }
interface SupplyDemand {
  year: number; ending_stocks_mt: number; begin_stocks_mt: number;
  green_imports_mt: number; product_imports_mt: number;
  consumption_mt: number; exports_mt: number;
}
interface ImportsOrigin { year: number; by_country: Record<string, number> }
interface ImportsType { year: number; green_mt: number; regular_mt: number; instant_mt: number }
interface AjcaData {
  source: string; source_url: string; last_updated: string;
  stocks: {
    latest_period: string | null; latest_total_mt: number | null;
    monthly: StockMonth[]; annual: AnnualStock[];
  };
  supply_demand: SupplyDemand[];
  imports_origin: ImportsOrigin[];
  imports_type?: ImportsType[];
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COLORS: Record<string, string> = {
  Brazil: "#16a34a", Vietnam: "#ca8a04", Colombia: "#dc2626", Indonesia: "#7c3aed",
  "Central America": "#0891b2", Others: "#64748b", Africa: "#ea580c",
  Guatemala: "#0891b2", Ethiopia: "#ea580c", Tanzania: "#14b8a6", Honduras: "#f59e0b",
  Peru: "#a855f7", India: "#ef4444", Uganda: "#84cc16", Mexico: "#06b6d4",
  Kenya: "#f43f5e", "Papua New Guinea": "#22c55e", "Costa Rica": "#eab308",
  Keihin: "#6366f1", Chukyo: "#8b5cf6", Hanshin: "#a78bfa",
};
const color = (k: string, i = 0) => COLORS[k] ?? ["#64748b", "#94a3b8", "#475569", "#0ea5e9"][i % 4];
const kt = (v?: number | null) => (v != null ? Math.round(v / 1000) : null);
const TT = { backgroundColor: "#1e293b", borderColor: "#475569", fontSize: 11 } as const;

// Dedup preserving order, without Set spread (repo TS target predates es2015).
function uniq(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (!out.includes(x)) out.push(x);
  return out;
}

type Row = Record<string, number | string | null>;

export default function AjcaPanel() {
  const { data: d, error: err } = useFetchJson<AjcaData>("/data/ajca.json");
  const [dim, setDim] = useState<"origin" | "region">("origin");

  if (err) return <div className="p-4 text-xs text-red-400">Failed to load AJCA data.</div>;
  if (!d) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading AJCA data…</div>;

  // ── Panel A: stocks ─────────────────────────────────────────────────────────
  const annual = d.stocks.annual.map(a => ({ year: a.year, stocks: kt(a.ending_stocks_mt) }));
  const dimKey = dim === "origin" ? "by_origin" : "by_region";
  const items = uniq(d.stocks.monthly.flatMap(m => Object.keys(m[dimKey])));
  const monthlyData: Row[] = d.stocks.monthly.map(m => {
    const row: Row = { month: MONTHS[parseInt(m.period.slice(5))] };
    for (const it of items) row[it] = kt(m[dimKey][it]);
    return row;
  });
  const latestM = d.stocks.latest_total_mt;

  // ── Panel B: supply & demand (recent years) ─────────────────────────────────
  const sd = d.supply_demand.slice(-16).map(r => ({
    year: r.year, imports: kt(r.green_imports_mt), consumption: kt(r.consumption_mt),
    exports: kt(r.exports_mt), stocks: kt(r.ending_stocks_mt),
  }));

  // ── Panel C: imports by origin ──────────────────────────────────────────────
  const io = d.imports_origin;
  const latestIO = io.length ? io[io.length - 1] : null;
  const topBars = latestIO
    ? Object.entries(latestIO.by_country).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([country, v]) => ({ country, imports: kt(v) }))
    : [];
  const top5 = topBars.slice(0, 5).map(o => o.country);
  const ioTrend: Row[] = io.map(r => {
    const row: Row = { year: r.year };
    for (const c of top5) row[c] = kt(r.by_country[c]);
    return row;
  });

  // ── Panel D: imports by type (green / regular / instant) ────────────────────
  const typeData = (d.imports_type ?? []).map(t => ({
    year: t.year, green: kt(t.green_mt), regular: kt(t.regular_mt), instant: kt(t.instant_mt),
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Japan · AJCA</h2>
          <p className="text-xs text-slate-400">
            All Japan Coffee Association — stocks, supply &amp; demand, imports
          </p>
        </div>
        <a href={d.source_url} target="_blank" rel="noopener noreferrer"
           className="text-[10px] text-indigo-400 hover:text-indigo-300 underline">
          AJCA · {d.last_updated}
        </a>
      </div>

      {/* Panel A — Stocks */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-300 font-semibold">Green-coffee stocks</div>
          <div className="text-[10px] text-slate-500">
            Latest {d.stocks.latest_period}: <span className="text-white font-bold">
              {latestM != null ? `${Math.round(latestM / 1000)}k t` : "—"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Annual ending-stock history */}
          <div>
            <div className="text-[10px] text-slate-400 mb-1">Annual ending stocks ({annual[0]?.year}→{annual[annual.length - 1]?.year}) · k t</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annual} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 8, fill: "#64748b" }} interval={4} />
                  <YAxis tick={{ fontSize: 8, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
                  <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${v}k t`, "Ending stocks"]} />
                  <Bar dataKey="stocks" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Current-year monthly by origin/region */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] text-slate-400">Monthly by {dim} · k t</div>
              <div className="flex gap-1">
                {(["origin", "region"] as const).map(t => (
                  <button key={t} onClick={() => setDim(t)}
                    className={`text-[8px] px-1.5 py-0.5 rounded ${dim === t
                      ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {t === "origin" ? "Origin" : "Region"}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
                  <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [`${v}k t`, String(n)]} />
                  <Legend wrapperStyle={{ fontSize: 8 }} />
                  {items.map((it, i) => (
                    <Bar key={it} dataKey={it} stackId="s" fill={color(it, i)} name={it}
                         radius={i === items.length - 1 ? [2, 2, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Panel B — Supply & demand */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
        <div className="text-xs text-slate-300 font-semibold mb-2">Supply &amp; demand · k t (green-bean equiv.)</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sd} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
              <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [`${v}k t`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="imports" fill="#0ea5e9" name="Green imports" radius={[2, 2, 0, 0]} />
              <Bar dataKey="consumption" fill="#f59e0b" name="Consumption" radius={[2, 2, 0, 0]} />
              <Bar dataKey="exports" fill="#64748b" name="Exports" radius={[2, 2, 0, 0]} />
              <Line dataKey="stocks" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} name="Ending stocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Panel C — Imports by origin */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
        <div className="text-xs text-slate-300 font-semibold">Green imports by origin</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-400 mb-1">Top origins {latestIO?.year} · k t</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBars} layout="vertical" margin={{ top: 0, right: 8, left: 28, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 8, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
                  <YAxis type="category" dataKey="country" tick={{ fontSize: 8, fill: "#94a3b8" }} width={80} />
                  <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${v}k t`, "Imports"]} />
                  <Bar dataKey="imports" fill="#16a34a" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 mb-1">Top-5 origins trend · k t</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ioTrend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
                  <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [`${v}k t`, String(n)]} />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  {top5.map((c, i) => (
                    <Line key={c} dataKey={c} stroke={color(c, i)} strokeWidth={2} dot={false} name={c} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="text-[9px] text-slate-500 italic">
          Imports are green-coffee (生豆) by country; stocks panel above is end-of-month inventory.
        </div>
      </div>

      {/* Panel D — Imports by type */}
      {typeData.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-300 font-semibold mb-2">
            Imports by type · k t (product weight)
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={v => `${v}k`} />
                <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [`${v}k t`, String(n)]} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                <Bar dataKey="green" stackId="t" fill="#16a34a" name="Green (生豆)" />
                <Bar dataKey="regular" stackId="t" fill="#b45309" name="Roasted (レギュラー)" />
                <Bar dataKey="instant" stackId="t" fill="#6366f1" name="Instant (インスタント)"
                     radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-slate-500 italic mt-1">
            Green is overwhelmingly the largest; roasted &amp; instant are in product weight (not green-bean equivalent).
          </div>
        </div>
      )}
    </div>
  );
}
