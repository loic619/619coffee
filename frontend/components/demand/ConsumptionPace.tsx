"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Market } from "./ConsumptionRanking";
import { chgTone } from "@/lib/formatters";

// Where demand growth actually comes from.
//
// Consumption = drinking-age population × coffee per adult. In log terms that
// decomposes cleanly:
//     growth(consumption) ≈ growth(adults 18+) + growth(intensity)
// The first term is demography — how many potential drinkers a market gains.
// The second is behaviour — coffee winning (or losing) share of the cup against
// tea and everything else. Splitting them says whether a market is growing
// because it has more people or because those people are switching to coffee,
// which have very different durability.
//
// "Pace" compares the recent 5-year CAGR with the 5 years before it: a market
// can be growing while decelerating, which the level and the growth rate alone
// both hide.

export interface Cohort { name?: string; annual: { year: number; pop_18plus: number }[] }

// growth_markets `short` → age_cohort_18plus ISO3 key.
export const MARKET_ISO3: Record<string, string> = {
  usa: "usa", japan: "jpn", uk: "gbr", canada: "can", australia: "aus",
  new_zealand: "nzl", switzerland: "che", norway: "nor",
  china: "chn", india: "ind", korea: "kor", russia: "rus", turkey: "tur",
  philippines: "phl", egypt: "egy", algeria: "dza", morocco: "mar",
  saudi_arabia: "sau", jordan: "jor", iran: "irn", south_africa: "zaf",
  ukraine: "ukr", serbia: "srb", armenia: "arm", kazakhstan: "kaz",
  thailand: "tha", malaysia: "mys", taiwan: "twn",
  argentina: "arg", chile: "chl",
  brazil: "bra", indonesia: "idn", vietnam: "vnm", ethiopia: "eth",
  mexico: "mex", colombia: "col", peru: "per", honduras: "hnd",
  guatemala: "gtm", nicaragua: "nic", costa_rica: "cri", uganda: "uga",
  tanzania: "tza", ivory_coast: "civ", venezuela: "ven", ecuador: "ecu",
  el_salvador: "slv",
  // Bosnia ranks by volume but UN WPP carries no 18+ cohort for it here, so it
  // sits out the pace and projection panels rather than being dropped entirely.
};
// The EU bloc has no single cohort row — sum its members.
const EU_MEMBER_ISO3 = ["deu", "fra", "ita", "esp", "pol", "rou", "nld", "bel", "cze",
  "grc", "prt", "swe", "hun", "aut", "bgr", "dnk", "fin", "svk", "irl", "hrv",
  "ltu", "svn", "lva", "est", "cyp", "lux", "mlt"];

export function adultsFor(short: string, cohorts: Record<string, Cohort>): Record<number, number> | null {
  if (short === "eu") {
    const out: Record<number, number> = {};
    let any = false;
    for (const iso of EU_MEMBER_ISO3) {
      for (const a of cohorts[iso]?.annual ?? []) { out[a.year] = (out[a.year] ?? 0) + a.pop_18plus; any = true; }
    }
    return any ? out : null;
  }
  const c = cohorts[MARKET_ISO3[short] ?? ""];
  if (!c) return null;
  const out: Record<number, number> = {};
  for (const a of c.annual) out[a.year] = a.pop_18plus;
  return out;
}

const cagr = (v0: number, v1: number, yrs: number) => (v0 > 0 && v1 > 0 && yrs > 0 ? Math.pow(v1 / v0, 1 / yrs) - 1 : null);

