"use client";
import type { CotMarketPositions, ProcessedCotRow } from "@/lib/cot/types";
import { HM_CAT_COLORS } from "./constants";
import SectionHeader from "./SectionHeader";
import { fmtLotK as fmtLot } from "@/lib/formatters";

type PositionField = keyof CotMarketPositions;
type Mkt = "ny" | "ldn";

export default function CotGauges({ data }: { data: ProcessedCotRow[] }) {
  const hist52 = data.slice(-52);
  const curr = hist52[hist52.length - 1];
  const prev = hist52.length >= 2 ? hist52[hist52.length - 2] : null;

  type GRData = { label: string; color: string; curr: number; prev: number; min: number; max: number; pct: number; isSpread?: boolean };

  const mkRow = (market: Mkt, label: string, cat: string, field: PositionField, isSpread?: boolean): GRData => {
    const vals = hist52.map(d => d[market]?.[field] ?? 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    const cv = curr[market]?.[field] ?? 0;
    const pv = prev?.[market]?.[field] ?? cv;
    return { label, color: HM_CAT_COLORS[cat] ?? "#64748b", curr: cv, prev: pv, min, max,
      pct: max > min ? (cv - min) / (max - min) * 100 : 50, isSpread };
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

  const renderGauge = (r: GRData) => {
    const pct = Math.max(0, Math.min(100, r.pct));
    const prevPct = r.max > r.min ? Math.max(0, Math.min(100, (r.prev - r.min) / (r.max - r.min) * 100)) : 50;
    const delta = r.curr - r.prev;
    const color = r.isSpread ? "#a78bfa" : pctColor(pct);
    return (
      <div key={r.label} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "baseline" }}>
          <span style={{ fontSize: 11, color: r.color, fontWeight: 600 }}>{r.label}</span>
          <span style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#475569" }}>{fmtLot(r.curr)}</span>
            <span style={{ color, fontWeight: 600 }}>{Math.round(pct)}th</span>
            <span style={{ color: delta >= 0 ? "#22c55e" : "#ef4444", fontSize: 9 }}>
              {delta >= 0 ? "▲" : "▼"} {fmtLot(Math.abs(delta))}
            </span>
          </span>
        </div>
        <div style={{ position: "relative", height: 11, background: "#1e293b", borderRadius: 6 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color, borderRadius: 6, opacity: 0.28 }} />
          <div style={{ position: "absolute", top: 1, left: `calc(${prevPct}% - 1px)`, width: 2, height: 9, background: "#60a5fa", borderRadius: 1, opacity: 0.6 }} title={`Prev: ${fmtLot(r.prev)}`} />
          <div style={{ position: "absolute", top: 0.5, left: `calc(${pct}% - 5px)`, width: 10, height: 10, background: color, borderRadius: "50%", border: "2px solid #0f172a", boxShadow: `0 0 4px ${color}80` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontSize: 9, color: "#334155" }}>{fmtLot(r.min)}</span>
          <span style={{ fontSize: 9, color: "#334155" }}>{fmtLot(r.max)}</span>
        </div>
      </div>
    );
  };

  const subHead = (t: string) => (
    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-3 mt-1">{t}</div>
  );

  const marketColumn = (title: string, rows: ReturnType<typeof marketRows>) => (
    <div>
      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3 pb-2 border-b border-slate-800">{title}</div>
      {subHead("Longs")}
      {rows.longRows.map(renderGauge)}
      {subHead("Shorts")}
      {rows.shortRows.map(renderGauge)}
      <div style={{ borderTop: "1px dashed #334155", marginTop: 12, paddingTop: 10 }}>
        {subHead("Spreading positions")}
        {rows.spreadRows.map(renderGauge)}
      </div>
    </div>
  );

  return (
    <>
      <SectionHeader icon="Sliders" title="52-Week Positioning Gauges"
        subtitle="Current level vs. 52-week range, per market (Arabica left · Robusta right). Longs then shorts. Colored dot = current week, blue tick = previous week. Red ≥80th pct · Green ≤20th." />
      {extremes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 mb-4 flex flex-wrap gap-3">
          <span className="text-[10px] text-slate-500 font-semibold self-center uppercase tracking-wider">Extremes:</span>
          {extremes.map(r => (
            <span key={`${r.mkt}-${r.label}`} style={{ fontSize: 11, color: pctColor(r.pct) }}>
              {r.mkt} {r.label} {Math.round(r.pct)}th
            </span>
          ))}
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:gap-x-8">
          {marketColumn("Arabica · NY", ny)}
          {marketColumn("Robusta · LDN", ldn)}
        </div>
      </div>
    </>
  );
}
