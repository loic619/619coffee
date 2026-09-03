"use client";
/**
 * Auto-comment generators for the briefing builder — structured house style.
 *
 * Every chart builder returns a structured Note:
 *   { facts: [{label, value}], read?, flag? }
 *   - facts  — scannable `**Label:** value` bullets. The FIRST fact's label
 *              identifies subject + period (it feeds the Executive Summary).
 *   - read   — ONE takeaway line, rendered as "→ …". MUST be data-conditional:
 *              it only appears when a rule fires (extreme, streak, divergence,
 *              band breach). Never a static educational sentence.
 *   - flag   — true when the read is notable enough to surface in the
 *              Executive Summary's "⚠ Watch" line.
 *
 * Rendering to markdown happens in ONE place (renderNote), so the house format
 * is a single edit for all charts. Split-note charts (NY/London,
 * Arabica/Robusta) return a Record<noteKey, Note>.
 *
 * SAFETY: unchanged — getInsight try/catches every builder; a failure yields
 * null and the note box falls back to the empty placeholder.
 */
import { transformApiData } from "@/lib/cot/transformApiData";
import type { CotRawRow, ProcessedCotRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import { evaluateSignals } from "@/lib/cot/signalEngine";
import { buildIndonesiaData, type RawIndonesiaExports } from "@/components/supply/IndonesiaExports/data";
import type { IndonesiaExportsData } from "@/components/supply/IndonesiaExports/types";
import { offerTons, cropTier, type SpotRow } from "@/components/demand/spot/spotLib";

// ── structured note core ──────────────────────────────────────────────────────
export interface Fact { label: string; value: string }
export interface Note { facts: Fact[]; read?: string; flag?: boolean }
type Insight = Note | Record<string, Note> | null;
type Builder = () => Promise<Insight>;

/** THE house format. Change this once to restyle every auto-comment. */
const renderNote = (n: Note): string => {
  const lines = n.facts.map((f) => `- **${f.label}:** ${f.value}`);
  if (n.read) lines.push(`- **→** ${n.read}`);
  return lines.join("\n");
};

// ── fetch cache (one request per file, shared across notes) ───────────────────
const _cache = new Map<string, Promise<unknown>>();
function load<T = Record<string, unknown>>(path: string): Promise<T | null> {
  if (!_cache.has(path)) {
    const p = fetch(path)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        // Never cache a failure: drop the entry so the next consumer retries
        // (transient-failure retries themselves live in the global data-fetch
        // guard — lib/dataFetchGuard).
        if (d == null) _cache.delete(path);
        return d;
      });
    _cache.set(path, p);
  }
  return _cache.get(path)! as Promise<T | null>;
}

// ── format helpers ────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
};
const kt = (bags: number) => bags * 0.06 / 1000;          // 60-kg bags → kt
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const klots = (lots: number) => `${lots >= 0 ? "+" : ""}${(lots / 1000).toFixed(1)}k lots`;
const cropKey = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${s}/${String((s + 1) % 100).padStart(2, "0")}`;
};
const prevCrop = (ck: string) => `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
const chgPct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

// ── series helpers (streaks / percentiles / extremes) ─────────────────────────
/** Percentile (0–100) of v within series; null when the sample is too thin. */
const pctileOf = (series: number[], v: number): number | null => {
  const s = series.filter((x) => Number.isFinite(x));
  if (s.length < 8) return null;
  return Math.round((s.filter((x) => x <= v).length / s.length) * 100);
};
/** Consecutive rises (dir=1) or falls (dir=-1) counted back from the end. */
const endStreak = (series: number[], dir: 1 | -1): number => {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    const d = series[i] - series[i - 1];
    if (dir === 1 ? d > 0 : d < 0) n++;
    else break;
  }
  return n;
};
/** Months of consecutive same-sign YoY change at the end of a monthly series. */
const yoyStreak = (vals: number[]): { n: number; up: boolean } | null => {
  if (vals.length < 14) return null;
  const yoy = (i: number) => vals[i] - vals[i - 12];
  const lastI = vals.length - 1;
  if (yoy(lastI) === 0) return null;
  const up = yoy(lastI) > 0;
  let n = 0;
  for (let i = lastI; i >= 12; i--) {
    if (yoy(i) !== 0 && (yoy(i) > 0) === up) n++;
    else break;
  }
  return { n, up };
};
const streakText = (s: { n: number; up: boolean } | null): string =>
  s && s.n >= 2 ? `, ${s.n}${s.n === 2 ? "nd" : s.n === 3 ? "rd" : "th"} straight YoY ${s.up ? "gain" : "decline"}` : "";

// ── COT shared (cot.json → processed rows + metric engine) ────────────────────
async function cotRows(): Promise<ProcessedCotRow[] | null> {
  const rows = await load<CotRawRow[]>("/data/cot.json");
  if (!Array.isArray(rows) || !rows.length) return null;
  return transformApiData(rows);
}
const mmNet = (r: ProcessedCotRow, mkt: "ny" | "ldn") =>
  (mkt === "ny" ? r.ny : r.ldn).mmLong - (mkt === "ny" ? r.ny : r.ldn).mmShort;
const mmNetSeries = (data: ProcessedCotRow[], mkt: "ny" | "ldn") =>
  data.slice(-52).map((r) => mmNet(r, mkt));
const cotMetrics = (data: ProcessedCotRow[], mkt: "ny" | "ldn") =>
  buildMarketMetrics(data.slice(-52), data, mkt);

const cotOverview: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const side = (mkt: "ny" | "ldn"): Note | null => {
    const m = cotMetrics(data, mkt); if (!m) return null;
    const net = m.mmLongChangeLots - m.mmShortChangeLots;
    const priceUp = m.priceChangePct > 0.5, priceDn = m.priceChangePct < -0.5;
    let read: string | undefined; let flag = false;
    if (net > 1000 && priceUp) read = "Fresh fund longs driving the rally.";
    else if (net < -1000 && priceUp) { read = "Price up while funds sold — short-covering, weaker foundation."; flag = true; }
    else if (net > 1000 && priceDn) { read = "Funds bought into a falling tape — positioning leading price."; flag = true; }
    else if (net < -1000 && priceDn) read = "Fund selling pressing price lower.";
    return {
      facts: [
        { label: "MM flow WoW", value: `longs **${klots(m.mmLongChangeLots)}**, shorts **${klots(m.mmShortChangeLots)}** (net **${klots(net)}**)` },
        { label: "OI / price", value: `OI **${klots(m.oiChangeLots)}**, price **${pct(m.priceChangePct)}**` },
        { label: "Industry coverage", value: `roasters **${m.roasterCovPct.toFixed(0)}%**, producers **${m.producerCovPct.toFixed(0)}%** of 52w range` },
      ],
      read, flag,
    };
  };
  const ny = side("ny"), ldn = side("ldn");
  if (!ny || !ldn) return null;
  return { ny, ldn };
};

const cotHeatmapNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const sig = evaluateSignals(data);
  const count = (mkt: string) => {
    const ms = sig.filter((s) => String(s.market).toUpperCase().includes(mkt));
    return { bull: ms.filter((s) => s.score > 0).length, bear: ms.filter((s) => s.score < 0).length };
  };
  const ny = count("NY"), ldn = count("LDN");
  const skew = ny.bull + ldn.bull - (ny.bear + ldn.bear);
  return {
    facts: [
      { label: "NY signals", value: `**${ny.bull} bullish / ${ny.bear} bearish** firing this week` },
      { label: "LDN signals", value: `**${ldn.bull} bullish / ${ldn.bear} bearish**` },
    ],
    read: Math.abs(skew) >= 3 ? `Signal cluster skews ${skew > 0 ? "bullish" : "bearish"} across the rule set.` : undefined,
    flag: Math.abs(skew) >= 5,
  };
};

const cotGaugesNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const side = (mkt: "ny" | "ldn") => {
    const s = mmNetSeries(data, mkt);
    const cur = s[s.length - 1] ?? 0;
    return { cur, p: pctileOf(s, cur) };
  };
  const ny = side("ny"), ldn = side("ldn");
  const ex = (p: number | null) => p != null && (p >= 85 || p <= 15);
  const extremes = [ny, ldn]
    .map((x, i) => (ex(x.p) ? `${i === 0 ? "NY" : "London"} MM net ${x.p! >= 85 ? "stretched long" : "stretched short"} (${x.p}th pctile)` : null))
    .filter((x): x is string => !!x);
  return {
    facts: [
      { label: "NY MM net", value: `**${klots(ny.cur)}** — **${ny.p ?? "—"}th pctile** of 52w` },
      { label: "LDN MM net", value: `**${klots(ldn.cur)}** — **${ldn.p ?? "—"}th pctile** of 52w` },
    ],
    read: extremes.length ? `${extremes.join("; ")}.` : "Both markets mid-range — no positioning extreme.",
    flag: extremes.length > 0,
  };
};

const cotGlobalFlowNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = cotMetrics(data, "ny"), ldn = cotMetrics(data, "ldn");
  if (!ny || !ldn) return null;
  const dNy = ny.mmLongChangeLots - ny.mmShortChangeLots;
  const dLdn = ldn.mmLongChangeLots - ldn.mmShortChangeLots;
  const comb = dNy + dLdn;
  const same = Math.sign(dNy) === Math.sign(dLdn) && dNy !== 0;
  return {
    facts: [
      { label: "Fund flow WoW", value: `NY net **${klots(dNy)}**, LDN net **${klots(dLdn)}**` },
      { label: "Combined", value: `**${klots(comb)}** across both coffee markets` },
    ],
    read: same && Math.abs(comb) > 8000
      ? `Coordinated cross-market ${comb > 0 ? "buying" : "selling"} — reads as macro fund flow, not a single-market story.`
      : !same && Math.abs(dNy) > 2000 && Math.abs(dLdn) > 2000
      ? "Flows diverge between NY and London — market-specific drivers at work."
      : undefined,
    flag: same && Math.abs(comb) > 8000,
  };
};

const cotIndustryPulseNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = cotMetrics(data, "ny"), ldn = cotMetrics(data, "ldn");
  if (!ny || !ldn) return null;
  const thin = [
    ny.roasterCovPct <= 15 ? "NY roaster" : null, ldn.roasterCovPct <= 15 ? "LDN roaster" : null,
    ny.producerCovPct <= 15 ? "NY producer" : null, ldn.producerCovPct <= 15 ? "LDN producer" : null,
  ].filter(Boolean);
  return {
    facts: [
      { label: "NY coverage", value: `roasters **${ny.roasterCovPct.toFixed(0)}%** / producers **${ny.producerCovPct.toFixed(0)}%** of 52w range (roasters **${n0(ny.roasterMTWoW)} MT** WoW)` },
      { label: "LDN coverage", value: `roasters **${ldn.roasterCovPct.toFixed(0)}%** / producers **${ldn.producerCovPct.toFixed(0)}%** of 52w range` },
    ],
    read: thin.length ? `${thin.join(", ")} coverage thin — an under-hedged side tends to chase adverse moves.` : undefined,
    flag: thin.length > 0,
  };
};

const cotDryPowderNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const side = (mkt: "ny" | "ldn") => {
    const s = mmNetSeries(data, mkt);
    const cur = s[s.length - 1] ?? 0;
    const max = Math.max(...s), min = Math.min(...s), range = max - min || 1;
    return { toMax: max - cur, toMin: cur - min, nearMax: (max - cur) / range < 0.1, nearMin: (cur - min) / range < 0.1 };
  };
  const ny = side("ny"), ldn = side("ldn");
  const notes: string[] = [];
  if (ny.nearMax) notes.push("NY longs near 52w capacity — squeeze fuel is low");
  if (ny.nearMin) notes.push("NY at max-short territory — flush risk spent");
  if (ldn.nearMax) notes.push("London longs near 52w capacity");
  if (ldn.nearMin) notes.push("London at max-short territory");
  return {
    facts: [
      { label: "NY room", value: `**${n0(ny.toMax / 1000)}k lots** to 52w max-long, **${n0(ny.toMin / 1000)}k** to max-short` },
      { label: "LDN room", value: `**${n0(ldn.toMax / 1000)}k lots** to max-long, **${n0(ldn.toMin / 1000)}k** to max-short` },
    ],
    read: notes.length ? `${notes.join("; ")}.` : "Meaningful dry powder in both directions — positioning is not the constraint.",
    flag: notes.length > 0,
  };
};

const cotCycleLocationNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = cotMetrics(data, "ny"), ldn = cotMetrics(data, "ldn");
  if (!ny || !ldn) return null;
  const flags = [ny, ldn].map((m, i) => m.obosFlag !== "neutral" ? `${i === 0 ? "NY" : "London"} ${m.obosFlag}` : null).filter(Boolean);
  return {
    facts: [
      { label: "NY location", value: `price rank **${ny.priceRank.toFixed(0)}** / OI rank **${ny.oiRank.toFixed(0)}** (0–100)` },
      { label: "LDN location", value: `price rank **${ldn.priceRank.toFixed(0)}** / OI rank **${ldn.oiRank.toFixed(0)}**` },
    ],
    read: flags.length ? `${flags.join("; ")} — cycle extreme in play.` : "Neither market at an overbought/oversold extreme.",
    flag: flags.length > 0,
  };
};

const cotSignalsNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const sig = evaluateSignals(data);
  const a = sig.filter((s) => s.severity === "alert").length;
  const w = sig.filter((s) => s.severity === "warn").length;
  const top = sig.find((s) => s.severity === "alert") ?? sig.find((s) => s.severity === "warn");
  const score = sig.reduce((t, s) => t + s.score, 0);
  return {
    facts: [
      { label: "Rule engine", value: `**${a} alert${a === 1 ? "" : "s"}**, **${w} warning${w === 1 ? "" : "s"}** firing` },
      ...(top ? [{ label: "Lead signal", value: top.name }] : []),
    ],
    read: score !== 0 ? `Net rule score skews ${score > 0 ? "bullish" : "bearish"} this week.` : undefined,
    flag: a > 0,
  };
};

const cotReportNote: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = cotMetrics(data, "ny"), ldn = cotMetrics(data, "ldn");
  if (!ny || !ldn) return null;
  const mism = [ny.positionMismatch ? "NY" : null, ldn.positionMismatch ? "London" : null].filter(Boolean);
  return {
    facts: [
      { label: "NY", value: `MM net **${klots(ny.mmLongChangeLots - ny.mmShortChangeLots)}** WoW, MM concentration **${ny.mmConcentrationPct.toFixed(0)}%** of OI` },
      { label: "LDN", value: `MM net **${klots(ldn.mmLongChangeLots - ldn.mmShortChangeLots)}** WoW, concentration **${ldn.mmConcentrationPct.toFixed(0)}%**` },
    ],
    read: mism.length
      ? `${mism.join(" and ")} show a lots-vs-trader-count mismatch — a few large accounts drive the position (concentration risk).`
      : "No crowd-risk or concentration flags this week.",
    flag: mism.length > 0,
  };
};

