"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";

import { ResponsiveContainer } from "@/components/ui/FocusableChart";

// Where a futures move actually lands. London rises USD 100/t; Vietnam's
// farmgate rises 50, Brazil conilon 20 — Vietnam absorbed half the move, so
// Vietnam is where that move is being priced.
//
// No ModelledBadge here on purpose. This is a measured regression coefficient
// over observed prices, not a prediction, so there is nothing to grade and a
// hit-rate badge would imply a track record that cannot exist. The method and
// its caveat are shown instead, straight from the payload.
interface Row {
  date: string;
  futures: number;
  leader: string | null;
  elasticity: Record<string, number>;
}
interface OriginMeta { name: string; color: string; lag: number }
interface Leader7d {
  origin: string; elasticity: number; days_led: number; of_days: number;
  all: Record<string, number>;
}
interface Market {
  label: string;
  origins: Record<string, OriginMeta>;
  series: Row[];
  leader_7d: Leader7d | null;
}
interface Doc {
  window_days: number; tile_days: number; method: string; caveat: string;
  markets: Record<string, Market>;
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };
const RANGES = [[1, "1M"], [3, "3M"], [6, "6M"], [12, "1Y"], [0, "All"]] as const;
const MKT_ORDER = ["arabica", "robusta"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Month+year alone repeats itself across a short window — a 3-month view
// rendered "Jun 26" five times over. Short windows get the day.
const fmtDate = (d: string, withDay: boolean) =>
  withDay ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`
          : `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}`;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export default function PriceElasticitySection() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [months, setMonths] = useState<number>(3);
  const [country, setCountry] = useState<string>("all");

  useEffect(() => {
    fetch("/data/price_elasticity.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.markets) setDoc(d as Doc); })
      .catch(() => { /* section renders its own empty state */ });
  }, []);

  /** Every date either market quotes, oldest first. */
  const dates = useMemo(() => {
    if (!doc) return [];
    const s = new Set<string>();
    for (const m of Object.values(doc.markets)) for (const r of m.series) s.add(r.date);
    return Array.from(s).sort();
  }, [doc]);

  const view = useMemo(() => {
    if (!dates.length) return dates;
    if (!months) return dates;
    const last = new Date(dates[dates.length - 1]);
    const from = new Date(last);
    from.setMonth(from.getMonth() - months);
    const iso = from.toISOString().slice(0, 10);
    return dates.filter(d => d >= iso);
  }, [dates, months]);

  /** Futures level, split into one key per origin so each stretch of the line
   *  can be stroked in the colour of whoever was leading at the time. */
  const priceRows = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const d of view) byDate.set(d, { date: d });
    if (doc) {
      for (const mkt of MKT_ORDER) {
        const m = doc.markets[mkt];
        if (!m) continue;
        const rows = m.series.filter(r => byDate.has(r.date));
        rows.forEach((r, i) => {
          const cell = byDate.get(r.date)!;
          cell[mkt] = r.futures;
          if (!r.leader) return;
          cell[`${mkt}__${r.leader}`] = r.futures;
          // Also write the previous point into this origin's key, so a change
          // of leader joins up instead of leaving a one-pixel hole.
          const prev = rows[i - 1];
          if (prev && byDate.has(prev.date)) {
            byDate.get(prev.date)![`${mkt}__${r.leader}`] = prev.futures;
          }
        });
      }
    }
    return view.map(d => byDate.get(d)!);
  }, [doc, view]);

  const elasticityRows = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const d of view) byDate.set(d, { date: d });
    if (doc) {
      for (const mkt of MKT_ORDER) {
        const m = doc.markets[mkt];
        if (!m) continue;
        for (const r of m.series) {
          const cell = byDate.get(r.date);
          if (!cell) continue;
          for (const [origin, v] of Object.entries(r.elasticity)) {
            cell[`${mkt}__${origin}`] = v;
          }
        }
      }
    }
    return view.map(d => byDate.get(d)!);
  }, [doc, view]);

  /** Every (market, origin) pair present, for the legend and the filter. */
  const pairs = useMemo(() => {
    if (!doc) return [];
    const out: { mkt: string; origin: string; meta: OriginMeta }[] = [];
    for (const mkt of MKT_ORDER) {
      const m = doc.markets[mkt];
      if (!m) continue;
      for (const [origin, meta] of Object.entries(m.origins)) out.push({ mkt, origin, meta });
    }
    return out;
  }, [doc]);

  const countries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pairs) if (!seen.has(p.origin)) seen.set(p.origin, p.meta.name.split(" (")[0]);
    return Array.from(seen.entries());
  }, [pairs]);

  const visible = pairs.filter(p => country === "all" || p.origin === country);
  // Up to 6 months the ticks need the day; beyond that month+year reads better.
  const dayTicks = months !== 0 && months <= 6;
  const tick = (d: string) => fmtDate(d, dayTicks);

  if (!doc) {
    return (
      <section className="px-6 py-5">
        <div className="text-[11px] text-slate-500 italic">
          Waiting on price_elasticity.json — the pass-through series needs origin prices,
          FX and futures history all present.
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-5 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-teal-400 bg-teal-950/60 px-2 py-0.5 rounded">
              Section 6
            </span>
            <h2 className="text-lg font-bold text-white">Futures pass-through by origin</h2>
          </div>
          <p className="text-xs text-slate-400 max-w-4xl mt-1">
            How much of each futures move actually reaches the farmgate. London rises
            $100/t; if Vietnam&apos;s local price rises $50 and Brazil conilon $20, Vietnam
            absorbed half the move and is where it is being priced. Both legs in USD/t, so
            currency drift is not mistaken for pass-through.
          </p>
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px] h-fit">
          {RANGES.map(([m, label]) => (
            <button key={label} onClick={() => setMonths(m)}
              className={`px-2.5 py-1.5 transition ${months === m ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Who is leading each market right now */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MKT_ORDER.map(mkt => {
          const m = doc.markets[mkt];
          if (!m) return null;
          const lead = m.leader_7d;
          const meta = lead ? m.origins[lead.origin] : null;
          return (
            <div key={mkt} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">{m.label}</div>
              {lead && meta ? (
                <>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: meta.color }} />
                    <span className="text-base font-bold text-white">{meta.name}</span>
                    <span className="text-base font-bold font-mono" style={{ color: meta.color }}>
                      {lead.elasticity}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    led {lead.days_led}/{lead.of_days} of the last sessions · others{" "}
                    {Object.entries(lead.all)
                      .filter(([k]) => k !== lead.origin)
                      .map(([k, v]) => `${m.origins[k]?.name ?? k} ${v}%`)
                      .join(" · ")}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-slate-500 italic mt-1">
                  No leader — needs two origins with a reading.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Futures, stroked in the colour of whoever is leading */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Futures · USD/t, coloured by the leading origin
          <span className="text-slate-600 normal-case"> · arabica left axis, robusta right</span>
        </div>
        {/* The coloured stretches carry the whole point of this chart, and the
            recharts legend below only names the two grey backbones — so the
            origin key is spelled out rather than left to be guessed. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-[10px] text-slate-400">
          {countries.map(([key, label]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-3.5 h-0.5 rounded-sm"
                style={{ background: pairs.find(p => p.origin === key)?.meta.color }} />
              {label} leading
            </span>
          ))}
        </div>
        <div className="h-72">
          <ResponsiveContainer focusTitle="Futures coloured by leading origin"
            width="100%" height="100%">
            <ComposedChart data={priceRows} margin={{ top: 5, right: 4, left: -8, bottom: 0 }}
              syncId="elasticity">
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={48}
                tickFormatter={tick} />
              <YAxis yAxisId="arabica" stroke="#94a3b8" tick={{ fontSize: 9 }} width={52}
                domain={["auto", "auto"]} tickFormatter={(v: number) => `${Math.round(v / 100) / 10}k`} />
              <YAxis yAxisId="robusta" orientation="right" stroke="#94a3b8" tick={{ fontSize: 9 }}
                width={46} domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${Math.round(v / 100) / 10}k`} />
              <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                labelFormatter={(d) => String(d)}
                formatter={(v, name) => typeof v !== "number" ? "—" : [usd(v), String(name)]} />
              {/* Faint continuous backbone, so a stretch with no named leader
                  still shows the price rather than breaking the line. */}
              <Line yAxisId="arabica" type="monotone" dataKey="arabica" name="KC (arabica)"
                stroke="#475569" strokeWidth={1} dot={false} legendType="plainline" />
              <Line yAxisId="robusta" type="monotone" dataKey="robusta" name="RC (robusta)"
                stroke="#475569" strokeWidth={1} strokeDasharray="3 3" dot={false}
                legendType="plainline" />
              {pairs.map(p => (
                <Line key={`${p.mkt}__${p.origin}`} yAxisId={p.mkt} type="monotone"
                  dataKey={`${p.mkt}__${p.origin}`}
                  name={`${p.meta.name} leading`}
                  stroke={p.meta.color} strokeWidth={2.2} dot={false} connectNulls={false}
                  strokeDasharray={p.mkt === "robusta" ? "3 3" : undefined}
                  legendType="none" />
              ))}
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pass-through through time */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Pass-through · % of each futures move reaching the local price
            <span className="text-slate-600 normal-case">
              {" "}· trailing {doc.window_days} days · solid arabica, dashed robusta
            </span>
          </div>
          <div className="flex bg-slate-900 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            <button onClick={() => setCountry("all")}
              className={`px-2.5 py-1.5 transition ${country === "all" ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
              All
            </button>
            {countries.map(([key, label]) => (
              <button key={key} onClick={() => setCountry(key)}
                className={`px-2.5 py-1.5 transition ${country === key ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer focusTitle="Pass-through by origin over time"
            width="100%" height="100%">
            <ComposedChart data={elasticityRows} margin={{ top: 5, right: 4, left: -8, bottom: 0 }}
              syncId="elasticity">
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={48}
                tickFormatter={tick} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} width={44}
                tickFormatter={(v: number) => `${v}%`} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 3" />
              <ReferenceLine y={100} stroke="#334155" strokeDasharray="2 4"
                label={{ value: "full", position: "insideTopRight", fill: "#475569", fontSize: 9 }} />
              <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v, name) => typeof v !== "number" ? "—" : [`${v.toFixed(1)}%`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {visible.map(p => (
                <Line key={`${p.mkt}__${p.origin}`} type="monotone"
                  dataKey={`${p.mkt}__${p.origin}`}
                  name={`${p.meta.name} · ${p.mkt === "arabica" ? "KC" : "RC"}`}
                  stroke={p.meta.color} strokeWidth={1.7} dot={false} connectNulls={false}
                  strokeDasharray={p.mkt === "robusta" ? "3 3" : undefined} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[9px] text-slate-600 mt-1.5">{doc.method}</p>
        <p className="text-[9px] text-amber-600/80 mt-1">{doc.caveat}</p>
      </div>
    </section>
  );
}
