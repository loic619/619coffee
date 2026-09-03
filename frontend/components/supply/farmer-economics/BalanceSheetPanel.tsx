"use client";
import { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { BalanceSheet, BalanceSeasonRow } from "./farmerEconomicsData";
import { chgTone } from "@/lib/formatters";

// ── helpers ───────────────────────────────────────────────────────────────────

const avg = (r: BalanceSeasonRow) =>
  (r.production.usda + r.production.conab + r.production.cecafe) / 3;

const stocks = (r: BalanceSeasonRow) =>
  avg(r) - r.exports_ico - r.consumption;

const TT_STYLE = {
  background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10,
};

// ── Equation header strip ─────────────────────────────────────────────────────

function Eq({ label, value, sign, color, sub }: {
  label: string; value: string; sign?: string; color: string; sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {sign && <span className="text-slate-500 text-lg font-light">{sign}</span>}
      <div className={`bg-slate-900 border rounded-lg px-3 py-2 flex-1 min-w-0`}
        style={{ borderColor: color + "55" }}>
        <div className="text-[8px] uppercase tracking-wide font-bold mb-0.5" style={{ color }}>
          {label}
        </div>
        <div className="text-sm font-extrabold" style={{ color }}>
          {value}
        </div>
        {sub && <div className="text-[7px] text-slate-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Source spread (USDA / CONAB / CECAFE) for latest season ──────────────────

function SourceSpread({ row }: { row: BalanceSeasonRow }) {
  const prodAvg = avg(row);
  const sources: { label: string; value: number; color: string }[] = [
    { label: "USDA",   value: row.production.usda,   color: "#3b82f6" },
    { label: "CONAB",  value: row.production.conab,  color: "#10b981" },
    { label: "CECAFE", value: row.production.cecafe, color: "#f59e0b" },
  ];
  const min = Math.min(...sources.map(s => s.value));
  const max = Math.max(...sources.map(s => s.value));
  const range = max - min || 1;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">
        Production estimates · {row.season}{row.forecast ? " (f)" : ""}
      </div>
      {sources.map(s => {
        const pct = ((s.value - min) / range) * 100;
        return (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-[8px] font-bold w-11 flex-shrink-0" style={{ color: s.color }}>
              {s.label}
            </span>
            <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 8)}%`, background: s.color }} />
            </div>
            <span className="text-[8px] font-mono text-slate-300 w-10 text-right">
              {s.value.toFixed(1)}
            </span>
          </div>
        );
      })}
      <div className="flex justify-between text-[7px] text-slate-600 border-t border-slate-800 pt-1.5 mt-1">
        <span>Spread: {(max - min).toFixed(1)} M bags</span>
        <span>Avg: <span className="text-slate-400 font-bold">{prodAvg.toFixed(1)}</span></span>
      </div>
    </div>
  );
}

// ── Historical chart ──────────────────────────────────────────────────────────

function HistoryChart({ seasons }: { seasons: BalanceSeasonRow[] }) {
  const data = useMemo(() =>
    seasons.map(r => ({
      season: r.season + (r.forecast ? "f" : ""),
      prod_avg: parseFloat(avg(r).toFixed(1)),
      exports: r.exports_ico,
      consumption: r.consumption,
      demand: parseFloat((r.exports_ico + r.consumption).toFixed(1)),
      stocks: parseFloat(stocks(r).toFixed(1)),
      type: r.type,
    })), [seasons]);

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 36, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="season" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="vol" domain={[0, 80]} tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v}M`} />
          <YAxis yAxisId="stk" orientation="right" domain={[-3, 6]} tick={{ fontSize: 7, fill: "#94a3b8" }}
            axisLine={false} tickLine={false} width={30} tickFormatter={v => `${v > 0 ? "+" : ""}${v}`} />
          <Tooltip
            contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => {
              const n = String(name);
              const val = Number(v).toFixed(1);
              if (n === "stocks")  return [`${Number(v) > 0 ? "+" : ""}${val} M bags`, "Net stocks"];
              if (n === "prod_avg") return [`${val} M bags`, "Production avg"];
              if (n === "exports") return [`${val} M bags`, "ICO Exports"];
              if (n === "consumption") return [`${val} M bags`, "Local Consumption"];
              return [val, n];
            }}
          />
          <ReferenceLine yAxisId="stk" y={0} stroke="#475569" strokeDasharray="4 2" strokeWidth={1} />

          {/* Demand stack (exports + consumption) */}
          <Bar yAxisId="vol" dataKey="exports" stackId="demand" fill="#ef4444" opacity={0.75} name="exports">
            {data.map((d, i) => (
              <Cell key={i} fill="#ef4444" fillOpacity={d.season.endsWith("f") ? 0.4 : 0.75} />
            ))}
          </Bar>
          <Bar yAxisId="vol" dataKey="consumption" stackId="demand" fill="#f97316" opacity={0.75}
            radius={[2, 2, 0, 0]} name="consumption">
            {data.map((d, i) => (
              <Cell key={i} fill="#f97316" fillOpacity={d.season.endsWith("f") ? 0.4 : 0.75} />
            ))}
          </Bar>

          {/* Production avg line */}
          <Line yAxisId="vol" type="monotone" dataKey="prod_avg" stroke="#22c55e" strokeWidth={2}
            dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }} connectNulls name="prod_avg" />

          {/* Net stocks line (secondary axis) */}
          <Line yAxisId="stk" type="monotone" dataKey="stocks" stroke="#fbbf24" strokeWidth={2.5}
            dot={{ r: 4, fill: "#fbbf24", strokeWidth: 0 }}
            connectNulls strokeDasharray={data[data.length - 1]?.season.endsWith("f") ? "0" : "0"}
            name="stocks" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BalanceSheetPanel({ balance }: { balance: BalanceSheet }) {
  const latest = balance.seasons[balance.seasons.length - 1];
  const prodAvg = avg(latest);
  const netStocks = stocks(latest);
  const isDeficit = netStocks < 0;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
      {/* Title */}
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            Supply Balance Sheet · Brazil
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">{balance.note}</div>
        </div>
        <div className="text-[8px] text-slate-600">{balance.unit}</div>
      </div>

      {/* Equation strip */}
      <div className="flex items-stretch gap-1">
        <Eq label="Production avg" value={`${prodAvg.toFixed(1)}M`} color="#22c55e"
          sub={`USDA / CONAB / CECAFE · ${latest.season}${latest.forecast ? " (f)" : ""}`} />
        <Eq label="ICO Exports" value={`${latest.exports_ico.toFixed(1)}M`} sign="−" color="#ef4444"
          sub="International Coffee Org" />
        <Eq label="Local Consumption" value={`${latest.consumption.toFixed(1)}M`} sign="−" color="#f97316"
          sub="Domestic use" />
        <Eq
          label="Net Stocks"
          value={`${netStocks > 0 ? "+" : ""}${netStocks.toFixed(1)}M`}
          sign="="
          color={isDeficit ? "#f87171" : "#34d399"}
          sub={isDeficit ? "Supply deficit" : "Supply surplus"}
        />
      </div>

      {/* Historical chart */}
      <div className="space-y-1">
        <div className="flex gap-4 text-[7px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/75" />ICO Exports</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500/75" />Local consumption</span>
          <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-green-400" />Production avg</span>
          <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-400" />Net stocks →</span>
        </div>
        <HistoryChart seasons={balance.seasons} />
      </div>

      {/* Source spread for latest season */}
      <SourceSpread row={latest} />

      {/* YoY summary table */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-2">Season comparison</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[8px]">
            <thead>
              <tr className="text-slate-600 border-b border-slate-700">
                <th className="text-left pb-1 pr-3">Season</th>
                <th className="text-right pb-1 pr-3">Prod avg</th>
                <th className="text-right pb-1 pr-3">Exports</th>
                <th className="text-right pb-1 pr-3">Consump.</th>
                <th className="text-right pb-1">Net stocks</th>
              </tr>
            </thead>
            <tbody>
              {balance.seasons.map(r => {
                const p = avg(r), s = stocks(r);
                return (
                  <tr key={r.season} className="border-b border-slate-800/50">
                    <td className="py-1 pr-3 text-slate-400">
                      {r.season}
                      {r.forecast && <span className="ml-1 text-[7px] text-amber-500/70">f</span>}
                      <span className="ml-1 text-[7px] text-slate-600">{r.type}</span>
                    </td>
                    <td className="text-right pr-3 text-slate-300 font-mono">{p.toFixed(1)}</td>
                    <td className="text-right pr-3 text-red-400/80 font-mono">{r.exports_ico.toFixed(1)}</td>
                    <td className="text-right pr-3 text-orange-400/80 font-mono">{r.consumption.toFixed(1)}</td>
                    <td className={`text-right font-mono font-bold ${chgTone(s)}`}>
                      {s > 0 ? "+" : ""}{s.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[7px] text-slate-700 italic mt-1.5">
          Production = avg(USDA, CONAB, CECAFE). Exports = ICO. Consumption = domestic roasting estimate. Forecast seasons shaded.
        </div>
      </div>
    </div>
  );
}