// ── Futures chain (futures_chain.json) ────────────────────────────────────────
interface Contract { contract?: string; last?: number; chg?: number; oi?: number; symbol?: string; }
interface Chain { contracts?: Contract[]; pub_date?: string; }
const dailyQuotes: Builder = async () => {
  const d = await load<{ arabica?: Chain; robusta?: Chain }>("/data/futures_chain.json"); if (!d) return null;
  const side = (c: Chain | undefined, unit: string, dec: number): Note | null => {
    // Liquid front = max-OI contract, not nearest expiry (see MarketTicker.frontByOI).
    const cs = (c?.contracts ?? []).filter((x) => x.last != null);
    if (!cs.length) return null;
    const f = cs.reduce((best, x) => ((x.oi ?? 0) > (best.oi ?? 0) ? x : best), cs[0]);
    if (f.last == null) return null;
    const sym = f.symbol?.slice(0, 5) ?? f.contract ?? "front";
    const dayPct = f.chg != null && f.last - f.chg !== 0 ? (f.chg / (f.last - f.chg)) * 100 : null;
    return {
      facts: [
        { label: sym, value: `last **${f.last.toFixed(dec)} ${unit}**, ${(f.chg ?? 0) >= 0 ? "up" : "down"} **${f.chg != null ? Math.abs(f.chg).toFixed(dec) : "—"}**${dayPct != null ? ` (${pct(dayPct)})` : ""}` },
        { label: "Front OI", value: `**${n0(f.oi ?? 0)}** lots` },
      ],
      read: dayPct != null && Math.abs(dayPct) > 2 ? `Outsized daily move — ${dayPct > 0 ? "rally" : "sell-off"} of ${Math.abs(dayPct).toFixed(1)}%.` : undefined,
      flag: dayPct != null && Math.abs(dayPct) > 2,
    };
  };
  const ny = side(d.arabica, "¢/lb", 2), ldn = side(d.robusta, "$/t", 0);
  if (!ny && !ldn) return null;
  return { ny: ny ?? { facts: [] }, ldn: ldn ?? { facts: [] } };
};

// ── OI to FND (oi_fnd_chart.json) ─────────────────────────────────────────────
interface Spread { frontLabel?: string; nextLabel?: string; data?: { day: number; spread: number }[]; }
const oiFnd: Builder = async () => {
  const d = await load<{ arabica_front_spread?: Spread; robusta_front_spread?: Spread }>("/data/oi_fnd_chart.json"); if (!d) return null;
  const side = (sp: Spread | undefined, unit: string): Note | null => {
    if (!sp?.frontLabel) return null;
    const vals = (sp.data ?? []).map((x) => x.spread);
    const last = vals.length ? vals[vals.length - 1] : null;
    const narrowing = vals.length >= 4 ? endStreak(vals, -1) >= 3 : false;
    const widening = vals.length >= 4 ? endStreak(vals, 1) >= 3 : false;
    return {
      facts: [
        { label: "Roll", value: `**${sp.frontLabel}** → **${sp.nextLabel ?? "next"}** into FND` },
        ...(last != null ? [{ label: "Front spread", value: `**${last} ${unit}**` }] : []),
      ],
      read: narrowing ? "Front spread narrowing session after session — roll pressure building." :
            widening ? "Front spread widening into the roll — front holding a premium." : undefined,
      flag: narrowing,
    };
  };
  const ny = side(d.arabica_front_spread, "¢/lb"), ldn = side(d.robusta_front_spread, "$/t");
  if (!ny && !ldn) return null;
  return { ny: ny ?? { facts: [] }, ldn: ldn ?? { facts: [] } };
};

// ── Freight (freight.json / port_activity) ────────────────────────────────────
interface Route { id?: string; from?: string; to?: string; rate?: number; prev?: number; unit?: string; }
async function routes(): Promise<Route[] | null> {
  const d = await load<{ routes?: Route[] }>("/data/freight.json");
  return d?.routes?.length ? d.routes : null;
}
const freightSpot: Builder = async () => {
  const rs = await routes(); if (!rs) return null;
  const moved = rs.map((r) => ({ ...r, mv: chgPct(r.rate ?? 0, r.prev ?? 0) ?? 0 })).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv));
  const top = moved[0];
  const up = rs.filter((r) => (r.rate ?? 0) > (r.prev ?? 0)).length;
  const broad = up >= rs.length - 1 && Math.abs(top.mv) > 3;
  return {
    facts: [
      { label: "Biggest move", value: `**${top.from}→${top.to}** at **${n0(top.rate ?? 0)} ${top.unit ?? ""}** (**${pct(top.mv)}**)` },
      { label: "Breadth", value: `**${up}/${rs.length}** corridors higher vs prior reading` },
    ],
    read: broad ? "Broad freight pressure building — landed costs rising across corridors." :
          up === 0 ? "Rates easing across the board." : undefined,
    flag: broad,
  };
};
const freightEvolution: Builder = async () => {
  const rs = await routes(); if (!rs) return null;
  const up = rs.filter((r) => (r.rate ?? 0) > (r.prev ?? 0)).length;
  const avgMv = rs.reduce((a, r) => a + (chgPct(r.rate ?? 0, r.prev ?? 0) ?? 0), 0) / rs.length;
  return {
    facts: [
      { label: "Corridor trend", value: `**${up}/${rs.length}** routes higher; average move **${pct(avgMv)}**` },
    ],
    read: Math.abs(avgMv) > 5 ? `Freight trending ${avgMv > 0 ? "up" : "down"} meaningfully across the corridor set.` : undefined,
    flag: avgMv > 5,
  };
};
const portActivity: Builder = async () => {
  const d = await load<{ label?: string; country?: string; series?: { date: string; portcalls?: number }[] }>("/data/port_activity/hcmc.json");
  const s = d?.series; if (!Array.isArray(s) || !s.length) return null;
  const last = s[s.length - 1].date; const yr = last.slice(0, 4); const md = last.slice(5);
  const ytd = (y: string) => s.filter((r) => r.date.slice(0, 4) === y && r.date.slice(5) <= md).reduce((a, r) => a + (r.portcalls ?? 0), 0);
  const cur = ytd(yr); const prev = ytd(String(+yr - 1));
  const dp = chgPct(cur, prev);
  return {
    facts: [{ label: `${d?.label ?? "Gateway"} YTD`, value: `**${n0(cur)}** vessel calls (**${pct(dp)}** vs same point last year)` }],
    read: dp != null && Math.abs(dp) > 10 ? `Throughput running well ${dp > 0 ? "above" : "below"} last year at the ${d?.country ?? "origin"} export gateway.` : undefined,
    flag: dp != null && dp < -10,
  };
};
const originFreightCosts: Builder = async () => {
  const rs = await routes(); if (!rs) return null;
  const find = (from: string, to: string) => rs.find((r) => (r.from ?? "").includes(from) && (r.to ?? "").includes(to));
  const vn = find("Ho Chi Minh", "Rotterdam"), br = find("Santos", "Rotterdam");
  const moved = rs.map((r) => ({ ...r, mv: chgPct(r.rate ?? 0, r.prev ?? 0) ?? 0 })).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv))[0];
  const facts: Fact[] = [];
  if (vn?.rate != null && br?.rate != null) {
    facts.push({ label: "VN→EU vs BR→EU", value: `**${n0(vn.rate)}** vs **${n0(br.rate)} ${vn.unit ?? "USD/FEU"}** (spread **${n0(vn.rate - br.rate)}**)` });
  }
  facts.push({ label: "Biggest move", value: `**${moved.from}→${moved.to}** **${pct(moved.mv)}**` });
  return {
    facts,
    read: Math.abs(moved.mv) > 8 ? `Fresh move on ${moved.from}→${moved.to} — differentials on that corridor will feel it.` : undefined,
    flag: Math.abs(moved.mv) > 8,
  };
};

// ── Brazil (cecafe.json) ──────────────────────────────────────────────────────
interface CecafeRow { date: string; total: number; arabica?: number; conillon?: number; soluvel?: number; }
interface Cecafe { series?: CecafeRow[]; by_country?: Record<string, number>; by_country_prev?: Record<string, number>; }
async function cecafe(): Promise<Cecafe | null> { return load<Cecafe>("/data/cecafe.json"); }

/** Crop-year-to-date totals for the latest crop vs the prior crop at the same stage. */
function ctdPair(series: { key: string; month: string; v: number }[]): { ck: string; pk: string; cur: number; prev: number } {
  const last = series[series.length - 1];
  const ck = last.key; const pk = prevCrop(ck);
  const ctd = series.filter((r) => r.key === ck);
  const months = new Set(ctd.map((r) => r.month));
  const prev = series.filter((r) => r.key === pk && months.has(r.month));
  return { ck, pk, cur: ctd.reduce((a, r) => a + r.v, 0), prev: prev.reduce((a, r) => a + r.v, 0) };
}
const paceNote = (label: string, unit: (v: number) => string, p: { ck: string; pk: string; cur: number; prev: number }, tightFlagPct = -8): Note => {
  const dp = chgPct(p.cur, p.prev);
  return {
    facts: [
      { label: `${label} · crop ${p.ck} YTD`, value: `**${unit(p.cur)}** (**${pct(dp)}** vs ${p.pk} at the same stage)` },
      { label: `${p.pk} same stage`, value: `**${unit(p.prev)}**` },
    ],
    read: dp != null && Math.abs(dp) > 3 ? `Pace ${dp > 0 ? "ahead of" : "behind"} last season — ${dp > 0 ? "ample" : "tightening"} availability.` : undefined,
    flag: dp != null && dp < tightFlagPct,
  };
};

const brazilMonthly: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const latest = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(latest.total, ya.total) : null;
  const st = streakText(yoyStreak(s.map((r) => r.total)));
  const p = ctdPair(s.map((r) => ({ key: cropKey(r.date), month: r.date.slice(5), v: r.total })));
  const dp = chgPct(p.cur, p.prev);
  return {
    facts: [
      { label: `Brazil · ${monthLabel(latest.date)}`, value: `**${n1(kt(latest.total))} kt** shipped (**${pct(yoy)}** YoY${st})` },
      { label: `Crop ${p.ck} YTD`, value: `**${n1(kt(p.cur))} kt** (**${pct(dp)}** vs ${p.pk} pace)` },
    ],
    read: dp != null && Math.abs(dp) > 3 ? `Pace ${dp > 0 ? "ahead of" : "behind"} last season — ${dp > 0 ? "ample" : "tightening"} near-term availability.` : undefined,
    flag: dp != null && dp < -8,
  };
};
const brazilAnnual: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13];
  const mix = (row: CecafeRow) => {
    const a = row.arabica ?? 0, c = row.conillon ?? 0, so = row.soluvel ?? 0;
    const t = a + c + so || row.total || 1;
    return { a: (a / t) * 100, c: (c / t) * 100, so: (so / t) * 100 };
  };
  const now = mix(r); const then = ya ? mix(ya) : null;
  const conShift = then ? now.c - then.c : null;
  return {
    facts: [
      { label: `Mix · ${monthLabel(r.date)}`, value: `**${now.a.toFixed(0)}% arabica / ${now.c.toFixed(0)}% conilon / ${now.so.toFixed(0)}% soluble** on **${n1(kt(r.total))} kt**` },
    ],
    read: conShift != null && Math.abs(conShift) >= 5
      ? `Conilon share ${conShift > 0 ? "up" : "down"} ${Math.abs(conShift).toFixed(0)}pp YoY — ${conShift > 0 ? "more" : "less"} robusta-substitutable supply on the water.`
      : undefined,
    flag: conShift != null && conShift >= 8,
  };
};
const brazilPace: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  return paceNote("Brazil", (v) => `${n1(kt(v))} kt`, ctdPair(s.map((r) => ({ key: cropKey(r.date), month: r.date.slice(5), v: r.total }))));
};
const brazilDest: Builder = async () => {
  const d = await cecafe(); const by = d?.by_country; if (!by) return null;
  const tot = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return null;
  const [c0, v0] = top[0];
  const mv = d?.by_country_prev?.[c0] != null ? chgPct(v0, d.by_country_prev[c0]) : null;
  const share0 = (v0 / tot) * 100;
  return {
    facts: [
      { label: "Top destination", value: `**${c0}** — **${n1(kt(v0))} kt** (**${share0.toFixed(0)}%**${mv != null ? `, ${pct(mv)} vs prior` : ""})` },
      { label: "Next", value: top.slice(1).map(([c, v]) => `${c} (${((v / tot) * 100).toFixed(0)}%)`).join(", ") },
    ],
    read: share0 > 40 ? `High concentration — ${c0} alone takes ${share0.toFixed(0)}% of shipments.` : undefined,
  };
};
const brazilDaily: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const latest = s[s.length - 1]; const ya = s[s.length - 13];
  return {
    facts: [
      { label: `Registrations · ${monthLabel(latest.date)}`, value: `**${n1(kt(latest.total))} kt** (arabica + conilon)` },
      ...(ya ? [{ label: "vs same month LY", value: `**${pct(chgPct(latest.total, ya.total))}**` }] : []),
    ],
  };
};
const brazilTypeShare: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13];
  const share = (row: CecafeRow) => {
    const a = row.arabica ?? 0, c = row.conillon ?? 0, so = row.soluvel ?? 0;
    const t = a + c + so || row.total || 1;
    return (a / t) * 100;
  };
  const now = share(r); const then = ya ? share(ya) : null;
  const shift = then != null ? now - then : null;
  return {
    facts: [
      { label: `Arabica share · ${monthLabel(r.date)}`, value: `**${now.toFixed(0)}%**${then != null ? ` (vs ${then.toFixed(0)}% a year ago)` : ""}` },
    ],
    read: shift != null && Math.abs(shift) >= 3
      ? `Mix shifting ${shift > 0 ? "toward arabica" : "toward conilon"} — ${Math.abs(shift).toFixed(0)}pp YoY.`
      : undefined,
    flag: shift != null && shift <= -5,
  };
};
const brazilYoyType: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13]; if (!ya) return null;
  const a = chgPct(r.arabica ?? 0, ya.arabica ?? 0);
  const c = chgPct(r.conillon ?? 0, ya.conillon ?? 0);
  const gap = a != null && c != null ? c - a : null;
  return {
    facts: [
      { label: `YoY · ${monthLabel(r.date)}`, value: `arabica **${pct(a)}**, conilon **${pct(c)}**, soluble **${pct(chgPct(r.soluvel ?? 0, ya.soluvel ?? 0))}**` },
    ],
    read: gap != null && Math.abs(gap) > 15 ? `${gap > 0 ? "Conilon" : "Arabica"} strongly outpacing (${Math.abs(gap).toFixed(0)}pp gap) — the exported mix is tilting.` : undefined,
  };
};
const brazilSeasonality: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const byMonth: Record<number, number[]> = {};
  for (const r of s) { const m = +r.date.slice(5, 7); (byMonth[m] ||= []).push(r.total); }
  const avg = (m: number) => (byMonth[m]?.reduce((x, y) => x + y, 0) ?? 0) / (byMonth[m]?.length || 1);
  const peak = Object.keys(byMonth).map(Number).sort((x, y) => avg(y) - avg(x))[0];
  const latest = s[s.length - 1]; const lm = +latest.date.slice(5, 7);
  const vsNorm = chgPct(latest.total, avg(lm));
  return {
    facts: [
      { label: "Seasonal peak", value: `**${MONTHS[peak - 1]}**` },
      { label: `${MONTHS[lm - 1]} vs its norm`, value: `**${pct(vsNorm)}**` },
    ],
    read: vsNorm != null && Math.abs(vsNorm) > 15 ? `Flow running ${vsNorm > 0 ? "hot" : "cold"} against the seasonal calendar.` : undefined,
  };
};
const brazilWeatherRisk: Builder = async () => {
  const d = await load<{ weather?: { regions?: { name?: string; frost?: string; drought?: string }[] } }>("/data/farmer_economics.json");
  const rg = d?.weather?.regions; if (!Array.isArray(rg) || !rg.length) return null;
  const frostAt = rg.filter((r) => r.frost && r.frost.toUpperCase() !== "NONE");
  const droughtHi = rg.filter((r) => ["HIGH", "MED", "H", "M"].includes((r.drought ?? "").toUpperCase()));
  return {
    facts: [
      { label: "Brazil frost", value: `**${frostAt.length}/${rg.length}** regions flagged${frostAt[0]?.name ? ` (${frostAt.map((r) => r.name).join(", ")})` : ""}` },
      { label: "Drought (CSI)", value: `**${droughtHi.length}/${rg.length}** regions elevated` },
    ],
    read: frostAt.length > 0 ? `Frost risk live in ${frostAt.length} region${frostAt.length === 1 ? "" : "s"} — the sharpest weather threat to the arabica crop.`
      : droughtHi.length >= 2 ? "Multiple regions under drought stress — monitor soil-moisture recovery."
      : "No acute frost or drought flags in the forecast window.",
    flag: frostAt.length > 0 || droughtHi.length >= 3,
  };
};

