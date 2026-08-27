"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

import { fmtDateLabel } from "@/lib/formatters";

// US Treasury par yield curve, published by Treasury itself (no vendor in the
// path). Coffee's interest is the dollar channel: the front end of the curve
// drives USD, USD reprices every producer currency in the CCI, and that feeds
// the arabica/robusta complex. The slope matters more than the level for risk
// appetite across commodities, so 2s10s is given equal billing.

interface Session { date: string; yields: Record<string, number>; }
interface Curve {
  scraped_at: string;
  source: string;
  unit: string;
  tenor_order: string[];
  latest: {
    date: string;
    yields: Record<string, number>;
    spread_2s10s: number | null;
    spread_3m10y: number | null;
  };
  history: Session[];
}

const TENOR_LABEL: Record<string, string> = {
  "1m": "1M", "2m": "2M", "3m": "3M", "4m": "4M", "6m": "6M",
  "1y": "1Y", "2y": "2Y", "3y": "3Y", "5y": "5Y", "7y": "7Y",
  "10y": "10Y", "20y": "20Y", "30y": "30Y",
};

type Window = "3M" | "6M" | "1Y" | "MAX";
const WINDOW_DAYS: Record<Window, number> = { "3M": 63, "6M": 126, "1Y": 252, MAX: 10_000 };

function bpChange(now?: number, prev?: number): { text: string; cls: string } {
  if (now == null || prev == null) return { text: "—", cls: "text-slate-500" };
  const bp = Math.round((now - prev) * 100);
  if (bp === 0) return { text: "0bp", cls: "text-slate-400" };
  // Higher yields = tighter policy = dollar-positive = a headwind for origins,
  // so rising is coloured as the adverse direction, matching the freight panel.
  return {
    text: `${bp > 0 ? "+" : ""}${bp}bp`,
    cls: bp > 0 ? "text-red-400" : "text-emerald-400",
  };
}

function CurveLine({ curve, tenors }: { curve: Record<string, number>; tenors: string[] }) {
  const pts = tenors.map((t) => curve[t]).filter((v): v is number => v != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const W = 260, H = 48;
  const path = pts
    .map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
    </svg>
  );
}

