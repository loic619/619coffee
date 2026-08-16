"use client";
/**
 * SentimentCalibration — does the net news-sentiment index actually lead price?
 *
 * Reads quant_report.json → sentiment_calibration (computed server-side, which
 * pairs each day's net index with the realized KC/RC forward return). Shows, per
 * market: directional hit rate, correlation, mean forward return on bullish vs
 * bearish days, and a scatter of net index (x) vs forward return (y) — points in
 * the agreement quadrants (signal matched the move) are green, misses red.
 *
 * Until enough paired days accrue it shows an honest warm-up state.
 */
import { useEffect, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface CalPoint { date: string; net: number; ret: number; }
interface CalMarket {
  label: string; n: number; n_directional: number;
  hit_rate: number | null; corr: number | null;
  mean_ret_bull: number | null; mean_ret_bear: number | null;
  points: CalPoint[];
}
interface Calibration {
  available?: boolean; warmup?: boolean; reason?: string;
  n?: number; min_sample?: number; horizon_days?: number; neutral_band?: number;
  markets?: Record<string, CalMarket>;
}

const fmtPct = (v: number | null, signed = false) =>
  v == null ? "—" : `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-slate-950/60 rounded p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold font-mono ${tone ?? "text-slate-200"}`}>{value}</div>
    </div>
  );
}

export default function SentimentCalibration() {
  const [cal, setCal] = useState<Calibration | null>(null);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("arabica");

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCal(j?.sentiment_calibration ?? { available: false, warmup: true }))
      .catch(() => setCal({ available: false, reason: "fetch failed" }));
  }, []);

  if (cal === null) {
    return <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 text-[11px] text-slate-600 animate-pulse">Loading calibration…</div>;
  }

  const horizon = cal.horizon_days ?? 5;

  if (!cal.available) {
    const have = cal.n ?? 0;
    const need = cal.min_sample ?? 8;
    return (
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 space-y-2">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Signal Calibration</div>
        <div className="text-[11px] text-slate-400">
          Validates the net sentiment index against realized {horizon}-day KC/RC futures moves —
          hit rate, correlation and forward returns.
        </div>
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-600 rounded-full" style={{ width: `${Math.min(100, have / need * 100)}%` }} />
          </div>
          <span className="text-[10px] font-mono text-slate-500">{have}/{need} paired days</span>
        </div>
        <div className="text-[10px] text-slate-600">
          Accumulating — one paired day is added per scraper run. Calibration appears once {need} days
          (~{Math.ceil((need - have) * 1)} more) of forward returns exist.
        </div>
      </div>
    );
  }

  const m = cal.markets?.[mkt];
  const points = (m?.points ?? []).map((p) => ({ ...p, agree: (p.net > 0) === (p.ret > 0) && Math.abs(p.net) >= (cal.neutral_band ?? 8) }));
  const agree = points.filter((p) => p.agree);
  const miss = points.filter((p) => !p.agree);
  const hitTone = m?.hit_rate == null ? "text-slate-300" : m.hit_rate >= 55 ? "text-emerald-400" : m.hit_rate <= 45 ? "text-red-400" : "text-slate-300";
  const corrTone = m?.corr == null ? "text-slate-300" : m.corr > 0.15 ? "text-emerald-400" : m.corr < -0.15 ? "text-red-400" : "text-slate-300";

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Signal Calibration · {horizon}-day forward move
        </div>
        <div className="flex items-center rounded-md border border-slate-700 overflow-hidden">
          {(["arabica", "robusta"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setMkt(k)}
              className={`px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                mkt === k ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {k === "arabica" ? "KC" : "RC"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Hit rate" value={m?.hit_rate == null ? "—" : `${m.hit_rate.toFixed(0)}%`} tone={hitTone} />
        <Stat label="Correlation" value={m?.corr == null ? "—" : m.corr.toFixed(2)} tone={corrTone} />
        <Stat label="Bull → fwd" value={fmtPct(m?.mean_ret_bull ?? null, true)} tone="text-emerald-400" />
        <Stat label="Bear → fwd" value={fmtPct(m?.mean_ret_bear ?? null, true)} tone="text-red-400" />
      </div>

      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="net" name="Net sentiment" domain={[-100, 100]}
                   stroke="#64748b" tick={{ fontSize: 9 }}
                   label={{ value: "Net sentiment →", position: "insideBottom", offset: -2, fontSize: 9, fill: "#64748b" }} />
            <YAxis type="number" dataKey="ret" name="Forward return"
                   stroke="#64748b" tick={{ fontSize: 9 }}
                   tickFormatter={(v) => `${v}%`} />
            <ZAxis range={[40, 40]} />
            <ReferenceLine x={0} stroke="#475569" />
            <ReferenceLine y={0} stroke="#475569" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v, name) => [name === "Forward return" ? `${Number(v)}%` : Number(v), name]}
            />
            <Scatter name="Hit" data={agree} fill="#10b981" fillOpacity={0.8} />
            <Scatter name="Miss" data={miss} fill="#ef4444" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[10px] text-slate-600">
        {m?.n ?? 0} paired days · {m?.n_directional ?? 0} directional calls. Top-right &amp; bottom-left
        quadrants (green) = the index agreed with the subsequent move. Self-reported confidence is
        only as good as this hit rate.
      </div>
    </div>
  );
}
