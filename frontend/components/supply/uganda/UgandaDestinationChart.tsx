"use client";
// Uganda — Export by Destination. Aligned to the shared Export-by-Destination
// template (Brazil / Indonesia / Vietnam): window selector, current-vs-prior-
// year bars in kt, By Country / By Hub views, Top-N, YoY table with hub share
// deltas — plus the Robusta/Arabica type split stacked inside the current bar
// (UCDA publishes the R/A split per destination from the enriched schema on;
// older rows only carry totals, which land in the 'Unsplit' segment).
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend, LabelList } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { COUNTRY_HUB, HUB_COLORS, HUB_ORDER } from "../IndonesiaExports/constants";
import { TT_STYLE, bagsToKT, type UgandaMonthlyRow } from "./helpers";
import { chgTone } from "@/lib/formatters";

type ViewMode = "country" | "hub";
const WINDOWS = ["1M", "3M", "6M", "12M", "CYTD"] as const;
type DestWindow = (typeof WINDOWS)[number];

const GREEN = "#22c55e";
const SLATE = "#64748b";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// End-of-bar volume label (values are already in thousand tons).
const ktLabel = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n}kt` : "";
};

const SPLIT_SERIES = [
  { key: "t_robusta", label: "Robusta", color: "#f59e0b" },
  { key: "t_arabica", label: "Arabica", color: GREEN },
  { key: "t_unsplit", label: "Unsplit", color: SLATE },
];

function getHub(country: string): string {
  return COUNTRY_HUB[country.toUpperCase()] ?? "Other";
}

function monthLabel(ym: string): string {
  return MONTH_LABELS[parseInt(ym.split("-")[1], 10) - 1] ?? ym;
}

function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface DestAcc { bags: number; rob: number; ara: number }

export default function UgandaDestinationChart({ monthly }: { monthly: UgandaMonthlyRow[] }) {
  const [mode, setMode]             = useState<ViewMode>("country");
  const [topN, setTopN]             = useState(15);
  const [destWindow, setDestWindow] = useState<DestWindow>("CYTD");
  const [splitTypes, setSplitTypes] = useState(true);

  // country → ym → accumulated bags (+ R/A split where published).
  const { byCountry, allMonths, warned } = useMemo(() => {
    const out: Record<string, Record<string, DestAcc>> = {};
    const months = new Set<string>();
    const warnedMonths: string[] = [];
    for (const r of monthly) {
      if (!r.by_destination) continue;
      months.add(r.month);
      if (r.parse_warnings?.some(w => /cross-check failed|no published total/i.test(w))) {
        warnedMonths.push(r.month);
      }
      for (const d of r.by_destination) {
        const c = out[d.country] ?? (out[d.country] = {});
        const acc = c[r.month] ?? (c[r.month] = { bags: 0, rob: 0, ara: 0 });
        acc.bags += d.bags ?? 0;
        acc.rob  += d.robusta_bags ?? 0;
        acc.ara  += d.arabica_bags ?? 0;
      }
    }
    return { byCountry: out, allMonths: Array.from(months).sort(), warned: warnedMonths.sort() };
  }, [monthly]);

  const latestMonth = allMonths[allMonths.length - 1] ?? "";

  // Window months. CYTD = Uganda crop year (Oct → Sep) to date.
  const windowMonths = useMemo(() => {
    if (!latestMonth) return [];
    if (destWindow === "CYTD") {
      const [y, m] = latestMonth.split("-").map(Number);
      const cropStart = m >= 10 ? `${y}-10` : `${y - 1}-10`;
      return allMonths.filter(mm => mm >= cropStart && mm <= latestMonth);
    }
    const n = { "1M": 1, "3M": 3, "6M": 6, "12M": 12 }[destWindow]!;
    return allMonths.slice(-n);
  }, [destWindow, allMonths, latestMonth]);

  const prevWindowMonths = useMemo(
    () => windowMonths.map(m => offsetYM(m, 12)),
    [windowMonths],
  );

  const fmtPeriod = (months: string[]) => {
    const first = months[0], last = months[months.length - 1];
    if (!first || !last) return "";
    return first === last
      ? `${monthLabel(first)} ${first.split("-")[0]}`
      : `${monthLabel(first)} ${first.split("-")[0]}–${monthLabel(last)} ${last.split("-")[0]}`;
  };
  const periodLabel     = fmtPeriod(windowMonths);
  const prevPeriodLabel = fmtPeriod(prevWindowMonths);

  const countryTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number; rob: number; ara: number }> = {};
    Object.entries(byCountry).forEach(([c, mv]) => {
      const sum = (months: string[], pick: (a: DestAcc) => number) =>
        months.reduce((s, m) => s + (mv[m] ? pick(mv[m]) : 0), 0);
      const current = sum(windowMonths, a => a.bags);
      const prev    = sum(prevWindowMonths, a => a.bags);
      if (current > 0 || prev > 0) {
        out[c] = {
          current, prev,
          rob: sum(windowMonths, a => a.rob),
          ara: sum(windowMonths, a => a.ara),
        };
      }
    });
    return out;
  }, [byCountry, windowMonths, prevWindowMonths]);

  const hubTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(countryTotals).forEach(([c, v]) => {
      const hub = getHub(c);
      if (!out[hub]) out[hub] = { current: 0, prev: 0 };
      out[hub].current += v.current;
      out[hub].prev    += v.prev;
    });
    return out;
  }, [countryTotals]);

  const countryRows = useMemo(() =>
    Object.entries(countryTotals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([c, v]) => {
        const current   = bagsToKT(v.current);
        const t_robusta = bagsToKT(v.rob);
        const t_arabica = bagsToKT(v.ara);
        const t_unsplit = Math.max(0,
          Math.round((current - t_robusta - t_arabica) * 10) / 10);
        return {
          label:      c.length > 22 ? c.slice(0, 21) + "…" : c,
          current,
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: null as number | null,
          t_robusta, t_arabica, t_unsplit,
        };
      })
  , [countryTotals, topN]);

  const hubRows = useMemo(() => {
    const totalCurrent = Object.values(hubTotals).reduce((s, v) => s + v.current, 0);
    const totalPrev    = Object.values(hubTotals).reduce((s, v) => s + v.prev,    0);
    return [...HUB_ORDER, "Other"]
      .map(hub => {
        const v = hubTotals[hub] ?? { current: 0, prev: 0 };
        const shareCurrent = totalCurrent > 0 ? v.current / totalCurrent * 100 : 0;
        const sharePrev    = totalPrev    > 0 ? v.prev    / totalPrev    * 100 : 0;
        return {
          label:      hub,
          current:    bagsToKT(v.current),
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: totalPrev > 0
            ? Math.round((shareCurrent - sharePrev) * 10) / 10 : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current);
  }, [hubTotals]);

  if (allMonths.length === 0) return null;

  const rows = mode === "hub" ? hubRows : countryRows;
  const barH = mode === "hub" ? rows.length * 30 + 40 : Math.min(topN, rows.length) * 26 + 40;

  // One source of truth for the current-window colour — used by both the bar
  // cells and the tooltip, so hovering always echoes the bar's own colour.
  const barFill = (r: { label: string; pct: number | null }) =>
    mode === "hub"
      ? (HUB_COLORS[r.label] ?? "#475569")
      : r.pct !== null && r.pct < 0 ? "#ef4444" : GREEN;

  const canSplit  = mode === "country";
  const showSplit = canSplit && splitTypes;
  const warnedInWindow = warned.filter(m => windowMonths.includes(m));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination</div>
          <div className="text-[10px] text-slate-500">
            {periodLabel} (current) vs {prevPeriodLabel} (grey) · Thousand metric tons · UCDA
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {/* Window selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setDestWindow(w)}
                className={`text-[10px] px-2 py-0.5 rounded ${destWindow === w ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {w}
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
          {/* Type-split toggle (country view only) */}
          {canSplit && (
            <div className="flex gap-1 border border-slate-600 rounded p-0.5">
              {([true, false] as const).map(s => (
                <button key={String(s)} onClick={() => setSplitTypes(s)}
                  title={s ? "Stack Robusta + Arabica inside each bar" : "Single bar coloured by YoY direction"}
                  className={`text-[10px] px-2 py-0.5 rounded ${splitTypes === s ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                  {s ? "Split" : "Solid"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {warnedInWindow.length > 0 && (
        <div className="text-[10px] text-amber-500/90 mb-1">
          ⚠ Source-PDF totals cross-check failed for {warnedInWindow.join(", ")} —
          destination volumes for {warnedInWindow.length === 1 ? "this month" : "these months"} may be incomplete.
        </div>
      )}

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
          <Bar dataKey="prev" name="prev" fill="#94a3b8" opacity={0.55} />
          {showSplit ? (
            SPLIT_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.key} stackId="cur" fill={s.color}
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
        <div className="grid pb-1 border-b border-slate-700 text-slate-500 font-medium gap-x-6"
          style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}>
          <span>Destination</span>
          <span className="text-right">YoY vol. (same period)</span>
          {mode === "hub" && <span className="text-right">Share Δpp</span>}
        </div>
        {rows.map(r => (
          <div key={r.label}
            className="grid gap-x-6 py-0.5 border-b border-slate-800"
            style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}>
            <span className="text-slate-300 truncate">{r.label}</span>
            <span className={`text-right ${
              r.pct === null ? "text-slate-500" : chgTone(r.pct)
            }`}>
              {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
            </span>
            {mode === "hub" && (
              <span className={`text-right ${
                r.shareDelta === null ? "text-slate-500"
                : r.shareDelta > 0    ? "text-green-400"
                : r.shareDelta < 0    ? "text-red-400"
                : "text-slate-500"
              }`}>
                {r.shareDelta === null ? "n/a"
                  : `${r.shareDelta > 0 ? "+" : ""}${r.shareDelta}pp`}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Source note */}
      <div className="mt-3 text-[8px] text-slate-600 leading-relaxed">
        Source: UCDA monthly reports (60-kg bags → kt). The Robusta/Arabica split
        per destination is published from the enriched schema onward; earlier
        months appear in the Unsplit segment.
      </div>
    </div>
  );
}
