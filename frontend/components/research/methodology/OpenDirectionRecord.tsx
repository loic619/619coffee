"use client";
import { useEffect, useMemo, useState } from "react";
import OpenDirectionFactors from "./OpenDirectionFactors";

// ── Prediction vs Reality — the open-direction walk-forward record ──────────
// Research-tab article fed by open_direction_wf_analysis.json, which the
// daily 03:07 UTC job regenerates from the CURRENT model spec (band, active
// features) — unlike a frozen report, the numbers here track the live model.
// Status colors: hit/miss is the classic red/green CVD pair, so every state
// also carries a glyph and identity is never color-alone.

interface Cell { n: number; hit: number | null; ci_lo: number; ci_hi: number; avg_abs_move: number | null; capture: number }
interface Bucket { label: string; n: number; hit: number }
interface Row {
  date: string; p: number; pred: number; act: number; hit: boolean;
  raw: Record<string, number>; comps: Record<string, number>;
}
interface WfAnalysis {
  generated_at: string; band: number; features: string[]; n: number;
  span: [string, string];
  headline: { all: Cell; acted: Cell; confident: Cell; strong: Cell; ny_shock: Cell };
  buckets: { realized: Bucket[]; predicted: Bucket[]; confidence: Bucket[] };
  rows: Row[];
}

