"use client";
import { useState } from "react";
import type { CotMarketPositions, ProcessedCotRow } from "@/lib/cot/types";
import { HM_CAT_COLORS } from "./constants";
import SectionHeader from "./SectionHeader";

type PositionField = keyof CotMarketPositions;

export default function CotHeatmap({ data }: { data: ProcessedCotRow[] }) {
  const [mode, setMode] = useState<"net" | "long" | "short">("net");
  const weeks13 = data.slice(-13);
  const n = weeks13.length;

  const lsFields: { label: string; lf: PositionField; sf: PositionField }[] = [
    { label: "PMPU",      lf: "pmpuLong",   sf: "pmpuShort"   },
    { label: "Swap",      lf: "swapLong",   sf: "swapShort"   },
    { label: "MM",        lf: "mmLong",     sf: "mmShort"     },
    { label: "Other Rpt", lf: "otherLong",  sf: "otherShort"  },
    { label: "Non-Rep",   lf: "nonRepLong", sf: "nonRepShort" },
  ];
  const spreadFields: { label: string; key: PositionField; color: string }[] = [
    { label: "MM Spr",    key: "mmSpread",    color: "#a78bfa" },
    { label: "Swap Spr",  key: "swapSpread",  color: "#34d399" },
    { label: "Other Spr", key: "otherSpread", color: "#67e8f9" },
  ];

  const gv = (d: ProcessedCotRow, field: PositionField, mkt: "ny" | "ldn") => d[mkt]?.[field] ?? 0;

  const cellBg = (val: number, min: number, max: number, isSpread: boolean): string => {
    if (max === min) return "#1e293b";
    if (isSpread) {
      const t = (val - min) / (max - min);
      return `rgba(167,139,250,${(0.12 + t * 0.65).toFixed(2)})`;
    }
    if (mode === "net") {
      const range = Math.max(Math.abs(min), Math.abs(max));
      if (!range) return "#1e293b";
      const t = val / range;
      return t >= 0
        ? `rgba(34,197,94,${(0.1 + t * 0.6).toFixed(2)})`
        : `rgba(239,68,68,${(0.1 + (-t) * 0.6).toFixed(2)})`;
    }
    const t = (val - min) / (max - min);
    return `rgba(99,102,241,${(0.1 + t * 0.65).toFixed(2)})`;
  };

  const renderCells = (vals: number[], isSpread: boolean) => {
    const min = Math.min(...vals), max = Math.max(...vals);
    return (
      // minmax(0, 1fr): plain `1fr` means minmax(auto, 1fr), so wide cell text
      // ("294k") forces content-based minimum widths — cells end up unequal and
      // rows misalign against each other (worst on phones). Zero-min makes
      // every column truly equal; overflow:hidden keeps text inside its cell.
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 2 }}>
        {vals.map((val, wi) => {
          const isLast  = wi === n - 1;
          const range   = isSpread ? (max - min) : mode === "net" ? Math.max(Math.abs(min), Math.abs(max)) : (max - min);
          const intensity = range > 0
            ? (isSpread ? (val - min) / range : mode === "net" ? Math.abs(val) / range : (val - min) / range)
            : 0;
          return (
            <div key={wi}
              title={`${weeks13[wi].date}: ${Math.round(val).toLocaleString()} lots`}
              style={{
                background: cellBg(val, min, max, isSpread),
                borderRadius: 3, height: 30,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9,
                color: intensity > 0.4 ? "rgba(255,255,255,0.9)" : "#475569",
                fontWeight: isLast ? 700 : 400,
                outline: isLast ? "2px solid #6366f1" : "none",
                outlineOffset: "-1px",
                overflow: "hidden", minWidth: 0, whiteSpace: "nowrap",
              }}>
              {Math.abs(val) >= 1000 ? (Math.abs(val) / 1000).toFixed(0) + "k" : Math.round(val)}
            </div>
          );
        })}
      </div>
    );
  };

  // Build row values for each market
  const nyLsRows = lsFields.map(f => ({
    label: f.label,
    color: HM_CAT_COLORS[f.label] ?? "#64748b",
    vals: weeks13.map(d =>
      mode === "long"  ? gv(d, f.lf, "ny") :
      mode === "short" ? gv(d, f.sf, "ny") :
      gv(d, f.lf, "ny") - gv(d, f.sf, "ny")
    ),
  }));
  const ldnLsRows = lsFields.map(f => ({
    label: f.label,
    color: HM_CAT_COLORS[f.label] ?? "#64748b",
    vals: weeks13.map(d =>
      mode === "long"  ? gv(d, f.lf, "ldn") :
      mode === "short" ? gv(d, f.sf, "ldn") :
      gv(d, f.lf, "ldn") - gv(d, f.sf, "ldn")
    ),
  }));
  const nySpreadRows  = spreadFields.map(f => ({ label: f.label, color: f.color, vals: weeks13.map(d => gv(d, f.key, "ny"))  }));
  const ldnSpreadRows = spreadFields.map(f => ({ label: f.label, color: f.color, vals: weeks13.map(d => gv(d, f.key, "ldn")) }));

  const dateRow = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 2 }}>
      {weeks13.map((d, i) => (
        <div key={i} style={{ fontSize: 9, color: i === n - 1 ? "#a5b4fc" : "#475569", textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", minWidth: 0 }}>
          {d.date.slice(5)}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <SectionHeader icon="Grid" title="13-Week Positioning Heatmap"
        subtitle="Weekly position levels by category. Color intensity = level within 13-week range. Purple outline = latest week." />

      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(["net", "long", "short"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${mode === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {m === "net" ? "Net" : m === "long" ? "Longs" : "Shorts"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
        {/* min-width so phones scroll this block horizontally instead of
            crushing 2×13 cells into ~7px slivers; desktop is unaffected. */}
        <div style={{ minWidth: 640 }}>
        {/* Market column headers + date rows */}
        <div className="flex gap-2 mb-1">
          <div style={{ width: 72 }} />
          <div className="flex-1 text-[9px] text-blue-400 font-semibold text-center">KC · Arabica</div>
          <div style={{ width: 9 }} />
          <div className="flex-1 text-[9px] text-violet-400 font-semibold text-center">RC · Robusta</div>
        </div>
        <div className="flex gap-2 mb-2">
          <div style={{ width: 72 }} />
          <div className="flex-1">{dateRow}</div>
          <div style={{ width: 9 }} />
          <div className="flex-1">{dateRow}</div>
        </div>

        {/* Net / Long / Short rows */}
        <div className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-1">
          {mode === "net" ? "Net (L − S)" : mode === "long" ? "Longs" : "Shorts"}
        </div>
        {lsFields.map((f, idx) => (
          <div key={f.label} className="flex gap-2" style={{ marginBottom: 2 }}>
            <div style={{ width: 72, fontSize: 10, color: nyLsRows[idx].color, fontWeight: 600, height: 30, display: "flex", alignItems: "center" }}>
              {f.label}
            </div>
            <div className="flex-1">{renderCells(nyLsRows[idx].vals,  false)}</div>
            <div style={{ width: 1, background: "#334155", margin: "0 4px" }} />
            <div className="flex-1">{renderCells(ldnLsRows[idx].vals, false)}</div>
          </div>
        ))}

        {/* Spread rows */}
        <div style={{ borderTop: "1px dashed #334155", margin: "10px 0 6px" }} />
        <div className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-1">Spreading</div>
        {spreadFields.map((f, idx) => (
          <div key={f.label} className="flex gap-2" style={{ marginBottom: 2 }}>
            <div style={{ width: 72, fontSize: 10, color: f.color, fontWeight: 600, height: 30, display: "flex", alignItems: "center" }}>
              {f.label}
            </div>
            <div className="flex-1">{renderCells(nySpreadRows[idx].vals,  true)}</div>
            <div style={{ width: 1, background: "#334155", margin: "0 4px" }} />
            <div className="flex-1">{renderCells(ldnSpreadRows[idx].vals, true)}</div>
          </div>
        ))}

        <div className="text-[9px] text-slate-700 mt-2">Hover for exact lots · Colors normalized per row · Purple = latest week</div>
        </div>
      </div>
    </>
  );
}
