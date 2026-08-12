"use client";
// Total — world coffee exports aggregated across every origin the app
// tracks. Two questions this tab answers that no single-origin tab can:
//   1. How much coffee left origin last month / this crop year, in total,
//      and how is that split between origins?
//   2. Where did it all go — one destination ranking summed across the
//      origins that publish a by-destination breakdown?
//
// Every source ships a different unit (Brazil 60-kg bags, Vietnam tonnes
// and k-bags, Indonesia kg, Uganda bags, Colombia k-bags), so everything
// is normalised to kt (thousand metric tons) at read time and the origin
// registry below is the single place a new origin gets wired in.
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { COUNTRY_EN } from "./BrazilTab/constants";
import { COUNTRY_HUB, HUB_COLORS, HUB_ORDER } from "./IndonesiaExports/constants";

const TT_STYLE = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 6, fontSize: 11,
} as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Unit conversions → kt (thousand metric tons).
const bagsToKT  = (bags: number) => (bags * 60) / 1e6;
const kbagsToKT = (kb: number)   => (kb * 60) / 1000;
const kgToKT    = (kg: number)   => kg / 1e6;
const tToKT     = (t: number)    => t / 1000;

const round1 = (v: number) => Math.round(v * 10) / 10;
const ktLabel = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${round1(n)}kt` : "";
};

const ORIGIN_COLORS: Record<string, string> = {
  Brazil:    "#22c55e",
  Vietnam:   "#f59e0b",
  Colombia:  "#f97316",
  Indonesia: "#38bdf8",
  Uganda:    "#a78bfa",
};
const ORIGIN_ORDER = ["Brazil", "Vietnam", "Colombia", "Indonesia", "Uganda"];

/** Canonical destination key: uppercase English. Brazil ships Portuguese
 *  names, Uganda/Vietnam title-case English, Indonesia uppercase — all
 *  three collapse onto the same key so the sum is a real sum. */
function destKey(raw: string, fromPortuguese = false): string {
  const en = fromPortuguese ? (COUNTRY_EN[raw] ?? raw) : raw;
  const up = en.trim().toUpperCase();
  return DEST_ALIAS[up] ?? up;
}
const DEST_ALIAS: Record<string, string> = {
  "USA": "UNITED STATES",
  "U.S.A.": "UNITED STATES",
  "UNITED STATES OF AMERICA": "UNITED STATES",
  "KOREA (REPUBLIC)": "KOREA",
  "SOUTH KOREA": "KOREA",
  "REPUBLIC OF KOREA": "KOREA",
  "RUSSIAN FEDERATION": "RUSSIA",
  "UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND": "UNITED KINGDOM",
  "MYANMAR (BURMA)": "MYANMAR",
  "NETHERLAND": "NETHERLANDS",
  "HOLLAND": "NETHERLANDS",
};
/** Title-case a canonical key for display ("UNITED STATES" → "United States"). */
const prettyDest = (key: string) =>
  key.split(" ").map(w => w.length > 3 || /^[A-Z]{2,3}$/.test(w) === false
    ? w.charAt(0) + w.slice(1).toLowerCase()
    : w).join(" ");

function monthLabel(ym: string): string {
  return MONTH_LABELS[parseInt(ym.split("-")[1], 10) - 1] ?? ym;
}
function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Source payload shapes (only the fields this tab reads) ─────────────────
interface Cecafe {
  series?: { date: string; total?: number }[];
  by_country?: { months?: string[]; countries?: Record<string, Record<string, number>> };
}
interface VnSupply { exports?: { monthly?: { month: string; total_k_bags: number }[] } | null }
interface CoSupply { exports?: { monthly?: { month: string; total_k_bags?: number; total_t?: number }[] } | null }
interface IdnExports {
  series?: {
    month: string; total_coffee_kg?: number;
    by_destination?: { country: string; kg: number }[];
  }[];
}
interface UgMonthly {
  series?: {
    month: string; total_bags?: number;
    by_destination?: { country: string; bags?: number }[];
  }[];
}
interface VnDest { months?: string[]; countries?: Record<string, Record<string, number>> }

type MonthMap = Record<string, number>;                  // ym → kt
type DestMap  = Record<string, Record<string, number>>;  // destKey → ym → kt

const WINDOWS = ["3M", "6M", "12M", "24M"] as const;
type Win = (typeof WINDOWS)[number];

export default function TotalExportsTab() {
  const [cecafe, setCecafe]   = useState<Cecafe | null>(null);
  const [vnSup, setVnSup]     = useState<VnSupply | null>(null);
  const [coSup, setCoSup]     = useState<CoSupply | null>(null);
  const [idn, setIdn]         = useState<IdnExports | null>(null);
  const [ug, setUg]           = useState<UgMonthly | null>(null);
  const [vnDest, setVnDest]   = useState<VnDest | null>(null);
  const [loaded, setLoaded]   = useState(false);

  const [win, setWin]   = useState<Win>("12M");
  const [mode, setMode] = useState<"country" | "hub">("country");
  const [topN, setTopN] = useState(15);

  useEffect(() => {
    const get = <T,>(url: string, set: (v: T) => void) =>
      fetch(url).then(r => (r.ok ? r.json() : null)).then((d) => d && set(d)).catch(() => { /* origin absent → excluded */ });
    Promise.all([
      get<Cecafe>("/data/cecafe.json", setCecafe),
      get<VnSupply>("/data/vietnam_supply.json", setVnSup),
      get<CoSupply>("/data/colombia_supply.json", setCoSup),
      get<IdnExports>("/data/indonesia_exports.json", setIdn),
      get<UgMonthly>("/data/uganda_monthly.json", setUg),
      get<VnDest>("/data/vn_export_by_destination.json", setVnDest),
    ]).finally(() => setLoaded(true));
  }, []);

  // ── Per-origin monthly totals, all in kt ────────────────────────────────
  const byOrigin: Record<string, MonthMap> = useMemo(() => {
    const out: Record<string, MonthMap> = {};
    const put = (origin: string, ym: string, kt: number) => {
      if (!ym || !Number.isFinite(kt) || kt <= 0) return;
      (out[origin] ??= {})[ym] = (out[origin][ym] ?? 0) + kt;
    };
    for (const r of cecafe?.series ?? []) {
      if (r.total != null) put("Brazil", r.date, bagsToKT(r.total));
    }
    for (const r of vnSup?.exports?.monthly ?? []) {
      put("Vietnam", r.month, kbagsToKT(r.total_k_bags));
    }
    for (const r of coSup?.exports?.monthly ?? []) {
      const kt = r.total_t != null ? tToKT(r.total_t)
               : r.total_k_bags != null ? kbagsToKT(r.total_k_bags) : NaN;
      put("Colombia", r.month, kt);
    }
    for (const r of idn?.series ?? []) {
      if (r.total_coffee_kg != null) put("Indonesia", r.month, kgToKT(r.total_coffee_kg));
    }
    for (const r of ug?.series ?? []) {
      if (r.total_bags != null) put("Uganda", r.month, bagsToKT(r.total_bags));
    }
    return out;
  }, [cecafe, vnSup, coSup, idn, ug]);

  const origins = useMemo(
    () => ORIGIN_ORDER.filter(o => Object.keys(byOrigin[o] ?? {}).length > 0),
    [byOrigin],
  );

  // Months where at least one origin reports. The newest month is usually
  // partial (origins publish on different lags) — flagged, never hidden.
  const allMonths = useMemo(() => {
    const s = new Set<string>();
    origins.forEach(o => Object.keys(byOrigin[o]).forEach(m => s.add(m)));
    return Array.from(s).sort();
  }, [byOrigin, origins]);

  /** Latest month per origin — the coverage table's freshness column and
   *  the "complete month" cutoff below both read it. */
  const latestByOrigin = useMemo(() => {
    const out: Record<string, string> = {};
    origins.forEach(o => {
      const ms = Object.keys(byOrigin[o]).sort();
      out[o] = ms[ms.length - 1] ?? "";
    });
    return out;
  }, [byOrigin, origins]);

  // The last month EVERY origin has reported — the newest apples-to-apples
  // comparison point. Later months still render (flagged partial).
  const lastCompleteMonth = useMemo(() => {
    const lasts = origins.map(o => latestByOrigin[o]).filter(Boolean).sort();
    return lasts[0] ?? "";
  }, [origins, latestByOrigin]);

  const winMonths = useMemo(() => {
    const n = { "3M": 3, "6M": 6, "12M": 12, "24M": 24 }[win];
    return allMonths.slice(-n);
  }, [allMonths, win]);

  // ── Stacked monthly chart ───────────────────────────────────────────────
  const monthlyRows = useMemo(() =>
    winMonths.map(ym => {
      const row: Record<string, string | number | boolean> = {
        ym,
        label: `${monthLabel(ym)} ${ym.slice(2, 4)}`,
        partial: !!lastCompleteMonth && ym > lastCompleteMonth,
      };
      let total = 0;
      origins.forEach(o => {
        const v = round1(byOrigin[o][ym] ?? 0);
        row[o] = v;
        total += v;
      });
      row.total = round1(total);
      return row;
    })
  , [winMonths, origins, byOrigin, lastCompleteMonth]);

  // ── Coverage / KPI table: rolling 12M per origin + YoY ──────────────────
  const coverage = useMemo(() => {
    const last12 = allMonths.slice(-12);
    const prev12 = last12.map(m => offsetYM(m, 12));
    const rows = origins.map(o => {
      const cur  = last12.reduce((s, m) => s + (byOrigin[o][m] ?? 0), 0);
      const prev = prev12.reduce((s, m) => s + (byOrigin[o][m] ?? 0), 0);
      return {
        origin: o,
        kt: round1(cur),
        prevKt: round1(prev),
        pct: prev > 0 ? Math.round((cur - prev) / prev * 100) : null,
        latest: latestByOrigin[o],
      };
    });
    const total     = rows.reduce((s, r) => s + r.kt, 0);
    const totalPrev = rows.reduce((s, r) => s + r.prevKt, 0);
    return {
      rows: rows.map(r => ({ ...r, share: total > 0 ? Math.round(r.kt / total * 1000) / 10 : 0 }))
                .sort((a, b) => b.kt - a.kt),
      total: round1(total),
      totalPrev: round1(totalPrev),
      totalPct: totalPrev > 0 ? Math.round((total - totalPrev) / totalPrev * 100) : null,
      window: last12,
    };
  }, [allMonths, origins, byOrigin, latestByOrigin]);

  // ── Aggregated destinations (origins that publish a breakdown) ──────────
  const { destByKey, destOrigins } = useMemo(() => {
    const out: DestMap = {};
    const contributors: string[] = [];
    const put = (key: string, ym: string, kt: number) => {
      if (!key || !ym || !Number.isFinite(kt) || kt <= 0) return;
      (out[key] ??= {})[ym] = (out[key][ym] ?? 0) + kt;
    };
    // Brazil — Cecafé by_country (Portuguese keys, bags).
    const brC = cecafe?.by_country?.countries;
    if (brC && Object.keys(brC).length) {
      contributors.push("Brazil");
      for (const [pt, mv] of Object.entries(brC)) {
        const key = destKey(pt, true);
        for (const [ym, bags] of Object.entries(mv)) put(key, ym, bagsToKT(bags));
      }
    }
    // Vietnam — customs 5X by destination (tonnes).
    const vnC = vnDest?.countries;
    if (vnC && Object.keys(vnC).length) {
      contributors.push("Vietnam");
      for (const [c, mv] of Object.entries(vnC)) {
        const key = destKey(c);
        for (const [ym, t] of Object.entries(mv)) put(key, ym, tToKT(t));
      }
    }
    // Indonesia — BPS by_destination per month (kg).
    if ((idn?.series ?? []).some(r => (r.by_destination ?? []).length)) {
      contributors.push("Indonesia");
      for (const r of idn?.series ?? []) {
        for (const d of r.by_destination ?? []) put(destKey(d.country), r.month, kgToKT(d.kg));
      }
    }
    // Uganda — UCDA monthly reports by destination (bags).
    if ((ug?.series ?? []).some(r => (r.by_destination ?? []).length)) {
      contributors.push("Uganda");
      for (const r of ug?.series ?? []) {
        for (const d of r.by_destination ?? []) put(destKey(d.country), r.month, bagsToKT(d.bags ?? 0));
      }
    }
    return { destByKey: out, destOrigins: contributors };
  }, [cecafe, vnDest, idn, ug]);

  // Destination window: the months every contributing origin covers would
  // be too strict (Cecafé's by_country only spans the current crop year),
  // so we use the same window as the chart above and label it plainly.
  const destWindowMonths = winMonths;
  const destPrevMonths   = useMemo(() => destWindowMonths.map(m => offsetYM(m, 12)), [destWindowMonths]);

  const destRows = useMemo(() => {
    const totals: Record<string, { current: number; prev: number }> = {};
    for (const [key, mv] of Object.entries(destByKey)) {
      const cur  = destWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
      const prev = destPrevMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
      if (cur > 0 || prev > 0) totals[key] = { current: cur, prev };
    }
    if (mode === "hub") {
      const hubs: Record<string, { current: number; prev: number }> = {};
      Object.entries(totals).forEach(([key, v]) => {
        const hub = COUNTRY_HUB[key] ?? "Other";
        (hubs[hub] ??= { current: 0, prev: 0 });
        hubs[hub].current += v.current;
        hubs[hub].prev    += v.prev;
      });
      const tc = Object.values(hubs).reduce((s, v) => s + v.current, 0);
      const tp = Object.values(hubs).reduce((s, v) => s + v.prev, 0);
      return [...HUB_ORDER, "Other"]
        .map(hub => {
          const v = hubs[hub] ?? { current: 0, prev: 0 };
          return {
            label: hub,
            current: round1(v.current),
            prev: round1(v.prev),
            pct: v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
            shareDelta: tp > 0
              ? Math.round(((v.current / (tc || 1)) - (v.prev / (tp || 1))) * 1000) / 10
              : null,
          };
        })
        .filter(r => r.current > 0 || r.prev > 0)
        .sort((a, b) => b.current - a.current);
    }
    return Object.entries(totals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([key, v]) => ({
        label: prettyDest(key).length > 22 ? prettyDest(key).slice(0, 21) + "…" : prettyDest(key),
        current: round1(v.current),
        prev: round1(v.prev),
        pct: v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        shareDelta: null as number | null,
      }));
  }, [destByKey, destWindowMonths, destPrevMonths, mode, topN]);

  const periodLabel = winMonths.length
    ? `${monthLabel(winMonths[0])} ${winMonths[0].slice(0, 4)}–${monthLabel(winMonths[winMonths.length - 1])} ${winMonths[winMonths.length - 1].slice(0, 4)}`
    : "";
  const prevPeriodLabel = destPrevMonths.length
    ? `${monthLabel(destPrevMonths[0])} ${destPrevMonths[0].slice(0, 4)}–${monthLabel(destPrevMonths[destPrevMonths.length - 1])} ${destPrevMonths[destPrevMonths.length - 1].slice(0, 4)}`
    : "";

  const barFill = (r: { label: string; pct: number | null }) =>
    mode === "hub"
      ? (HUB_COLORS[r.label] ?? "#475569")
      : r.pct !== null && r.pct < 0 ? "#ef4444" : "#22c55e";

  if (!loaded) {
    return <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading world export data…</div>;
  }
  if (origins.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
        No origin export series available yet.
      </div>
    );
  }

  const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";

  return (
    <div className="space-y-4">
      {/* ── Headline KPIs ─────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            World exports — {origins.length} origins aggregated
          </div>
          <div className="text-[8px] text-slate-600">
            thousand metric tons (kt) · rolling 12 months
          </div>
        </div>
        <div className="flex items-stretch gap-2 flex-wrap">
          <div className="bg-slate-900 border border-emerald-800/50 rounded-lg px-3 py-2 flex-1 min-w-[130px]">
            <div className="text-[8px] uppercase tracking-wide font-bold text-emerald-400 mb-0.5">
              Total exports · 12M
            </div>
            <div className="text-sm font-extrabold text-emerald-300">
              {coverage.total.toLocaleString()} kt
            </div>
            <div className="text-[7px] text-slate-600 mt-0.5">
              {/* kt → million 60-kg bags: kt × 1e6 kg ÷ 60 ÷ 1e6 = kt ÷ 60. */}
              ≈ {round1(coverage.total / 60).toLocaleString()}M 60-kg bags
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 flex-1 min-w-[130px]">
            <div className="text-[8px] uppercase tracking-wide font-bold text-slate-400 mb-0.5">
              YoY
            </div>
            <div className={`text-sm font-extrabold ${
              coverage.totalPct == null ? "text-slate-400"
                : coverage.totalPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {coverage.totalPct == null ? "—" : `${coverage.totalPct >= 0 ? "+" : ""}${coverage.totalPct}%`}
            </div>
            <div className="text-[7px] text-slate-600 mt-0.5">
              vs {coverage.totalPrev.toLocaleString()} kt prior 12M
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 flex-1 min-w-[130px]">
            <div className="text-[8px] uppercase tracking-wide font-bold text-slate-400 mb-0.5">
              Complete through
            </div>
            <div className="text-sm font-extrabold text-slate-200">
              {lastCompleteMonth ? `${monthLabel(lastCompleteMonth)} ${lastCompleteMonth.slice(0, 4)}` : "—"}
            </div>
            <div className="text-[7px] text-slate-600 mt-0.5">
              every origin reported
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly stacked chart ─────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Monthly exports by origin
            <span className="ml-2 text-slate-600 normal-case">· {periodLabel}</span>
          </div>
          <div className="inline-flex rounded border border-slate-700 overflow-hidden">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setWin(w)}
                className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                  win === w ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                }`}>
                {w}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyRows} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.round(Number(v))}kt`} />
            <Tooltip contentStyle={TT_STYLE}
              labelFormatter={(l, items) => {
                const p = items?.[0]?.payload as { ym?: string; partial?: boolean; total?: number } | undefined;
                return `${l}${p?.partial ? " · partial (not all origins reported)" : ""} — total ${round1(p?.total ?? 0)} kt`;
              }}
              formatter={((v, n) => [
                <span key="v" style={{ color: ORIGIN_COLORS[String(n)] ?? "#94a3b8" }}>{`${v} kt`}</span>,
                n as NameType,
              ]) satisfies Formatter<ValueType, NameType>} />
            <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
            {origins.map((o, i) => (
              <Bar key={o} dataKey={o} name={o} stackId="x" fill={ORIGIN_COLORS[o] ?? "#64748b"}
                radius={i === origins.length - 1 ? [2, 2, 0, 0] : undefined}>
                {/* Stack total above the newest bars only — labelling every
                    month would crowd a 24-month window. */}
                {i === origins.length - 1 && monthlyRows.length <= 12 && (
                  <LabelList dataKey="total" position="top" formatter={ktLabel}
                    style={{ fill: "#94a3b8", fontSize: 8 }} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="text-[8px] text-slate-600 leading-relaxed">
          Each origin normalised to kt from its native unit (Brazil &amp; Uganda 60-kg bags,
          Vietnam k-bags, Colombia customs tons, Indonesia kg). The most recent month(s)
          can be partial — origins publish on different lags, so a short final bar means
          &quot;not all origins reported yet&quot;, not a collapse in shipments.
        </div>
      </div>

      {/* ── Per-origin coverage table ─────────────────────────────────── */}
      <div className={CARD}>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Origin contribution · rolling 12M
        </div>
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2 font-medium">Origin</th>
              <th className="text-right py-1 px-1 font-medium">12M (kt)</th>
              <th className="text-right py-1 px-1 font-medium">YoY</th>
              <th className="text-right py-1 px-1 font-medium">Share</th>
              <th className="text-right py-1 pl-1 font-medium">Latest</th>
            </tr>
          </thead>
          <tbody>
            {coverage.rows.map(r => (
              <tr key={r.origin} className="border-t border-slate-700/50">
                <td className="py-1 pr-2">
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle"
                    style={{ background: ORIGIN_COLORS[r.origin] ?? "#64748b" }} />
                  <span className="text-slate-300">{r.origin}</span>
                </td>
                <td className="text-right py-1 px-1 text-slate-300">{r.kt.toLocaleString()}</td>
                <td className={`text-right py-1 px-1 ${
                  r.pct == null ? "text-slate-600" : r.pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {r.pct == null ? "—" : `${r.pct >= 0 ? "+" : ""}${r.pct}%`}
                </td>
                <td className="text-right py-1 px-1 text-slate-400">{r.share}%</td>
                <td className="text-right py-1 pl-1 text-slate-500">
                  {r.latest ? `${monthLabel(r.latest)} ${r.latest.slice(2, 4)}` : "—"}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-600">
              <td className="py-1 pr-2 font-bold text-slate-200">Total</td>
              <td className="text-right py-1 px-1 font-bold text-slate-200">{coverage.total.toLocaleString()}</td>
              <td className={`text-right py-1 px-1 font-bold ${
                coverage.totalPct == null ? "text-slate-600"
                  : coverage.totalPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {coverage.totalPct == null ? "—" : `${coverage.totalPct >= 0 ? "+" : ""}${coverage.totalPct}%`}
              </td>
              <td className="text-right py-1 px-1 text-slate-500">100%</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Aggregated destinations ───────────────────────────────────── */}
      {destRows.length > 0 && (
        <div className={CARD}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Export by destination — all origins
              <span className="ml-2 text-slate-600 normal-case">· {periodLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                {(["country", "hub"] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                      mode === m ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                    }`}>
                    {m === "country" ? "By country" : "By hub"}
                  </button>
                ))}
              </div>
              {mode === "country" && (
                <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                  {[10, 15, 25].map(n => (
                    <button key={n} onClick={() => setTopN(n)}
                      className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                        topN === n ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                      }`}>
                      Top {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.min(topN, destRows.length) * 26 + 50}>
            <BarChart data={destRows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 130 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 9 }} />
              <YAxis type="category" dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 9 }} width={125} />
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
              <Bar dataKey="prev" name="prev" fill="#64748b" opacity={0.55} />
              <Bar dataKey="current" name="current" radius={[0, 3, 3, 0]}>
                {destRows.map((r, i) => <Cell key={i} fill={barFill(r)} />)}
                <LabelList dataKey="current" position="right" formatter={ktLabel}
                  style={{ fill: "#94a3b8", fontSize: 8.5 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="text-[8px] text-slate-600 leading-relaxed">
            Summed across the origins that publish a destination breakdown:{" "}
            <span className="text-slate-500">{destOrigins.join(", ")}</span>. Country names are
            normalised to one taxonomy before summing (Cecafé ships Portuguese labels, the
            others English). Coverage is narrower than the totals above — origins without a
            destination feed (and each feed&apos;s own history depth) are simply absent here,
            so treat this as a shape-of-demand ranking rather than a world total.
          </div>
        </div>
      )}
    </div>
  );
}