// ── Vietnam (vietnam_supply.json + vn_export_by_destination.json) ─────────────
interface VnMonth { month: string; total_k_bags?: number; yoy_pct?: number | null; }
async function vnMonthly(): Promise<VnMonth[] | null> {
  const d = await load<{ exports?: { monthly?: VnMonth[] } }>("/data/vietnam_supply.json");
  const m = d?.exports?.monthly;
  return Array.isArray(m) && m.length ? m : null;
}
const vnKt = (kb: number) => kb * 0.06;
const vnCrop = (ym: string) => { const [y, m] = ym.split("-").map(Number); const s = m >= 10 ? y : y - 1; return `${s}/${String((s + 1) % 100).padStart(2, "0")}`; };

const vietnamMonthly: Builder = async () => {
  const m = await vnMonthly(); if (!m) return null;
  const last = m[m.length - 1];
  const st = streakText(yoyStreak(m.map((r) => r.total_k_bags ?? 0)));
  return {
    facts: [
      { label: `Vietnam · ${monthLabel(last.month)}`, value: `**${n1(vnKt(last.total_k_bags ?? 0))} kt** exported (**${pct(last.yoy_pct ?? null)}** YoY${st})` },
    ],
    read: last.yoy_pct != null && Math.abs(last.yoy_pct) > 15 ? `Robusta flow from the top origin ${last.yoy_pct > 0 ? "surging" : "contracting"} — a direct London supply signal.` : undefined,
    flag: last.yoy_pct != null && last.yoy_pct < -15,
  };
};
const vietnamPace: Builder = async () => {
  const m = await vnMonthly(); if (!m) return null;
  return paceNote("Vietnam", (v) => `${n1(vnKt(v))} kt`, ctdPair(m.map((r) => ({ key: vnCrop(r.month), month: r.month.slice(5), v: r.total_k_bags ?? 0 }))));
};
const vietnamAnnual: Builder = async () => {
  const m = await vnMonthly(); if (!m || m.length < 24) return null;
  const last12 = m.slice(-12).reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  const prev12 = m.slice(-24, -12).reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  const dp = chgPct(last12, prev12);
  return {
    facts: [{ label: "Vietnam trailing 12m", value: `**${n1(vnKt(last12))} kt** (**${pct(dp)}** vs prior 12m)` }],
    read: dp != null && Math.abs(dp) > 8 ? `Annual release rate ${dp > 0 ? "expanding" : "shrinking"} — structural robusta supply ${dp > 0 ? "growth" : "pullback"}.` : undefined,
  };
};
const vietnamDest: Builder = async () => {
  const d = await load<{ countries?: Record<string, Record<string, number>> }>("/data/vn_export_by_destination.json");
  const c = d?.countries; if (!c) return null;
  const totals = Object.entries(c).map(([country, months]) => [country, Object.values(months).reduce((a, b) => a + (b || 0), 0)] as [string, number]);
  const grand = totals.reduce((a, [, v]) => a + v, 0) || 1;
  const top = totals.sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return null;
  const share0 = (top[0][1] / grand) * 100;
  return {
    facts: [
      { label: "Top buyer", value: `**${top[0][0]}** — **${share0.toFixed(0)}%** of tracked volume` },
      { label: "Next", value: top.slice(1).map(([n, v]) => `${n} (${((v / grand) * 100).toFixed(0)}%)`).join(", ") },
    ],
    read: share0 > 25 ? `Buyer concentration: ${top[0][0]} dominates offtake from the top robusta origin.` : undefined,
  };
};

// ── Uganda (uganda_monthly.json) ──────────────────────────────────────────────
interface UgRow { month: string; total_bags?: number; robusta_bags?: number; arabica_bags?: number; by_destination?: { country?: string; bags?: number }[]; }
async function ugSeries(): Promise<UgRow[] | null> {
  const d = await load<{ series?: UgRow[] }>("/data/uganda_monthly.json");
  return Array.isArray(d?.series) && d!.series!.length ? d!.series! : null;
}
const ugKt = (bags: number) => bags * 6e-5;

const ugandaMonthly: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(last.total_bags ?? 0, ya.total_bags ?? 0) : null;
  const rob = last.robusta_bags ?? 0, ara = last.arabica_bags ?? 0; const tot = last.total_bags || rob + ara || 1;
  const st = streakText(yoyStreak(s.map((r) => r.total_bags ?? 0)));
  return {
    facts: [
      { label: `Uganda · ${monthLabel(last.month)}`, value: `**${n1(ugKt(last.total_bags ?? 0))} kt** (**${pct(yoy)}** YoY${st})` },
      { label: "Mix", value: `**${((rob / tot) * 100).toFixed(0)}% robusta / ${((ara / tot) * 100).toFixed(0)}% arabica**` },
    ],
    read: yoy != null && Math.abs(yoy) > 15 ? `Africa's top robusta exporter ${yoy > 0 ? "accelerating" : "slowing"} — feeds directly into London availability.` : undefined,
    flag: yoy != null && yoy < -15,
  };
};
const ugandaPace: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  return paceNote("Uganda", (v) => `${n1(ugKt(v))} kt`, ctdPair(s.map((r) => ({ key: vnCrop(r.month), month: r.month.slice(5), v: r.total_bags ?? 0 }))));
};
const ugandaAnnual: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const ck = vnCrop(s[s.length - 1].month); const ctd = s.filter((r) => vnCrop(r.month) === ck);
  const rob = ctd.reduce((a, r) => a + (r.robusta_bags ?? 0), 0), ara = ctd.reduce((a, r) => a + (r.arabica_bags ?? 0), 0);
  const tot = rob + ara || 1;
  return {
    facts: [
      { label: `Uganda · crop ${ck} YTD`, value: `**${((rob / tot) * 100).toFixed(0)}% robusta** (${n1(ugKt(rob))} kt) / **${((ara / tot) * 100).toFixed(0)}% arabica** (${n1(ugKt(ara))} kt)` },
    ],
  };
};
const ugandaTypeShare: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = s[s.length - 1]; const ya = s[s.length - 13];
  const shr = (r: UgRow) => { const t = (r.robusta_bags ?? 0) + (r.arabica_bags ?? 0) || 1; return ((r.robusta_bags ?? 0) / t) * 100; };
  const now = shr(last); const then = ya ? shr(ya) : null;
  const shift = then != null ? now - then : null;
  return {
    facts: [
      { label: `Robusta share · ${monthLabel(last.month)}`, value: `**${now.toFixed(0)}%**${then != null ? ` (vs ${then.toFixed(0)}% a year ago)` : ""}` },
    ],
    read: shift != null && Math.abs(shift) >= 5 ? `Mix shifting ${shift > 0 ? "further into robusta" : "toward arabica"} (${Math.abs(shift).toFixed(0)}pp YoY).` : undefined,
  };
};
const ugandaDest: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = [...s].reverse().find((r) => Array.isArray(r.by_destination) && r.by_destination!.length);
  const bd = last?.by_destination; if (!bd?.length) return null;
  const tot = bd.reduce((a, r) => a + (r.bags ?? 0), 0) || 1;
  const top = [...bd].sort((a, b) => (b.bags ?? 0) - (a.bags ?? 0)).slice(0, 3);
  const share0 = ((top[0].bags ?? 0) / tot) * 100;
  return {
    facts: [
      { label: `Top buyer · ${monthLabel(last!.month)}`, value: `**${top[0].country}** — **${share0.toFixed(0)}%**` },
      { label: "Next", value: top.slice(1).map((t) => `${t.country} (${(((t.bags ?? 0) / tot) * 100).toFixed(0)}%)`).join(", ") },
    ],
    read: share0 > 25 ? `Concentrated offtake — ${top[0].country} anchors Uganda's export demand.` : undefined,
  };
};

// ── Indonesia (indonesia_exports.json → buildIndonesiaData) ───────────────────
async function indoData(): Promise<IndonesiaExportsData | null> {
  const raw = await load<RawIndonesiaExports>("/data/indonesia_exports.json");
  if (!raw) return null;
  try { return buildIndonesiaData(raw); } catch { return null; }
}
const idKt = (kg: number) => kg / 1e6;
type IdRow = { date: string; total: number; arabica: number; robusta: number; other: number };

const indoMonthly: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const last = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(last.total, ya.total) : null;
  const st = streakText(yoyStreak(s.map((r) => r.total)));
  return {
    facts: [{ label: `Indonesia · ${monthLabel(last.date)}`, value: `**${n1(idKt(last.total))} kt** exported (**${pct(yoy)}** YoY${st})` }],
    read: yoy != null && Math.abs(yoy) > 15 ? `Flow from the dual-species origin ${yoy > 0 ? "surging" : "contracting"} — touches both KC and RC balances.` : undefined,
    flag: yoy != null && yoy < -15,
  };
};
const indoPace: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  return paceNote("Indonesia", (v) => `${n1(idKt(v))} kt`, ctdPair(s.map((r) => ({ key: cropKey(r.date), month: r.date.slice(5), v: r.total }))));
};
const indoAnnual: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const tot = r.arabica + r.robusta + r.other || r.total || 1;
  return {
    facts: [
      { label: `Mix · ${monthLabel(r.date)}`, value: `**${((r.arabica / tot) * 100).toFixed(0)}% arabica / ${((r.robusta / tot) * 100).toFixed(0)}% robusta / ${((r.other / tot) * 100).toFixed(0)}% other** on **${n1(idKt(r.total))} kt**` },
    ],
  };
};
const indoTypeShare: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13];
  const shr = (x: IdRow) => (x.robusta / (x.arabica + x.robusta + x.other || 1)) * 100;
  const now = shr(r); const then = ya ? shr(ya) : null;
  const shift = then != null ? now - then : null;
  return {
    facts: [{ label: `Robusta share · ${monthLabel(r.date)}`, value: `**${now.toFixed(0)}%**${then != null ? ` (vs ${then.toFixed(0)}% a year ago)` : ""}` }],
    read: shift != null && Math.abs(shift) >= 5 ? `Mix shifting ${shift > 0 ? "into robusta" : "toward arabica"} (${Math.abs(shift).toFixed(0)}pp YoY).` : undefined,
  };
};
const indoYoy: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13]; if (!ya) return null;
  const a = chgPct(r.arabica, ya.arabica), rb = chgPct(r.robusta, ya.robusta);
  const gap = a != null && rb != null ? rb - a : null;
  return {
    facts: [{ label: `YoY · ${monthLabel(r.date)}`, value: `arabica **${pct(a)}**, robusta **${pct(rb)}**` }],
    read: gap != null && Math.abs(gap) > 15 ? `${gap > 0 ? "Robusta" : "Arabica"} strongly outpacing (${Math.abs(gap).toFixed(0)}pp gap).` : undefined,
  };
};
const indoSeasonality: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const byMonth: Record<number, number[]> = {};
  for (const r of s) { const m = +r.date.slice(5, 7); (byMonth[m] ||= []).push(r.total); }
  const avg = (m: number) => (byMonth[m]?.reduce((x, y) => x + y, 0) ?? 0) / (byMonth[m]?.length || 1);
  const peak = Object.keys(byMonth).map(Number).sort((x, y) => avg(y) - avg(x))[0];
  const last = s[s.length - 1]; const lm = +last.date.slice(5, 7);
  const vsNorm = chgPct(last.total, avg(lm));
  return {
    facts: [
      { label: "Seasonal peak", value: `**${MONTHS[peak - 1]}**` },
      { label: `${MONTHS[lm - 1]} vs its norm`, value: `**${pct(vsNorm)}**` },
    ],
    read: vsNorm != null && Math.abs(vsNorm) > 15 ? `Flow running ${vsNorm > 0 ? "hot" : "cold"} against the seasonal calendar.` : undefined,
  };
};
const indoDest: Builder = async () => {
  const d = await indoData();
  const cc = d?.by_country?.countries; if (!cc) return null;
  const totals = Object.entries(cc)
    .map(([c, months]) => [c, Object.values(months || {}).reduce((a, b) => a + (b || 0), 0)] as [string, number])
    .filter(([, v]) => v > 0);
  if (!totals.length) return null;
  const grand = totals.reduce((a, [, v]) => a + v, 0) || 1;
  const top = totals.sort((a, b) => b[1] - a[1]).slice(0, 3);
  const share0 = (top[0][1] / grand) * 100;
  return {
    facts: [
      { label: "Top destination", value: `**${top[0][0]}** — **${share0.toFixed(0)}%** of shipments` },
      { label: "Next", value: top.slice(1).map(([c, v]) => `${c} (${((v / grand) * 100).toFixed(0)}%)`).join(", ") },
    ],
    read: share0 > 25 ? `Concentrated offtake — ${top[0][0]} anchors Indonesian export demand.` : undefined,
  };
};

