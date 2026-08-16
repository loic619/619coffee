"use client";
import type { CotMarketPositions, ProcessedCotRow } from "@/lib/cot/types";
import { HM_CAT_COLORS } from "./constants";
import SectionHeader from "./SectionHeader";
import { fmtLotK as fmtLot } from "@/lib/formatters";

type PositionField = keyof CotMarketPositions;
type Mkt = "ny" | "ldn";

// 5-year window (weekly reports). The published cot.json carries ~6y, so this
// is fully backed by real data; shorter histories just clamp.
const WEEKS_5Y = 260;

export default function CotGauges({ data }: { data: ProcessedCotRow[] }) {
  const hist5y = data.slice(-WEEKS_5Y);
  const hist52 = data.slice(-52);
  const curr = hist52[hist52.length - 1];
  const prev = hist52.length >= 2 ? hist52[hist52.length - 2] : null;

  type GRData = {
    label: string; color: string; curr: number; prev: number;
    min5: number; max5: number;   // 5-year range (the bar track)
    min52: number; max52: number; // 52-week range (solid band inside it)
    pct: number;                  // current position within the 5y range
    isSpread?: boolean;
  };

  const mkRow = (market: Mkt, label: string, cat: string, field: PositionField, isSpread?: boolean): GRData => {
    const vals5 = hist5y.map(d => d[market]?.[field] ?? 0);
    const vals52 = hist52.map(d => d[market]?.[field] ?? 0);
    const min5 = Math.min(...vals5), max5 = Math.max(...vals5);
    const cv = curr[market]?.[field] ?? 0;
    const pv = prev?.[market]?.[field] ?? cv;
    return {
      label, color: HM_CAT_COLORS[cat] ?? "#64748b", curr: cv, prev: pv,
      min5, max5, min52: Math.min(...vals52), max52: Math.max(...vals52),
      pct: max5 > min5 ? (cv - min5) / (max5 - min5) * 100 : 50, isSpread,
    };
  };

  const marketRows = (market: Mkt) => ({
    longRows: [
      mkRow(market, "PMPU Long",    "PMPU",      "pmpuLong"),
      mkRow(market, "Swap Long",    "Swap",      "swapLong"),
      mkRow(market, "MM Long",      "MM",        "mmLong"),
      mkRow(market, "Other Long",   "Other Rpt", "otherLong"),
      mkRow(market, "Non-Rep Long", "Non-Rep",   "nonRepLong"),
    ],
    shortRows: [
      mkRow(market, "PMPU Short",    "PMPU",      "pmpuShort"),
      mkRow(market, "Swap Short",    "Swap",      "swapShort"),
      mkRow(market, "MM Short",      "MM",        "mmShort"),
      mkRow(market, "Other Short",   "Other Rpt", "otherShort"),
      mkRow(market, "Non-Rep Short", "Non-Rep",   "nonRepShort"),
    ],
    spreadRows: [
      mkRow(market, "MM Spread",    "MM",        "mmSpread",    true),
      mkRow(market, "Swap Spread",  "Swap",      "swapSpread",  true),
      mkRow(market, "Other Spread", "Other Rpt", "otherSpread", true),
    ],
  });

  const ny  = marketRows("ny");
  const ldn = marketRows("ldn");

  // Bar length is proportional to the row's 5y range SIZE, relative to the
  // widest range in the same market column — a swap-long range of ~5k lots
  // renders ~4x shorter than a PMPU-long range of ~22k, so range magnitudes
  // are comparable at a glance. Small floor keeps tiny rows usable.
  const maxSpanOf = (rows: ReturnType<typeof marketRows>) =>
    Math.max(1, ...[...rows.longRows, ...rows.shortRows, ...rows.spreadRows].map(r => r.max5 - r.min5));
  const MIN_TRACK_PCT = 8;

  const pctColor = (pct: number) => {
    if (pct >= 80) return "#ef4444";
    if (pct >= 60) return "#f97316";
    if (pct <= 20) return "#22c55e";
    if (pct <= 40) return "#84cc16";
    return "#94a3b8";
  };

  const extremes = [
    ...[...ny.longRows, ...ny.shortRows].map(r => ({ ...r, mkt: "NY" })),
    ...[...ldn.longRows, ...ldn.shortRows].map(r => ({ ...r, mkt: "LDN" })),
  ].filter(r => r.pct >= 80 || r.pct <= 20);

  const renderGauge = (r: GRData, maxSpan: number) => {
    const span5 = r.max5 - r.min5;
    const trackPct = Math.max(MIN_TRACK_PCT, (span5 / maxSpan) * 100);
    const pos = (v: number) => span5 > 0 ? Math.max(0, Math.min(100, (v - r.min5) / span5 * 100)) : 50;
    const pct = pos(r.curr);
    const prevPct = pos(r.prev);
    // 52-week range band inside the 5y track
    const band52L = pos(r.min52);
    const band52W = Math.max(1.5, pos(r.max52) - band52L);
    const delta = r.curr - r.prev;
    // Dot: green when the current week added vs last week, red when it cut.
    const dotColor = delta > 0 ? "#22c55e" : delta < 0 ? "#ef4444" : "#94a3b8";
    return (
      <div key={r.label} style={{ marginBottom: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1, alignItems: "baseline", flexWrap: "wrap", columnGap: 4 }}>
          <span style={{ fontSize: 10, color: r.color, fontWeight: 600, whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            <span style={{ color: "#475569" }}>{fmtLot(r.curr)}</span>
            <span style={{ color: r.isSpread ? "#a78bfa" : pctColor(pct), fontWeight: 600 }}>{Math.round(pct)}th</span>
            <span style={{ color: delta >= 0 ? "#22c55e" : "#ef4444", fontSize: 8 }}>
              {delta >= 0 ? "▲" : "▼"} {fmtLot(Math.abs(delta))}
            </span>
          </span>
        </div>
        {/* Track width ∝ 5y range size (vs the widest range in this market) */}
        <div style={{ width: `${trackPct}%` }}>
          <div style={{ position: "relative", height: 9, background: "rgba(59,130,246,0.12)", borderRadius: 5, border: "1px solid #1e293b" }}
            title={`5y: ${fmtLot(r.min5)}–${fmtLot(r.max5)} · 52w: ${fmtLot(r.min52)}–${fmtLot(r.max52)}`}>
            {/* 52-week range — solid blue band inside the faded 5y track */}
            <div style={{ position: "absolute", left: `${band52L}%`, top: 0, height: "100%", width: `${band52W}%`, background: "rgba(59,130,246,0.45)", borderRadius: 4 }} />
            {/* previous week — blue tick */}
            <div style={{ position: "absolute", top: 1, left: `calc(${prevPct}% - 1px)`, width: 2, height: 7, background: "#60a5fa", borderRadius: 1 }} title={`Prev: ${fmtLot(r.prev)}`} />
            {/* current week — green (added) / red (reduced) dot */}
            <div style={{ position: "absolute", top: 0, left: `calc(${pct}% - 4px)`, width: 9, height: 9, background: dotColor, borderRadius: "50%", border: "2px solid #0f172a", boxShadow: `0 0 4px ${dotColor}80` }}
              title={`Current: ${fmtLot(r.curr)} (${delta >= 0 ? "+" : ""}${fmtLot(delta)})`} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1 }}>
            <span style={{ fontSize: 8, color: "#334155" }}>{fmtLot(r.min5)}</span>
            <span style={{ fontSize: 8, color: "#334155" }}>{fmtLot(r.max5)}</span>
          </div>
        </div>
      </div>
    );
  };

  const subHead = (t: string) => (
    <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">{t}</div>
  );

  const marketColumn = (title: string, rows: ReturnType<typeof marketRows>) => {
    const maxSpan = maxSpanOf(rows);
    return (
      <div style={{ minWidth: 0 }}>
        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 pb-1.5 border-b border-slate-800 truncate">{title}</div>
        {subHead("Longs")}
        {rows.longRows.map(r => renderGauge(r, maxSpan))}
        {subHead("Shorts")}
        {rows.shortRows.map(r => renderGauge(r, maxSpan))}
        <div style={{ borderTop: "1px dashed #334155", marginTop: 8, paddingTop: 6 }}>
          {subHead("Spreading positions")}
          {rows.spreadRows.map(r => renderGauge(r, maxSpan))}
        </div>
      </div>
    );
  };

  return (
    <>
      <SectionHeader icon="Sliders" title="Positioning Gauges"
        subtitle="Faded blue = 5-year range · solid blue band = 52-week range · blue tick = previous week · dot = current week (green = added vs last week, red = reduced). Bar length ∝ range size within each market. Percentile is within the 5-year range." />
      {extremes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 mb-4 flex flex-wrap gap-3">
          <span className="text-[10px] text-slate-500 font-semibold self-center uppercase tracking-wider">Extremes (5y):</span>
          {extremes.map(r => (
            <span key={`${r.mkt}-${r.label}`} style={{ fontSize: 11, color: pctColor(r.pct) }}>
              {r.mkt} {r.label} {Math.round(r.pct)}th
            </span>
          ))}
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        {/* Always two equal columns — Arabica left, Robusta right — on every
            breakpoint (grid-cols-2 = repeat(2, minmax(0,1fr)), truly equal). */}
        <div className="grid grid-cols-2 gap-x-3 sm:gap-x-6">
          {marketColumn("Arabica · NY", ny)}
          {marketColumn("Robusta · LDN", ldn)}
        </div>
      </div>
    </>
  );
}
