"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  AMBER, DEST_WINDOWS, EMPTY_CY, GREEN, HUB_COLORS, HUB_ORDER, ISLAND_COLORS, ISLAND_ORDER,
  SLATE, TT_STYLE, TYPE_LABELS,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey, getHub, getIsland, kgToKT, monthLabel, offsetYM } from "./helpers";
import type { CountryYear, DestWindow, SeriesKey, ViewMode } from "./types";
import { chgTone } from "@/lib/formatters";

// Stacked species split for the Total view (destination × country mode).
// BPS gives species-level HS codes only, so the stack is arabica / robusta
// plus an 'Other / unsplit' remainder (decaf, roasted, husks, and the
// pre-Apr-2022 lumped code) that keeps the stack summing to the total.
// End-of-bar volume label (values are already in thousand tons).
const ktLabel = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n}kt` : "";
};

const SPLIT_SERIES = [
  { key: "t_arabica", label: "Arabica",          color: GREEN },
  { key: "t_robusta", label: "Robusta",          color: AMBER },
  { key: "t_other",   label: "Other / unsplit",  color: "#64748b" },
];

/** Mode-axis options:
 *    DEST_MODE: which side of the trade lane to view — destination
 *      country vs origin port. Brazil only has destinations; Indonesia's
 *      BPS payload gives both, so the toggle lives here.
 *    GROUPING:  per-leaf (country / port) vs rolled-up region (hub for
 *      destinations, island cluster for ports).
 */
type DestMode = "destination" | "port";
type DestType = "total" | "arabica" | "robusta";

export default function DestinationChart({
  byCountry, byCountryPrev,
  byCountryArabica, byCountryArabicaPrev,
  byCountryRobusta, byCountryRobustaPrev,
  byCountryHistory,
  byPort, byPortPrev, byPortHistory,
  isReportMode = false,
}: {
  byCountry: CountryYear; byCountryPrev: CountryYear;
  byCountryArabica?: CountryYear; byCountryArabicaPrev?: CountryYear;
  byCountryRobusta?: CountryYear; byCountryRobustaPrev?: CountryYear;
  byCountryHistory?: Record<string, CountryYear>;
  byPort: CountryYear; byPortPrev: CountryYear;
  byPortHistory?: Record<string, CountryYear>;
  isReportMode?: boolean;
}) {
  const [destMode, setDestMode] = useState<DestMode>("destination");
  const [view, setView]         = useState<ViewMode>("country");
  const [topN, setTopN]         = useState(15);
  const [coffeeType, setCoffeeType] = useState<DestType>("total");
  const [destWindow, setDestWindow] = useState<DestWindow>("CTD");
  const [splitTypes, setSplitTypes] = useState(true);

  // Per-mode source tables. The "port" side has only totals (BPS doesn't
  // ship per-type port breakdowns), so the type selector disables itself.
  const sourceCurrent = destMode === "port" ? byPort         : byCountry;
  const sourcePrev    = destMode === "port" ? byPortPrev     : byCountryPrev;
  const sourceHistory = destMode === "port" ? byPortHistory  : byCountryHistory;

  // Build a merged flat map: key → ym → kg, across all available history.
  const merged = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const sources: CountryYear[] = [
      ...Object.values(sourceHistory ?? {}),
      sourcePrev,
      sourceCurrent,
    ];
    for (const cy of sources) {
      for (const [k, mv] of Object.entries(cy.countries ?? {})) {
        if (!out[k]) out[k] = {};
        for (const [ym, vol] of Object.entries(mv)) {
          out[k][ym] = (out[k][ym] ?? 0) + vol;
        }
      }
    }
    return out;
  }, [sourceCurrent, sourcePrev, sourceHistory]);

  // All available months (sorted).
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    [...Object.values(sourceHistory ?? {}), sourcePrev, sourceCurrent]
      .forEach(cy => (cy.months ?? []).forEach(m => set.add(m)));
    return Array.from(set).sort();
  }, [sourceCurrent, sourcePrev, sourceHistory]);

  const latestMonth = allMonths[allMonths.length - 1] ?? "";

  // Months in the current window.
  const windowMonths: string[] = useMemo(() => {
    if (destWindow === "CTD") {
      const ck = cropYearKey(latestMonth);
      const cropStartYear = parseInt(ck.split("/")[0]);
      const cropStart = `${cropStartYear}-04`;
      return allMonths.filter(m => m >= cropStart && m <= latestMonth);
    }
    const n = DEST_WINDOWS.find(w => w.label === destWindow)!.n!;
    return allMonths.slice(-n);
  }, [destWindow, allMonths, latestMonth]);

  // Prev-year comparison window.
  const prevWindowMonths: string[] = useMemo(
    () => windowMonths.map(m => offsetYM(m, 12)),
    [windowMonths],
  );

  // Type-specific sources only exist on the destination side.
  const activeData: CountryYear = (() => {
    if (destMode !== "destination") return sourceCurrent;
    if (coffeeType === "arabica") return byCountryArabica ?? EMPTY_CY;
    if (coffeeType === "robusta") return byCountryRobusta ?? EMPTY_CY;
    return byCountry;
  })();
  const activePrev: CountryYear = (() => {
    if (destMode !== "destination") return sourcePrev;
    if (coffeeType === "arabica") return byCountryArabicaPrev ?? EMPTY_CY;
    if (coffeeType === "robusta") return byCountryRobustaPrev ?? EMPTY_CY;
    return byCountryPrev;
  })();

  const useTyped = destMode === "destination" && coffeeType !== "total";

  // Period labels.
  const wFirst   = windowMonths[0] ?? "";
  const wLast    = windowMonths[windowMonths.length - 1] ?? "";
  const pwFirst  = prevWindowMonths[0] ?? "";
  const pwLast   = prevWindowMonths[prevWindowMonths.length - 1] ?? "";
  const periodLabel = wFirst && wLast
    ? wFirst === wLast ? `${monthLabel(wFirst)} ${wFirst.split("-")[0]}`
      : `${monthLabel(wFirst)} ${wFirst.split("-")[0]}–${monthLabel(wLast)} ${wLast.split("-")[0]}`
    : "";
  const prevPeriodLabel = pwFirst && pwLast
    ? pwFirst === pwLast ? `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}`
      : `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}–${monthLabel(pwLast)} ${pwLast.split("-")[0]}`
    : "";

  // ── Aggregate by leaf (country or port) ────────────────────────────────────
  const leafTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    if (useTyped) {
      Object.entries(activeData.countries ?? {}).forEach(([k, mv]) => {
        const val = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) out[k] = { current: val, prev: 0 };
      });
      Object.entries(activePrev.countries ?? {}).forEach(([k, mv]) => {
        const val = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) { if (!out[k]) out[k] = { current: 0, prev: 0 }; out[k].prev = val; }
      });
    } else {
      Object.entries(merged).forEach(([k, mv]) => {
        const curr = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        const prev = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (curr > 0 || prev > 0) out[k] = { current: curr, prev };
      });
    }
    return out;
  }, [merged, activeData, activePrev, windowMonths, prevWindowMonths, useTyped]);

  // ── Aggregate by hub / island ──────────────────────────────────────────────
  const groupOrder  = destMode === "port" ? ISLAND_ORDER  : HUB_ORDER;
  const groupColors = destMode === "port" ? ISLAND_COLORS : HUB_COLORS;

  const hubTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    const resolve = destMode === "port" ? getIsland : getHub;
    Object.entries(leafTotals).forEach(([leaf, v]) => {
      const g = resolve(leaf);
      if (!out[g]) out[g] = { current: 0, prev: 0 };
      out[g].current += v.current;
      out[g].prev    += v.prev;
    });
    return out;
  }, [leafTotals, destMode]);

  // ── Chart rows ─────────────────────────────────────────────────────────────
  const leafRows = useMemo(() => {
    // Per-species window sum for one country: current-crop-year data first,
    // the prior crop year covers window months across the boundary.
    const typedKt = (name: string, cy?: CountryYear, cyPrev?: CountryYear) =>
      kgToKT(windowMonths.reduce((s, m) =>
        s + (cy?.countries?.[name]?.[m] ?? cyPrev?.countries?.[name]?.[m] ?? 0), 0));

    return Object.entries(leafTotals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([name, v]) => {
        const current   = kgToKT(v.current);
        const t_arabica = typedKt(name, byCountryArabica, byCountryArabicaPrev);
        const t_robusta = typedKt(name, byCountryRobusta, byCountryRobustaPrev);
        const t_other   = Math.max(0,
          Math.round((current - t_arabica - t_robusta) * 10) / 10);
        return {
          label:      name.length > 22 ? name.slice(0, 21) + "…" : name,
          current,
          prev:       kgToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: null as number | null,
          t_arabica, t_robusta, t_other,
        };
      });
  }, [leafTotals, topN, windowMonths, byCountryArabica, byCountryArabicaPrev,
      byCountryRobusta, byCountryRobustaPrev]);

  const hubRows = useMemo(() => {
    const totalCurrent = Object.values(hubTotals).reduce((s, v) => s + v.current, 0);
    const totalPrev    = Object.values(hubTotals).reduce((s, v) => s + v.prev,    0);

    return groupOrder
      .map(g => {
        const v = hubTotals[g] ?? { current: 0, prev: 0 };
        const shareCurrent = totalCurrent > 0 ? v.current / totalCurrent * 100 : 0;
        const sharePrev    = totalPrev    > 0 ? v.prev    / totalPrev    * 100 : 0;
        const shareDelta   = Math.round((shareCurrent - sharePrev) * 10) / 10;
        return {
          label:      g,
          current:    kgToKT(v.current),
          prev:       kgToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: totalPrev > 0 ? shareDelta : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current);
  }, [hubTotals, groupOrder]);

  const rows = view === "hub" ? hubRows : leafRows;
  const barH = view === "hub" ? rows.length * 30 + 40 : topN * 26 + 40;

  // One source of truth for the current-window colour — used by both the bar
  // cells and the tooltip, so hovering always echoes the bar's own colour.
  const barFill = (r: { label: string; pct: number | null }) =>
    view === "hub"
      ? (groupColors[r.label] ?? "#475569")
      : r.pct !== null && r.pct < 0 ? "#ef4444" : GREEN;

  // Stacked species split: Total view, destination × country mode only
  // (ports carry no per-type data).
  const canSplit  = destMode === "destination" && view === "country"
    && coffeeType === "total" && !!(byCountryArabica || byCountryRobusta);
  const showSplit = canSplit && splitTypes;

  // Hide the type selector when port mode is active (no per-type port data).
  const showTypeSelector = destMode === "destination";

  // Headline labels: switch wording when we're in port mode.
  const titleLeaf      = destMode === "port" ? "Port"         : "Destination";
  const titleLeafPlur  = destMode === "port" ? "Ports"        : "Destinations";
  const hubGroupingLbl = destMode === "port" ? "By Island"    : "By Hub";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Title — kept on its own row so the toggle bar below has a
          predictable position regardless of how many controls wrap. */}
      <div className="mb-2">
        <div className="text-sm font-semibold text-slate-200">
          Export by {titleLeaf}
        </div>
        <div className="text-[10px] text-slate-500">
          {destMode === "destination" ? TYPE_LABELS[coffeeType as SeriesKey] : "Total"} ·{" "}
          {periodLabel} (green) vs {prevPeriodLabel} (grey) · Thousand metric tons
        </div>
      </div>

      {/* Toggle bar — always sits below the title; flex-wraps freely
          without ever moving back next to the heading. */}
      {!isReportMode && (
        <div className="flex flex-wrap gap-1 mb-3">
          {/* Leaf-axis selector (destination ↔ port) */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(["destination", "port"] as DestMode[]).map(m => (
              <button key={m}
                onClick={() => {
                  setDestMode(m);
                  if (m === "port") setCoffeeType("total");
                }}
                className={`text-[10px] px-2 py-0.5 rounded capitalize ${destMode === m ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {m === "port" ? "By Origin Port" : "By Destination"}
              </button>
            ))}
          </div>

          {/* Window selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {DEST_WINDOWS.map(w => (
              <button key={w.label}
                onClick={() => setDestWindow(w.label)}
                className={`text-[10px] px-2 py-0.5 rounded ${destWindow === w.label ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {w.label}
              </button>
            ))}
          </div>

          {/* Coffee type selector (destination side only) */}
          {showTypeSelector && (
            <div className="flex gap-1 border border-slate-600 rounded p-0.5">
              {(["total", "arabica", "robusta"] as DestType[]).map(t => (
                <button key={t}
                  onClick={() => setCoffeeType(t)}
                  className={`text-[10px] px-2 py-0.5 rounded ${coffeeType === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                  {t === "total" ? "Total" : t === "arabica" ? "Arabica" : "Robusta"}
                </button>
              ))}
            </div>
          )}

          {/* Leaf vs hub view */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(["country", "hub"] as ViewMode[]).map(m => (
              <button key={m}
                onClick={() => setView(m)}
                className={`text-[10px] px-2 py-0.5 rounded capitalize ${view === m ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {m === "hub" ? hubGroupingLbl : `By ${titleLeaf}`}
              </button>
            ))}
          </div>

          {/* Top-N (leaf view only) */}
          {view === "country" && (
            <div className="flex gap-1">
              {[10, 15, 25].map(n => (
                <button key={n}
                  onClick={() => setTopN(n)}
                  className={`text-[10px] px-2 py-0.5 rounded ${topN === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                  Top {n}
                </button>
              ))}
            </div>
          )}
          {/* Type-split toggle (Total × country view only) */}
          {canSplit && (
            <div className="flex gap-1 border border-slate-600 rounded p-0.5">
              {([true, false] as const).map(sp => (
                <button key={String(sp)} onClick={() => setSplitTypes(sp)}
                  title={sp ? "Stack the species inside each bar" : "Single bar coloured by YoY direction"}
                  className={`text-[10px] px-2 py-0.5 rounded ${splitTypes === sp ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                  {sp ? "Split" : "Solid"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={barH}>
        <BarChart data={rows} layout="vertical"
          margin={{ top: 4, right: 64, bottom: 4, left: view === "hub" ? 130 : 150 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis type="category" dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 9 }}
            width={view === "hub" ? 125 : 145} />
          <Tooltip contentStyle={TT_STYLE} itemStyle={{ color: "#94a3b8" }}
            formatter={((v, name, item) => {
              const split = SPLIT_SERIES.find(sp => sp.key === name);
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
              const split = SPLIT_SERIES.find(sp => sp.key === v);
              return (
                <span style={{ color: "#cbd5e1" }}>
                  {split ? split.label : v === "current" ? periodLabel : prevPeriodLabel}
                </span>
              );
            }} />
          <Bar dataKey="prev" name="prev" fill={SLATE} opacity={0.55} />
          {showSplit ? (
            SPLIT_SERIES.map((sp, i) => (
              <Bar key={sp.key} dataKey={sp.key} name={sp.key} stackId="cur" fill={sp.color}
                radius={i === SPLIT_SERIES.length - 1 ? [0, 3, 3, 0] : undefined}>
                {/* Stack total at the end of the bar. */}
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
        <div
          className={`grid pb-1 border-b border-slate-700 text-slate-500 font-medium gap-x-6`}
          style={{ gridTemplateColumns: view === "hub" ? "1fr auto auto" : "1fr auto" }}
        >
          <span>{view === "hub" ? "Region" : titleLeafPlur}</span>
          <span className="text-right">YoY vol. (same period)</span>
          {view === "hub" && <span className="text-right">Share Δpp</span>}
        </div>

        {rows.map(r => {
          const hubRow = r as typeof hubRows[0];
          return (
            <div key={r.label}
              className="grid gap-x-6 py-0.5 border-b border-slate-800"
              style={{ gridTemplateColumns: view === "hub" ? "1fr auto auto" : "1fr auto" }}>
              <span className="text-slate-300 truncate">{r.label}</span>
              <span className={`text-right ${
                r.pct === null ? "text-slate-500" : chgTone(r.pct)
              }`}>
                {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
              </span>
              {view === "hub" && (
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