// ── Producer S&D (demand_stocks.json + the origin's balance sheet) ────────────
/**
 * The S&D card headlines the HOUSE number for the focus season: the analyst
 * "Final" typed in the crop-estimate editor when there is one, otherwise the
 * average of the published sources. The note has to lead with that same figure
 * or the two disagree on the page — previously the note quoted only the raw
 * USDA PSD row, in kt, against a card headlining the house call in M bags.
 *
 * `balance` locates the origin's multi-source seed: Vietnam nests it under
 * `balance_sheet` in vn_farmer_economics.json, the other origins ship a
 * top-level br/id/ug_balance_sheet.json. Absent → the note degrades to the
 * plain USDA balance it always produced.
 */
interface SdSeason { season: string; forecast: boolean; production: Record<string, number>; production_final?: number }
interface SdBalance { sources?: { key: string; label: string }[]; seasons?: SdSeason[] }
const MBAGS_PER_KT = 1 / 60; // 1 kt of green coffee = 16.67k bags = 0.01667 M bags

const supplyDemand = (
  key: string,
  label: string,
  balance?: { url: string; path?: "balance_sheet" },
): Builder => async () => {
  const d = await load<{ producers?: Record<string, { latest_year?: string | number; latest_production_mt?: number; latest_exports_mt?: number; latest_stocks_mt?: number }> }>("/data/demand_stocks.json");
  const p = d?.producers?.[key]; if (!p) return null;
  const facts: Fact[] = [];

  // ── The house call, matching the card's focus season and its own maths ──
  if (balance) {
    const raw = await load<Record<string, unknown>>(balance.url);
    const bs = (balance.path ? raw?.[balance.path] : raw) as SdBalance | undefined;
    const seasons = bs?.seasons ?? [];
    // Card focus = the LAST forecast season, else the last season on file.
    const focus = [...seasons].reverse().find((s) => s.forecast) ?? seasons[seasons.length - 1];
    const vals = (bs?.sources ?? [])
      .map((s) => ({ label: s.label, mBags: focus?.production?.[s.key] }))
      .filter((s): s is { label: string; mBags: number } => Number.isFinite(s.mBags));

    if (focus && vals.length) {
      const avg = vals.reduce((a, s) => a + s.mBags, 0) / vals.length;
      const isFinal = focus.production_final != null;
      const house = isFinal ? (focus.production_final as number) : avg;
      const lo = Math.min(...vals.map((v) => v.mBags));
      const hi = Math.max(...vals.map((v) => v.mBags));
      const usda = vals.find((v) => v.label.toUpperCase() === "USDA")?.mBags;

      // Fixed 1dp everywhere so the note's figures line up character-for-
      // character with the card's own toFixed(1) equation strip.
      const m1 = (v: number) => v.toFixed(1);
      // "House number" is the reader-facing name for the figure the card
      // displays, in either mode — the code calls the typed variant an
      // "analyst final", but that is an internal label, not the concept.
      const how = isFinal
        ? "house number (typed)"
        : `house number (avg of ${vals.length} source${vals.length > 1 ? "s" : ""}, ${m1(lo)}–${m1(hi)}M)`;
      const vsUsda = usda != null && Math.abs(house - usda) >= 0.05
        ? `, **${m1(Math.abs(house - usda))}M ${house < usda ? "below" : "above"}** USDA's ${m1(usda)}M`
        : usda != null ? ", in line with USDA" : "";
      facts.push({
        label: `${label} crop ${focus.season}${focus.forecast ? " (f)" : ""}`,
        value: `**${m1(house)}M bags** — ${how}${vsUsda}`,
      });
    }
  }

  // ── The USDA PSD backbone the rest of the card's rows are built on ──
  const bits: string[] = [];
  if (p.latest_production_mt != null) bits.push(`production **${n1(p.latest_production_mt / 1000)} kt**`);
  if (p.latest_exports_mt != null) bits.push(`exports **${n1(p.latest_exports_mt / 1000)} kt**`);
  if (p.latest_stocks_mt != null) bits.push(`ending stocks **${n1(p.latest_stocks_mt / 1000)} kt**`);
  if (!bits.length && !facts.length) return null;
  if (bits.length) {
    // Spell the unit conversion out — the card is in M bags, PSD ships tonnes,
    // and the two looked like different crops until you did the division.
    const asMBags = p.latest_production_mt != null
      ? ` (production = **${((p.latest_production_mt / 1000) * MBAGS_PER_KT).toFixed(1)}M bags**)`
      : "";
    facts.push({ label: `USDA PSD backbone · MY${p.latest_year ?? "latest"}`, value: `${bits.join(", ")}${asMBags}` });
  }

  let read: string | undefined; let flag = false;
  if (p.latest_stocks_mt != null && p.latest_exports_mt) {
    const cover = (p.latest_stocks_mt / p.latest_exports_mt) * 100;
    facts.push({ label: "Stock cover", value: `ending stocks = **${cover.toFixed(0)}%** of a year's exports` });
    if (cover < 15) { read = "Thin buffer — the balance sheet has little room for a crop disappointment."; flag = true; }
    else if (cover > 35) read = "Comfortable stock buffer relative to export commitments.";
  }
  return { facts, read, flag };
};

// ── Weather packs & analogs ───────────────────────────────────────────────────
interface WxDaily { day: number; accum_mm: number | null; avg_accum_mm?: number; min_accum_mm?: number; max_accum_mm?: number; }
interface Wx { updated?: string; station?: string; daily_station?: WxDaily[]; forecast_7d?: { rain_mm?: number }[]; }
const weatherPack = (origin: string, label: string): Builder => async () => {
  const d = await load<Wx>(`/data/${origin}_weather.json`);
  const ds = d?.daily_station;
  if (!Array.isArray(ds) || !ds.length) return null;
  const actual = [...ds].reverse().find((r) => r.accum_mm != null);
  if (!actual || actual.accum_mm == null) return null;
  const mtd = actual.accum_mm, avg = actual.avg_accum_mm, lo = actual.min_accum_mm, hi = actual.max_accum_mm;
  const mo = +(d?.updated ?? "").slice(5, 7);
  const monAbbr = mo >= 1 && mo <= 12 ? MONTHS[mo - 1] : "";
  const fc = (d?.forecast_7d ?? []).reduce((a, r) => a + (r.rain_mm ?? 0), 0);
  let zone: "below" | "within" | "above" = "within";
  if (lo != null && mtd < lo) zone = "below";
  else if (hi != null && mtd > hi) zone = "above";
  return {
    facts: [
      { label: `${label} MTD rain${d?.station ? ` (${d.station})` : ""}`, value: `**${n0(mtd)} mm** through ${actual.day} ${monAbbr}${avg != null ? ` (**${pct(chgPct(mtd, avg))}** vs normal)` : ""}` },
      ...(lo != null && hi != null ? [{ label: "Safe zone", value: `**${zone}** the ${n0(lo)}–${n0(hi)} mm band` }] : []),
      { label: "7-day forecast", value: `+**${n0(fc)} mm**` },
    ],
    read: zone === "below" ? "Rainfall below the safe zone — watch for crop-moisture stress." :
          zone === "above" ? "Wetter than the safe zone — flowering/harvest disruption risk." : undefined,
    flag: zone !== "within",
  };
};
/** Vietnam river flow — the Jan–Apr irrigation constraint in the Central
 *  Highlands. Basins are reported as % vs TBNN (the multi-year normal), so the
 *  read is "how many basins are short, and is the forecast easing or not". */
const vnWaterLevels: Builder = async () => {
  interface River { river?: string; station?: string; tbnn_pct?: number | null; forecast_tbnn_pct?: number | null; signal?: string }
  const d = await load<{ rivers?: River[]; bulletin_date?: string | null; has_live_data?: boolean }>("/data/vn_water_levels.json");
  const rivers = (d?.rivers ?? []).filter((r) => typeof r.tbnn_pct === "number");
  if (!rivers.length) return null;

  const short = rivers.filter((r) => r.signal === "critical" || r.signal === "low");
  // Deepest deficit anchors the note — that basin is the binding constraint.
  const worst = [...rivers].sort((a, b) => (a.tbnn_pct ?? 0) - (b.tbnn_pct ?? 0))[0];
  const facts: Fact[] = [
    {
      label: `Basins below normal${d?.bulletin_date ? ` (bulletin ${d.bulletin_date})` : ""}`,
      value: `**${short.length} of ${rivers.length}** — ${short.length ? short.map((r) => r.river).join(", ") : "none"}`,
    },
    { label: "Deepest deficit", value: `**${worst.river}** at **${pct(worst.tbnn_pct ?? null)}** vs TBNN${worst.station ? ` (${worst.station})` : ""}` },
  ];
  if (typeof worst.forecast_tbnn_pct === "number") {
    const easing = worst.forecast_tbnn_pct > (worst.tbnn_pct ?? 0);
    facts.push({ label: "Forecast", value: `**${pct(worst.forecast_tbnn_pct)}** vs TBNN — ${easing ? "easing" : "deepening"}` });
  }
  const critical = rivers.filter((r) => r.signal === "critical").length;
  return {
    facts,
    read: critical
      ? `${critical} basin${critical > 1 ? "s" : ""} critical — irrigation water is the binding constraint on the next robusta crop.`
      : short.length
      ? "Flow below normal but not critical — watch through the Jan–Apr dry season."
      : "Basins at or above normal — no irrigation constraint priced in.",
    flag: critical > 0,
  };
};

/** Vietnam farmer economics — the grower's margin is what decides whether
 *  farmgate coffee gets sold or held, so the note is cost vs the FAQ spot. */
const vnFarmerEconomics: Builder = async () => {
  const d = await load<{
    cost_robusta?: { total_usd_per_ton?: number; total_usd_per_ton_excl_family?: number; yoy_pct?: number; season_label?: string; components?: { label?: string; usd?: number; share?: number }[] };
    acreage?: { thousand_ha?: number; yoy_pct?: number };
    yield?: { bags_per_ha?: number; yoy_pct?: number };
  }>("/data/vn_farmer_economics.json");
  const c = d?.cost_robusta;
  const cost = c?.total_usd_per_ton;
  if (cost == null) return null;

  const spotFile = await load<{ vn_faq?: { usd_per_mt?: number } }>("/data/vn_physical_prices.json");
  const spot = spotFile?.vn_faq?.usd_per_mt;

  const facts: Fact[] = [
    {
      label: `Cost of production${c?.season_label ? ` (${c.season_label})` : ""}`,
      value: `**$${n0(cost)}/t** full cost${c?.total_usd_per_ton_excl_family != null ? `, **$${n0(c.total_usd_per_ton_excl_family)}/t** excl. family labour` : ""}${c?.yoy_pct != null ? ` (**${pct(c.yoy_pct)}** YoY)` : ""}`,
    },
  ];
  let read: string | undefined;
  let flag = false;
  if (spot != null) {
    const margin = spot - cost;
    const mult = cost ? spot / cost : null;
    facts.push({
      label: "Grower margin vs VN FAQ spot",
      value: `spot **$${n0(spot)}/t** → margin **${margin >= 0 ? "+" : "−"}$${n0(Math.abs(margin))}/t**${mult ? ` (**${mult.toFixed(2)}×** cost)` : ""}`,
    });
    if (margin <= 0) { read = "Spot below full cost — growers hold rather than sell, tightening near-term offers."; flag = true; }
    else if (mult && mult >= 1.6) read = "Margin well above cost — growers have every incentive to keep selling into the rally.";
    else read = "Positive but unexceptional margin — selling stays price-sensitive.";
  }
  const top = (c?.components ?? []).slice().sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  if (top?.label && top.share != null) {
    facts.push({ label: "Largest cost block", value: `**${top.label}** — **${(top.share * 100).toFixed(0)}%** of full cost` });
  }
  const ha = d?.acreage?.thousand_ha, yld = d?.yield?.bags_per_ha;
  if (ha != null || yld != null) {
    const bits: string[] = [];
    if (ha != null) bits.push(`**${n1(ha)}k ha**${d?.acreage?.yoy_pct != null ? ` (${pct(d.acreage.yoy_pct)})` : ""}`);
    if (yld != null) bits.push(`**${n1(yld)} bags/ha**${d?.yield?.yoy_pct != null ? ` (${pct(d.yield.yoy_pct)})` : ""}`);
    facts.push({ label: "Acreage · yield", value: bits.join(" · ") });
  }
  return { facts, read, flag };
};

const weatherAnalogs = (origin: string, label: string): Builder => async () => {
  // The file keys the matches as `top_analogs` (ranked by distance) and carries
  // the ensemble outcome separately — the years alone say nothing, so the note
  // pairs them with what those analogue crops actually did.
  interface Analog { year?: number | string; same_cycle_yoy_detrended_pct?: number | null }
  interface Ensemble { mean_pct?: number; median_pct?: number; n?: number; ci95_lo?: number; ci95_hi?: number }
  const d = await load<{
    top_analogs?: Analog[];
    ensemble_same_cycle?: Ensemble;
    current_crop_year?: number | string;
  }>(`/data/weather_analogs_${origin}.json`);
  const an = d?.top_analogs;
  if (!an?.length) return null;

  const top = an.slice(0, 3).filter((a) => a.year != null);
  if (!top.length) return null;
  const facts: Fact[] = [{
    label: `${label} closest analogs`,
    value: top
      .map((a) => {
        const y = a.same_cycle_yoy_detrended_pct;
        return `**${a.year}**${typeof y === "number" ? ` (crop ${pct(y)})` : ""}`;
      })
      .join(", "),
  }];

  const e = d?.ensemble_same_cycle;
  let read: string | undefined;
  let flag = false;
  if (e && typeof e.mean_pct === "number") {
    facts.push({
      label: `Analog-implied crop${d?.current_crop_year ? ` ${d.current_crop_year}` : ""}`,
      value: `**${pct(e.mean_pct)}** detrended YoY${e.n ? ` (n=${e.n})` : ""}${
        typeof e.ci95_lo === "number" && typeof e.ci95_hi === "number"
          ? `, 95% CI [${pct(e.ci95_lo)}, ${pct(e.ci95_hi)}]`
          : ""
      }`,
    });
    // A CI entirely one side of zero is the only case the analogs actually call.
    const oneSided = typeof e.ci95_lo === "number" && typeof e.ci95_hi === "number"
      && (e.ci95_lo > 0 || e.ci95_hi < 0);
    if (e.mean_pct <= -5) {
      read = oneSided
        ? `Analog years point to a smaller ${label} crop — the whole confidence interval sits below trend.`
        : `Analogs lean to a smaller ${label} crop, but the spread still straddles trend.`;
      flag = oneSided;
    } else if (e.mean_pct >= 5) {
      read = oneSided
        ? `Analog years point to a bigger ${label} crop — the whole interval sits above trend.`
        : `Analogs lean to a bigger ${label} crop, but the spread still straddles trend.`;
    } else {
      read = "This season's weather signature has no directional crop message — analogs land near trend.";
    }
  }
  return { facts, read, flag };
};

