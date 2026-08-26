"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";

import { ResponsiveContainer } from "@/components/ui/FocusableChart";

// Brazil's internal arbitrage: what a roaster pays for arabica versus conilon,
// both in R$ per 60-kg bag, both PHYSICAL domestic trade prices (not futures).
//   brazil_arabica_fisico.json  Tipo 6/7, trimmed mean of the 7 município quotes
//   brazil_conilon_vitoria.json CCCV Vitória-ES T7/8 — the B3 CNL delivery spec
//   cepea_conilon_indicator.json CEPEA/ESALQ conilon indicator (alternative leg)
interface ArabicaRow { date: string; trimmed_mean: number | null }
interface VitoriaRow { date: string; benchmark: number | null }
interface CepeaRow { date: string; price: number | null }

type ConilonLeg = "vitoria" | "cepea";
const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };
const brl = (v: number) => `R$ ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Windows offered on the x-axis, in months back from the latest point. */
const RANGES = [[12, "1Y"], [24, "2Y"], [36, "3Y"], [0, "All"]] as const;

export default function BrazilArbitragePanel() {
  const [arabica, setArabica] = useState<ArabicaRow[] | null>(null);
  const [vitoria, setVitoria] = useState<VitoriaRow[] | null>(null);
  const [cepea, setCepea] = useState<CepeaRow[] | null>(null);
  const [leg, setLeg] = useState<ConilonLeg>("vitoria");
  const [months, setMonths] = useState<number>(24);

  useEffect(() => {
    const grab = <T,>(f: string, set: (v: T) => void, key = "history") =>
      fetch(`/data/${f}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d?.[key]) set(d[key] as T); })
        .catch(() => { /* panel renders its own empty state */ });
    grab<ArabicaRow[]>("brazil_arabica_fisico.json", setArabica);
    grab<VitoriaRow[]>("brazil_conilon_vitoria.json", setVitoria);
    grab<CepeaRow[]>("cepea_conilon_indicator.json", setCepea);
  }, []);

  // Join on dates where BOTH legs quote, so the premium is never a stale
  // arabica against a fresh conilon (or vice versa).
  const series = useMemo(() => {
    if (!arabica) return [];
    const con = new Map<string, number>();
    if (leg === "vitoria") {
      for (const r of vitoria ?? []) if (r.benchmark) con.set(r.date, r.benchmark);
    } else {
      for (const r of cepea ?? []) if (r.price) con.set(r.date, r.price);
    }
    const rows = [];
    for (const a of arabica) {
      const c = con.get(a.date);
      if (!a.trimmed_mean || !c) continue;
      rows.push({
        date: a.date,
        arabica: a.trimmed_mean,
        conilon: c,
        premium: Math.round((a.trimmed_mean - c) * 10) / 10,
        // The discount is the substitution INCENTIVE: the bigger the gap in
        // percentage terms, the harder domestic blends lean on conilon. (The
        // published "domestic conilon demand %" is survey data we don't carry;
        // this is the price signal that drives it, computed from the quotes.)
        discount: Math.round(((a.trimmed_mean - c) / a.trimmed_mean) * 1000) / 10,
      });
    }
    return rows.sort((x, y) => x.date.localeCompare(y.date));
  }, [arabica, vitoria, cepea, leg]);

  const view = useMemo(() => {
    if (!months || !series.length) return series;
    const last = new Date(series[series.length - 1].date);
    const from = new Date(last);
    from.setMonth(from.getMonth() - months);
    const iso = from.toISOString().slice(0, 10);
    return series.filter(r => r.date >= iso);
  }, [series, months]);

  const stats = useMemo(() => {
    if (!series.length) return null;
    const now = series[series.length - 1];
    const prems = series.map(r => r.premium).sort((a, b) => a - b);
    const rank = prems.filter(p => p <= now.premium).length / prems.length;
    const yrAgo = series.filter(r => r.date <= new Date(
      new Date(now.date).setFullYear(new Date(now.date).getFullYear() - 1))
      .toISOString().slice(0, 10)).slice(-1)[0];
    return {
      now, pct: Math.round(rank * 100),
      min: prems[0], max: prems[prems.length - 1],
      yoy: yrAgo ? now.premium - yrAgo.premium : null,
      n: series.length,
    };
  }, [series]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Brazil Internal Arbitrage</h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            What a Brazilian roaster pays for arabica over conilon — both physical domestic
            quotes in R$ per 60-kg bag, not futures. A wide premium pushes domestic blends
            toward conilon; a narrow one pulls them back to arabica and frees conilon for export.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["vitoria", "CCCV Vitória"], ["cepea", "CEPEA"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setLeg(k)}
                title={k === "vitoria"
                  ? "Centro do Comércio de Café de Vitória T7/8 — the B3 CNL delivery spec"
                  : "CEPEA/ESALQ conilon indicator"}
                className={`px-2.5 py-1.5 transition ${leg === k ? "bg-amber-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {RANGES.map(([m, label]) => (
              <button key={label} onClick={() => setMonths(m)}
                className={`px-2.5 py-1.5 transition ${months === m ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!series.length ? (
        <div className="text-[11px] text-slate-500 italic">
          Waiting on the Brazilian physical quotes — arabica Tipo 6/7 and conilon both
          need a price on the same day for a premium to exist.
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Arabica premium</div>
              <div className="text-base font-bold font-mono text-violet-300">
                {brl(stats!.now.premium)}<span className="text-[10px] text-slate-400 font-normal">/bag</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">{stats!.now.date}</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Conilon discount</div>
              <div className="text-base font-bold font-mono text-red-400">
                {stats!.now.discount.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-400 font-mono">below arabica</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Where in range</div>
              <div className={`text-base font-bold font-mono ${stats!.pct > 66 ? "text-red-400" : stats!.pct < 33 ? "text-emerald-400" : "text-slate-100"}`}>
                {stats!.pct}<span className="text-[10px] font-normal">th pct</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {brl(stats!.min)} – {brl(stats!.max)}
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Both legs</div>
              <div className="text-base font-bold font-mono text-slate-100">
                {brl(stats!.now.arabica)}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                conilon {brl(stats!.now.conilon)}
              </div>
            </div>
          </div>

          {/* The chart: premium in R$/bag on the left, the same gap as a % of
              arabica on the right — level and incentive on one canvas. */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
              Arabica premium to conilon · R$/bag and as % of arabica
              <span className="text-slate-600 normal-case">
                {" "}· arabica Tipo 6/7 vs {leg === "vitoria" ? "CCCV Vitória T7/8" : "CEPEA indicator"}
              </span>
            </div>
            <div className="h-80">
              <ResponsiveContainer focusTitle="Brazil arabica premium to conilon"
                width="100%" height="100%">
                <ComposedChart data={view} margin={{ top: 5, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="premFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={48}
                    tickFormatter={(d: string) => {
                      const [y, m] = d.split("-");
                      return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y.slice(2)}`;
                    }} />
                  <YAxis yAxisId="prem" stroke="#a78bfa" tick={{ fontSize: 9 }} width={54}
                    tickFormatter={(v: number) => v.toLocaleString()} />
                  <YAxis yAxisId="pct" orientation="right" stroke="#f87171" tick={{ fontSize: 9 }}
                    width={42} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                    formatter={(v, name) => typeof v !== "number" ? "—"
                      : name === "Conilon discount" ? `${v.toFixed(1)}%` : brl(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <ReferenceLine yAxisId="prem" y={0} stroke="#475569" strokeDasharray="4 3" />
                  <Area yAxisId="prem" type="monotone" dataKey="premium" name="Arabica premium"
                    stroke="#a78bfa" strokeWidth={1.6} fill="url(#premFill)" dot={false} />
                  <Line yAxisId="pct" type="monotone" dataKey="discount" name="Conilon discount"
                    stroke="#ef4444" strokeWidth={1.8} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[9px] text-slate-600 mt-1.5">
              Premium = arabica − conilon; discount = the same gap as a share of the arabica
              price, i.e. how strongly the spread rewards substituting conilon into domestic
              blends. Published domestic-demand shares are survey data and are not shown here.
            </p>
          </div>

          {/* The two legs themselves, so the premium can be read in context */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
              The two legs · R$ per 60-kg bag
            </div>
            <div className="h-56">
              <ResponsiveContainer focusTitle="Brazil physical arabica and conilon"
                width="100%" height="100%">
                <ComposedChart data={view} margin={{ top: 5, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={48}
                    tickFormatter={(d: string) => {
                      const [y, m] = d.split("-");
                      return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y.slice(2)}`;
                    }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 9 }} width={54}
                    tickFormatter={(v: number) => v.toLocaleString()} />
                  <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                    formatter={(v) => typeof v === "number" ? brl(v) : "—"} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Line type="monotone" dataKey="arabica" name="Arabica Tipo 6/7"
                    stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="conilon"
                    name={leg === "vitoria" ? "Conilon CCCV T7/8" : "Conilon CEPEA"}
                    stroke="#34d399" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
