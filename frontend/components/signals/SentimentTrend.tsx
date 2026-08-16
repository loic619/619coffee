"use client";
/**
 * SentimentTrend — the dedicated visual for the coffee-news sentiment feature.
 *
 * Two parts:
 *  1. A diverging net-sentiment gauge (−100 bearish … +100 bullish), the single
 *     confidence-weighted score for the latest run.
 *  2. A trend area chart of that net index over time (from sentiment_history.json,
 *     appended daily by the quant scraper), green above the zero line, red below.
 *
 * Self-fetches both files; degrades gracefully when history is short or the
 * section is unavailable. Reused on the Signals page and in the report builder.
 */
import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface HistPoint {
  date: string;
  net_index: number;
  overall_sentiment?: string;
  bull?: number; bear?: number; neutral?: number; total?: number;
}
interface Sentiment {
  available?: boolean;
  net_index?: number;
  overall_sentiment?: "Bullish" | "Bearish" | "Neutral";
  overall_confidence?: number;
  bull_count?: number; bear_count?: number; total?: number;
}

const label = (net: number) => (net > 8 ? "Bullish" : net < -8 ? "Bearish" : "Neutral");
const colorFor = (net: number) =>
  net > 8 ? "#10b981" : net < -8 ? "#ef4444" : "#94a3b8";

// Older snapshots predate the net_index field — derive it from counts so the
// trend still plots: confidence isn't stored historically, so fall back to a
// count-based proxy ((bull − bear)/total × 100).
const pointNet = (h: HistPoint) =>
  typeof h.net_index === "number"
    ? h.net_index
    : h.total
    ? Math.round(((h.bull ?? 0) - (h.bear ?? 0)) / h.total * 1000) / 10
    : 0;

export default function SentimentTrend({ compact = false }: { compact?: boolean }) {
  const [sent, setSent] = useState<Sentiment | null>(null);
  const [hist, setHist] = useState<HistPoint[] | null>(null);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSent(j?.sentiment ?? { available: false }))
      .catch(() => setSent({ available: false }));
    fetch("/data/sentiment_history.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setHist(Array.isArray(j) ? j : []))
      .catch(() => setHist([]));
  }, []);

  // Current net index: prefer the stored value, else derive from counts.
  const net =
    sent?.net_index ??
    (sent?.total
      ? Math.round(((sent.bull_count ?? 0) - (sent.bear_count ?? 0)) / sent.total * 1000) / 10
      : 0);
  const lab = label(net);
  const col = colorFor(net);

  const series = (hist ?? []).map((h) => ({ date: h.date.slice(5), net: pointNet(h) }));
  // Gauge needle position: map −100…100 → 0…100%.
  const needlePct = Math.max(0, Math.min(100, (net + 100) / 2));

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Net News-Sentiment Index
        </div>
        <div className="text-[10px] text-slate-500">−100 bearish · +100 bullish</div>
      </div>

      {/* Gauge */}
      <div className="flex items-center gap-4">
        <div className="shrink-0 text-center w-24">
          <div className="text-3xl font-bold font-mono" style={{ color: col }}>
            {net > 0 ? "+" : ""}{net.toFixed(0)}
          </div>
          <div className="text-xs font-semibold" style={{ color: col }}>{lab}</div>
        </div>
        <div className="flex-1">
          <div className="relative h-3 rounded-full overflow-hidden"
               style={{ background: "linear-gradient(90deg,#7f1d1d,#475569 50%,#065f46)" }}>
            <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow"
                 style={{ left: `${needlePct}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 mt-1">
            <span>Bearish</span><span>Neutral</span><span>Bullish</span>
          </div>
        </div>
      </div>

      {/* Trend */}
      <div style={{ height: compact ? 120 : 160 }}>
        {series.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="sentPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={24} />
              <YAxis domain={[-100, 100]} stroke="#64748b" tick={{ fontSize: 9 }} width={32} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(v) => { const n = Number(v); return [`${n > 0 ? "+" : ""}${n}`, "Net index"]; }}
              />
              <Area type="monotone" dataKey="net" stroke={col} strokeWidth={2} fill="url(#sentPos)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-slate-600 text-center px-4">
            Trend builds daily — {series.length} day{series.length === 1 ? "" : "s"} recorded so far.
          </div>
        )}
      </div>
    </div>
  );
}
