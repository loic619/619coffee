"use client";
import { useEffect, useState } from "react";
import { fmtAgo } from "@/lib/formatters";
import ModelledBadge from "@/components/ModelledBadge";
import SentimentTrend from "./SentimentTrend";
import SentimentCalibration from "./SentimentCalibration";

interface SentimentItem {
  headline: string;
  source: string;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  tags: string[];
}

interface SentimentData {
  available: boolean;
  reason?: string;
  scraped_at?: string;
  overall_sentiment?: "Bullish" | "Bearish" | "Neutral";
  overall_confidence?: number;
  bull_count?: number;
  bear_count?: number;
  neutral_count?: number;
  total?: number;
  items?: SentimentItem[];
}

const SENT_COLOR = {
  Bullish: "text-emerald-400 bg-emerald-950/60 border-emerald-700",
  Bearish: "text-red-400 bg-red-950/60 border-red-700",
  Neutral: "text-slate-400 bg-slate-800/60 border-slate-600",
};
const SENT_BAR = {
  Bullish: "bg-emerald-600",
  Bearish: "bg-red-600",
  Neutral: "bg-slate-600",
};


export default function SentimentSection() {
  const [data, setData] = useState<SentimentData | null>(null);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then(r => r.ok ? r.json() : null)
      .then(j => setData(j?.sentiment ?? { available: false, reason: "No data" }))
      .catch(() => setData({ available: false, reason: "Fetch failed" }));
  }, []);

  const loading = data === null;
  const unavailable = data !== null && !data.available;

  const items    = data?.items ?? [];
  const total    = data?.total ?? 0;
  const bull     = data?.bull_count ?? 0;
  const bear     = data?.bear_count ?? 0;
  const neutral  = data?.neutral_count ?? 0;
  const overall  = data?.overall_sentiment ?? "Neutral";
  const overallConf = data?.overall_confidence ?? 50;

  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded">Section 5</span>
          <h2 className="text-base font-bold text-white">Coffee News Sentiment Analysis</h2>
          {/* A classification, not a price forecast: there is nothing to
              grade it against, so no hit-rate slot — but it is still model
              output and must not read as a measured series. */}
          <ModelledBadge method="NLP classification" />
          <span className="text-[10px] text-slate-500">Google Gemini · NLP classification · Confidence scoring</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          AI classifies recent coffee news headlines into discrete sentiment signals:{" "}
          <span className="text-emerald-400">Bullish</span>,{" "}
          <span className="text-red-400">Bearish</span>, or{" "}
          <span className="text-slate-400">Neutral</span>.
          Confidence reflects model certainty (0–100%).
          {data?.scraped_at && (
            <span className="text-slate-600 ml-2">{fmtAgo(data.scraped_at)}</span>
          )}
        </p>
      </div>

      {/* Dedicated visuals — net-sentiment gauge + daily trend, and the
          calibration of that signal against realized KC/RC moves. Both
          self-fetch, so they render independently of the headline cards. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SentimentTrend />
        <SentimentCalibration />
      </div>

      {loading && (
        <div className="text-xs text-slate-500 animate-pulse py-8 text-center">Loading sentiment data…</div>
      )}

      {unavailable && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center space-y-2">
          <div className="text-sm text-slate-400">Sentiment analysis not yet available</div>
          <div className="text-[10px] text-slate-600">{data?.reason}</div>
          <div className="text-[10px] text-slate-600 mt-1">
            Add <code className="text-slate-400">GEMINI_API_KEY</code> to GitHub Actions secrets to enable.
          </div>
        </div>
      )}

      {!loading && !unavailable && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* Aggregate panel */}
          <div className="xl:col-span-1 space-y-3">
            <div className="bg-slate-900 rounded-lg p-4 text-center space-y-2">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Overall Sentiment</div>
              <div className={`text-2xl font-bold ${SENT_COLOR[overall].split(" ")[0]}`}>{overall}</div>
              <div className="text-xs text-slate-400">Confidence</div>
              <div className="text-3xl font-bold font-mono text-white">{overallConf.toFixed(1)}%</div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-2 rounded-full ${SENT_BAR[overall]}`} style={{ width: `${overallConf}%` }} />
              </div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Distribution ({total} headlines)</div>
              {(["Bullish", "Bearish", "Neutral"] as const).map(s => {
                const count = s === "Bullish" ? bull : s === "Bearish" ? bear : neutral;
                const pct   = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={s} className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className={`text-[11px] ${SENT_COLOR[s].split(" ")[0]}`}>{s}</span>
                      <span className="text-[11px] font-mono text-slate-400">{count}/{total}</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full">
                      <div className={`h-1.5 rounded-full ${SENT_BAR[s]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-slate-900 rounded-lg p-4 space-y-1.5">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Methodology</div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Recent coffee <em>news</em> headlines (editorial feeds only — data snapshots excluded)
                scored by Google Gemini via a single structured prompt.
                Confidence reflects the model&apos;s self-reported certainty per headline.
                Overall signal uses a confidence-weighted majority vote; the net index is
                confidence-weighted bullish minus bearish pressure.
              </p>
              <div className="pt-1 space-y-1 font-mono text-[10px] text-slate-500">
                <div>P(Bullish | headline)</div>
                <div>P(Bearish | headline)</div>
                <div>P(Neutral | headline)</div>
                <div className="text-slate-600">Model: gemini-2.5-flash</div>
              </div>
            </div>
          </div>

          {/* News cards */}
          <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((item, idx) => (
              <div key={idx} className="bg-slate-900 rounded-lg p-3 space-y-2 border border-slate-800 hover:border-slate-700 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-200 leading-tight">{item.headline}</span>
                  <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-bold ${SENT_COLOR[item.sentiment]}`}>
                    {item.sentiment}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">{tag}</span>
                    ))}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[9px] text-slate-500">{item.source}</div>
                    <div className="text-[10px] font-mono font-bold text-white">{item.confidence.toFixed(1)}%</div>
                    <div className="w-16 h-1 bg-slate-700 rounded-full mt-0.5 ml-auto">
                      <div className={`h-1 rounded-full ${SENT_BAR[item.sentiment]}`} style={{ width: `${item.confidence}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