export default function ConsumptionPace({ markets, cohorts }: {
  markets: Market[]; cohorts: Record<string, Cohort>;
}) {
  const [win, setWin] = useState<5 | 10>(5);

  const rows = useMemo(() => {
    const out: {
      short: string; name: string; group: string; tea: boolean;
      consKt: number; total: number; popPart: number; intenPart: number;
      pace: number | null; prev: number | null;
    }[] = [];
    for (const m of markets) {
      const series = m.annual
        .filter(a => a.consumption_mt != null && (a.consumption_mt as number) > 0)
        .map(a => ({ y: Number(a.year), v: a.consumption_mt as number }))
        .sort((a, b) => a.y - b.y);
      if (series.length < win + 1) continue;
      const adults = adultsFor(m.short, cohorts);
      if (!adults) continue;

      const last = series[series.length - 1];
      const at = (y: number) => series.find(s => s.y === y)?.v ?? null;
      const y1 = last.y, y0 = y1 - win, yPrev = y1 - 2 * win;
      const c1 = last.v, c0 = at(y0), cPrev = at(yPrev);
      const a1 = adults[y1], a0 = adults[y0];
      if (!c0 || !a1 || !a0) continue;

      // Total growth split into its demographic and behavioural halves.
      const gTotal = cagr(c0, c1, win);
      const gPop = cagr(a0, a1, win);
      if (gTotal == null || gPop == null) continue;
      const gInten = (1 + gTotal) / (1 + gPop) - 1;   // exact multiplicative residual

      // Pace: this window's CAGR vs the window before it.
      const gPrev = cPrev ? cagr(cPrev, c0, win) : null;
      out.push({
        short: m.short, name: m.name, group: m.group ?? "growing", tea: !!m.tea_culture,
        consKt: c1 / 1000,
        total: gTotal * 100, popPart: gPop * 100, intenPart: gInten * 100,
        pace: gPrev != null ? (gTotal - gPrev) * 100 : null,
        prev: gPrev != null ? gPrev * 100 : null,
      });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [markets, cohorts, win]);

  if (rows.length < 3) return null;

  const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
  const NAMES: Record<string, string> = { popPart: "Drinking-age population", intenPart: "Coffee per adult (share of cup)" };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            What drives the growth — demography vs behaviour ({win}-yr CAGR, %/yr)
          </div>
          <div className="text-[10px] text-slate-500">
            Consumption = adults 18+ × coffee per adult, so growth splits into the two bars. ▲/▼ = pace vs the prior {win} years.
          </div>
        </div>
        <div className="flex rounded overflow-hidden border border-slate-700 text-[9px]">
          {([5, 10] as const).map(w => (
            <button key={w} onClick={() => setWin(w)}
              className={`px-2 py-0.5 ${win === w ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>{w}y</button>
          ))}
        </div>
      </div>

      <div style={{ height: Math.max(220, rows.length * 20 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ top: 4, right: 46, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={96} interval={0} />
            <ReferenceLine x={0} stroke="#475569" />
            <Tooltip contentStyle={TT}
              formatter={(v: unknown, n: unknown) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)} %/yr`, NAMES[String(n)] ?? String(n)]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => NAMES[v] ?? v} />
            <Bar dataKey="popPart" stackId="g" fill="#6366f1" />
            <Bar dataKey="intenPart" stackId="g">
              {rows.map(r => <Cell key={r.short} fill={r.intenPart >= 0 ? "#16a34a" : "#ef4444"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pace table — accelerating or fading */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left px-1.5 py-1">Market</th>
              <th className="text-right px-1.5 py-1">Now</th>
              <th className="text-right px-1.5 py-1">Growth {win}y</th>
              <th className="text-right px-1.5 py-1">Prior {win}y</th>
              <th className="text-right px-1.5 py-1">Pace</th>
              <th className="text-right px-1.5 py-1">Of which people</th>
              <th className="text-right px-1.5 py-1">Of which habit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.short} className="border-b border-slate-800/70 hover:bg-slate-800/40">
                <td className="px-1.5 py-0.5 text-slate-300">
                  {r.tea && <span className="text-emerald-400 mr-1">🍃</span>}{r.name}
                </td>
                <td className="px-1.5 py-0.5 text-right font-mono text-slate-200">{Math.round(r.consKt).toLocaleString()} kt</td>
                <td className={`px-1.5 py-0.5 text-right font-mono ${chgTone(r.total)}`}>
                  {r.total >= 0 ? "+" : ""}{r.total.toFixed(1)}%
                </td>
                <td className="px-1.5 py-0.5 text-right font-mono text-slate-500">
                  {r.prev == null ? "—" : `${r.prev >= 0 ? "+" : ""}${r.prev.toFixed(1)}%`}
                </td>
                <td className={`px-1.5 py-0.5 text-right font-mono ${r.pace == null ? "text-slate-600" : r.pace >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                  {r.pace == null ? "—" : `${r.pace >= 0 ? "▲" : "▼"} ${Math.abs(r.pace).toFixed(1)}pp`}
                </td>
                <td className="px-1.5 py-0.5 text-right font-mono text-indigo-300">{r.popPart >= 0 ? "+" : ""}{r.popPart.toFixed(1)}%</td>
                <td className={`px-1.5 py-0.5 text-right font-mono ${chgTone(r.intenPart)}`}>
                  {r.intenPart >= 0 ? "+" : ""}{r.intenPart.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Population = UN WPP 18+ (drinking-age) — for the EU bloc, summed across the 27 members. &ldquo;Habit&rdquo; is
        the exact multiplicative residual (1+total)/(1+population)−1, i.e. coffee per adult: positive means coffee is
        winning share of the cup, negative means it is losing it even where the population still grows. Pace compares
        this window&rsquo;s CAGR with the one before — a market can grow and decelerate at the same time.
      </div>
    </div>
  );
}