function YieldHistory({ history }: { history: Session[] }) {
  // The 10Y is the default because it is the discount rate the rest of the
  // complex is priced off, but every tenor in the file is selectable — they all
  // come down the same feed, so offering only one would be throwing data away.
  const [tenor, setTenor] = useState("10y");
  const [win, setWin] = useState<Window>("1Y");

  const available = useMemo(() => {
    const seen = new Set<string>();
    for (const s of history) for (const t of Object.keys(s.yields)) seen.add(t);
    return ["2y", "5y", "10y", "30y"].filter((t) => seen.has(t));
  }, [history]);

  const series = useMemo(() => {
    const rows = history.slice(-WINDOW_DAYS[win]);
    return rows
      .filter((r) => r.yields[tenor] != null)
      .map((r) => ({ date: r.date, label: fmtDateLabel(r.date), y: r.yields[tenor] }));
  }, [history, tenor, win]);

  if (series.length < 2) return null;

  const first = series[0].y;
  const last = series[series.length - 1].y;
  const bp = Math.round((last - first) * 100);

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {TENOR_LABEL[tenor] ?? tenor} history
          </span>
          <span className="font-mono text-slate-100">{last.toFixed(2)}%</span>
          <span className={`text-[10px] font-mono ${bp > 0 ? "text-red-400" : bp < 0 ? "text-emerald-400" : "text-slate-400"}`}>
            {bp > 0 ? "+" : ""}{bp}bp over {win === "MAX" ? "the full series" : win}
          </span>
        </div>
        <div className="flex gap-1">
          {available.map((t) => (
            <button key={t} onClick={() => setTenor(t)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                t === tenor ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
              {TENOR_LABEL[t] ?? t}
            </button>
          ))}
          <span className="w-2" />
          {(Object.keys(WINDOW_DAYS) as Window[]).map((w) => (
            <button key={w} onClick={() => setWin(w)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                w === win ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={24} />
            <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto", "auto"]}
                   tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 11 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v) => [`${Number(v).toFixed(2)}%`, TENOR_LABEL[tenor] ?? tenor]} />
            <ReferenceLine y={first} stroke="#475569" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="y" stroke="#60a5fa" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[9px] text-slate-600">
        Dashed line marks the level at the start of the window. {series.length} sessions shown
        of {history.length} retained.
      </div>
    </div>
  );
}

export default function TreasuryYieldsPanel() {
  const [data, setData] = useState<Curve | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/treasury_yields.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // Prior session for the bp column — the curve moves in basis points a day,
  // so a level with no delta says very little.
  const prev = useMemo(() => {
    if (!data || data.history.length < 2) return null;
    return data.history[data.history.length - 2];
  }, [data]);

  // Keep the heading in the empty states. Without it the section collapses to a
  // single grey sentence between two titled panels and reads as a page glitch
  // rather than as the Treasury block waiting for its first export — which is
  // exactly what it looks like before treasury_yields.json first lands.
  if (error || !data) {
    return (
      <div className="p-4 space-y-1">
        <h2 className="text-lg font-bold text-white">US Treasury Yield Curve</h2>
        <p className={`text-xs text-slate-500 ${error ? "" : "animate-pulse"}`}>
          {error
            ? "Curve unavailable — treasury_yields.json has not been published yet. It is written by the daily static export."
            : "Loading Treasury curve…"}
        </p>
      </div>
    );
  }

  const tenors = data.tenor_order?.length
    ? data.tenor_order
    : Object.keys(data.latest.yields);
  const { spread_2s10s: s210, spread_3m10y: s310 } = data.latest;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">US Treasury Yield Curve</h2>
        <p className="text-xs text-slate-400">
          The rate path the Fed is pricing. Front-end yields drive the dollar, the dollar reprices
          producer currencies in the Coffee Currency Index, and that feeds the arabica/robusta
          complex — so the curve is a coffee input, not just a macro one.
          Source: {data.source} · as-of {data.latest.date}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { label: "2s10s", v: s210, hint: "10Y − 2Y · positive = upward sloping" },
          { label: "3m10y", v: s310, hint: "10Y − 3M · the Fed's preferred recession gauge" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800 rounded-lg border border-slate-700 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{s.label}</div>
            <div className={`text-xl font-mono font-bold ${
              s.v == null ? "text-slate-500" : s.v < 0 ? "text-amber-400" : "text-slate-100"}`}>
              {s.v == null ? "—" : `${s.v > 0 ? "+" : ""}${s.v}bp`}
            </div>
            <div className="text-[9px] text-slate-500">{s.hint}</div>
          </div>
        ))}
        <div className="bg-slate-800 rounded-lg border border-slate-700 px-3 py-2 flex-1 min-w-[220px]">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Curve shape</div>
          <CurveLine curve={data.latest.yields} tenors={tenors} />
        </div>
      </div>

      <YieldHistory history={data.history} />

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-x-auto">
        <table className="w-full text-xs min-w-[420px]">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="px-3 py-2 font-medium">Tenor</th>
              <th className="px-3 py-2 font-medium text-right">Yield</th>
              <th className="px-3 py-2 font-medium text-right">1d</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {tenors.map((t) => {
              const now = data.latest.yields[t];
              const chg = bpChange(now, prev?.yields?.[t]);
              return (
                <tr key={t} className="hover:bg-slate-800/60">
                  <td className="px-3 py-2 text-slate-200">{TENOR_LABEL[t] ?? t.toUpperCase()}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-100">
                    {now == null ? "—" : `${now.toFixed(2)}%`}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${chg.cls}`}>{chg.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-600 italic">
        {data.history.length} sessions retained · par yields, percent per annum
      </div>
    </div>
  );
}