const HIT = "#10b981", MISS = "#ef4444";
const COMP_LABEL: Record<string, string> = {
  base: "base drift", kc_after_rc_diff: "NY after-close",
  days_since_roll: "roll-cycle", cci_overnight: "CCI overnight",
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const usd = (v: number, d = 0) => `${v > 0 ? "+" : ""}${v.toFixed(d)}$/t`;

function Tile({ label, cell, note, hl }: { label: string; cell: Cell; note: string; hl?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${hl ? "bg-indigo-950/30 border-indigo-800/60" : "bg-slate-900 border-slate-700"}`}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold font-mono text-emerald-400">{pct(cell.hit)}</div>
      <div className="text-[10px] font-mono text-slate-500">
        n={cell.n} · CI [{pct(cell.ci_lo, 0)},{pct(cell.ci_hi, 0)}] · {cell.capture > 0 ? "+" : ""}${cell.capture}/t per call
      </div>
      <div className="text-[9px] text-slate-500">{note}</div>
    </div>
  );
}

function Bars({ title, note, buckets, overall }: { title: string; note: string; buckets: Bucket[]; overall: number }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{title}</div>
      <div className="text-[10px] text-slate-500 mb-3">{note}</div>
      <div className="space-y-1.5">
        {buckets.map(b => (
          <div key={b.label} className="flex items-center gap-2">
            <div className="w-16 text-right text-[10px] font-mono text-slate-400 shrink-0">{b.label}</div>
            <div className="flex-1 h-4 bg-slate-800 rounded relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded"
                   style={{ width: `${Math.min(100, b.hit * 100)}%`, background: b.hit >= 0.5 ? HIT : MISS, opacity: 0.85 }} />
              <div className="absolute inset-y-0 border-l border-dashed border-slate-500/70" style={{ left: "50%" }} />
              <div className="absolute inset-y-0 border-l border-dotted border-indigo-400/70" style={{ left: `${overall * 100}%` }} />
            </div>
            <div className={`w-12 text-[11px] font-mono font-bold ${b.hit >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>
              {(b.hit * 100).toFixed(1)}%
            </div>
            <div className="w-12 text-right text-[9px] font-mono text-slate-500">n={b.n}</div>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-slate-500 mt-2">dashed = coin-flip 50% · dotted = all-call average</div>
    </div>
  );
}

export default function OpenDirectionRecord() {
  const [data, setData] = useState<WfAnalysis | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/data/open_direction_wf_analysis.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j ? setData(j) : setMissing(true)))
      .catch(() => setMissing(true));
  }, []);

  const last90 = useMemo(() => (data ? data.rows.slice(-90).reverse() : []), [data]);
  const stats90 = useMemo(() => {
    if (!data) return null;
    const band = data.band;
    let acted = 0, hits = 0, und = 0;
    for (const r of last90) {
      if (Math.abs(r.p - 0.5) < band) und++;
      else { acted++; if ((r.p >= 0.5) === (r.act > 0)) hits++; }
    }
    return { acted, hits, und };
  }, [data, last90]);

  if (missing) {
    return (
      <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
        Walk-forward analysis not yet generated — produced by the next 03:07 UTC prediction run.
      </div>
    );
  }
  if (!data || !stats90) return <div className="bg-slate-900 rounded-lg h-40 animate-pulse" />;

  const H = data.headline;
  const overall = H.all.hit ?? 0.5;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">
          Live report
        </span>
        <h3 className="text-sm font-bold text-white">Prediction vs Reality — the walk-forward record</h3>
        <span className="text-[10px] text-slate-500">
          {data.n} sessions {data.span[0]} → {data.span[1]} · regenerated daily at 03:07 UTC · current spec (band ±{(data.band * 100).toFixed(0)}pp)
        </span>
      </div>

      {/* Headline cells */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="All calls" cell={H.all} note="every session, no Undefined filter" />
        <Tile label={`Acted (current ±${(data.band * 100).toFixed(0)}pp rule)`} cell={H.acted} note="what the live model actually calls" hl />
        <Tile label="Strong calls (conf ≥10pp + pred ≥$10/t)" cell={H.strong} note="rare (~1 per 2–3 weeks), most reliable" />
        <Tile label="NY-shock setup (|KC after| ≥0.8%)" cell={H.ny_shock} note="the signature situation" />
      </div>

      {/* Bucket charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Bars title="Hit-rate by realized |open|" note="misses cluster on tiny-dollar opens — being wrong is cheap"
              buckets={data.buckets.realized} overall={overall} />
        <Bars title="Hit-rate by predicted strength" note="the stronger the forecast, the more reliable the direction"
              buckets={data.buckets.predicted} overall={overall} />
        <Bars title="Hit-rate by confidence |p−50|" note={`the extremes are informative; below ${(data.band * 100).toFixed(0)}pp the model says Undefined`}
              buckets={data.buckets.confidence} overall={overall} />
      </div>

      {/* Last 90 sessions */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Last 90 sessions, day by day</div>
        <p className="text-[10px] text-slate-500 mb-2">
          Walk-forward reconstruction on today&rsquo;s data (the Macro-tab calendar is the frozen pre-open log).
          Over these 90: <b className="text-slate-300">{stats90.acted} calls, {stats90.acted ? Math.round((stats90.hits / stats90.acted) * 100) : 0}% correct, {stats90.und} Undefined</b>.
          Click a <span className="font-mono text-slate-400">▸ predicted</span> value to ungroup its components (they sum exactly).
        </p>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-700 text-left">
                <th className="py-1 pr-2">Session</th><th className="py-1 pr-2">Call</th>
                <th className="py-1 pr-2 text-right">P(up)</th><th className="py-1 pr-2 text-right">Predicted</th>
                <th className="py-1 pr-2 text-right">Open did</th><th className="py-1 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {last90.map(r => {
                const undef = Math.abs(r.p - 0.5) < data.band;
                const call = undef ? "Undefined" : r.p >= 0.5 ? "Bullish" : "Bearish";
                const ok = (r.p >= 0.5) === (r.act > 0);
                const compEntries = ["base", ...data.features].filter(k => r.comps[k] !== undefined);
                return (
                  <>
                    <tr key={r.date}>
                      <td className="py-1 pr-2 font-mono text-slate-400">{r.date}</td>
                      <td className={`py-1 pr-2 font-semibold ${undef ? "text-slate-500 font-normal" : r.p >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>{call}</td>
                      <td className="py-1 pr-2 text-right font-mono text-slate-300">{pct(r.p)}</td>
                      <td className="py-1 pr-2 text-right font-mono text-slate-300">
                        <button onClick={() => setOpen(o => ({ ...o, [r.date]: !o[r.date] }))}
                                className="hover:text-white" aria-expanded={!!open[r.date]}>
                          <span className={`inline-block text-slate-500 transition-transform ${open[r.date] ? "rotate-90" : ""}`}>▸</span>{" "}
                          {usd(r.pred)}
                        </button>
                      </td>
                      <td className={`py-1 pr-2 text-right font-mono ${r.act > 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {r.act > 0 ? "Up" : "Down"} {usd(r.act)}
                      </td>
                      <td className="py-1 text-right">
                        {undef ? <span className="text-slate-500">·</span>
                          : ok ? <span className="text-emerald-400 font-bold">✓</span>
                               : <span className="text-red-400 font-bold">✗</span>}
                      </td>
                    </tr>
                    {open[r.date] && (
                      <tr key={`${r.date}-c`}>
                        <td />
                        <td colSpan={5} className="pb-1.5">
                          <div className="font-mono text-[10px] text-slate-500 border-l-2 border-slate-600 pl-3 leading-relaxed">
                            {compEntries.map((k, i) => (
                              <span key={k}>
                                {i > 0 && "  +  "}
                                {COMP_LABEL[k] ?? k}
                                {k === "kc_after_rc_diff" && r.raw.kc_after_rc_diff !== undefined &&
                                  ` ${(r.raw.kc_after_rc_diff * 100).toFixed(2)}% →`}
                                {k === "days_since_roll" && r.raw.days_since_roll !== undefined &&
                                  ` day ${r.raw.days_since_roll.toFixed(0)} →`}{" "}
                                <b className={Math.abs(r.comps[k]) < 0.5 ? "text-slate-400" : r.comps[k] > 0 ? "text-emerald-400" : "text-red-400"}>
                                  {usd(r.comps[k], 1)}
                                </b>
                              </span>
                            ))}
                            {"  =  "}<b className="text-slate-300">{usd(r.pred, 1)}</b>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-500 italic">
        Basis: out-of-sample expanding walk-forward with the current model spec — each day predicted using only
        prior data. The Macro-tab calendar remains the append-only ground truth (frozen at 03:07, never
        reconstructed). Methodology: Research → Signals &amp; forecasts §1 · evidence trail:{" "}
        <span className="font-mono not-italic">docs/research/open-price-direction-findings.md</span>.
      </p>

      <OpenDirectionFactors />
    </div>
  );
}
