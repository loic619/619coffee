"use client";
// Vietnam — Export by Destination. Visual pack mirrors BrazilTab/
// DestinationChart (window vs prior-year bars, country/hub views, Top-N,
// YoY table) with the Vietnam specifics: data is the Customs 5X '(ta-sb)'
// coffee-by-destination series in TONNES (not bags), the crop year runs
// Oct–Sep, and the 5X bulletin only lists countries where coffee is a
// 'main export' line (~85–94% of the 2x national total — see footer note).
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { COUNTRY_HUB, HUB_COLORS, HUB_ORDER } from "../IndonesiaExports/constants";
import { chgTone } from "@/lib/formatters";

interface DestData {
  source: string;
  unit: string;
  coverage_note?: string;
  source_boundary?: string | null;  // first 5X month; earlier months are the XLSX series
  months_from_xlsx?: string[];
  // Green-bean-equivalent uplift: customs reports by product weight, so the
  // green coffee behind Vietnam's instant/soluble exports is added back.
  basis?: string;
  gbe_uplift_t_per_month?: number;
  gbe_months?: string[];
  gbe_note?: string;
  months: string[];                                   // sorted "YYYY-MM"
  countries: Record<string, Record<string, number>>;  // country → ym → tonnes
}

type ViewMode = "country" | "hub";
const WINDOWS = ["1M", "3M", "6M", "12M", "CYTD"] as const;
type DestWindow = (typeof WINDOWS)[number];

const GREEN = "#22c55e";
const SLATE = "#64748b";
const TT_STYLE = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 6, fontSize: 11,
} as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The 5X uses a few country labels the shared hub taxonomy doesn't key on.
const HUB_ALIAS: Record<string, string> = {
  "United States of America": "UNITED STATES",
  "Korea (Republic)":         "KOREA",
  "Myanmar (Burma)":          "MYANMAR",
};
const HUB_OVERRIDE: Record<string, string> = {
  Laos:      "SE Asia & Pacific",
  Indonesia: "SE Asia & Pacific",
};

function getHub(country: string): string {
  return HUB_OVERRIDE[country]
    ?? COUNTRY_HUB[(HUB_ALIAS[country] ?? country).toUpperCase()]
    ?? "Other";
}

function monthLabel(ym: string): string {
  return MONTH_LABELS[parseInt(ym.split("-")[1], 10) - 1] ?? ym;
}

function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const tToKT = (t: number) => Math.round(t / 100) / 10;

export default function DestinationChart() {
  const [data, setData]       = useState<DestData | null>(null);
  const [failed, setFailed]   = useState(false);
  const [mode, setMode]       = useState<ViewMode>("country");
  const [topN, setTopN]       = useState(15);
  const [destWindow, setDestWindow] = useState<DestWindow>("CYTD");

  useEffect(() => {
    fetch("/data/vn_export_by_destination.json")
      .then(r => r.json())
      .then(setData)
      .catch((err) => {
        console.error("[VN DestinationChart] fetch failed:", err);
        setFailed(true);
      });
  }, []);

  const allMonths   = useMemo(() => data?.months ?? [], [data]);
  const latestMonth = allMonths[allMonths.length - 1] ?? "";

  // Window months. CYTD = Vietnam crop year (Oct → Sep) to date.
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
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(data?.countries ?? {}).forEach(([c, mv]) => {
      const current = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
      const prev    = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
      if (current > 0 || prev > 0) out[c] = { current, prev };
    });
    return out;
  }, [data, windowMonths, prevWindowMonths]);

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
      .map(([c, v]) => ({
        label:      c.length > 22 ? c.slice(0, 21) + "…" : c,
        current:    tToKT(v.current),
        prev:       tToKT(v.prev),
        pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        shareDelta: null as number | null,
      }))
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
          current:    tToKT(v.current),
          prev:       tToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: totalPrev > 0
            ? Math.round((shareCurrent - sharePrev) * 10) / 10 : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current);
  }, [hubTotals]);

  if (failed) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-[10px] text-slate-500">
        Export-by-destination data unavailable (vn_export_by_destination.json).
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-[10px] text-slate-500">
        Loading export destinations…
      </div>
    );
  }

  const rows = mode === "hub" ? hubRows : countryRows;
  const barH = mode === "hub" ? rows.length * 30 + 40 : Math.min(topN, rows.length) * 26 + 40;

  // One source of truth for the current-window colour — used by both the bar
  // cells and the tooltip, so hovering always echoes the bar's own colour.
  const barFill = (r: { label: string; pct: number | null }) =>
    mode === "hub"
      ? (HUB_COLORS[r.label] ?? "#475569")
      : r.pct !== null && r.pct < 0 ? "#ef4444" : GREEN;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination</div>
          <div className="text-[10px] text-slate-500">
            {periodLabel} (green) vs {prevPeriodLabel} (grey) · Thousand metric tons · Vietnam Customs 5X
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
              const row = (item?.payload ?? {}) as { label: string; pct: number | null };
              const color = name === "current" ? barFill(row) : "#94a3b8";
              return [
                <span key="v" style={{ color }}>{`${v} kt`}</span>,
                (name === "current" ? periodLabel : prevPeriodLabel) as NameType,
              ];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={(v) => (
              <span style={{ color: "#cbd5e1" }}>
                {v === "current" ? periodLabel : prevPeriodLabel}
              </span>
            )} />
          <Bar dataKey="prev"    name="prev"    fill={SLATE} opacity={0.55} />
          <Bar dataKey="current" name="current" radius={[0, 3, 3, 0]}>
            {rows.map((r, i) => <Cell key={i} fill={barFill(r)} />)}
            <LabelList dataKey="current" position="right"
              formatter={(v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${n}kt` : ""; }}
              style={{ fill: "#94a3b8", fontSize: 8.5 }} />
          </Bar>
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

      {/* Source / coverage note */}
      <div className="mt-3 text-[8px] text-slate-600 leading-relaxed">
        Source: {data.source}. {data.coverage_note ?? ""} Preliminary figures;
        months absent from both sources are omitted rather than interpolated.
        {data.source_boundary && ` Months before ${data.source_boundary} are the XLSX series.`}
        {data.gbe_uplift_t_per_month ? (
          <span className="block mt-1 text-amber-700/80">
            Whole series shown on a <strong>green-bean-equivalent</strong> basis.
            Customs counts Vietnam&apos;s instant/soluble exports once at product
            weight, so {(data.gbe_uplift_t_per_month / 1000).toFixed(0)} kt/month —
            the extra green coffee behind them at ~2 t green per 1 t instant — is added
            back pro-rata across destinations on the {data.gbe_months?.length ?? 0}{" "}
            customs months. The pre-{data.source_boundary ?? "2024"} XLSX months already
            arrive on a green-bean-equivalent basis and are left as published, so the two
            halves compare like for like. Pro-rata is an assumption — customs publishes
            no per-destination split for soluble.
          </span>
        ) : null}
      </div>
    </div>
  );
}