// ── ENSO ──────────────────────────────────────────────────────────────────────
const enso: Builder = async () => {
  const d = await load<{ phase?: string; intensity?: string; oni?: number; forecast_direction?: string; analogs?: { year?: number }[] }>("/data/enso.json");
  if (!d?.phase) return null;
  const strong = (d.intensity ?? "").toLowerCase().includes("strong");
  return {
    facts: [
      { label: "ENSO phase", value: `**${d.phase}${d.intensity ? ` (${d.intensity})` : ""}**, ONI **${d.oni ?? "—"}**` },
      ...(d.analogs?.[0]?.year ? [{ label: "Closest analog", value: `**${d.analogs[0].year}**` }] : []),
    ],
    read: d.forecast_direction ? `Forecast: ${d.forecast_direction}.` : undefined,
    flag: strong,
  };
};
const ensoPlume: Builder = async () => {
  const d = await load<{ oni_forecast?: { season?: string; la_nina?: number; neutral?: number; el_nino?: number }[] }>("/data/enso.json");
  const f = d?.oni_forecast; if (!Array.isArray(f) || !f.length) return null;
  const first = f[0];
  const entries: [string, number | undefined][] = [["La Niña", first.la_nina], ["Neutral", first.neutral], ["El Niño", first.el_nino]];
  const probs = entries.filter((p) => typeof p[1] === "number").sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (!probs.length) return null;
  const [lead, p] = probs[0];
  const strong = (p ?? 0) >= 0.7 && lead !== "Neutral";
  return {
    facts: [{ label: `Plume · ${first.season ?? "next season"}`, value: `**${lead}** at **${((p ?? 0) * 100).toFixed(0)}%**` }],
    read: strong ? `High-confidence ${lead} call — rainfall-risk regime for Brazil/Vietnam/Colombia likely to shift.` : undefined,
    flag: strong,
  };
};
const ensoRiskTable: Builder = async () => {
  const d = await load<{ risk?: { pins?: { region?: string; country?: string; level?: string; driver?: string; severity?: number }[] } }>("/data/enso.json");
  const pins = d?.risk?.pins; if (!Array.isArray(pins) || !pins.length) return null;
  const lv = (x: string) => pins.filter((p) => (p.level ?? "").toLowerCase() === x).length;
  const high = lv("high"), mod = lv("moderate");
  const top = [...pins].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))[0];
  return {
    facts: [
      { label: "Region risk", value: `**${high} high / ${mod} moderate** of ${pins.length} tracked` },
      ...(top?.region ? [{ label: "Highest", value: `**${top.region}${top.country ? `, ${top.country}` : ""}** (${top.driver ?? "—"})` }] : []),
    ],
    read: high > 0 ? "High-risk growing regions on the board — production risk is live." : "No region currently at high ENSO-driven risk.",
    flag: high > 0,
  };
};
const ensoDivergence: Builder = async () => {
  const d = await load<{ nino34?: { latest?: { sst_anomaly?: number; phase?: string } }; soi?: { latest?: { soi?: number } } }>("/data/enso_indices.json");
  const n = d?.nino34?.latest; const s = d?.soi?.latest;
  if (!n || n.sst_anomaly == null) return null;
  const sst = n.sst_anomaly; const soi = s?.soi ?? null;
  let read: string | undefined; let flag = false;
  if (soi != null) {
    if (sst >= 0.5 && soi <= -0.5) { read = "Ocean and atmosphere coupled warm — El Niño locked in."; flag = true; }
    else if (sst <= -0.5 && soi >= 0.5) { read = "Ocean and atmosphere coupled cool — La Niña locked in."; flag = true; }
    else if (Math.abs(sst) >= 0.5) read = "Atmosphere not yet confirming the ocean signal — phase less entrenched.";
    else read = "Near-neutral coupling.";
  }
  return {
    facts: [
      { label: "Niño 3.4 SST", value: `**${sst >= 0 ? "+" : ""}${sst}°C**${n.phase ? ` (${n.phase.replace(/-/g, " ")})` : ""}` },
      ...(soi != null ? [{ label: "SOI", value: `**${soi}**` }] : []),
    ],
    read, flag,
  };
};
const ensoSubsurface: Builder = async () => {
  const d = await load<{ wwv?: { latest?: { wwv_anomaly?: number; lead_signal?: string }; lead_months?: string } }>("/data/enso_subsurface.json");
  const w = d?.wwv?.latest; if (!w || w.wwv_anomaly == null) return null;
  const lm = d?.wwv?.lead_months ?? "4–6";
  const big = Math.abs(w.wwv_anomaly) >= 1;
  return {
    facts: [
      { label: "Warm Water Volume", value: `**${w.wwv_anomaly >= 0 ? "+" : ""}${w.wwv_anomaly}** ×10¹⁴ m³${w.lead_signal ? ` — **${w.lead_signal.replace(/-/g, " ")}**` : ""}` },
    ],
    read: big ? `Subsurface anomaly beyond the ±1.0 lead threshold — ${w.wwv_anomaly > 0 ? "El Niño" : "La Niña"} odds building over the next ~${lm} months.` : undefined,
    flag: big,
  };
};

// ── Certified stocks (certified_stocks_*.json) ────────────────────────────────
interface CSnap { date: string; total_bags?: number; total_lots_certified?: number; passed_today_bags?: number; failed_today_bags?: number; lots_graded_today?: number; lots_sold_today?: number; }
interface CJson { snapshots?: CSnap[]; as_of?: string; }
const mtdWindow = (snaps: CSnap[]) => {
  const last = snaps[snaps.length - 1]?.date; if (!last) return snaps.slice(0);
  return snaps.filter((s) => s.date.slice(0, 7) === last.slice(0, 7));
};
/** ~6-week trend: % change of the level vs ~30 snapshots ago. */
const snapTrend = (snaps: CSnap[], level: (s: CSnap) => number): number | null => {
  if (snaps.length < 31) return null;
  return chgPct(level(snaps[snaps.length - 1]), level(snaps[snaps.length - 31]));
};

const certifiedTiles: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json");
  const r = await load<CJson>("/data/certified_stocks_robusta.json");
  const out: Record<string, Note> = {};
  const aS = a?.snapshots ?? [];
  if (aS.length) {
    const graded = mtdWindow(aS).reduce((s, x) => s + (x.passed_today_bags ?? 0) + (x.failed_today_bags ?? 0), 0);
    const trend = snapTrend(aS, (x) => x.total_bags ?? 0);
    out.arabica = {
      facts: [
        { label: "Arabica certified", value: `**${n0(aS[aS.length - 1].total_bags ?? 0)} bags** (as of ${a?.as_of ?? aS[aS.length - 1].date})` },
        { label: "Graded MTD", value: `**${n0(graded)} bags**` },
        ...(trend != null ? [{ label: "~6-week trend", value: `**${pct(trend)}**` }] : []),
      ],
      read: trend != null && Math.abs(trend) > 5 ? `Deliverable pool ${trend < 0 ? "draining" : "rebuilding"} — ${trend < 0 ? "a tightening signal for KC" : "supply cushion growing"}.` : undefined,
      flag: trend != null && trend < -10,
    };
  }
  const rS = r?.snapshots ?? [];
  if (rS.length) {
    const graded = mtdWindow(rS).reduce((s, x) => s + (x.lots_graded_today ?? 0), 0);
    const sold = mtdWindow(rS).reduce((s, x) => s + (x.lots_sold_today ?? 0), 0);
    const trend = snapTrend(rS, (x) => x.total_lots_certified ?? 0);
    out.robusta = {
      facts: [
        { label: "Robusta certified", value: `**${n0(rS[rS.length - 1].total_lots_certified ?? 0)} lots** (as of ${r?.as_of ?? rS[rS.length - 1].date})` },
        { label: "MTD", value: `**${n0(graded)} lots** graded, **${n0(sold)}** sold` },
        ...(trend != null ? [{ label: "~6-week trend", value: `**${pct(trend)}**` }] : []),
      ],
      read: trend != null && Math.abs(trend) > 5 ? `Deliverable pool ${trend < 0 ? "draining" : "rebuilding"} on the RC side.` : undefined,
      flag: trend != null && trend < -10,
    };
  }
  return Object.keys(out).length ? out : null;
};
const certifiedActivity: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json");
  const r = await load<CJson>("/data/certified_stocks_robusta.json");
  const aS = a?.snapshots ?? [], rS = r?.snapshots ?? [];
  if (!aS.length && !rS.length) return null;
  const aT = snapTrend(aS, (x) => x.total_bags ?? 0), rT = snapTrend(rS, (x) => x.total_lots_certified ?? 0);
  return {
    facts: [
      { label: "Arabica", value: `**${n0(aS.at(-1)?.total_bags ?? 0)} bags**${aT != null ? ` (**${pct(aT)}** ~6wk)` : ""}` },
      { label: "Robusta", value: `**${n0(rS.at(-1)?.total_lots_certified ?? 0)} lots**${rT != null ? ` (**${pct(rT)}** ~6wk)` : ""}` },
    ],
    read: aT != null && rT != null && aT < -5 && rT < -5 ? "Both contracts drawing down simultaneously — broad deliverable tightening." : undefined,
    flag: aT != null && rT != null && aT < -5 && rT < -5,
  };
};
const certifiedFlow: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json"); const aS = a?.snapshots ?? [];
  if (!aS.length) return null;
  const win = mtdWindow(aS);
  const graded = win.reduce((s, x) => s + (x.passed_today_bags ?? 0) + (x.failed_today_bags ?? 0), 0);
  const net = win.length >= 2 ? (win[win.length - 1].total_bags ?? 0) - (win[0].total_bags ?? 0) : null;
  return {
    facts: [
      { label: "Graded MTD", value: `**${n0(graded)} bags** entered grading` },
      ...(net != null ? [{ label: "Net MTD", value: `**${net >= 0 ? "+" : ""}${n0(net)} bags**` }] : []),
    ],
    read: net != null && net < 0 ? "Net drawdown this month — outflows beating gradings-in." : undefined,
    flag: net != null && net < -10000,
  };
};
const certifiedPeriod = (which: "arabica" | "robusta"): Builder => async () => {
  const j = await load<CJson>(`/data/certified_stocks_${which}.json`); const s = j?.snapshots ?? [];
  if (!s.length) return null;
  const last = s[s.length - 1];
  const total = which === "arabica" ? last.total_bags : last.total_lots_certified;
  const unit = which === "arabica" ? "bags" : "lots";
  const trend = snapTrend(s, (x) => (which === "arabica" ? x.total_bags : x.total_lots_certified) ?? 0);
  return {
    facts: [
      { label: `${which === "arabica" ? "Arabica" : "Robusta"} certified`, value: `**${n0(total ?? 0)} ${unit}** (as of ${j?.as_of ?? last.date})` },
      ...(trend != null ? [{ label: "~6-week trend", value: `**${pct(trend)}**` }] : []),
    ],
    read: trend != null && Math.abs(trend) > 5 ? `Pool ${trend < 0 ? "draining" : "building"} over the period.` : undefined,
  };
};

// ── Spot (spot_coffee.json — chart-specific aggregates from the raw rows,
//     using the SAME normalization helpers as the Spot tab: spotLib) ──────────
interface SpotJson { rows?: SpotRow[]; row_count?: number; as_of?: string; }
async function spotData(): Promise<{ rows: SpotRow[]; asOf: string } | null> {
  const d = await load<SpotJson>("/data/spot_coffee.json");
  if (!Array.isArray(d?.rows) || !d!.rows!.length) return null;
  return { rows: d!.rows!, asOf: d!.as_of ?? "latest scrape" };
}
const sumTons = (rows: SpotRow[]) => rows.reduce((a, r) => a + offerTons(r), 0);

