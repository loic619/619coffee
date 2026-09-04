"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

import { fmtDateLabel, fmtMonth } from "@/lib/formatters";
import { CIF_FINANCING_RATE, FEU_MT, ORIGIN_EXPORT_COSTS, SAMPLING_GRADING_USD_MT, fobbingUsdMt } from "@/lib/originCosts";
import { PARITY_ADDERS_USD } from "@/lib/research/certStocksParity";
import { KC_CENTS_TO_USD_MT } from "@/lib/units";

interface HistoryPoint {
  date:  string;
  price: number;
}

interface Origin {
  name:      string;
  source:    string;
  currency:  string;
  unit:      string;
  color:     string;
  commodity?: "robusta" | "arabica";
  history:   HistoryPoint[];
}

interface OriginPricesData {
  scraped_at: string;
  origins:    Record<string, Origin>;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Display order; the panel filters this to the selected commodity + origins
// that actually have a price history.
const ORIGIN_ORDER = [
  "vietnam", "brazil_conilon", "uganda",          // robusta
  "brazil_arabica", "guatemala_estrictamente_duro", // arabica
  "uganda_drugar", "uganda_wugar",
] as const;
type OriginKey = string;
type Commodity = "robusta" | "arabica";

// Price basis: farmgate as scraped, FOB (+ fobbing cost stack), or CIF Antwerp
// (+ ocean freight + 8% p.a. financing over the transit time). FOB/CIF are
// USD/MT constructions, so those bases force the USD/MT view.
type Basis = "farmgate" | "fob" | "cif";

// freight.json: FBX-derived USD/FEU per route — latest per-route rates plus a
// (shorter) daily history with one column per route id.
interface FreightData {
  routes?:  { id: string; rate: number }[];
  history?: ({ date: string } & Record<string, number | string>)[];
}

type Window = "1M" | "3M" | "6M" | "1Y" | "2Y" | "MAX";
const WINDOW_DAYS: Record<Window, number> = {
  "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "MAX": Infinity,
};

/** Axis ticks: MM/DD reads well over months, but over a year or more the same
 *  tick recurs each year, so long windows switch to MMM-YY. */
function axisTickFor(w: Window): (iso: string) => string {
  const short = w === "1M" || w === "3M" || w === "6M";
  return short ? fmtDateLabel : (iso: string) => fmtMonth(String(iso).slice(0, 7));
}

/** Tooltip heading: the full date, year included. The axis ticks stay MM/DD
 *  for density, but the tooltip is where "which year am I on?" gets answered
 *  — and on a 1Y+ window that is not a rhetorical question. */
function fmtTooltipDate(iso: unknown): string {
  const s = String(iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parseInt(m[3], 10)} ${MON[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** First date in the window, as an ISO string to compare `h.date` against.
 *  MAX returns "" — every ISO date sorts after it, so nothing is filtered
 *  and the chart shows each origin's full accumulated history (Vietnam is
 *  ~3 years, Guatemala a few months; series simply start where they start). */
function windowCutoff(w: Window): string {
  const days = WINDOW_DAYS[w];
  if (!Number.isFinite(days)) return "";
  const c = new Date();
  c.setDate(c.getDate() - days);
  return c.toISOString().slice(0, 10);
}

// Native unit → metric tonne multiplier, so every origin converts to a single
// comparable USD/MT figure (1 cwt = 45.359237 kg; 1 saca = 60 kg; ¢/lb via
// 2204.62 lb/MT ÷ 100). USD/cwt and ¢/lb are numerically identical (×22.0462).
const UNIT_TO_MT: Record<string, number> = {
  per_kg:            1000,
  per_saca_60kg:     1000 / 60,
  per_cwt:           1000 / 45.359237,
  cents_lb:          KC_CENTS_TO_USD_MT,   // from lib/units — one definition
  per_quintal_100lb: 1000 / 45.359237,   // Guatemala café oro quintal = 100 lb
};

const FUTURES_COLOR = "#e2e8f0";
const FUTURES_KEY   = "__futures";

// Daily FX close (units of currency per 1 USD), ascending by date.
type FxSeries = Record<string, { date: string; close: number }[]>;

interface OiContract { symbol: string; oi: number; last_price: number }
interface OiSnapshot { date: string; contracts: OiContract[] }
interface OiHistory  { arabica?: OiSnapshot[]; robusta?: OiSnapshot[] }

// Long-lived front-month price history (from the 5-year contract archive, not
// the 14-day OI window). arabica price is US¢/lb, robusta USD/MT.
interface FrontPricePoint { date: string; price: number }
interface FuturesPriceHistory { arabica?: FrontPricePoint[]; robusta?: FrontPricePoint[] }

// Rate on a given date: the last close on or before it (forward-fill across
// weekends/holidays / dates past the last FX point). Falls back to the earliest
// close for dates before the series starts.
function rateOnDate(hist: { date: string; close: number }[] | undefined, date: string): number | null {
  if (!hist?.length) return null;
  let rate: number | null = null;
  for (const h of hist) {
    if (h.date <= date) rate = h.close;
    else break;
  }
  return rate ?? hist[0].close;
}

// Convert a native-currency, native-unit farmgate price to USD/MT using the FX
// rate for THAT day. USD-quoted origins (Uganda) need the unit factor only.
function toUsdMtOnDate(price: number, unit: string, currency: string, date: string, fx: FxSeries): number | null {
  const factor = UNIT_TO_MT[unit];
  if (factor == null) return null;
  if (currency === "USD") return price * factor;
  const rate = rateOnDate(fx[currency], date);
  if (!rate) return null;
  return (price / rate) * factor;
}

function fmtNative(price: number, unit: string, currency: string): string {
  if (unit === "cents_lb") return `${price.toFixed(2)} ¢/lb`;
  if (unit === "per_quintal_100lb") {
    const n = price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === "GTQ" ? `Q${n}/qq` : `$${n}/qq`;
  }
  const big = Math.abs(price) >= 1000;
  const n = big
    ? price.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : price.toFixed(2);
  const unitLabel = unit === "per_kg" ? "/kg"
                  : unit === "per_saca_60kg" ? "/saca"
                  : unit === "per_cwt" ? "/cwt"
                  : "";
  const sym = currency === "BRL" ? "R$ " : currency === "USD" ? "$ " : "";
  return `${sym}${n}${unitLabel}${!sym ? ` ${currency}` : ""}`;
}

export default function OriginPricesPanel() {
  const [data,      setData]      = useState<OriginPricesData | null>(null);
  const [error,     setError]     = useState(false);
  // Defaults: six months of USD/MT price levels — the view where the origin
  // lines and the exchange overlay share a scale and the differential reads
  // off directly. Index and native units stay one click away.
  const [window,    setWindow]    = useState<Window>("6M");
  const [usd,       setUsd]       = useState(true);
  const [axisMode,  setAxisMode]  = useState<"index" | "value">("value");
  const [commodity, setCommodity] = useState<Commodity>("robusta");
  const [basis,     setBasis]     = useState<Basis>("farmgate");
  const [fx,        setFx]        = useState<FxSeries>({});
  const [freight,   setFreight]   = useState<FreightData | null>(null);
  const [oiHist,    setOiHist]    = useState<OiHistory | null>(null);
  const [priceHist, setPriceHist] = useState<FuturesPriceHistory | null>(null);

  // FOB/CIF only exist in USD/MT space; the basis toggle overrides Native.
  const effUsd = usd || basis !== "farmgate";

  useEffect(() => {
    fetch("/data/origin_prices_history.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
    // Daily FX history (one close per day per pair) for the USD-equivalent
    // toggle, so each historical local price converts at its own day's rate.
    fetch("/data/fx_history.json")
      .then(r => r.ok ? r.json() : null)
      .then((fh: { pairs?: Record<string, { history?: { date: string; close: number }[] }> } | null) => {
        if (!fh?.pairs) return;
        const series: FxSeries = {};
        for (const [pair, v] of Object.entries(fh.pairs)) {
          const m = pair.match(/^([A-Z]{3})=X$/);   // "VND=X" → "VND"
          if (m && v?.history?.length) {
            series[m[1]] = [...v.history].sort((a, b) => a.date.localeCompare(b.date));
          }
        }
        setFx(series);
      })
      .catch(() => { /* native-only */ });
    // Long front-month price history (5-year contract archive) for the KC/RC
    // overlay — spans the whole selected window, not just 14 days.
    fetch("/data/futures_price_history.json")
      .then(r => r.ok ? r.json() : null)
      .then((ph: FuturesPriceHistory | null) => { if (ph) setPriceHist(ph); })
      .catch(() => { /* fall back to oi_history */ });
    // FBX freight per route, for the CIF Antwerp basis (per-day where the
    // history covers the date, latest flat rate otherwise).
    fetch("/data/freight.json")
      .then(r => r.ok ? r.json() : null)
      .then((f: FreightData | null) => { if (f) setFreight(f); })
      .catch(() => { /* CIF falls back to FOB-only if freight is missing */ });
    // Fallback: the 14-day OI window (used only if the price-history file is
    // missing, e.g. before its first export run).
    fetch("/data/oi_history.json")
      .then(r => r.ok ? r.json() : null)
      .then((oi: OiHistory | null) => { if (oi) setOiHist(oi); })
      .catch(() => { /* no overlay */ });
  }, []);

  // Per-route freight history (sorted, for as-of lookups) + latest flat rates.
  const freightByRoute = useMemo(() => {
    const perRoute = new Map<string, { dates: string[]; by: Map<string, number> }>();
    for (const row of freight?.history ?? []) {
      if (!row?.date) continue;
      for (const [key, val] of Object.entries(row)) {
        if (key === "date" || typeof val !== "number") continue;
        let r = perRoute.get(key);
        if (!r) { r = { dates: [], by: new Map() }; perRoute.set(key, r); }
        r.dates.push(row.date as string);
        r.by.set(row.date as string, val);
      }
    }
    perRoute.forEach(r => r.dates.sort());
    const latest = new Map((freight?.routes ?? []).map(r => [r.id, r.rate]));
    return { perRoute, latest };
  }, [freight]);

  // Ocean freight USD/MT on a date: forward-filled route history where it
  // covers the date, else the latest flat route rate. USD/FEU ÷ 21.6 MT.
  const freightMtOnDate = useCallback((route: string, date: string): number | null => {
    const rh = freightByRoute.perRoute.get(route);
    let feu: number | null = null;
    if (rh && rh.dates.length && date >= rh.dates[0]) {
      for (const d of rh.dates) { if (d <= date) feu = rh.by.get(d)!; else break; }
    }
    if (feu == null) feu = freightByRoute.latest.get(route) ?? null;
    return feu == null ? null : feu / FEU_MT;
  }, [freightByRoute]);

  // One converter for chart + KPI: native price, or USD/MT at that day's FX,
  // lifted to the selected basis — FOB adds the research-tab fobbing stack;
  // CIF Antwerp adds ocean freight and 8% p.a. financing on the FOB value over
  // the route's transit time. Returns null (a gap, not a wrong number) when
  // FX, the cost table or freight can't price that origin/date.
  const convertPoint = useCallback((k: OriginKey, h: HistoryPoint): number | null => {
    if (h.price == null) return null;
    const o = data?.origins?.[k];
    if (!o) return null;
    if (!effUsd) return h.price;
    const usdMt = toUsdMtOnDate(h.price, o.unit, o.currency, h.date, fx);
    if (usdMt == null || basis === "farmgate") return usdMt;
    const cost = ORIGIN_EXPORT_COSTS[k];
    if (!cost) return null;
    const fob = usdMt + fobbingUsdMt(cost.fobLabel, usdMt);
    if (basis === "fob") return fob;
    const fr = freightMtOnDate(cost.freightRoute, h.date);
    if (fr == null) return null;
    return fob + fr + fob * CIF_FINANCING_RATE * (cost.transitDays / 365);
  }, [data, effUsd, basis, fx, freightMtOnDate]);

  // Origins of the selected commodity that actually have a price history.
  const presentOrigins = useMemo<OriginKey[]>(
    () => ORIGIN_ORDER.filter(k => {
      const o = data?.origins?.[k];
      return o && o.commodity === commodity && (o.history?.length ?? 0) > 0;
    }),
    [data, commodity]
  );

  // Front-month futures price (USD/MT) per day, for the active commodity. KC is
  // ¢/lb → USD/MT; RC is already $/MT. Prefer the long price-history file (5-year
  // archive) so the overlay spans the window; fall back to the 14-day oi_history
  // (front = highest open interest) only if the long file isn't available.
  const futuresSeries = useMemo(() => {
    const toUsdMt = (price: number) =>
      commodity === "arabica" ? price * KC_CENTS_TO_USD_MT : price;

    const long = commodity === "arabica" ? priceHist?.arabica : priceHist?.robusta;
    if (long?.length) {
      return long
        .filter(p => p.price != null)
        .map(p => ({ date: p.date, value: toUsdMt(p.price) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    const snaps = commodity === "arabica" ? oiHist?.arabica : oiHist?.robusta;
    if (!snaps?.length) return [] as { date: string; value: number }[];
    return snaps
      .map(s => {
        const cs = s.contracts ?? [];
        if (!cs.length) return null;
        const front = cs.reduce((b, c) => (c.oi ?? 0) > (b.oi ?? 0) ? c : b, cs[0]);
        if (front?.last_price == null) return null;
        return { date: s.date, value: toUsdMt(front.last_price) };
      })
      .filter((x): x is { date: string; value: number } => x != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [oiHist, priceHist, commodity]);

  const futuresName = commodity === "arabica" ? "ICE NY Arabica (KC)" : "ICE London Robusta (RC)";
  // The futures price is a USD/MT figure, so only overlay it where the origins
  // share that scale: any index view, or a USD/MT value view (FOB/CIF included
  // — comparing CIF Antwerp against the exchange front month IS the point).
  const showFutures = futuresSeries.length > 0 && (axisMode === "index" || effUsd);

  // Cost bands: on the USD/MT Value view, stack the REMAINING export costs
  // above each origin line as translucent same-color surfaces, so the top edge
  // vs the KC/RC overlay reads directly as delivering above or below the
  // exchange. What remains depends on the basis:
  //   farmgate → +fobbing, then +freight & adders (tendering)
  //   FOB      → +freight & adders (tendering) only
  //   CIF ANR  → +ICE sampling/grading fees, plus the origin/quality delivery
  //              adjustment where the growth isn't par (e.g. BR semi-washed
  //              tenders to KC at a 900-pt discount → +$198/MT to match).
  const showCostBands = effUsd && axisMode === "value";

  // All-in (top-of-stack) value for one point: what this origin costs delivered
  // into an exchange warehouse on the selected basis. Also defines "cheapest".
  const allInValue = useCallback((k: OriginKey, h: HistoryPoint): number | null => {
    const v = convertPoint(k, h);
    if (v == null) return null;
    const cost = ORIGIN_EXPORT_COSTS[k];
    if (!cost) return null;
    if (basis === "cif") {
      return v + SAMPLING_GRADING_USD_MT[commodity]
               + Math.max(0, -(cost.exchangePremiumUsdMt ?? 0));
    }
    const fr = freightMtOnDate(cost.freightRoute, h.date);
    if (fr == null) return null;
    const fob = basis === "farmgate" ? v + cost.fobbingUsdMt : v;
    return fob + fr + PARITY_ADDERS_USD;
  }, [convertPoint, basis, commodity, freightMtOnDate]);

  // Cheapest origin = lowest all-in cost at its latest in-window quote. That is
  // the one that actually sets tender parity, so it's the sensible default to
  // shade; stacking every origin's bands buries it in overlapping fills.
  const cheapestOrigin = useMemo<OriginKey | null>(() => {
    if (!data) return null;
    const cutoffIso = windowCutoff(window);
    let best: OriginKey | null = null, bestVal = Infinity;
    for (const k of presentOrigins) {
      const inWindow = (data.origins[k]?.history ?? []).filter(h => h.date >= cutoffIso);
      const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
      const v = last ? allInValue(k, last) : null;
      if (v != null && v < bestVal) { bestVal = v; best = k; }
    }
    return best;
  }, [data, window, presentOrigins, allInValue]);

  // null = follow the cheapest automatically; an array = explicit user pick.
  const [bandSel, setBandSel] = useState<OriginKey[] | null>(null);
  const activeBands = useMemo(
    () => new Set(bandSel ?? (cheapestOrigin ? [cheapestOrigin] : [])),
    [bandSel, cheapestOrigin]
  );
  const toggleBand = (k: OriginKey) => {
    const next = new Set(activeBands);
    if (next.has(k)) next.delete(k); else next.add(k);
    setBandSel(Array.from(next));
  };

  const chartData = useMemo(() => {
    if (!data) return [];
    const cutoffIso = windowCutoff(window);

    // Per-point chart value on the selected basis (see convertPoint).
    const valueOf = convertPoint;

    // Union of dates across present origins + the futures overlay, in window.
    const dateSet = new Set<string>();
    for (const k of presentOrigins) {
      for (const h of data.origins[k]?.history ?? []) if (h.date >= cutoffIso) dateSet.add(h.date);
    }
    if (showFutures) for (const f of futuresSeries) if (f.date >= cutoffIso) dateSet.add(f.date);
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    const rebase = axisMode === "index";

    // Bases for rebasing (first in-window value > 0).
    const base: Record<string, number | null> = {};
    for (const k of presentOrigins) {
      const hist = data.origins[k]?.history.filter(h => h.date >= cutoffIso) ?? [];
      base[k] = hist.map(h => valueOf(k, h)).find(v => v != null && v > 0) ?? null;
    }
    const fMap   = new Map(futuresSeries.map(f => [f.date, f.value]));
    const fBase  = futuresSeries.filter(f => f.date >= cutoffIso).find(f => f.value > 0)?.value ?? null;

    return dates.map(d => {
      const row: Record<string, number | string | null | [number, number]> = { date: d };
      for (const k of presentOrigins) {
        const point = data.origins[k]?.history.find(h => h.date === d);
        const v = point ? valueOf(k, point) : null;
        row[k] = v == null ? null : rebase ? (base[k] ? (v / base[k]!) * 100 : null) : v;
        // Range-area bands stacked on the line's USD/MT value (value view
        // only, so `v` is the unrebased figure on the selected basis).
        if (showCostBands && activeBands.has(k) && v != null) {
          const cost = ORIGIN_EXPORT_COSTS[k];
          if (cost) {
            if (basis === "farmgate") {
              const fob = v + fobbingUsdMt(cost.fobLabel, v);
              row[`${k}__fob`] = [v, fob];
              const fr = freightMtOnDate(cost.freightRoute, d);
              if (fr != null) row[`${k}__tender`] = [fob, fob + fr + PARITY_ADDERS_USD];
            } else if (basis === "fob") {
              const fr = freightMtOnDate(cost.freightRoute, d);
              if (fr != null) row[`${k}__tender`] = [v, v + fr + PARITY_ADDERS_USD];
            } else {
              // CIF: only the exchange fixed fees + quality/origin adjustment.
              const sg = SAMPLING_GRADING_USD_MT[commodity];
              const qualityAdj = Math.max(0, -(cost.exchangePremiumUsdMt ?? 0));
              row[`${k}__cert`] = [v, v + sg + qualityAdj];
            }
          }
        }
      }
      if (showFutures) {
        const fv = fMap.get(d) ?? null;
        row[FUTURES_KEY] = fv == null ? null : rebase ? (fBase ? (fv / fBase) * 100 : null) : fv;
      }
      return row;
    });
  }, [data, window, presentOrigins, convertPoint, axisMode, futuresSeries, showFutures, showCostBands, activeBands, freightMtOnDate, basis, commodity]);

  // Differential to the exchange front month, USD/MT, per origin per day: the
  // origin's price on the selected basis minus the last futures settle on or
  // before that date (physical quotes land on days the exchange is shut).
  // Always computed on unrebased USD/MT values, so it is independent of the
  // Index/Value axis choice; it only needs the USD/MT basis to exist.
  const showDiff = effUsd && futuresSeries.length > 0;
  const diffData = useMemo(() => {
    if (!data || !showDiff) return [] as Record<string, number | string | null>[];
    const cutoffIso = windowCutoff(window);
    const dateSet = new Set<string>();
    for (const k of presentOrigins) {
      for (const h of data.origins[k]?.history ?? []) if (h.date >= cutoffIso) dateSet.add(h.date);
    }
    const dates = Array.from(dateSet).sort();
    let fi = -1;                                   // pointer into the sorted futures series
    const rows: Record<string, number | string | null>[] = [];
    for (const d of dates) {
      while (fi + 1 < futuresSeries.length && futuresSeries[fi + 1].date <= d) fi++;
      if (fi < 0) continue;
      const fv = futuresSeries[fi].value;
      const row: Record<string, number | string | null> = { date: d, label: fmtDateLabel(d) };
      let any = false;
      for (const k of presentOrigins) {
        const point = data.origins[k]?.history.find(h => h.date === d);
        const v = point ? convertPoint(k, point) : null;
        row[k] = v == null ? null : v - fv;
        if (v != null) any = true;
      }
      if (any) rows.push(row);
    }
    return rows;
  }, [data, showDiff, window, presentOrigins, futuresSeries, convertPoint]);

  // Latest differential per origin, for the KPI cards.
  const latestDiff = useMemo(() => {
    const out: Record<string, number> = {};
    for (let i = diffData.length - 1; i >= 0; i--) {
      for (const k of presentOrigins) {
        const v = diffData[i][k];
        if (out[k] === undefined && typeof v === "number") out[k] = v;
      }
    }
    return out;
  }, [diffData, presentOrigins]);

  const stats = useMemo(() => {
    if (!data) return [] as { key: OriginKey; name: string; latest: HistoryPoint | null; pct: number | null; color: string; unit: string; currency: string; source: string; count: number }[];
    const cutoffIso = windowCutoff(window);

    return presentOrigins.map(k => {
      const o = data.origins[k];
      const inWindow = o.history.filter(h => h.date >= cutoffIso);
      const firstPt  = inWindow.find(h => h.price > 0) ?? null;
      const last     = inWindow.length ? inWindow[inWindow.length - 1] : null;
      const conv = (h: HistoryPoint) => convertPoint(k, h);
      const fv = firstPt ? conv(firstPt) : null;
      const lv = last ? conv(last) : null;
      const pct = fv && lv ? ((lv - fv) / fv) * 100 : null;
      return {
        key: k, name: o.name, latest: last, pct,
        color: o.color, unit: o.unit, currency: o.currency,
        source: o.source, count: inWindow.length,
      };
    });
  }, [data, window, presentOrigins, convertPoint]);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Origin prices unavailable — origin_prices_history.json failed to load.
        Will populate after the next export-and-publish run.
      </div>
    );
  }
  if (!data) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading origin prices…</div>;
  }

  const fmtTick = (v: number) => axisMode === "index" ? v.toFixed(0) : v.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Origin Farmgate Prices</h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Local farmgate prices per origin, liftable to FOB (+ the Origin Logistics fobbing stack) or
            CIF Antwerp (+ FBX ocean freight ÷ {FEU_MT} MT/FEU + {(CIF_FINANCING_RATE * 100).toFixed(0)}% p.a.
            financing on FOB over the route&apos;s transit time). Index view rebases each series to 100 at the
            start of the window (cross-origin % moves); Value view plots the actual price.
            The {futuresName} front month is overlaid for context. Last update {new Date(data.scraped_at).toISOString().slice(0,10)}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Robusta ⇄ Arabica */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["robusta","Robusta"],["arabica","Arabica"]] as const).map(([c, label]) => (
              <button key={c} onClick={() => setCommodity(c)}
                className={`px-2.5 py-1.5 transition ${commodity === c ? "bg-amber-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Farmgate ⇄ FOB ⇄ CIF Antwerp basis */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["farmgate","Farmgate"],["fob","FOB"],["cif","CIF ANR"]] as const).map(([b, label]) => (
              <button key={b} onClick={() => setBasis(b)}
                title={b === "fob" ? "Farmgate + origin fobbing cost (Research → Origin Logistics)"
                     : b === "cif" ? `FOB + FBX ocean freight + ${(CIF_FINANCING_RATE * 100).toFixed(0)}% p.a. financing over transit to Antwerp`
                     : "Local price as scraped"}
                className={`px-2.5 py-1.5 transition ${basis === b ? "bg-rose-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Index ⇄ Value axis */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["index","Index"],["value","Value"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setAxisMode(m)}
                className={`px-2.5 py-1.5 transition ${axisMode === m ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Native ⇄ USD/MT (FOB/CIF are USD/MT by construction, so Native is
              unavailable on those bases) */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["native","Native"],["usd","USD/MT"]] as const).map(([mode, label]) => {
              const nativeLocked = mode === "native" && basis !== "farmgate";
              return (
                <button key={mode} onClick={() => !nativeLocked && setUsd(mode === "usd")}
                  disabled={nativeLocked}
                  title={nativeLocked ? "FOB / CIF are USD/MT constructions — switch basis to Farmgate for native units" : undefined}
                  className={`px-2.5 py-1.5 transition ${(effUsd ? "usd" : "native") === mode ? "bg-emerald-600 text-white" : nativeLocked ? "text-slate-600 cursor-not-allowed" : "text-slate-300 hover:bg-slate-700"}`}>
                  {label}
                </button>
              );
            })}
          </div>
          {/* Window */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["1M","3M","6M","1Y","2Y","MAX"] as Window[]).map(w => (
              <button key={w} onClick={() => setWindow(w)}
                className={`px-2.5 py-1.5 transition ${window === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — one per origin */}
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {stats.map(s => {
            const cls = s.pct == null ? "text-slate-500"
                      : s.pct >= 0   ? "text-emerald-400"
                                     : "text-red-400";
            return (
              <div key={s.key} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-slate-200 text-[11px]">{s.name}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="text-base font-bold font-mono text-slate-100">
                    {(() => {
                      if (!s.latest) return "—";
                      if (effUsd) {
                        const v = convertPoint(s.key, s.latest);
                        return v != null ? `$${Math.round(v).toLocaleString()}/MT` : "—";
                      }
                      return fmtNative(s.latest.price, s.unit, s.currency);
                    })()}
                  </div>
                  <div className={`text-sm font-bold font-mono ${cls}`}>
                    {s.pct == null ? "—" : `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(1)}%`}
                  </div>
                </div>
                {showDiff && latestDiff[s.key] !== undefined && (
                  <div className="text-[10px] font-mono mt-0.5">
                    <span className="text-slate-500">vs {commodity === "arabica" ? "KC" : "RC"} </span>
                    <span className={latestDiff[s.key] >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {latestDiff[s.key] >= 0 ? "+" : "−"}${Math.abs(Math.round(latestDiff[s.key])).toLocaleString()}/MT
                    </span>
                  </div>
                )}
                <div className="text-[9px] text-slate-500 mt-1">
                  {s.count} pt{s.count === 1 ? "" : "s"} in window · {s.source}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 italic">
          No {commodity} origin price history yet — it accumulates from the scrapers and fills in over time.
        </div>
      )}

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          {axisMode === "index"
            ? `Rebased to 100 at start of ${window === "MAX" ? "each series" : window}`
            : "Price level"}
          {" · "}
          {basis === "fob" ? "FOB basis (farmgate + fobbing)"
            : basis === "cif" ? "CIF Antwerp basis (FOB + freight + transit financing)"
            : "farmgate basis"}
          {" · "}{effUsd ? "USD/MT, per-day FX" : "local currency, native unit"}
          {showFutures ? ` · ${futuresName} overlay` : ""}
          {showCostBands
            ? basis === "farmgate" ? " · shaded: +fobbing, +freight & adders (tendering)"
            : basis === "fob"      ? " · shaded: +freight & adders (tendering)"
            :                        " · shaded: +sampling/grading & quality adj"
            : ""}
        </div>

        {/* Which origins get their cost bands drawn. Defaults to the cheapest
            delivered origin — the one that sets tender parity — because
            shading every origin buries it under overlapping fills. */}
        {showCostBands && presentOrigins.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2 text-[10px]">
            <span className="text-slate-500 uppercase tracking-wide">Cost bands</span>
            <button
              onClick={() => setBandSel(null)}
              title="Follow the cheapest delivered origin automatically"
              className={`px-2 py-0.5 rounded border transition ${
                bandSel === null
                  ? "bg-slate-700 border-slate-500 text-slate-100"
                  : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>
              Auto{cheapestOrigin && bandSel === null ? " (cheapest)" : ""}
            </button>
            {presentOrigins.map(k => {
              const o = data.origins[k];
              const on = activeBands.has(k);
              return (
                <button key={k} onClick={() => toggleBand(k)}
                  title={on ? `Hide ${o.name} cost bands` : `Show ${o.name} cost bands`}
                  className={`px-2 py-0.5 rounded border transition flex items-center gap-1 ${
                    on ? "border-slate-500 text-slate-100" : "border-slate-700 text-slate-500 hover:bg-slate-800"}`}
                  style={on ? { background: `${o.color}33` } : undefined}>
                  <span className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: on ? o.color : "#475569" }} />
                  {o.name.split(/[(—]/)[0].trim()}
                </button>
              );
            })}
            {presentOrigins.length > 1 && (
              <button
                onClick={() => setBandSel(activeBands.size === presentOrigins.length ? [] : [...presentOrigins])}
                className="px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 transition">
                {activeBands.size === presentOrigins.length ? "None" : "All"}
              </button>
            )}
          </div>
        )}
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              {/* Keyed on the ISO date, NOT the MM/DD label: two rows a year
                  apart share a label, so on a 1Y+ window Recharts treated them
                  as one category and the tooltip showed the older row's values
                  (hovering 6 Aug 2026 read 6 Aug 2025). The label is display
                  only, via tickFormatter. */}
              <XAxis dataKey="date" tickFormatter={axisTickFor(window)} stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={20} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto","auto"]} tickFormatter={fmtTick} width={48} />
              <Tooltip
                contentStyle={TT_STYLE}
                labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                labelFormatter={fmtTooltipDate}
                formatter={(v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
                  ? `$${Math.round(v[0]).toLocaleString()} → $${Math.round(v[1]).toLocaleString()}/MT`
                  : typeof v === "number"
                    ? (axisMode === "index"
                        ? v.toFixed(1)
                        : effUsd ? `$${Math.round(v).toLocaleString()}/MT` : v.toLocaleString())
                    : "—"}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {axisMode === "index" && <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" />}
              {/* Cost bands under the lines: same hue as the origin, opacity
                  steps — denser = fobbing (farmgate→FOB), fainter = tendering
                  (→delivered-to-exchange); on CIF a single band for the ICE
                  sampling/grading fees + origin-quality adjustment. Range
                  areas: dataKey is [lo, hi]; keys absent on a basis no-op. */}
              {showCostBands && basis === "farmgate" && presentOrigins.filter(k => activeBands.has(k)).map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Area key={`${k}__fob`} type="monotone" dataKey={`${k}__fob`}
                    name={`${o.name} + fobbing`} legendType="none"
                    stroke="none" fill={o.color} fillOpacity={0.28}
                    activeDot={false} connectNulls />
                );
              })}
              {showCostBands && basis !== "cif" && presentOrigins.filter(k => activeBands.has(k)).map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Area key={`${k}__tender`} type="monotone" dataKey={`${k}__tender`}
                    name={`${o.name} + freight & adders`} legendType="none"
                    stroke="none" fill={o.color} fillOpacity={0.13}
                    activeDot={false} connectNulls />
                );
              })}
              {showCostBands && basis === "cif" && presentOrigins.filter(k => activeBands.has(k)).map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Area key={`${k}__cert`} type="monotone" dataKey={`${k}__cert`}
                    name={`${o.name} + sampling/grading & quality adj`} legendType="none"
                    stroke="none" fill={o.color} fillOpacity={0.2}
                    activeDot={false} connectNulls />
                );
              })}
              {presentOrigins.map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Line key={k} type="monotone" dataKey={k} name={o.name}
                    stroke={o.color} strokeWidth={1.5} dot={false} connectNulls />
                );
              })}
              {showFutures && (
                <Line type="monotone" dataKey={FUTURES_KEY} name={futuresName}
                  stroke={FUTURES_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Differential to the exchange: origin (on the selected basis) minus
            the front month, USD/MT. Above zero = the physical is dearer than
            the board; the gap that FOB/CIF lifting is meant to close. */}
        {showDiff && diffData.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
              Differential to {futuresName} · USD/MT ·{" "}
              {basis === "fob" ? "FOB" : basis === "cif" ? "CIF Antwerp" : "farmgate"} minus front month
            </div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={diffData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                  <XAxis dataKey="date" tickFormatter={axisTickFor(window)} stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={20} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto", "auto"]} width={48}
                    tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`} />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                    labelFormatter={fmtTooltipDate}
                    formatter={(v) => typeof v === "number"
                      ? `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString()}/MT`
                      : "—"}
                  />
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                  {presentOrigins.map(k => {
                    const o = data.origins[k];
                    if (!o) return null;
                    return (
                      <Line key={k} type="monotone" dataKey={k} name={o.name}
                        stroke={o.color} strokeWidth={1.5} dot={false} connectNulls />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
