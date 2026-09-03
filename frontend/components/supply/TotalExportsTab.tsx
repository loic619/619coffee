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
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, LineChart, Line } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import WorldBalanceSheet from "./WorldBalanceSheet";
import { COUNTRY_EN } from "./BrazilTab/constants";
import { COUNTRY_HUB, HUB_COLORS, HUB_ORDER } from "./IndonesiaExports/constants";
import { chgTone } from "@/lib/formatters";

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

type CoffeeType = "total" | "arabica" | "robusta";

/** Arabica/robusta mix for origins whose MONTHLY feed carries no type
 *  split. Brazil (arabica/conillon), Indonesia (arabica/robusta green kg)
 *  and Uganda (arabica/robusta bags) publish theirs per month and never
 *  reach this table.
 *    Colombia — grows washed arabica only, so 100/0 is a fact, not an
 *      estimate (DANE's NANDINA lines are arabica by construction).
 *    Vietnam — customs publishes no split; the ratio comes from the crop
 *      mix in the balance sheets (≈1.2 M bags arabica vs ≈28.5 robusta,
 *      2025/26), i.e. ~4% arabica. Flagged as estimated in the footnote. */
const TYPE_MIX: Record<string, { arabica: number; robusta: number; estimated: boolean }> = {
  Colombia: { arabica: 1,    robusta: 0,    estimated: false },
  Vietnam:  { arabica: 0.04, robusta: 0.96, estimated: true  },
};

/** Canonical destination key: uppercase English. Brazil ships Portuguese
 *  names, Uganda/Vietnam title-case English, Indonesia uppercase — all
 *  three collapse onto the same key so the sum is a real sum. */
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
function destKey(raw: string, fromPortuguese = false): string {
  const en = fromPortuguese ? (COUNTRY_EN[raw] ?? raw) : raw;
  const up = en.trim().toUpperCase();
  return DEST_ALIAS[up] ?? up;
}
/** Title-case a canonical key for display ("UNITED STATES" → "United States"). */
const prettyDest = (key: string) =>
  key.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

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
  series?: { date: string; total?: number; arabica?: number; conillon?: number }[];
  by_country?: { months?: string[]; countries?: Record<string, Record<string, number>> };
}
interface VnSupply { exports?: { monthly?: { month: string; total_k_bags: number }[] } | null }
interface CoSupply { exports?: { monthly?: { month: string; total_k_bags?: number; total_t?: number }[] } | null }
interface IdnExports {
  series?: {
    month: string; total_coffee_kg?: number;
    arabica_green_kg?: number; robusta_green_kg?: number;
    by_destination?: { country: string; kg: number }[];
  }[];
}
interface UgMonthly {
  series?: {
    month: string; total_bags?: number; arabica_bags?: number; robusta_bags?: number;
    by_destination?: { country: string; bags?: number }[];
  }[];
}
interface VnDest { months?: string[]; countries?: Record<string, Record<string, number>> }

/** ym → kt, per coffee type. */
type TypeMap  = { total: Record<string, number>; arabica: Record<string, number>; robusta: Record<string, number> };
type DestMap  = Record<string, Record<string, number>>;

const emptyTypeMap = (): TypeMap => ({ total: {}, arabica: {}, robusta: {} });

const DEST_WINDOWS = ["3M", "6M", "12M", "24M"] as const;
type DestWin = (typeof DEST_WINDOWS)[number];

