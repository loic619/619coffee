"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  DEST_WINDOWS, EMPTY_CY, GREEN, HUB_COLORS, HUB_ORDER, SLATE,
  TT_STYLE, TYPE_LABELS, TYPE_SERIES,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey, getHub, monthLabel, offsetYM, toEn } from "./helpers";
import type { CoffeeType, CountryYear, DestWindow, ViewMode } from "./types";
import { chgTone } from "@/lib/formatters";

// Stacked type-split series for the Total view (country mode): the four
// coffee types plus an 'Unsplit' remainder so the stack always sums to the
// total (typed data only covers the current + prior crop years; window
// months beyond that land in Unsplit rather than silently vanishing).
const SPLIT_SERIES = [
  ...TYPE_SERIES.map(t => ({ key: `t_${t.key}`, label: t.label, color: t.color })),
  { key: "t_unsplit", label: "Unsplit", color: "#64748b" },
];

// End-of-bar volume label (values are already in thousand tons).
const ktLabel = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n}kt` : "";
};

export default function DestinationChart({
  byCountry, byCountryPrev,
  byArabica, byArabicaPrev,
  byConillon, byConillonPrev,
  bySoluvel, bySoluvelPrev,
  byTorrado, byTorradoPrev,
  byCountryHistory,
  isReportMode = false,
}: {
  byCountry: CountryYear; byCountryPrev: CountryYear;
  byArabica?: CountryYear; byArabicaPrev?: CountryYear;
  byConillon?: CountryYear; byConillonPrev?: CountryYear;
  bySoluvel?: CountryYear; bySoluvelPrev?: CountryYear;
  byTorrado?: CountryYear; byTorradoPrev?: CountryYear;
  byCountryHistory?: Record<string, CountryYear>;
  isReportMode?: boolean;
}) {
  const [mode, setMode]           = useState<ViewMode>("country");
  const [topN, setTopN]           = useState(15);
  const [coffeeType, setCoffeeType] = useState<CoffeeType>("total");
  const [destWindow, setDestWindow] = useState<DestWindow>("CTD");
  const [splitTypes, setSplitTypes] = useState(true);

  // Build a merged flat map: country → ym → vol, across all available data
  const mergedCountries = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const sources: CountryYear[] = [
      ...Object.values(byCountryHistory ?? {}),
      byCountryPrev,
      byCountry,
    ];
    for (const cy of sources) {
      for (const [pt, mv] of Object.entries(cy.countries ?? {})) {
        if (!out[pt]) out[pt] = {};
        for (const [ym, vol] of Object.entries(mv)) {
          out[pt][ym] = (out[pt][ym] ?? 0) + vol;
        }
      }
    }
    return out;
  }, [byCountry, byCountryPrev, byCountryHistory]);

  // All available months (sorted)
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    [...Object.values(byCountryHistory ?? {}), byCountryPrev, byCountry].forEach(cy =>
      (cy.months ?? []).forEach(m => set.add(m))
    );
    return Array.from(set).sort();
  }, [byCountry, byCountryPrev, byCountryHistory]);

  const latestMonth  = allMonths[allMonths.length - 1] ?? "";

  // Determine which months to include for current window
  const windowMonths: string[] = useMemo(() => {
    if (destWindow === "CTD") {
      // Crop-to-date: Apr of current crop year → latest
      const ck = cropYearKey(latestMonth);
      const cropStartYear = parseInt(ck.split("/")[0]);
      const cropStart = `${cropStartYear}-04`;
      return allMonths.filter(m => m >= cropStart && m <= latestMonth);
    }
    const n = DEST_WINDOWS.find(w => w.label === destWindow)!.n!;
    return allMonths.slice(-n);
  }, [destWindow, allMonths, latestMonth]);

  // Prev year comparison: same months offset -12
  const prevWindowMonths: string[] = useMemo(() =>
    windowMonths.map(m => offsetYM(m, 12))
  , [windowMonths]);

  // Determine which source has the type data for prev window months
  const activeData: CountryYear = (() => {
    switch (coffeeType) {
      case "arabica":  return byArabica  ?? EMPTY_CY;
      case "conillon": return byConillon ?? EMPTY_CY;
      case "soluvel":  return bySoluvel  ?? EMPTY_CY;
      case "torrado":  return byTorrado  ?? EMPTY_CY;
      default:         return byCountry;
    }
  })();
  const activePrev: CountryYear = (() => {
    switch (coffeeType) {
      case "arabica":  return byArabicaPrev  ?? EMPTY_CY;
      case "conillon": return byConillonPrev ?? EMPTY_CY;
      case "soluvel":  return bySoluvelPrev  ?? EMPTY_CY;
      case "torrado":  return byTorradoPrev  ?? EMPTY_CY;
      default:         return byCountryPrev;
    }
  })();

  // For type-specific data, we only have current + prev year (no deeper history)
  // Use merged (total) for current window when spanning into history
  const useTyped = coffeeType !== "total";

  // Period labels
  const wFirst = windowMonths[0] ?? "";
  const wLast  = windowMonths[windowMonths.length - 1] ?? "";
  const pwFirst = prevWindowMonths[0] ?? "";
  const pwLast  = prevWindowMonths[prevWindowMonths.length - 1] ?? "";
  const periodLabel = wFirst && wLast
    ? wFirst === wLast ? `${monthLabel(wFirst)} ${wFirst.split("-")[0]}`
      : `${monthLabel(wFirst)} ${wFirst.split("-")[0]}–${monthLabel(wLast)} ${wLast.split("-")[0]}`
    : "";
  const prevPeriodLabel = pwFirst && pwLast
    ? pwFirst === pwLast ? `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}`
      : `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}–${monthLabel(pwLast)} ${pwLast.split("-")[0]}`
    : "";

  // ── Aggregate by country ────────────────────────────────────────────────────
  const countryTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};

    if (useTyped) {
      // Type-specific: use activeData (current year) and activePrev only
      Object.entries(activeData.countries ?? {}).forEach(([c, mv]) => {
        const val = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) out[c] = { current: val, prev: 0 };
      });
      Object.entries(activePrev.countries ?? {}).forEach(([c, mv]) => {
        const val = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) { if (!out[c]) out[c] = { current: 0, prev: 0 }; out[c].prev = val; }
      });
    } else {
      // Total: use merged map spanning all available history
      Object.entries(mergedCountries).forEach(([c, mv]) => {
        const curr = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        const prev = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (curr > 0 || prev > 0) out[c] = { current: curr, prev };
      });
    }
    return out;
  }, [mergedCountries, activeData, activePrev, windowMonths, prevWindowMonths, useTyped]);

  // ── Aggregate by hub ────────────────────────────────────────────────────────
  const hubTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(countryTotals).forEach(([ptCountry, v]) => {
      const hub = getHub(ptCountry);
      if (!out[hub]) out[hub] = { current: 0, prev: 0 };
      out[hub].current += v.current;
      out[hub].prev    += v.prev;
    });
    return out;
  }, [countryTotals]);

  // ── Build chart data ────────────────────────────────────────────────────────
  const countryRows = useMemo(() => {
    // Per-type window sum for one country: current-crop-year data first, the
    // prior crop year covers window months reaching back across the boundary.
    const typedKt = (pt: string, cy?: CountryYear, cyPrev?: CountryYear) =>
      bagsToKT(windowMonths.reduce((s, m) =>
        s + (cy?.countries?.[pt]?.[m] ?? cyPrev?.countries?.[pt]?.[m] ?? 0), 0));

    return Object.entries(countryTotals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([pt, v]) => {
        const en = toEn(pt);
        const current = bagsToKT(v.current);
        const t_arabica  = typedKt(pt, byArabica,  byArabicaPrev);
        const t_conillon = typedKt(pt, byConillon, byConillonPrev);
        const t_soluvel  = typedKt(pt, bySoluvel,  bySoluvelPrev);
        const t_torrado  = typedKt(pt, byTorrado,  byTorradoPrev);
        const t_unsplit  = Math.max(0, Math.round(
          (current - t_arabica - t_conillon - t_soluvel - t_torrado) * 10) / 10);
        return {
          label:      en.length > 20 ? en.slice(0, 19) + "…" : en,
          current,
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: null as number | null,
          t_arabica, t_conillon, t_soluvel, t_torrado, t_unsplit,
        };
      });
  }, [countryTotals, topN, windowMonths, byArabica, byArabicaPrev, byConillon,
      byConillonPrev, bySoluvel, bySoluvelPrev, byTorrado, byTorradoPrev]);

  const hubRows = useMemo(() => {
    const totalCurrent = Object.values(hubTotals).reduce((s, v) => s + v.current, 0);
    const totalPrev    = Object.values(hubTotals).reduce((s, v) => s + v.prev,    0);

    return HUB_ORDER
      .map(hub => {
        const v = hubTotals[hub] ?? { current: 0, prev: 0 };
        const shareCurrent = totalCurrent > 0 ? v.current / totalCurrent * 100 : 0;
        const sharePrev    = totalPrev    > 0 ? v.prev    / totalPrev    * 100 : 0;
        const shareDelta   = Math.round((shareCurrent - sharePrev) * 10) / 10;
        return {
          label:      hub,
          current:    bagsToKT(v.current),
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: totalPrev > 0 ? shareDelta : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current);
  }, [hubTotals]);

  const rows    = mode === "hub" ? hubRows : countryRows;
  const barH    = mode === "hub" ? rows.length * 30 + 40 : topN * 26 + 40;

  // One source of truth for the current-window colour — used by both the bar
  // cells and the tooltip, so hovering always echoes the bar's own colour.
  const barFill = (r: { label: string; pct: number | null }) =>
    mode === "hub"
      ? (HUB_COLORS[r.label] ?? "#475569")
      : r.pct !== null && r.pct < 0 ? "#ef4444" : GREEN;

  // Stacked type split: Total view, country mode, typed data present.
  const canSplit  = coffeeType === "total" && mode === "country"
    && !!(byArabica || byConillon || bySoluvel || byTorrado);
  const showSplit = canSplit && splitTypes;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination</div>
          <div className="text-[10px] text-slate-500">
            {TYPE_LABELS[coffeeType]} · {periodLabel} (green) vs {prevPeriodLabel} (grey) · Thousand metric tons
          </div>
        </div>
        <div className="flex flex-wrap gap-1" style={isReportMode ? { display: "none" } : undefined}>
          {/* Window selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {DEST_WINDOWS.map(w => (
              <button key={w.label} onClick={() => setDestWindow(w.label)}
                className={`text-[10px] px-2 py-0.5 rounded ${destWindow === w.label ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {w.label}
              </button>
            ))}
          </div>
          {/* Coffee type selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(Object.keys(TYPE_LABELS) as CoffeeType[]).map(t => (
              <button key={t} onClick={() => setCoffeeType(t)}
                className={`text-[10px] px-2 py-0.5 rounded ${coffeeType === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {/* View toggle */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(["country", "hub"] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[10px] px-2 py-0.5 rounded capitalize ${mode === m ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {m === "hub" ? "By Hub" : "By Country"}
              </button>
            ))}
          </div>
          {/* Top N (country only) */}
          {mode === "country" && (
            <div className="flex gap-1">
              {[10, 15, 25].map(n => (
                <button key={n} onClick={() => setTopN(n)}
                  className={`text-[10px] px-2 py-0.5 rounded ${topN === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                  Top {n}
                </button>
              ))}
            </div>
          )}
          {/* Type-split toggle (Total × country view only) */}
          {canSplit && (
            <div className="flex gap-1 border border-slate-600 rounded p-0.5">
              {([true, false] as const).map(s => (
                <button key={String(s)} onClick={() => setSplitTypes(s)}
                  title={s ? "Stack the coffee types inside each bar" : "Single bar coloured by YoY direction"}
                  className={`text-[10px] px-2 py-0.5 rounded ${splitTypes === s ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                  {s ? "Split" : "Solid"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={barH}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: mode === "hub" ? 130 : 140 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis type="category" dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 9 }}
            width={mode === "hub" ? 125 : 135} />
          <Tooltip contentStyle={TT_STYLE} itemStyle={{ color: "#94a3b8" }}
            formatter={((v, name, item) => {
              const split = SPLIT_SERIES.find(s => s.key === name);
              if (split) {
                return [
                  <span key="v" style={{ color: split.color }}>{`${v} kt`}</span>,
                  split.label as NameType,
                ];
              }
              const row = (item?.payload ?? {}) as { label: string; pct: number | null };
              const color = name === "current" ? barFill(row) : "#94a3b8";
              return [
                <span key="v" style={{ color }}>{`${v} kt`}</span>,
                (name === "current" ? periodLabel : prevPeriodLabel) as NameType,
              ];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={(v) => {
              const split = SPLIT_SERIES.find(s => s.key === v);
              return (
                <span style={{ color: "#cbd5e1" }}>
                  {split ? split.label : v === "current" ? periodLabel : prevPeriodLabel}
                </span>
              );
            }} />
          <Bar dataKey="prev" name="prev" fill={SLATE} opacity={0.55} />
          {showSplit ? (
            SPLIT_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.key} stackId="cur" fill={s.color}
                radius={i === SPLIT_SERIES.length - 1 ? [0, 3, 3, 0] : undefined}>
                {/* Stack total at the end of the bar — anchored on the last
                    segment so it sits past the full stack. */}
                {i === SPLIT_SERIES.length - 1 && (
                  <LabelList dataKey="current" position="right" formatter={ktLabel}
                    style={{ fill: "#94a3b8", fontSize: 8.5 }} />
                )}
              </Bar>
            ))
          ) : (
            <Bar dataKey="current" name="current" radius={[0, 3, 3, 0]}>
              {rows.map((r, i) => <Cell key={i} fill={barFill(r)} />)}
              <LabelList dataKey="current" position="right" formatter={ktLabel}
                style={{ fill: "#94a3b8", fontSize: 8.5 }} />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* YoY change table */}
      <div className="mt-4 text-[10px]">
        {/* Header */}
        <div className={`grid pb-1 border-b border-slate-700 text-slate-500 font-medium gap-x-6`}
          style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}>
          <span>Destination</span>
          <span className="text-right">YoY vol. (same period)</span>
          {mode === "hub" && <span className="text-right">Share Δpp</span>}
        </div>

        {rows.map(r => {
          const hubRow = r as typeof hubRows[0];
          return (
            <div
              key={r.label}
              className="grid gap-x-6 py-0.5 border-b border-slate-800"
              style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}
            >
              <span className="text-slate-300 truncate">{r.label}</span>
              <span className={`text-right ${
                r.pct === null ? "text-slate-500" : chgTone(r.pct)
              }`}>
                {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
              </span>
              {mode === "hub" && (
                <span className={`text-right ${
                  hubRow.shareDelta === null ? "text-slate-500"
                  : hubRow.shareDelta > 0   ? "text-green-400"
                  : hubRow.shareDelta < 0   ? "text-red-400"
                  : "text-slate-500"
                }`}>
                  {hubRow.shareDelta === null ? "n/a"
                    : `${hubRow.shareDelta > 0 ? "+" : ""}${hubRow.shareDelta}pp`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