const spotTiles: Builder = async () => {
  const d = await spotData(); if (!d) return null;
  const tot = sumTons(d.rows);
  const ara = sumTons(d.rows.filter((r) => r.Type === "Arabica"));
  const rob = sumTons(d.rows.filter((r) => r.Type === "Robusta"));
  const araPct = tot ? (ara / tot) * 100 : 0;
  return {
    facts: [
      { label: `Spot offers · ${d.asOf}`, value: `**${n0(tot)} t** across **${d.rows.length}** offers (ATTE)` },
      { label: "Split", value: `arabica **${n0(ara)} t** (${araPct.toFixed(0)}%) / robusta **${n0(rob)} t**` },
    ],
    read: araPct >= 85 ? "Offer book heavily arabica-weighted." : araPct <= 15 ? "Offer book heavily robusta-weighted." : undefined,
  };
};
const spotOriginPort: Builder = async () => {
  const d = await spotData(); if (!d) return null;
  const tot = sumTons(d.rows) || 1;
  const agg = (key: (r: SpotRow) => string) => {
    const m = new Map<string, number>();
    for (const r of d.rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + offerTons(r)); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const byOrigin = agg((r) => r.Origin || "");
  const byCell = agg((r) => (r.Origin && r.Port ? `${r.Origin} @ ${r.Port}` : ""));
  if (!byOrigin.length) return null;
  const share0 = (byOrigin[0][1] / tot) * 100;
  return {
    facts: [
      { label: "Top origin offered", value: `**${byOrigin[0][0]}** — **${n0(byOrigin[0][1])} t** (**${share0.toFixed(0)}%** of the book)` },
      ...(byCell.length ? [{ label: "Largest cell", value: `**${byCell[0][0]}** (${n0(byCell[0][1])} t)` }] : []),
    ],
    read: share0 > 40 ? `Offer book concentrated — ${byOrigin[0][0]} alone is ${share0.toFixed(0)}% of visible spot supply.` : undefined,
    flag: share0 > 50,
  };
};
const spotEcf: Builder = async () => {
  const d = await spotData(); if (!d) return null;
  const e = await load<{ monthly?: (EcfM & { arabica_unwashed_mt?: number; arabica_washed_mt?: number })[] }>("/data/ecf_history.json");
  const last = e?.monthly?.length ? e.monthly[e.monthly.length - 1] : null;
  if (!last?.value_mt) return null;
  const offered = sumTons(d.rows);
  const ratio = (offered / last.value_mt) * 100;
  return {
    facts: [
      { label: "Offered vs ECF", value: `**${n0(offered)} t** on offer = **${ratio.toFixed(1)}%** of European port stocks (${n1(last.value_mt / 1000)} kt, ${last.period})` },
    ],
    read: ratio > 10 ? "A large slice of port stocks is actively offered — visible selling pressure in Europe." :
          ratio < 3 ? "Only a sliver of port stocks is on offer — holders sitting tight." : undefined,
    flag: ratio > 10,
  };
};
const spotSquareMap: Builder = async () => {
  const d = await spotData(); if (!d) return null;
  const tot = sumTons(d.rows) || 1;
  const fresh = sumTons(d.rows.filter((r) => cropTier(r.Crop).label === "fresh"));
  const freshPct = (fresh / tot) * 100;
  const byPort = new Map<string, number>();
  for (const r of d.rows) if (r.Port) byPort.set(r.Port, (byPort.get(r.Port) ?? 0) + offerTons(r));
  const topPort = Array.from(byPort.entries()).sort((a, b) => b[1] - a[1])[0];
  return {
    facts: [
      { label: "Crop freshness", value: `**${freshPct.toFixed(0)}%** of offered tonnage is fresh crop` },
      ...(topPort ? [{ label: "Top port", value: `**${topPort[0]}** — **${((topPort[1] / tot) * 100).toFixed(0)}%** of offers` }] : []),
    ],
    read: freshPct < 50 ? "Older crop dominates the visible offer book — quality-discount pressure on differentials." : undefined,
    flag: freshPct < 40,
  };
};

// ── ECF / Kaffeesteuer ────────────────────────────────────────────────────────
interface EcfM { period?: string; value_mt?: number; robusta_mt?: number; }
const ecf: Builder = async () => {
  const d = await load<{ monthly?: EcfM[] }>("/data/ecf_history.json"); const m = d?.monthly; if (!m?.length) return null;
  const last = m[m.length - 1], prev = m[m.length - 2];
  const mv = prev ? chgPct(last.value_mt ?? 0, prev.value_mt ?? 0) : null;
  const vals = m.map((x) => x.value_mt ?? 0);
  const draws = endStreak(vals, -1), builds = endStreak(vals, 1);
  return {
    facts: [
      { label: `ECF ports · ${last.period}`, value: `**${n1((last.value_mt ?? 0) / 1000)} kt** (**${pct(mv)}** MoM)` },
      ...(last.robusta_mt != null ? [{ label: "of which robusta", value: `**${n1(last.robusta_mt / 1000)} kt**` }] : []),
    ],
    read: draws >= 3 ? `${draws} consecutive monthly draws — European availability tightening.` :
          builds >= 3 ? `${builds} consecutive monthly builds — consuming-region cushion growing.` : undefined,
    flag: draws >= 3,
  };
};
const kaffee: Builder = async () => {
  const d = await load<Record<string, number>>("/data/kaffeesteuer.json"); if (!d) return null;
  const keys = Object.keys(d).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  if (keys.length < 13) return null;
  const last = keys[keys.length - 1];
  const cur = d[last];
  const avg12 = keys.slice(-13, -1).reduce((a, k) => a + d[k], 0) / 12;
  const dv = chgPct(cur, avg12);
  return {
    facts: [{ label: `Kaffeesteuer · ${monthLabel(last)}`, value: `**${n0(cur)}** (**${pct(dv)}** vs trailing 12m avg)` }],
    read: dv != null && Math.abs(dv) > 10 ? `German consumption proxy running ${dv > 0 ? "strong" : "soft"} vs its own trend.` : undefined,
    flag: dv != null && dv < -10,
  };
};

// ── Demand — consumption & imports ────────────────────────────────────────────
const worldConsumption: Builder = async () => {
  const d = await load<{ world_consumption?: { tracked_consumption_mt?: number; tracked_countries?: number; tracked_marketing_year?: string; tracked_latest_year?: number | string; tracked_vs_ico_pct?: number } }>("/data/demand_stocks.json");
  const w = d?.world_consumption; if (!w?.tracked_consumption_mt) return null;
  return {
    facts: [
      { label: `World consumption (${w.tracked_marketing_year ?? w.tracked_latest_year ?? "latest"})`, value: `**${n1(w.tracked_consumption_mt / 1e6)} M tonnes** across ${w.tracked_countries ?? "—"} countries${w.tracked_vs_ico_pct != null ? ` (**${w.tracked_vs_ico_pct.toFixed(0)}%** of ICO reference)` : ""}` },
    ],
  };
};
const ageCohort: Builder = async () => {
  const d = await load<{ age_cohort_18plus?: { countries?: Record<string, { annual?: { year: number; pop_18plus?: number }[] }> } }>("/data/demand_stocks.json");
  const c = d?.age_cohort_18plus?.countries; if (!c) return null;
  const names = Object.keys(c); if (!names.length) return null;
  const sumAt = (fromEnd: number) => names.reduce((a, k) => { const arr = c[k].annual ?? []; return a + (arr[arr.length - fromEnd]?.pop_18plus ?? 0); }, 0);
  const last = sumAt(1); const decadeAgo = sumAt(11);
  if (!last || !decadeAgo) return null;
  const yr = (c[names[0]].annual ?? []).at(-1)?.year;
  return {
    facts: [{ label: `18+ population (${names.length} markets)`, value: `**${pct(chgPct(last, decadeAgo))}** over the past decade${yr ? ` (to ${yr})` : ""}` }],
  };
};
interface ImportsJson { total_by_year?: Record<string, number>; origins?: { name?: string; latest_mt?: number }[]; }
const importsByOrigin = (src: string, label: string): Builder => async () => {
  const d = await load<ImportsJson>(src); const tby = d?.total_by_year; const origins = d?.origins;
  if (!tby || !Array.isArray(origins) || !origins.length) return null;
  const years = Object.keys(tby).sort(); const ly = years[years.length - 1]; const py = years[years.length - 2];
  const total = tby[ly]; if (total == null) return null;
  const top = [...origins].sort((a, b) => (b.latest_mt ?? 0) - (a.latest_mt ?? 0))[0];
  const share = top?.latest_mt != null ? (top.latest_mt / total) * 100 : null;
  const yoy = py != null ? chgPct(total, tby[py]) : null;
  return {
    facts: [
      { label: `${label} imports · ${ly}`, value: `**${n1(total / 1000)} kt** green coffee${yoy != null ? ` (**${pct(yoy)}** YoY)` : ""}` },
      ...(top?.name ? [{ label: "Top origin", value: `**${top.name}**${share != null ? ` at **${share.toFixed(0)}%**` : ""}` }] : []),
    ],
    read: share != null && share > 30 ? `Concentrated sourcing — a ${top!.name} supply shock hits this bloc hardest.` : undefined,
  };
};

// ── Macro ─────────────────────────────────────────────────────────────────────
const currency: Builder = async () => {
  const d = await load<{ currency_index?: { index_value?: number; daily_delta_pct?: number; zscore?: number } }>("/data/quant_report.json");
  const ci = d?.currency_index; if (!ci || ci.index_value == null) return null;
  const z = ci.zscore ?? 0;
  return {
    facts: [{ label: "Producer-FX index", value: `**${n1(ci.index_value)}** (**${pct(ci.daily_delta_pct ?? null)}** today, z **${z.toFixed(1)}**)` }],
    read: z > 1 ? "Producer currencies unusually strong vs USD — supports local prices and farmer retention." :
          z < -1 ? "Producer currencies unusually weak vs USD — incentivises origin selling." : undefined,
    flag: Math.abs(z) > 1.5,
  };
};
interface FgOrigin { currency?: string; unit?: string; history?: { date: string; price: number }[] }
const FG_UNIT: Record<string, string> = {
  per_kg: "/kg", cents_lb: " ¢/lb", per_saca_60kg: "/sc", per_quintal_100lb: "/qq",
};
const FG_MAIN: [string, string][] = [
  ["vietnam", "VN robusta"], ["brazil_arabica", "BR arabica"],
  ["brazil_conilon", "BR conilon"], ["uganda", "UG robusta"],
];
const farmgate: Builder = async () => {
  const d = await load<{ origins?: Record<string, FgOrigin> }>("/data/origin_prices_history.json");
  const o = d?.origins; if (!o) return null;
  const facts: Fact[] = [];
  let worst: { label: string; dod: number } | null = null;
  for (const [key, label] of FG_MAIN) {
    const og = o[key]; const h = og?.history;
    if (!h?.length) continue;
    const last = h[h.length - 1]; const prev = h[h.length - 2];
    const dod = prev ? chgPct(last.price, prev.price) : null;
    const unit = og.unit && FG_UNIT[og.unit] !== undefined ? FG_UNIT[og.unit] : "";
    const cur = og.unit === "cents_lb" ? "" : `${og.currency ?? ""} `;
    facts.push({
      label,
      value: `**${cur}${n1(last.price)}${unit}**${dod != null ? ` (**${pct(dod)}** DoD)` : ""}`,
    });
    if (dod != null && (worst == null || Math.abs(dod) > Math.abs(worst.dod))) worst = { label, dod };
  }
  if (!facts.length) return null;
  const extra = Object.keys(o).length - FG_MAIN.length;
  if (extra > 0) facts.push({ label: "Also tracked", value: `${extra} more origin series` });
  return {
    facts,
    read: worst && Math.abs(worst.dod) > 2 ? `${worst.label} moved ${pct(worst.dod)} on the day — the sharpest farmgate move.` : undefined,
    flag: worst != null && Math.abs(worst.dod) > 4,
  };
};
interface FertItem { name?: string; price_usd_mt?: number; mom_pct?: number; }
const fertilizer: Builder = async () => {
  const d = await load<{ fertilizer?: { items?: FertItem[] } }>("/data/farmer_economics.json");
  const items = d?.fertilizer?.items; if (!items?.length) return null;
  const rising = items.filter((it) => (it.mom_pct ?? 0) > 0).length;
  return {
    facts: [{ label: "N-P-K inputs", value: items.map((it) => `${it.name} **$${n0(it.price_usd_mt ?? 0)}/MT** (${pct(it.mom_pct ?? null)})`).join(", ") }],
    read: rising >= 2 ? "Broad input-cost pressure — squeezes next-cycle farmer break-evens." :
          rising === 0 ? "Input costs easing across the board — margin relief for producers." : undefined,
    flag: rising >= 3,
  };
};
const fxTimeseries: Builder = async () => {
  const d = await load<{ pairs?: Record<string, { history?: { close: number }[] }> }>("/data/fx_history.json");
  const pairs = d?.pairs; if (!pairs) return null;
  const mv = (sym: string, days = 90) => {
    const h = pairs[sym]?.history; if (!h?.length) return null;
    return chgPct(h[h.length - 1].close, h[Math.max(0, h.length - 1 - days)].close);
  };
  const brl = mv("BRL=X"), vnd = mv("VND=X"), cop = mv("COP=X");
  const vals = [brl, vnd, cop].filter((x): x is number => x != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length; // USD/local: negative = local stronger
  return {
    facts: [{ label: "FX ~3m", value: `USD/BRL **${pct(brl)}**, USD/VND **${pct(vnd)}**, USD/COP **${pct(cop)}**` }],
    read: Math.abs(avg) > 2
      ? avg < 0 ? "Producer currencies strengthening — supportive of local prices and farmer retention."
                : "Producer currencies weakening — incentivises origin selling, a headwind for USD futures."
      : undefined,
    flag: Math.abs(avg) > 4,
  };
};
const crossCommodity: Builder = async () => {
  const m = await load<{ date: string; commodities?: { symbol: string; close_price?: number }[] }[]>("/data/macro_cot.json");
  if (!Array.isArray(m) || m.length < 5) return null;
  const price = (row: typeof m[number], sym: string) => row.commodities?.find((c) => c.symbol === sym)?.close_price;
  const chg = (sym: string) => { const cur = price(m[m.length - 1], sym), old = price(m[m.length - 5], sym); return cur != null && old != null ? chgPct(cur, old) : null; };
  const ar = chg("arabica"); if (ar == null) return null;
  const su = chg("sugar11"), co = chg("cocoa_ny");
  const peers = [su, co].filter((x): x is number => x != null);
  const div = peers.length ? ar - peers.reduce((a, b) => a + b, 0) / peers.length : null;
  return {
    facts: [{ label: "~1 month", value: `arabica **${pct(ar)}** vs sugar **${pct(su)}**, cocoa **${pct(co)}**` }],
    read: div != null && Math.abs(div) > 8
      ? `Coffee decoupled from the softs complex (${pct(div)} gap) — the move is coffee-specific, not macro flow.`
      : div != null ? "Tracking the softs complex — macro/fund flow dominant." : undefined,
    flag: div != null && Math.abs(div) > 15,
  };
};
const cpiLatest = (series: Record<string, { monthly?: { period: string; yoy_pct?: number | null }[] }> | undefined, key: string) => {
  const m = series?.[key]?.monthly; if (!m?.length) return null;
  const last = [...m].reverse().find((r) => r.yoy_pct != null);
  return last ? { period: last.period, yoy: last.yoy_pct as number } : null;
};
const usCpi: Builder = async () => {
  const d = await load<{ series?: Record<string, { monthly?: { period: string; yoy_pct?: number | null }[] }> }>("/data/us_cpi.json");
  const all = cpiLatest(d?.series, "all_items"); const core = cpiLatest(d?.series, "core");
  if (!all) return null;
  return {
    facts: [{ label: `US CPI · ${all.period}`, value: `**${pct(all.yoy)}** YoY${core ? ` (core **${pct(core.yoy)}**)` : ""}` }],
    read: Math.abs(all.yoy - 2) >= 0.6 ? `${all.yoy > 2 ? "Above" : "Below"} the Fed's 2% goal — shapes the USD / real-rate backdrop coffee trades against.` : undefined,
    flag: all.yoy > 4,
  };
};
const retailCpi: Builder = async () => {
  const d = await load<{ series?: Record<string, { monthly?: { period: string; yoy_pct?: number | null }[] }> }>("/data/retail_cpi.json");
  const us = cpiLatest(d?.series, "us_coffee") ?? cpiLatest(d?.series, "us");
  const eu = cpiLatest(d?.series, "eu"); const br = cpiLatest(d?.series, "brazil");
  if (!us) return null;
  const entries: [string, { yoy: number } | null][] = [["US", us], ["EU", eu], ["Brazil", br]];
  const parts = entries.filter((p) => p[1]).map(([n, v]) => `${n} **${pct(v!.yoy)}**`);
  const max = Math.max(...entries.filter((p) => p[1]).map(([, v]) => v!.yoy));
  return {
    facts: [{ label: "Retail coffee CPI", value: `${parts.join(", ")} YoY` }],
    read: max > 10 ? "Retail coffee inflation elevated — a lagged demand headwind even if futures cool." : undefined,
    flag: max > 15,
  };
};

// ── Signals ───────────────────────────────────────────────────────────────────
const newsSentiment: Builder = async () => {
  const d = await load<{ sentiment?: { available?: boolean; net_index?: number; overall_sentiment?: string; overall_confidence?: number; bull_count?: number; bear_count?: number; neutral_count?: number; total?: number } }>("/data/quant_report.json");
  const s = d?.sentiment;
  if (!s?.available || !s.total) return null;
  const net = s.net_index ?? (((s.bull_count ?? 0) - (s.bear_count ?? 0)) / (s.total || 1)) * 100;
  return {
    facts: [
      { label: "News sentiment", value: `net **${net > 0 ? "+" : ""}${net.toFixed(0)}** across **${s.total}** headlines (${s.bull_count ?? 0}B / ${s.bear_count ?? 0}S / ${s.neutral_count ?? 0}N)` },
      { label: "Lead class", value: `**${s.overall_sentiment}** at ${(s.overall_confidence ?? 0).toFixed(0)}% confidence` },
    ],
    read: Math.abs(net) > 8 ? `News flow leans ${net > 0 ? "bullish" : "bearish"} for KC/RC.` : undefined,
    flag: Math.abs(net) > 25,
  };
};
const priceDirection: Builder = async () => {
  const d = await load<{ open_direction?: { available?: boolean; direction?: string; prob_up?: number; for_session?: string } }>("/data/quant_report.json");
  const od = d?.open_direction; if (!od?.available || od.prob_up == null) return null;
  const conv = Math.abs(od.prob_up * 100 - 50);
  return {
    facts: [{ label: `Open call · ${od.for_session ?? "next session"}`, value: `**${od.direction}** — P(up) **${(od.prob_up * 100).toFixed(0)}%**` }],
    read: conv >= 15 ? "High-conviction call from the pre-open classifier." : "Low conviction — near a coin-flip; treat accordingly.",
    flag: conv >= 15,
  };
};
const openDirectionCalendar: Builder = async () => {
  const rows = await load<{ hit?: boolean | null }[]>("/data/open_direction_history.json");
  if (!Array.isArray(rows) || !rows.length) return null;
  const graded = rows.filter((r) => typeof r.hit === "boolean");
  if (!graded.length) return null;
  const hr = (graded.filter((r) => r.hit === true).length / graded.length) * 100;
  return {
    facts: [{ label: "Track record", value: `**${hr.toFixed(0)}%** hit rate over **${graded.length}** graded sessions (logged pre-open)` }],
    read: hr >= 55 ? "Demonstrated forward edge over the graded window." :
          hr <= 45 ? "Hit rate below coin-flip — treat the signal with caution." :
          "No demonstrated edge yet — sample still consistent with chance.",
    flag: hr >= 60 || hr <= 40,
  };
};
const robustaForecast: Builder = async () => {
  const d = await load<{ robusta_factors?: { available?: boolean; prediction?: { direction?: string; delta_p?: number }; model?: { r_squared?: number; n_obs?: number } } }>("/data/quant_report.json");
  const rf = d?.robusta_factors; if (!rf?.available) return null;
  const p = rf.prediction ?? {}; const m = rf.model ?? {};
  return {
    facts: [
      { label: "4-week robusta call", value: `**${p.direction}**, ΔP **${p.delta_p ?? "—"} USD/MT**` },
      { label: "Model", value: `R² ${m.r_squared != null ? m.r_squared.toFixed(2) : "—"}, n=${m.n_obs ?? "—"}` },
    ],
    read: m.r_squared != null ? (m.r_squared >= 0.5 ? "Reasonable in-sample fit — directional signal worth weighing." : "Weak fit — low confidence in the point estimate.") : undefined,
  };
};

// ── Vietnam domestic price (vn_physical_prices.json + history for DoD) ────────
// Not a registry chart — feeds the News tab's Recent-activity datapoint for the
// vietnam_price feed (getHeadlineFact only).
const vnDomesticPrice: Builder = async () => {
  const d = await load<{ vn_faq?: { vnd_per_kg?: number; usd_per_mt?: number } }>("/data/vn_physical_prices.json");
  const pr = d?.vn_faq; if (!pr?.vnd_per_kg) return null;
  const h = await load<{ origins?: { vietnam?: { history?: { date: string; price: number }[] } } }>("/data/origin_prices_history.json");
  const hist = h?.origins?.vietnam?.history;
  const dod = hist && hist.length >= 2 ? chgPct(hist[hist.length - 1].price, hist[hist.length - 2].price) : null;
  return {
    facts: [
      { label: "VN FAQ farmgate (Đắk Lắk)", value: `**${n0(pr.vnd_per_kg)} VND/kg**${pr.usd_per_mt ? ` ($${n0(pr.usd_per_mt)}/MT)` : ""}${dod != null ? ` — **${pct(dod)}** DoD` : ""}` },
    ],
    read: dod != null && Math.abs(dod) > 3 ? `Sharp ${dod > 0 ? "jump" : "drop"} in the domestic robusta market.` : undefined,
    flag: dod != null && Math.abs(dod) > 3,
  };
};

// ── Recent-activity-only builders (non-registry) ──────────────────────────────
// FEED_TO_CHART in FreshnessGrid maps freshness feeds to these; they never
// appear in the briefing cart.
const freightHcmEu: Builder = async () => {
  const rs = await routes(); if (!rs) return null;
  const r = rs.find((x) => (x.from ?? "").includes("Ho Chi Minh") && (x.to ?? "").includes("Rotterdam"));
  if (!r?.rate || r.prev == null) return null;
  const d = r.rate - r.prev;
  const dp = chgPct(r.rate, r.prev);
  return {
    facts: [
      { label: "HCM → Rotterdam", value: `**${n0(r.rate)} ${r.unit ?? "USD/FEU"}** — **${d >= 0 ? "+" : "−"}${n0(Math.abs(d))} USD** WoW (${pct(dp)})` },
    ],
    read: dp != null && Math.abs(dp) > 8 ? `Sharp weekly move on the robusta corridor.` : undefined,
    flag: dp != null && Math.abs(dp) > 8,
  };
};

const WX_ALL: [string, string][] = [
  ["brazil", "BR"], ["vn", "VN"], ["colombia", "CO"], ["honduras", "HN"],
  ["ethiopia", "ET"], ["uganda", "UG"], ["indonesia", "ID"],
];
const originWeatherAll: Builder = async () => {
  const facts: Fact[] = [];
  const breaches: string[] = [];
  for (const [file, code] of WX_ALL) {
    const d = await load<Wx>(`/data/${file}_weather.json`);
    const ds = d?.daily_station;
    if (!Array.isArray(ds) || !ds.length) continue;
    const actual = [...ds].reverse().find((r) => r.accum_mm != null);
    if (!actual || actual.accum_mm == null) continue;
    const mtd = actual.accum_mm, avg = actual.avg_accum_mm, lo = actual.min_accum_mm, hi = actual.max_accum_mm;
    const anom = avg != null ? chgPct(mtd, avg) : null;
    const fc = (d?.forecast_7d ?? []).reduce((a, r) => a + (r.rain_mm ?? 0), 0);
    let zone = "";
    if (lo != null && mtd < lo) { zone = " · below band"; breaches.push(`${code} dry`); }
    else if (hi != null && mtd > hi) { zone = " · above band"; breaches.push(`${code} wet`); }
    facts.push({
      label: code,
      value: `rain anomaly **${pct(anom)}** vs normal · 7-day fcst **+${n0(fc)} mm**${zone}`,
    });
  }
  if (!facts.length) return null;
  return {
    facts,
    read: breaches.length ? `Outside the seasonal band: ${breaches.join(", ")}.` : undefined,
    flag: breaches.length > 0,
  };
};

// Open-direction CALL (non-registry) — the pre-open direction the model is
// actually calling, for the News tab's Recent-activity row. The registry's
// open_direction_calendar note keeps showing the track record, which is what
// that chart is about.
interface OdRow {
  date: string; direction?: string; prob_up?: number; status?: string;
  actual_dir?: string | null; actual_gap_pct?: number | null; hit?: boolean | null;
}
const openDirectionCall: Builder = async () => {
  const rows = await load<OdRow[]>("/data/open_direction_history.json");
  if (!Array.isArray(rows) || !rows.length) return null;
  const last = rows[rows.length - 1];
  const p = last.prob_up != null ? last.prob_up * 100 : null;
  const abstain = (last.direction ?? "").toLowerCase() === "abstain";
  const facts: Fact[] = [
    {
      label: `Call · ${last.date}`,
      value: `**${last.direction ?? "—"}**${p != null ? ` — P(up) **${p.toFixed(0)}%**` : ""}`
        + `${last.status === "pending" ? " *(awaiting the open)*" : ""}`,
    },
  ];
  const graded = [...rows].reverse().find((r) => typeof r.hit === "boolean");
  if (graded) {
    facts.push({
      label: `Last graded · ${graded.date}`,
      value: `${graded.direction} → open **${pct(graded.actual_gap_pct ?? null)}** — ${graded.hit ? "**hit**" : "**miss**"}`,
    });
  }
  const conv = p != null ? Math.abs(p - 50) : null;
  return {
    facts,
    read: abstain
      ? "Model abstained — signal too close to a coin-flip to call."
      : conv != null && conv >= 15
      ? "High-conviction pre-open call."
      : conv != null
      ? "Low conviction — near a coin-flip; weight accordingly."
      : undefined,
    flag: !abstain && conv != null && conv >= 15,
  };
};

// ── Options (options_oi.json) ─────────────────────────────────────────────────
// Mirrors the Options report's own maths: P/C from totals, max pain by
// minimising total in-the-money payout across strikes, net delta in
// future-equivalent lots, 25Δ risk-reversal, gamma wall, ATM IV.
interface OptStrike {
  strike: number; call_oi?: number; put_oi?: number;
  call_iv?: number | null; put_iv?: number | null;
  call_delta?: number | null; put_delta?: number | null;
  call_gamma?: number | null; put_gamma?: number | null;
  call_chg?: number | null; put_chg?: number | null;
}
interface OptContract {
  underlying: string; future_price?: number | null; option_expiry?: string | null;
  days_to_expiry?: number | null; strikes?: OptStrike[];
  totals?: { call_oi?: number; put_oi?: number; itm_call_oi?: number; itm_put_oi?: number };
}
const OPT_UNIT: Record<string, string> = { arabica: "¢/lb", robusta: "$/t" };

async function optContracts(mkt: "arabica" | "robusta"): Promise<OptContract | null> {
  const d = await load<{ markets?: Record<string, { contracts?: OptContract[] }> }>("/data/options_oi.json");
  const cs = d?.markets?.[mkt]?.contracts;
  if (!Array.isArray(cs) || !cs.length) return null;
  return cs[0]; // front contract — the one the tab opens on
}
/** Strike minimising total ITM payout to option holders (classic max pain). */
function maxPain(strikes: OptStrike[]): number | null {
  if (!strikes.length) return null;
  let best: { k: number; pain: number } | null = null;
  for (const s of strikes) {
    const k = s.strike;
    let pain = 0;
    for (const x of strikes) {
      if (x.strike < k) pain += (x.call_oi ?? 0) * (k - x.strike);
      if (x.strike > k) pain += (x.put_oi ?? 0) * (x.strike - k);
    }
    if (!best || pain < best.pain) best = { k, pain };
  }
  return best?.k ?? null;
}
/** ~25-delta risk reversal in IV points (put IV − call IV). */
function riskReversal(strikes: OptStrike[]): number | null {
  const near = (target: number, pick: (s: OptStrike) => number | null | undefined) => {
    const cands = strikes.filter((s) => pick(s) != null && s.call_iv != null && s.put_iv != null);
    if (!cands.length) return null;
    return cands.reduce((b, s) => (Math.abs(Math.abs(pick(s)!) - target) < Math.abs(Math.abs(pick(b)!) - target) ? s : b), cands[0]);
  };
  const c25 = near(0.25, (s) => s.call_delta);
  const p25 = near(0.25, (s) => s.put_delta);
  if (!c25?.call_iv || !p25?.put_iv) return null;
  return (p25.put_iv - c25.call_iv) * 100;
}
const atmIv = (c: OptContract): number | null => {
  const px = c.future_price; const ss = c.strikes ?? [];
  if (!px || !ss.length) return null;
  const s = [...ss].filter((x) => x.call_iv != null || x.put_iv != null)
    .sort((a, b) => Math.abs(a.strike - px) - Math.abs(b.strike - px))[0];
  if (!s) return null;
  const ivs = [s.call_iv, s.put_iv].filter((v): v is number => v != null);
  return ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null;
};

/** Build one Note per market — the options ticks render KC left / RM right. */
const optionsNote = (
  build: (c: OptContract, mkt: "arabica" | "robusta") => Note | null,
): Builder => async () => {
  const out: Record<string, Note> = {};
  for (const mkt of ["arabica", "robusta"] as const) {
    const c = await optContracts(mkt);
    if (!c) continue;
    const n = build(c, mkt);
    if (n?.facts.length) out[mkt] = n;
  }
  return Object.keys(out).length ? out : null;
};

const optionsTiles = optionsNote((c, mkt) => {
  const t = c.totals ?? {};
  const call = t.call_oi ?? 0, put = t.put_oi ?? 0, tot = call + put;
  if (!tot) return null;
  const pc = call ? put / call : null;
  const itm = (t.itm_call_oi ?? 0) + (t.itm_put_oi ?? 0);
  const itmShare = tot ? (itm / tot) * 100 : null;
  const mp = maxPain(c.strikes ?? []);
  const px = c.future_price ?? null;
  const mpGap = mp != null && px ? ((mp - px) / px) * 100 : null;
  return {
    facts: [
      { label: `${c.underlying}${c.days_to_expiry != null ? ` · ${Math.round(c.days_to_expiry)}d to expiry` : ""}`,
        value: `future **${px != null ? n1(px) : "—"} ${OPT_UNIT[mkt]}**, total OI **${n0(tot)}** lots` },
      { label: "Put/Call", value: `**${pc != null ? pc.toFixed(2) : "—"}** — ${pc != null && pc > 1 ? "put-heavy" : "call-heavy"}` },
      { label: "ITM · max pain", value: `**${itmShare != null ? itmShare.toFixed(1) : "—"}%** in the money · pain **${mp != null ? n0(mp) : "—"}**${mpGap != null ? ` (${pct(mpGap)} vs future)` : ""}` },
    ],
    read: mpGap != null && Math.abs(mpGap) > 5
      ? `Max pain sits ${pct(mpGap)} from the future — a magnet only if OI holds into expiry.`
      : pc != null && pc > 1.5 ? "Heavily put-weighted book — downside protection is where the OI is."
      : undefined,
    flag: pc != null && pc > 1.5,
  };
});

const optionsPositioning = optionsNote((c) => {
  const ss = c.strikes ?? []; if (!ss.length) return null;
  const callWall = [...ss].sort((a, b) => (b.call_oi ?? 0) - (a.call_oi ?? 0))[0];
  const putWall = [...ss].sort((a, b) => (b.put_oi ?? 0) - (a.put_oi ?? 0))[0];
  const movers = [...ss]
    .map((s) => ({ k: s.strike, d: (s.call_chg ?? 0) + (s.put_chg ?? 0) }))
    .filter((m) => m.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  const px = c.future_price ?? null;
  return {
    facts: [
      { label: "Call wall", value: `**${n0(callWall.strike)}** (${n0(callWall.call_oi ?? 0)} lots)${px ? ` — ${pct(((callWall.strike - px) / px) * 100)} vs future` : ""}` },
      { label: "Put wall", value: `**${n0(putWall.strike)}** (${n0(putWall.put_oi ?? 0)} lots)${px ? ` — ${pct(((putWall.strike - px) / px) * 100)} vs future` : ""}` },
      ...(movers ? [{ label: "Biggest ΔOI", value: `strike **${n0(movers.k)}** ${movers.d > 0 ? "+" : ""}${n0(movers.d)} lots this session` }] : []),
    ],
    read: px && callWall.strike > px && putWall.strike < px
      ? `Book brackets the future — walls at ${n0(putWall.strike)} / ${n0(callWall.strike)} frame the near-term range.`
      : undefined,
  };
});

const optionsGreeks = optionsNote((c) => {
  const ss = c.strikes ?? []; if (!ss.length) return null;
  // Net delta in future-equivalent lots (calls long delta, puts short).
  const netDelta = ss.reduce((a, s) => a + (s.call_delta ?? 0) * (s.call_oi ?? 0) + (s.put_delta ?? 0) * (s.put_oi ?? 0), 0);
  const gammaBy = ss.map((s) => ({ k: s.strike, g: (s.call_gamma ?? 0) * (s.call_oi ?? 0) + (s.put_gamma ?? 0) * (s.put_oi ?? 0) }));
  const gWall = gammaBy.sort((a, b) => b.g - a.g)[0];
  const px = c.future_price ?? null;
  return {
    facts: [
      { label: "Net delta", value: `**${netDelta > 0 ? "+" : ""}${n0(netDelta)}** future-equivalent lots` },
      ...(gWall ? [{ label: "Gamma peak", value: `strike **${n0(gWall.k)}**${px ? ` (${pct(((gWall.k - px) / px) * 100)} vs future)` : ""}` }] : []),
    ],
    read: gWall && px && Math.abs((gWall.k - px) / px) < 0.02
      ? "Future sits on the gamma peak — dealer hedging tends to pin price here."
      : netDelta < 0 ? "Net-short delta book — hedging flows lean with a falling market."
      : undefined,
    flag: !!(gWall && px && Math.abs((gWall.k - px) / px) < 0.02),
  };
});

const optionsExpiry = optionsNote((c) => {
  const t = c.totals ?? {};
  const itmC = t.itm_call_oi ?? 0, itmP = t.itm_put_oi ?? 0;
  const tot = (t.call_oi ?? 0) + (t.put_oi ?? 0);
  if (!tot) return null;
  const dte = c.days_to_expiry != null ? Math.round(c.days_to_expiry) : null;
  const share = ((itmC + itmP) / tot) * 100;
  return {
    facts: [
      { label: `Expiry ${c.option_expiry?.slice(0, 10) ?? "—"}`, value: `**${dte ?? "—"} sessions** left` },
      { label: "Deep ITM OI", value: `calls **${n0(itmC)}** / puts **${n0(itmP)}** lots — **${share.toFixed(1)}%** of the book` },
    ],
    read: dte != null && dte <= 10 && share > 15
      ? "Expiry inside two weeks with a heavy ITM book — pin and assignment risk are live."
      : dte != null && dte <= 10 ? "Expiry inside two weeks — watch the roll." : undefined,
    flag: dte != null && dte <= 10 && share > 15,
  };
});

const optionsVol = optionsNote((c) => {
  const iv = atmIv(c);
  const rr = riskReversal(c.strikes ?? []);
  if (iv == null && rr == null) return null;
  const facts: Fact[] = [];
  if (iv != null) facts.push({ label: "ATM implied vol", value: `**${iv.toFixed(1)}%**${c.days_to_expiry != null ? ` (${Math.round(c.days_to_expiry)}d)` : ""}` });
  if (rr != null) facts.push({ label: "25Δ risk reversal", value: `**${rr > 0 ? "+" : ""}${rr.toFixed(1)} pts** — ${rr > 0 ? "puts bid over calls" : "calls bid over puts"}` });
  return {
    facts,
    read: iv != null && iv > 45 ? "Elevated implied vol — the market is paying up for protection."
      : rr != null && Math.abs(rr) > 3 ? `Pronounced skew toward ${rr > 0 ? "downside" : "upside"} strikes.`
      : undefined,
    flag: (iv != null && iv > 45) || (rr != null && Math.abs(rr) > 3),
  };
});

// ── id → builder map ──────────────────────────────────────────────────────────
const INSIGHTS: Record<string, Builder> = {
  // Price
  daily_quotes: dailyQuotes,
  cot_overview: cotOverview,
  oi_fnd: oiFnd,
  options_tiles: optionsTiles,
  options_positioning: optionsPositioning,
  options_greeks: optionsGreeks,
  options_expiry: optionsExpiry,
  options_vol: optionsVol,
  cot_heatmap: cotHeatmapNote,
  cot_gauges: cotGaugesNote,
  cot_global_flow: cotGlobalFlowNote,
  cot_industry_pulse: cotIndustryPulseNote,
  cot_dry_powder: cotDryPowderNote,
  cot_cycle_location: cotCycleLocationNote,
  cot_signals: cotSignalsNote,
  cot_report: cotReportNote,
  origin_farmgate_prices: farmgate,
  // Freight
  freight_spot: freightSpot,
  freight_evolution: freightEvolution,
  port_activity: portActivity,
  origin_freight_costs: originFreightCosts,
  // Supply — Brazil
  brazil_daily_registration: brazilDaily,
  brazil_monthly_volume: brazilMonthly,
  brazil_annual_trend: brazilAnnual,
  brazil_cumulative_pace: brazilPace,
  brazil_destination: brazilDest,
  brazil_type_share: brazilTypeShare,
  brazil_yoy_type: brazilYoyType,
  brazil_seasonality: brazilSeasonality,
  brazil_supply_demand: supplyDemand("brazil", "Brazil", { url: "/data/br_balance_sheet.json" }),
  brazil_analogs_ensemble: weatherAnalogs("brazil", "Brazil"),
  brazil_weather_pack: weatherPack("brazil", "Brazil"),
  brazil_weather_risk: brazilWeatherRisk,
  // Supply — Vietnam & others
  vietnam_monthly_volume: vietnamMonthly,
  vietnam_cumulative_pace: vietnamPace,
  vietnam_annual_volume: vietnamAnnual,
  vietnam_destination: vietnamDest,
  vietnam_supply_demand: supplyDemand("vietnam", "Vietnam", { url: "/data/vn_farmer_economics.json", path: "balance_sheet" }),
  vietnam_farmer_economics: vnFarmerEconomics,
  vietnam_analogs_ensemble: weatherAnalogs("vietnam", "Vietnam"),
  vietnam_weather_pack: weatherPack("vn", "Vietnam"),
  vietnam_water_levels: vnWaterLevels,
  colombia_weather_pack: weatherPack("colombia", "Colombia"),
  honduras_weather_pack: weatherPack("honduras", "Honduras"),
  ethiopia_weather_pack: weatherPack("ethiopia", "Ethiopia"),
  uganda_monthly_volume: ugandaMonthly,
  uganda_cumulative_pace: ugandaPace,
  uganda_annual_trend: ugandaAnnual,
  uganda_type_share: ugandaTypeShare,
  uganda_destination: ugandaDest,
  uganda_weather_pack: weatherPack("uganda", "Uganda"),
  indonesia_monthly_volume: indoMonthly,
  indonesia_cumulative_pace: indoPace,
  indonesia_annual_trend: indoAnnual,
  indonesia_type_share: indoTypeShare,
  indonesia_yoy_type: indoYoy,
  indonesia_seasonality: indoSeasonality,
  indonesia_destination: indoDest,
  indonesia_weather_pack: weatherPack("indonesia", "Indonesia"),
  enso_oni: enso,
  enso_plume: ensoPlume,
  enso_risk_table: ensoRiskTable,
  enso_divergence: ensoDivergence,
  enso_subsurface: ensoSubsurface,
  // Demand
  certified_stocks_tiles: certifiedTiles,
  certified_stocks_activity: certifiedActivity,
  certified_stocks_flow: certifiedFlow,
  certified_stocks_period_arabica: certifiedPeriod("arabica"),
  certified_stocks_period_robusta: certifiedPeriod("robusta"),
  spot_tiles: spotTiles,
  spot_origin_port: spotOriginPort,
  spot_ecf: spotEcf,
  spot_square_map: spotSquareMap,
  ecf_port_stocks: ecf,
  kaffeesteuer: kaffee,
  world_consumption: worldConsumption,
  age_cohort: ageCohort,
  us_imports_origin: importsByOrigin("/data/us_coffee_imports.json", "US"),
  eu_imports_origin: importsByOrigin("/data/eu_coffee_imports.json", "EU"),
  // Macro
  coffee_currency_index: currency,
  fertilizer_inputs: fertilizer,
  fx_timeseries: fxTimeseries,
  cross_commodity: crossCommodity,
  us_cpi: usCpi,
  retail_cpi: retailCpi,
  // Non-registry (Recent-activity datapoints only)
  vn_domestic_price: vnDomesticPrice,
  open_direction_call: openDirectionCall,
  freight_hcm_eu: freightHcmEu,
  origin_weather_all: originWeatherAll,
  // Macro — Signals
  news_sentiment: newsSentiment,
  price_direction: priceDirection,
  open_direction_calendar: openDirectionCalendar,
  robusta_forecast: robustaForecast,
};

/**
 * Full bullet-note markdown for a feed's Recent-activity entry — every fact of
 * the mapped chart's note (first side for split notes) plus the fired read.
 * Null on any failure.
 */
export async function getFeedNote(chartId: string): Promise<string | null> {
  const fn = INSIGHTS[chartId];
  if (!fn) return null;
  try {
    const r = await fn();
    if (r == null) return null;
    const note: Note | undefined = "facts" in r ? (r as Note) : Object.values(r as Record<string, Note>)[0];
    if (!note || !note.facts.length) return null;
    return renderNote(note);
  } catch {
    return null;
  }
}

/**
 * Resolve the auto-comment markdown for a note id (`chartId` or
 * `chartId__noteKey`). Null on any failure → empty placeholder.
 */
export async function getInsight(noteId: string): Promise<string | null> {
  const [id, key] = noteId.split("__");
  const fn = INSIGHTS[id];
  if (!fn) return null;
  try {
    const r = await fn();
    if (r == null) return null;
    const note: Note | undefined = "facts" in r ? (r as Note) : key ? (r as Record<string, Note>)[key] : Object.values(r as Record<string, Note>)[0];
    if (!note || !note.facts.length) return null;
    const md = renderNote(note);
    return md.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Selection-aware executive summary — structured, line-per-fact format:
 *
 *   **Price**
 *   - NY · Arabica: longs −2.8k lots …      (one line per fact; split-note
 *   - London · Robusta: net +1.0k lots …     charts contribute one line per side)
 *
 *   **⚠ Watch**
 *   - Price up while funds sold — short-covering …
 *
 * Flagged charts sort first within their category; max 4 lines per category
 * with a "+N more" line beyond that. The Watch block collects fired reads so
 * the summary leads with what is actually anomalous.
 */
export async function getExecutiveSummary(selectedIds: string[]): Promise<string | null> {
  if (!selectedIds.length) return null;
  const { REPORT_REGISTRY, REPORT_CATEGORIES } = await import("./registry");
  const selected = new Set(selectedIds);

  interface Item { line: string; flag: boolean; read?: string }
  const byCat = new Map<string, Item[]>();

  for (const def of REPORT_REGISTRY) {
    if (!selected.has(def.id)) continue;
    const fn = INSIGHTS[def.id];
    if (!fn) continue;
    try {
      const r = await fn();
      if (r == null) continue;
      const items: Item[] = [];
      if ("facts" in r) {
        const note = r as Note;
        if (note.facts.length) {
          items.push({
            line: `**${note.facts[0].label}:** ${note.facts[0].value}`,
            flag: !!note.flag,
            read: note.flag ? note.read : undefined,
          });
        }
      } else {
        // Split-note chart: one LINE per side, labelled from the registry.
        for (const [k, note] of Object.entries(r as Record<string, Note>)) {
          if (!note.facts.length) continue;
          const sideLabel = def.notes?.find((n) => n.key === k)?.label ?? k;
          items.push({
            line: `**${sideLabel}:** ${note.facts[0].value}`,
            flag: !!note.flag,
            read: note.flag ? note.read : undefined,
          });
        }
      }
      if (!items.length) continue;
      const arr = byCat.get(def.category) ?? [];
      arr.push(...items);
      byCat.set(def.category, arr);
    } catch {
      continue;
    }
  }

  const lines: string[] = [];
  const watch: string[] = [];
  for (const cat of REPORT_CATEGORIES) {
    const items = byCat.get(cat);
    if (!items?.length) continue;
    const ordered = [...items.filter((i) => i.flag), ...items.filter((i) => !i.flag)];
    const shown = ordered.slice(0, 4);
    const extra = ordered.length - shown.length;
    lines.push(`**${cat}**`);
    for (const i of shown) lines.push(`- ${i.line}`);
    if (extra > 0) lines.push(`- *+${extra} more in section*`);
    lines.push("");
    for (const i of ordered) if (i.flag && i.read) watch.push(i.read);
  }
  if (watch.length) {
    lines.push("**⚠ Watch**");
    for (const w of Array.from(new Set(watch)).slice(0, 4)) lines.push(`- ${w}`);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join("\n") : null;
}