export default function TotalExportsTab() {
  const [cecafe, setCecafe]   = useState<Cecafe | null>(null);
  const [vnSup, setVnSup]     = useState<VnSupply | null>(null);
  const [coSup, setCoSup]     = useState<CoSupply | null>(null);
  const [idn, setIdn]         = useState<IdnExports | null>(null);
  const [ug, setUg]           = useState<UgMonthly | null>(null);
  const [vnDest, setVnDest]   = useState<VnDest | null>(null);
  const [loaded, setLoaded]   = useState(false);

  const [panel, setPanel]   = useState<"exports" | "balance">("exports");
  const [type, setType]     = useState<CoffeeType>("total");
  const [showPrior, setShowPrior] = useState(true);
  const [destWin, setDestWin] = useState<DestWin>("12M");
  const [mode, setMode]     = useState<"country" | "hub">("country");
  const [topN, setTopN]     = useState(15);

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

  // ── Per-origin monthly series, all in kt, split by coffee type ──────────
  const byOrigin: Record<string, TypeMap> = useMemo(() => {
    const out: Record<string, TypeMap> = {};
    /** Record a month for an origin. `split` may be omitted, in which case
     *  the TYPE_MIX ratio (or nothing) applies. */
    const put = (origin: string, ym: string, totalKt: number,
                 split?: { arabica?: number; robusta?: number }) => {
      if (!ym || !Number.isFinite(totalKt) || totalKt <= 0) return;
      const tm = (out[origin] ??= emptyTypeMap());
      tm.total[ym] = (tm.total[ym] ?? 0) + totalKt;
      const mix = TYPE_MIX[origin];
      const ara = split?.arabica ?? (mix ? totalKt * mix.arabica : undefined);
      const rob = split?.robusta ?? (mix ? totalKt * mix.robusta : undefined);
      if (ara != null && ara > 0) tm.arabica[ym] = (tm.arabica[ym] ?? 0) + ara;
      if (rob != null && rob > 0) tm.robusta[ym] = (tm.robusta[ym] ?? 0) + rob;
    };

    for (const r of cecafe?.series ?? []) {
      if (r.total == null) continue;
      // Cecafé splits green coffee into arabica + conillon (robusta); the
      // soluble/roasted remainder stays in the total only.
      put("Brazil", r.date, bagsToKT(r.total), {
        arabica: r.arabica != null ? bagsToKT(r.arabica) : undefined,
        robusta: r.conillon != null ? bagsToKT(r.conillon) : undefined,
      });
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
      if (r.total_coffee_kg == null) continue;
      put("Indonesia", r.month, kgToKT(r.total_coffee_kg), {
        arabica: r.arabica_green_kg != null ? kgToKT(r.arabica_green_kg) : undefined,
        robusta: r.robusta_green_kg != null ? kgToKT(r.robusta_green_kg) : undefined,
      });
    }
    for (const r of ug?.series ?? []) {
      if (r.total_bags == null) continue;
      put("Uganda", r.month, bagsToKT(r.total_bags), {
        arabica: r.arabica_bags != null ? bagsToKT(r.arabica_bags) : undefined,
        robusta: r.robusta_bags != null ? bagsToKT(r.robusta_bags) : undefined,
      });
    }
    return out;
  }, [cecafe, vnSup, coSup, idn, ug]);

  const origins = useMemo(
    () => ORIGIN_ORDER.filter(o => Object.keys(byOrigin[o]?.total ?? {}).length > 0),
    [byOrigin],
  );

  /** Active series per origin for the selected coffee type. */
  const activeByOrigin = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    origins.forEach(o => { out[o] = byOrigin[o][type] ?? {}; });
    return out;
  }, [byOrigin, origins, type]);

  const allMonths = useMemo(() => {
    const s = new Set<string>();
    origins.forEach(o => Object.keys(byOrigin[o].total).forEach(m => s.add(m)));
    return Array.from(s).sort();
  }, [byOrigin, origins]);

  const latestByOrigin = useMemo(() => {
    const out: Record<string, string> = {};
    origins.forEach(o => {
      const ms = Object.keys(byOrigin[o].total).sort();
      out[o] = ms[ms.length - 1] ?? "";
    });
    return out;
  }, [byOrigin, origins]);

  /** Newest month ANY origin has reported — anchors the rolling axis. */
  const latestMonth = allMonths[allMonths.length - 1] ?? "";
  /** Newest month EVERY origin has reported — the apples-to-apples point. */
  const lastCompleteMonth = useMemo(() => {
    const lasts = origins.map(o => latestByOrigin[o]).filter(Boolean).sort();
    return lasts[0] ?? "";
  }, [origins, latestByOrigin]);

  /** Estimate for a month an origin hasn't reported.
   *    1. Average of that same calendar month over its last ≤3 available
   *       years — the seasonality projection, same method the S&D card
   *       uses for the in-progress crop, so the surfaces can't disagree.
   *    2. If that calendar month is absent from the origin's history
   *       entirely (Colombia's customs series carries no November in any
   *       year), fall back to the mean of its last ≤12 reported months —
   *       a flat run-rate. Without it the stack would dip to zero for
   *       that origin and read as a shipment collapse rather than a hole
   *       in the feed. */
  const seasonalEstimate = useMemo(() => {
    const cache: Record<string, { perMonth: Record<string, number>; runRate: number }> = {};
    return (origin: string, ym: string): number => {
      const key = `${origin}|${type}`;
      const built = (cache[key] ??= (() => {
        const series = activeByOrigin[origin] ?? {};
        const newestFirst = Object.entries(series).sort((a, b) => (a[0] < b[0] ? 1 : -1));
        const byCal: Record<string, number[]> = {};
        newestFirst.forEach(([m, v]) => { (byCal[m.slice(5, 7)] ??= []).push(v); });
        const perMonth: Record<string, number> = {};
        for (const [cal, vals] of Object.entries(byCal)) {
          const take = vals.slice(0, 3);
          perMonth[cal] = take.reduce((s, v) => s + v, 0) / take.length;
        }
        const recent = newestFirst.slice(0, 12).map(([, v]) => v);
        const runRate = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
        return { perMonth, runRate };
      })());
      return built.perMonth[ym.slice(5, 7)] ?? built.runRate;
    };
  }, [activeByOrigin, type]);

  // ── Rolling 12-month axis: latest reported month sits 10th, leaving the
  // last two slots for the forward seasonality projection. ───────────────
  const axisMonths = useMemo(() => {
    if (!latestMonth) return [];
    return Array.from({ length: 12 }, (_, i) => offsetYM(latestMonth, 9 - i));
  }, [latestMonth]);

  const monthlyRows = useMemo(() =>
    axisMonths.map(ym => {
      const row: Record<string, string | number | boolean | null> = {
        ym,
        label: `${monthLabel(ym)} ${ym.slice(2, 4)}`,
      };
      let total = 0;
      let anyProjected = false;
      origins.forEach(o => {
        // "Did this origin report the month at all?" is asked of the TOTAL
        // series, never the type series: an origin that ships none of the
        // selected type (Colombia grows no robusta) has a structural zero,
        // not a missing print, and must not drag the month into
        // "projected" — that used to dot the entire Robusta pace line.
        const reported = byOrigin[o].total[ym] != null;
        const actual = reported ? (activeByOrigin[o]?.[ym] ?? 0) : undefined;
        const isProj = actual == null;
        const v = round1(isProj ? seasonalEstimate(o, ym) : actual);
        // Split each origin into an actual and a projected series so the
        // stack can render the projected part striped without a second
        // chart or a custom shape per bar.
        row[o] = isProj ? 0 : v;
        row[`${o}__proj`] = isProj ? v : 0;
        if (isProj && v > 0) anyProjected = true;
        total += v;
      });
      row.total = round1(total);
      row.projected = anyProjected;
      // Faded prior-year stacks — same origin breakdown, actuals only (a
      // past month that was never reported stays 0 rather than inventing
      // a projection for history).
      ([12, 24] as const).forEach((back, gi) => {
        const suffix = gi === 0 ? "p1" : "p2";
        const pm = offsetYM(ym, back);
        let sum = 0;
        origins.forEach(o => {
          const v = round1(activeByOrigin[o]?.[pm] ?? 0);
          row[`${o}__${suffix}`] = v;
          sum += v;
        });
        row[`total_${suffix}`] = round1(sum);
      });
      return row;
    })
  , [axisMonths, origins, byOrigin, activeByOrigin, seasonalEstimate]);

  /** Which axis months carry any projection — surfaced in the sub-header
   *  so a reader never mistakes an estimate for a customs print. */
  const projectedLabels = useMemo(
    () => monthlyRows.filter(r => r.projected).map(r => String(r.label)),
    [monthlyRows],
  );

  // ── Cumulative pace over the same rolling window ────────────────────────
  // Running total of the window, current vs the same 12 months one and two
  // years back. The current line goes solid while every origin has
  // reported and dotted from the first projected month on, so the reader
  // can see exactly where fact ends and estimate begins. `solid` and
  // `dashed` overlap on the junction month so the two segments join.
  const paceRows = useMemo(() => {
    const lastSolidIdx = monthlyRows.reduce(
      (acc, r, i) => (r.projected ? acc : i), -1);
    let cur = 0, p1 = 0, p2 = 0;
    return monthlyRows.map((r, i) => {
      cur += Number(r.total ?? 0);
      p1  += Number(r.total_p1 ?? 0);
      p2  += Number(r.total_p2 ?? 0);
      const c = round1(cur);
      return {
        label: r.label,
        solid:  lastSolidIdx < 0 || i <= lastSolidIdx ? c : null,
        dashed: lastSolidIdx < 0 || i >= lastSolidIdx ? c : null,
        cum:    c,
        cum_p1: round1(p1),
        cum_p2: round1(p2),
        projected: !!r.projected,
      };
    });
  }, [monthlyRows]);

  /** End-of-window totals for the pace card's sub-header. */
  const paceEnd = paceRows[paceRows.length - 1];

  // ── Coverage / KPI table: rolling 12M per origin + YoY ──────────────────
  const coverage = useMemo(() => {
    const last12 = allMonths.slice(-12);
    const prev12 = last12.map(m => offsetYM(m, 12));
    const rows = origins.map(o => {
      const s = activeByOrigin[o] ?? {};
      const cur  = last12.reduce((acc, m) => acc + (s[m] ?? 0), 0);
      const prev = prev12.reduce((acc, m) => acc + (s[m] ?? 0), 0);
      return {
        origin: o,
        kt: round1(cur),
        prevKt: round1(prev),
        pct: prev > 0 ? Math.round((cur - prev) / prev * 100) : null,
        latest: latestByOrigin[o],
        estimatedMix: !!TYPE_MIX[o]?.estimated && type !== "total",
      };
    }).filter(r => r.kt > 0 || r.prevKt > 0);
    const total     = rows.reduce((s, r) => s + r.kt, 0);
    const totalPrev = rows.reduce((s, r) => s + r.prevKt, 0);
    return {
      rows: rows.map(r => ({ ...r, share: total > 0 ? Math.round(r.kt / total * 1000) / 10 : 0 }))
                .sort((a, b) => b.kt - a.kt),
      total: round1(total),
      totalPrev: round1(totalPrev),
      totalPct: totalPrev > 0 ? Math.round((total - totalPrev) / totalPrev * 100) : null,
    };
  }, [allMonths, origins, activeByOrigin, latestByOrigin, type]);

  // ── Aggregated destinations (origins that publish a breakdown) ──────────
  const { destByKey, destOrigins } = useMemo(() => {
    const out: DestMap = {};
    const contributors: string[] = [];
    const put = (key: string, ym: string, kt: number) => {
      if (!key || !ym || !Number.isFinite(kt) || kt <= 0) return;
      (out[key] ??= {})[ym] = (out[key][ym] ?? 0) + kt;
    };
    const brC = cecafe?.by_country?.countries;
    if (brC && Object.keys(brC).length) {
      contributors.push("Brazil");
      for (const [pt, mv] of Object.entries(brC)) {
        const key = destKey(pt, true);
        for (const [ym, bags] of Object.entries(mv)) put(key, ym, bagsToKT(bags));
      }
    }
    const vnC = vnDest?.countries;
    if (vnC && Object.keys(vnC).length) {
      contributors.push("Vietnam");
      for (const [c, mv] of Object.entries(vnC)) {
        const key = destKey(c);
        for (const [ym, t] of Object.entries(mv)) put(key, ym, tToKT(t));
      }
    }
    if ((idn?.series ?? []).some(r => (r.by_destination ?? []).length)) {
      contributors.push("Indonesia");
      for (const r of idn?.series ?? []) {
        for (const d of r.by_destination ?? []) put(destKey(d.country), r.month, kgToKT(d.kg));
      }
    }
    if ((ug?.series ?? []).some(r => (r.by_destination ?? []).length)) {
      contributors.push("Uganda");
      for (const r of ug?.series ?? []) {
        for (const d of r.by_destination ?? []) put(destKey(d.country), r.month, bagsToKT(d.bags ?? 0));
      }
    }
    return { destByKey: out, destOrigins: contributors };
  }, [cecafe, vnDest, idn, ug]);

  const destWindowMonths = useMemo(() => {
    const n = { "3M": 3, "6M": 6, "12M": 12, "24M": 24 }[destWin];
    return allMonths.slice(-n);
  }, [allMonths, destWin]);
  const destPrevMonths = useMemo(() => destWindowMonths.map(m => offsetYM(m, 12)), [destWindowMonths]);

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
      .map(([key, v]) => {
        const name = prettyDest(key);
        return {
          label: name.length > 22 ? name.slice(0, 21) + "…" : name,
          current: round1(v.current),
          prev: round1(v.prev),
          pct: v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: null as number | null,
        };
      });
  }, [destByKey, destWindowMonths, destPrevMonths, mode, topN]);

  const fmtRange = (ms: string[]) => ms.length
    ? `${monthLabel(ms[0])} ${ms[0].slice(0, 4)}–${monthLabel(ms[ms.length - 1])} ${ms[ms.length - 1].slice(0, 4)}`
    : "";
  const destPeriodLabel = fmtRange(destWindowMonths);
  const destPrevLabel   = fmtRange(destPrevMonths);

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
  const typeNote = type === "total" ? "" : ` · ${type === "arabica" ? "Arabica" : "Robusta"} only`;
  const anyEstimatedMix = coverage.rows.some(r => r.estimatedMix);

  return (
    <div className="space-y-4">
      {/* Panel switch: the exports aggregation vs the world S&D statement. */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {([
          { id: "exports" as const, label: "Exports" },
          { id: "balance" as const, label: "Supply & Demand" },
        ]).map(t => (
          <button key={t.id} onClick={() => setPanel(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              panel === t.id
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {panel === "balance" ? <WorldBalanceSheet /> : (
      <>
      {/* ── Headline KPIs ─────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            World exports — {coverage.rows.length} origins aggregated{typeNote}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              {(["total", "arabica", "robusta"] as const).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`text-[9px] px-2 py-0.5 capitalize transition-colors ${
                    type === t ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                  }`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="text-[8px] text-slate-600">kt · rolling 12M</div>
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
            <div className="text-[8px] uppercase tracking-wide font-bold text-slate-400 mb-0.5">YoY</div>
            <div className={`text-sm font-extrabold ${
              coverage.totalPct == null ? "text-slate-400"
                : chgTone(coverage.totalPct)}`}>
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
            <div className="text-[7px] text-slate-600 mt-0.5">every origin reported</div>
          </div>
        </div>
      </div>

      {/* ── Rolling 12M chart: actuals + seasonality projection ───────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Monthly exports by origin
            <span className="ml-2 text-slate-600 normal-case">
              · rolling 12M{typeNote}
              {projectedLabels.length > 0 && (
                <span className="ml-1">· projected: {projectedLabels.join(", ")}</span>
              )}
            </span>
          </div>
          <button onClick={() => setShowPrior(v => !v)}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
              showPrior
                ? "border-slate-600 bg-slate-700 text-slate-200"
                : "border-slate-700 text-slate-500 hover:text-slate-300"
            }`}
            title="Overlay the same months one and two years ago">
            Prior years
          </button>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyRows} margin={{ top: 14, right: 8, left: -8, bottom: 0 }}>
            {/* One striped pattern per origin so a projected month reads as
                an estimate at a glance, in that origin's own colour. */}
            <defs>
              {origins.map(o => (
                <pattern key={o} id={`tot-proj-${o}`} patternUnits="userSpaceOnUse"
                  width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={ORIGIN_COLORS[o] ?? "#64748b"} fillOpacity="0.25" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={ORIGIN_COLORS[o] ?? "#64748b"} strokeWidth="3" />
                </pattern>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.round(Number(v))}kt`} />
            <Tooltip contentStyle={TT_STYLE}
              labelFormatter={(l, items) => {
                const p = items?.[0]?.payload as
                  { projected?: boolean; total?: number; total_p1?: number; total_p2?: number } | undefined;
                const head = `${l}${p?.projected ? " · incl. seasonality projection" : ""} — ${round1(p?.total ?? 0)} kt`;
                if (!showPrior) return head;
                return `${head}  (1yr ${round1(p?.total_p1 ?? 0)} · 2yr ${round1(p?.total_p2 ?? 0)})`;
              }}
              formatter={((v, n) => {
                if (Number(v) === 0) return [null, null];
                const name = String(n);
                const origin = name.replace(/__(proj|p1|p2)$/, "");
                const color = ORIGIN_COLORS[origin] ?? "#94a3b8";
                const suffix = name.endsWith("__proj") ? " (proj.)"
                             : name.endsWith("__p1")   ? " · 1yr ago"
                             : name.endsWith("__p2")   ? " · 2yr ago"
                             : "";
                const dim = name.endsWith("__p1") ? 0.65 : name.endsWith("__p2") ? 0.4 : 1;
                return [
                  <span key="v" style={{ color, opacity: dim }}>{`${v} kt`}</span>,
                  `${origin}${suffix}` as NameType,
                ];
              }) satisfies Formatter<ValueType, NameType>} />
            {/* Three grouped stacks per month — current, 1yr ago, 2yr ago —
                each broken down by origin, prior years faded (same pattern
                as the per-country Monthly Export Volume chart). Bars are
                declared stack-group by stack-group because recharts lays
                the groups out in declaration order. */}
            {origins.flatMap((o, i) => [
              <Bar key={o} dataKey={o} name={o} stackId="cur" fill={ORIGIN_COLORS[o] ?? "#64748b"} />,
              <Bar key={`${o}__proj`} dataKey={`${o}__proj`} name={`${o}__proj`} stackId="cur"
                fill={`url(#tot-proj-${o})`}
                radius={i === origins.length - 1 ? [2, 2, 0, 0] : undefined}>
                {i === origins.length - 1 && (
                  <LabelList dataKey="total" position="top" formatter={ktLabel}
                    style={{ fill: "#94a3b8", fontSize: 8 }} />
                )}
              </Bar>,
            ])}
            {showPrior && origins.map((o, i) => (
              <Bar key={`${o}__p1`} dataKey={`${o}__p1`} name={`${o}__p1`} stackId="p1"
                fill={ORIGIN_COLORS[o] ?? "#64748b"} opacity={0.55}
                radius={i === origins.length - 1 ? [2, 2, 0, 0] : undefined} />
            ))}
            {showPrior && origins.map((o, i) => (
              <Bar key={`${o}__p2`} dataKey={`${o}__p2`} name={`${o}__p2`} stackId="p2"
                fill={ORIGIN_COLORS[o] ?? "#64748b"} opacity={0.28}
                radius={i === origins.length - 1 ? [2, 2, 0, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* Hand-rolled legend: recharts' own can't express "striped = the
            same origins, projected" without duplicating every series. */}
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[9px] text-slate-400">
          {origins.map(o => (
            <span key={o} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: ORIGIN_COLORS[o] ?? "#64748b" }} />
              {o}
            </span>
          ))}
          {projectedLabels.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border border-slate-500"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, #94a3b8 0 2px, transparent 2px 4px)",
                }} />
              projected
            </span>
          )}
          {showPrior && (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: "#94a3b8", opacity: 0.55 }} />
                1 year ago
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: "#94a3b8", opacity: 0.28 }} />
                2 years ago
              </span>
            </>
          )}
        </div>

        <div className="text-[8px] text-slate-600 leading-relaxed">
          Axis is a rolling 12 months ending two months ahead of the newest customs print,
          so the forward window is always visible. Solid bars are reported months; striped
          bars are a <strong className="text-slate-500">seasonality projection</strong> —
          the average of that same calendar month over the origin&apos;s last three years,
          used both for months an origin hasn&apos;t published yet and for the two future
          months (where a feed carries no history at all for that calendar month, the
          origin&apos;s 12-month run-rate stands in). The two faded columns beside each month
          are the same month one and two years ago, broken down by the same origins —
          actuals only, never projected. Each origin is normalised to kt from its native unit.
          {type !== "total" && (
            <>
              {" "}Type split: Brazil (arabica/conillon), Indonesia and Uganda publish theirs
              per month{anyEstimatedMix && (
                <> ; Vietnam is apportioned at the balance-sheet crop mix (~96% robusta) and
                Colombia is 100% arabica by crop</>
              )}.
            </>
          )}
        </div>
      </div>

      {/* ── Cumulative pace ───────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Total crop-year pace
            <span className="ml-2 text-slate-600 normal-case">
              · cumulative over the same rolling 12M{typeNote}
            </span>
          </div>
          {paceEnd && (
            <div className="text-[9px] text-slate-500 font-mono">
              <span className="text-emerald-400 font-bold">{paceEnd.cum.toLocaleString()} kt</span>
              <span className="text-slate-600"> vs </span>
              {paceEnd.cum_p1.toLocaleString()}
              <span className="text-slate-600"> / </span>
              {paceEnd.cum_p2.toLocaleString()}
              {paceEnd.cum_p1 > 0 && (
                <span className={`ml-1.5 font-bold ${
                  paceEnd.cum >= paceEnd.cum_p1 ? "text-emerald-400" : "text-red-400"}`}>
                  {paceEnd.cum >= paceEnd.cum_p1 ? "+" : ""}
                  {Math.round((paceEnd.cum - paceEnd.cum_p1) / paceEnd.cum_p1 * 100)}%
                </span>
              )}
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={paceRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.round(Number(v))}kt`} />
            <Tooltip contentStyle={TT_STYLE}
              labelFormatter={(l, items) => {
                const p = items?.[0]?.payload as { projected?: boolean } | undefined;
                return `${l}${p?.projected ? " · projected" : ""}`;
              }}
              formatter={((v, n) => {
                const name = String(n);
                // solid + dashed are the same series — show it once.
                if (name === "dashed") return [null, null];
                const label = name === "solid" ? "This window"
                            : name === "cum_p1" ? "1 year ago"
                            : "2 years ago";
                const color = name === "solid" ? "#22c55e"
                            : name === "cum_p1" ? "#94a3b8" : "#64748b";
                return [
                  <span key="v" style={{ color }}>{`${v} kt`}</span>,
                  label as NameType,
                ];
              }) satisfies Formatter<ValueType, NameType>} />
            <Line dataKey="cum_p2" name="cum_p2" type="monotone" stroke="#475569"
              strokeWidth={1.5} dot={false} connectNulls />
            <Line dataKey="cum_p1" name="cum_p1" type="monotone" stroke="#94a3b8"
              strokeWidth={1.5} strokeOpacity={0.7} dot={false} connectNulls />
            <Line dataKey="solid" name="solid" type="monotone" stroke="#22c55e"
              strokeWidth={2.5} dot={false} connectNulls />
            <Line dataKey="dashed" name="dashed" type="monotone" stroke="#22c55e"
              strokeWidth={2.5} strokeDasharray="4 4" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[9px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: "#22c55e" }} />
            this window (reported)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0" style={{ borderTop: "2px dashed #22c55e" }} />
            projected
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: "#94a3b8", opacity: 0.7 }} />
            1 year ago
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: "#475569" }} />
            2 years ago
          </span>
        </div>
        <div className="text-[8px] text-slate-600 leading-relaxed">
          Running total across the same rolling window as the chart above, so the three
          curves always compare identical calendar months. The green line is solid while
          every origin has reported and switches to dotted from the first month carrying a
          seasonality projection — the gap between the dotted end point and the grey lines
          is the season&apos;s pace versus the last two years.
        </div>
      </div>

      {/* ── Per-origin coverage table ─────────────────────────────────── */}
      <div className={CARD}>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Origin contribution · rolling 12M{typeNote}
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
                  {r.estimatedMix && (
                    <span className="text-slate-600 ml-1" title="Type split apportioned at the crop mix — the monthly feed carries no split">
                      *
                    </span>
                  )}
                </td>
                <td className="text-right py-1 px-1 text-slate-300">{r.kt.toLocaleString()}</td>
                <td className={`text-right py-1 px-1 ${
                  r.pct == null ? "text-slate-600" : chgTone(r.pct)}`}>
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
                  : chgTone(coverage.totalPct)}`}>
                {coverage.totalPct == null ? "—" : `${coverage.totalPct >= 0 ? "+" : ""}${coverage.totalPct}%`}
              </td>
              <td className="text-right py-1 px-1 text-slate-500">100%</td>
              <td />
            </tr>
          </tbody>
        </table>
        {anyEstimatedMix && (
          <div className="text-[8px] text-slate-600 italic">
            * Type split apportioned at the crop mix (the origin&apos;s monthly feed publishes
            no arabica/robusta breakdown).
          </div>
        )}
      </div>

      {/* ── Aggregated destinations ───────────────────────────────────── */}
      {destRows.length > 0 && (
        <div className={CARD}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Export by destination — all origins
              <span className="ml-2 text-slate-600 normal-case">· {destPeriodLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                {DEST_WINDOWS.map(w => (
                  <button key={w} onClick={() => setDestWin(w)}
                    className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                      destWin === w ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                    }`}>
                    {w}
                  </button>
                ))}
              </div>
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
                    (name === "current" ? destPeriodLabel : destPrevLabel) as NameType,
                  ];
                }) satisfies Formatter<ValueType, NameType>} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
                formatter={(v) => (
                  <span style={{ color: "#cbd5e1" }}>
                    {v === "current" ? destPeriodLabel : destPrevLabel}
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
            so treat this as a shape-of-demand ranking rather than a world total. Actuals
            only; no projection applied.
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
