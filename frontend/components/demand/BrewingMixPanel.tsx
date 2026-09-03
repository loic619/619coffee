"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  BREWING, FORMAT_COLOR, FORMAT_LABEL, GRAMS_PER_CUP,
  gramsPerCup, mixShiftImpactPct, type Format,
} from "@/lib/brewingMix";
import type { Market } from "./ConsumptionRanking";
import { chgTone } from "@/lib/formatters";

// How a country brews, and why it moves the import bill.
//
// The same cup costs 12 g of green coffee as filter, 6 g as a capsule, 5 g as
// instant and ~16 g as a café double. So format mix is a volume lever hiding
// inside a demand number: a market can add drinkers and still import less.
// This panel shows the mix, the blended grams-per-cup it implies, and a
// what-if that prices a mix shift in kt of green coffee.

const FORMATS: Format[] = ["instant", "ground", "singleServe", "wholeBean"];
const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

export default function BrewingMixPanel({ markets }: { markets: Market[] }) {
  const [from, setFrom] = useState<Format>("singleServe");
  const [to, setTo] = useState<Format>("wholeBean");
  const [pts, setPts] = useState(10);

  const rows = useMemo(() => markets
    .filter(m => BREWING[m.short] && (m.consumption_mt ?? 0) > 0)
    .map(m => {
      const p = BREWING[m.short];
      const g = gramsPerCup(p);
      const consKt = (m.consumption_mt as number) / 1000;
      const impactPct = mixShiftImpactPct(p, from, to, pts / 100);
      return {
        short: m.short, name: m.name, consKt, profile: p,
        gRetail: g.retail, gBlended: g.blended,
        oohPct: p.outOfHomeShare * 100,
        // Share bars are % of at-home volume.
        instant: p.retail.instant * 100, ground: p.retail.ground * 100,
        singleServe: p.retail.singleServe * 100, wholeBean: p.retail.wholeBean * 100,
        impactPct, impactKt: consKt * impactPct / 100,
      };
    })
    .sort((a, b) => b.consKt - a.consKt), [markets, from, to, pts]);

  if (!rows.length) return null;

  const totalImpactKt = rows.reduce((s, r) => s + r.impactKt, 0);
  const coveredKt = rows.reduce((s, r) => s + r.consKt, 0);

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            How each market brews — retail format mix &amp; out-of-home share
          </div>
          <div className="text-[10px] text-slate-500">
            Bars = share of at-home volume · ☕ = share of cups drunk out of home · g/cup = green coffee per cup
          </div>
        </div>
        <span className="text-[9px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">
          ⚠ curated estimates — not scraped
        </span>
      </div>

      <div style={{ height: Math.max(200, rows.length * 22 + 44) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={96} interval={0} />
            <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) =>
              [`${Number(v).toFixed(0)}% of at-home volume`, FORMAT_LABEL[n as Format] ?? String(n)]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => FORMAT_LABEL[v as Format] ?? v} />
            {FORMATS.map((f, i) => (
              <Bar key={f} dataKey={f} stackId="mix" fill={FORMAT_COLOR[f]}
                radius={i === FORMATS.length - 1 ? [0, 2, 2, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-market grams/cup + OOH + what-if */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-1.5 py-1">Market</th>
              <th className="text-right px-1.5 py-1">Consumption</th>
              <th className="text-right px-1.5 py-1">☕ out-of-home</th>
              <th className="text-right px-1.5 py-1">g/cup at home</th>
              <th className="text-right px-1.5 py-1">g/cup blended</th>
              <th className="text-right px-1.5 py-1">Shift impact</th>
              <th className="text-left  px-1.5 py-1">Basis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.short} className="border-b border-slate-800/70 hover:bg-slate-800/40">
                <td className="px-1.5 py-0.5 text-slate-300">{r.name}</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-slate-200">{Math.round(r.consKt).toLocaleString()} kt</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-sky-300">{r.oohPct.toFixed(0)}%</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-slate-300">{r.gRetail.toFixed(1)} g</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-amber-300">{r.gBlended.toFixed(1)} g</td>
                <td className={`px-1.5 py-0.5 text-right font-mono ${chgTone(r.impactKt)}`}>
                  {r.impactKt >= 0 ? "+" : ""}{r.impactKt.toFixed(0)} kt
                  <span className="text-slate-500"> ({r.impactPct >= 0 ? "+" : ""}{r.impactPct.toFixed(1)}%)</span>
                </td>
                <td className="px-1.5 py-0.5 text-slate-500 max-w-[280px] truncate" title={r.profile.note}>
                  <span className={r.profile.confidence === "high" ? "text-emerald-500" : r.profile.confidence === "medium" ? "text-amber-500" : "text-red-500"}>●</span>{" "}
                  {r.profile.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* What-if control */}
      <div className="rounded border border-slate-700 bg-slate-900/50 p-2.5 space-y-2">
        <div className="text-[10px] text-slate-300 font-medium">
          What if the mix shifts? — same number of cups, different format
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="text-slate-500">Move</span>
          <input type="range" min={1} max={30} value={pts} onChange={e => setPts(Number(e.target.value))} className="w-28 accent-amber-500" />
          <span className="font-mono text-amber-300 w-9">{pts}pts</span>
          <span className="text-slate-500">from</span>
          <select value={from} onChange={e => setFrom(e.target.value as Format)}
            className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200">
            {FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
          </select>
          <span className="text-slate-500">to</span>
          <select value={to} onChange={e => setTo(e.target.value as Format)}
            className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200">
            {FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
          </select>
          <span className={`ml-auto font-mono ${chgTone(totalImpactKt)}`}>
            Σ {totalImpactKt >= 0 ? "+" : ""}{Math.round(totalImpactKt).toLocaleString()} kt/yr
            <span className="text-slate-500"> across {rows.length} markets ({Math.round(coveredKt).toLocaleString()} kt covered)</span>
          </span>
        </div>
        <div className="text-[9px] text-slate-500">
          {FORMAT_LABEL[from]} costs {GRAMS_PER_CUP[from]} g of green coffee per cup, {FORMAT_LABEL[to]} costs{" "}
          {GRAMS_PER_CUP[to]} g — so moving {pts}pts of at-home volume changes green demand by the amounts above,
          with cups held constant. This is the capsules-versus-beans question priced in tonnes.
        </div>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Format mix and out-of-home shares are <b>desk estimates</b> (ICO country profiles, national coffee-association
        surveys, trade press — each row&rsquo;s basis and vintage in the table, ● = confidence), not scraped data. The
        grams-per-cup constants are physical: ~12 g filter, ~13 g home espresso, 6 g capsule, ~5 g green-equivalent for
        instant (2 g soluble × 2.6), ~16 g for a café double. Replace the estimates with a retail-scan panel and every
        number here sharpens.
      </div>
    </div>
  );
}
