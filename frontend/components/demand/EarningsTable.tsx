"use client";
import { useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface MarketInfo {
  price: number | null;
  currency: string;
  w52_high: number | null;
  w52_low: number | null;
  mktcap: number | null;
  pe: number | null;
  forward_pe: number | null;
  ev_ebitda: number | null;
  ytd_pct: number | null;
}

interface FinancialPeriod {
  period_end: string;
  revenue: number | null;
  cogs: number | null;
  cogs_yoy?: number | null;
  gross_profit: number | null;
  net_income: number | null;
  net_debt: number | null;
  revenue_yoy?: number | null;
  gross_profit_yoy?: number | null;
  net_income_yoy?: number | null;
}

interface EarningsDate {
  date: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
}

interface Company {
  ticker: string;
  name: string;
  group: string;
  scraped_at: string;
  frequency?: "quarterly" | "annual";
  market?: MarketInfo;
  financials?: FinancialPeriod[];
  earnings_dates?: EarningsDate[];
  error?: string;
}

interface EarningsData {
  scraped_at: string;
  companies: Company[];
}

const GROUP_LABELS: Record<string, string> = {
  pure_coffee:  "Pure-Play Coffee",
  conglomerate: "Coffee Conglomerates",
  adjacent:     "Adjacent Demand",
  micro:        "Micro-Caps",
};
const GROUP_ORDER = ["pure_coffee", "conglomerate", "adjacent", "micro"];

function fmtB(v: number | null, currency = "USD"): string {
  if (v == null) return "—";
  const sym = currency === "CHF" ? "CHF" : currency === "EUR" ? "€" : "$";
  return `${sym}${(v / 1e9).toFixed(1)}B`;
}
function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtNum(v: number | null, dec = 1): string {
  if (v == null) return "—";
  return v.toFixed(dec);
}
function pctColor(v: number | null): string {
  if (v == null) return "text-slate-500";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function w52Bar({ price, w52_low, w52_high }: { price: number | null; w52_low: number | null; w52_high: number | null }) {
  if (!price || !w52_low || !w52_high || w52_high === w52_low) return <span className="text-slate-600">—</span>;
  const pct = ((price - w52_low) / (w52_high - w52_low)) * 100;
  return (
    <div className="flex items-center gap-1 min-w-[80px]">
      <span className="text-[9px] text-slate-500">{w52_low.toFixed(0)}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full relative">
        <div className="absolute top-0 h-1.5 w-1 rounded-full bg-amber-400" style={{ left: `${Math.min(98, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-[9px] text-slate-500">{w52_high.toFixed(0)}</span>
    </div>
  );
}

function nextEarningsDate(dates: EarningsDate[] | undefined): string {
  if (!dates?.length) return "—";
  const today = new Date().toISOString().slice(0, 10);
  const future = dates.filter(d => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return future[0]?.date ?? "—";
}

function lastSurprise(dates: EarningsDate[] | undefined): { surprise: number | null; date: string } {
  if (!dates?.length) return { surprise: null, date: "—" };
  const today = new Date().toISOString().slice(0, 10);
  const past = dates.filter(d => d.date < today && d.surprise_pct != null).sort((a, b) => b.date.localeCompare(a.date));
  if (!past[0]) return { surprise: null, date: "—" };
  return { surprise: past[0].surprise_pct, date: past[0].date };
}

const SPARK_TT_STYLE = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

function FinancialSparkline({ company }: { company: Company }) {
  const periods = (company.financials ?? [])
    .filter(f => f.revenue != null || f.net_income != null)
    .slice()
    .reverse(); // backend ships newest-first, chart wants oldest-first
  if (periods.length < 2) {
    return <div className="text-[10px] text-slate-500 italic">Not enough historical periods to chart.</div>;
  }
  const cur = company.market?.currency ?? "USD";
  const chartData = periods.map(p => ({
    period:     p.period_end?.slice(0, 7) ?? "",
    revenue:    p.revenue != null    ? +(p.revenue / 1e9).toFixed(2)    : null,
    net_income: p.net_income != null ? +(p.net_income / 1e9).toFixed(2) : null,
  }));
  return (
    <div className="h-32 px-1 pt-2 pb-1">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="rev" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}B`} />
          <YAxis yAxisId="ni" orientation="right" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}B`} />
          <Tooltip
            contentStyle={SPARK_TT_STYLE}
            formatter={(v: unknown, name: unknown) => [
              v == null ? "—" : `${Number(v).toFixed(2)}B ${cur}`,
              name === "revenue" ? "Revenue" : "Net Income",
            ]}
          />
          <Bar yAxisId="rev" dataKey="revenue" fill="#0ea5e9" opacity={0.6} radius={[2, 2, 0, 0]} name="revenue" />
          <Line yAxisId="ni" dataKey="net_income" type="monotone" stroke="#f59e0b" strokeWidth={1.6} dot={{ r: 2, fill: "#f59e0b" }} name="net_income" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}


export default function EarningsTable() {
  const [data, setData] = useState<EarningsData | null>(null);
  const [error, setError] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/data/earnings.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <div className="p-4 text-xs text-red-400">Failed to load earnings data.</div>;
  if (!data)  return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading earnings data…</div>;

  const groups = GROUP_ORDER.filter(g => data.companies.some(c => c.group === g));
  const filtered = activeGroup === "all" ? data.companies : data.companies.filter(c => c.group === activeGroup);

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Coffee Companies — Earnings Tracker</h2>
          <p className="text-xs text-slate-400">Annual financials · valuation · earnings dates · as of {data.scraped_at.slice(0, 10)}</p>
        </div>
        {/* Group filter */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setActiveGroup("all")}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${activeGroup === "all" ? "border-amber-500 bg-amber-500/20 text-amber-300" : "border-slate-600 text-slate-400"}`}
          >All</button>
          {groups.map(g => (
            <button key={g}
              onClick={() => setActiveGroup(g)}
              className={`px-2 py-0.5 rounded text-xs border transition-colors ${activeGroup === g ? "border-amber-500 bg-amber-500/20 text-amber-300" : "border-slate-600 text-slate-400"}`}
            >{GROUP_LABELS[g]}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
              <th className="text-left px-2 py-1.5 whitespace-nowrap">Company</th>
              {/* Stock */}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Price</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">YTD</th>
              <th className="px-2 py-1.5 whitespace-nowrap">52w Range</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Mkt Cap</th>
              {/* Valuation */}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">P/E</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">fwd P/E</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">EV/EBITDA</th>
              {/* Latest annual financials */}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Revenue</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Rev YoY</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">COGS</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">COGS YoY</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Gross Profit</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">GP YoY</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Net Income</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">NI YoY</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Net Debt</th>
              {/* Earnings */}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Last Surprise</th>
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Next Earnings</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map(g => {
              const rows = filtered.filter(c => c.group === g);
              if (!rows.length) return null;
              return (
                <>
                  {/* Group header row */}
                  <tr key={`hdr-${g}`} className="bg-slate-900/80">
                    <td colSpan={19} className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800">
                      {GROUP_LABELS[g]}
                    </td>
                  </tr>
                  {rows.map((co, idx) => {
                    const fi   = co.financials?.[0];
                    const mkt  = co.market;
                    const cur  = mkt?.currency ?? "USD";
                    const { surprise, date: surpriseDate } = lastSurprise(co.earnings_dates);
                    const nextEd = nextEarningsDate(co.earnings_dates);
                    const periodEnd = fi?.period_end ?? "—";

                    const isExpanded = expanded.has(co.ticker);
                    const toggleExpand = () => setExpanded(prev => {
                      const next = new Set(prev);
                      if (next.has(co.ticker)) next.delete(co.ticker);
                      else next.add(co.ticker);
                      return next;
                    });
                    return (
                      <>
                      <tr key={co.ticker} className={`border-b border-slate-800 ${idx % 2 === 0 ? "bg-transparent" : "bg-slate-900/40"} hover:bg-slate-800/40 cursor-pointer`} onClick={toggleExpand}>
                        {/* Company */}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 text-[10px] w-2 inline-block">{isExpanded ? "▾" : "▸"}</span>
                            <span className="font-semibold text-white">{co.ticker}</span>
                            <span className={`text-[9px] px-1 rounded font-bold ${co.frequency === "quarterly" ? "bg-sky-900/60 text-sky-400" : "bg-slate-700 text-slate-400"}`}>
                              {co.frequency === "quarterly" ? "Q" : "A"}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400">{co.name}</div>
                        </td>
                        {/* Stock */}
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-200">
                          {mkt?.price != null ? `${mkt.price.toFixed(2)} ${cur}` : "—"}
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(mkt?.ytd_pct ?? null)}`}>
                          {fmtPct(mkt?.ytd_pct ?? null)}
                        </td>
                        <td className="px-2 py-1.5">
                          {w52Bar({ price: mkt?.price ?? null, w52_low: mkt?.w52_low ?? null, w52_high: mkt?.w52_high ?? null })}
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-300">
                          {fmtB(mkt?.mktcap ?? null, cur)}
                        </td>
                        {/* Valuation */}
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-300">
                          {fmtNum(mkt?.pe ?? null)}x
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-300">
                          {fmtNum(mkt?.forward_pe ?? null)}x
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-300">
                          {fmtNum(mkt?.ev_ebitda ?? null)}x
                        </td>
                        {/* Financials — latest annual period */}
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-200">
                          <div>{fmtB(fi?.revenue ?? null, cur)}</div>
                          <div className="text-[9px] text-slate-500">{periodEnd}</div>
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(fi?.revenue_yoy ?? null)}`}>
                          {fmtPct(fi?.revenue_yoy ?? null)}
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-200">
                          <div>{fmtB(fi?.cogs ?? null, cur)}</div>
                          <div className="text-[9px] text-slate-500">{periodEnd}</div>
                        </td>
                        {/* COGS YoY — inverted: higher COGS is bad (red), lower is good (green) */}
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${fi?.cogs_yoy != null ? (fi.cogs_yoy <= 0 ? "text-emerald-400" : "text-red-400") : "text-slate-500"}`}>
                          {fmtPct(fi?.cogs_yoy ?? null)}
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap font-mono text-slate-200">
                          {fmtB(fi?.gross_profit ?? null, cur)}
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(fi?.gross_profit_yoy ?? null)}`}>
                          {fmtPct(fi?.gross_profit_yoy ?? null)}
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(fi?.net_income ?? null)}`}>
                          {fmtB(fi?.net_income ?? null, cur)}
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(fi?.net_income_yoy ?? null)}`}>
                          {fmtPct(fi?.net_income_yoy ?? null)}
                        </td>
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${(fi?.net_debt ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {fmtB(fi?.net_debt ?? null, cur)}
                        </td>
                        {/* Earnings */}
                        <td className={`text-right px-2 py-1.5 whitespace-nowrap font-mono ${pctColor(surprise)}`}>
                          <div>{fmtPct(surprise)}</div>
                          <div className="text-[9px] text-slate-500">{surpriseDate}</div>
                        </td>
                        <td className="text-right px-2 py-1.5 whitespace-nowrap text-amber-300 font-mono">
                          {nextEd}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${co.ticker}-spark`} className="bg-slate-900/60 border-b border-slate-800">
                          <td colSpan={19} className="px-2">
                            <div className="text-[10px] text-slate-400 mt-1 mb-0.5 uppercase tracking-wide">
                              Last {co.financials?.length ?? 0} {co.frequency === "quarterly" ? "quarters" : "years"} — revenue (bars, left) · net income (line, right)
                            </div>
                            <FinancialSparkline company={co} />
                          </td>
                        </tr>
                      )}
                      </>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
