"use client";
// Factor panel for the open-direction model — every candidate's correlation
// with the next overnight gap, through time, plus the B3 late-close study
// (2026-08). Rendered inside OpenDirectionRecord; fed by
// open_direction_factors.json (exporters/open_direction_factors.py).
import { useEffect, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface Factor {
  key: string; label: string; status: string; n: number;
  r: number | null; t: number | null; per_year: Record<string, number | null>;
}
interface EdgeCell { n: number; span: [string, string]; acc: number; base: number; edge: number }
interface PowerBucket { band: string; n: number; acc?: number; blind?: number; skill?: number; avg_abs_gap?: number }
interface Doc {
  generated_at: string; method: Record<string, string | number>;
  factors: Factor[];
  rolling: ({ date: string } & Record<string, number | string>)[];
  power?: { n: number; buckets: PowerBucket[]; inverted_tail_z: number | null; verdict: string };
  gate: {
    baseline: EdgeCell & { per_year: Record<string, number> };
    b3_univariate: EdgeCell | null;
    b3_matched: { base: EdgeCell | null; with_b3: EdgeCell | null; marginal: number | null; flips: number; flips_won: number };
    rc_ret_matched: { base: EdgeCell | null; with_rc: EdgeCell | null; marginal: number | null };
  };
  b3_study: {
    arabica: { icf_sessions: number; resid_sessions: number; close_gap_note: string };
    conilon: { cnl_sessions: number; status: string };
  };
}

const COLORS: Record<string, string> = {
  kc_after: "#0284c7", rc_ret: "#059669", b3: "#8b5cf6", brent: "#d97706",
};
const NAMES: Record<string, string> = {
  kc_after: "NY after-close (in model)", rc_ret: "RC prior-day return (dropped)",
  b3: "B3 after-KC residual (candidate)", brent: "Brent overnight (regime tag)",
};
const YEARS = ["2022", "2023", "2024", "2025", "2026"];
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const fr = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);

export default function OpenDirectionFactors() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/data/open_direction_factors.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j ? setD(j) : setMissing(true)))
      .catch(() => setMissing(true));
  }, []);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      Factor panel not published yet — run the open_direction_factors exporter.
    </div>;
  }
  if (!d) return <div className="bg-slate-900 rounded-lg h-32 animate-pulse" />;

  const g = d.gate;
  const b3m = g.b3_matched;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">
          Factor panel
        </span>
        <h3 className="text-sm font-bold text-white">Every candidate&rsquo;s correlation with the next open — through time</h3>
        <span className="text-[10px] text-slate-500">incl. the B3 late-close study (2026-08) · recomputed nightly</span>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">
          Rolling {d.method.rolling_window}-session correlation with the next overnight gap
        </div>
        <div className="text-[10px] text-slate-500 mb-2">
          The at-a-glance strength map: distance from the zero line is predictive content (either sign);
          wobble across zero is a factor that cannot be trusted.
        </div>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={d.rolling} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={56} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40} domain={[-0.6, 0.6]}
                tickFormatter={(v: number) => fr(v)} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [fr(Number(v)), NAMES[String(n)] ?? String(n)]} />
              <ReferenceLine y={0} stroke="#475569" />
              {Object.keys(COLORS).map(k => (
                <Line key={k} dataKey={k} stroke={COLORS[k]} dot={false} strokeWidth={1.5}
                  name={k} connectNulls />
              ))}
              <Legend verticalAlign="bottom" height={30} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{NAMES[n] ?? n}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Two regimes are visible at a glance: the NY after-close signal has roughly tripled in strength since 2022
          (now ~+0.40), and the prior-day reversal (green, negative) deepened to ~−0.41 in 2026 — while the B3
          candidate (violet) never leaves the noise band.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 overflow-x-auto">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Full battery — lead correlation vs the next gap, whole window and per year
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-700 text-left">
              <th className="py-1 pr-2">Factor</th><th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2 text-right">n</th><th className="py-1 pr-2 text-right">r (t)</th>
              {YEARS.map(y => <th key={y} className="py-1 pr-2 text-right">{y}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {d.factors.map(f => (
              <tr key={f.key}>
                <td className="py-1 pr-2 text-slate-300 font-semibold whitespace-nowrap">{f.label}</td>
                <td className="py-1 pr-2 text-slate-500 text-[10px]">{f.status}</td>
                <td className="py-1 pr-2 text-right font-mono text-slate-400">{f.n}</td>
                <td className="py-1 pr-2 text-right font-mono text-slate-200 whitespace-nowrap">
                  {fr(f.r)} ({f.t})
                </td>
                {YEARS.map(y => {
                  const v = f.per_year[y];
                  const strong = v != null && Math.abs(v) >= 0.15;
                  return <td key={y} className={`py-1 pr-2 text-right font-mono ${strong ? "text-slate-100 font-bold" : "text-slate-500"}`}>{v != null ? fr(v) : "·"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-slate-500 mt-2">
          Bold = |r| ≥ 0.15 that year. Correlation is <em>candidate</em> strength, not model value — the gate below
          shows why the two differ: RC&rsquo;s prior-day reversal correlates at −0.42 in 2026 yet adds
          {" "}{fr(g.rc_ret_matched.marginal)}pp at the model gate, because the NY after-close feature already
          carries the same information. Strong and <em>independent</em> is what earns a slot.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          The B3 late-close study — tested at the standing walk-forward gate
        </div>
        <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
          <b className="text-slate-200">Hypothesis</b>: B3 São Paulo keeps trading ~2.4h after KC&rsquo;s close
          (arabica ICF) and ~3h after London&rsquo;s (conilon CNL); that late window could carry Brazil
          physical/BRL/weather news into the next ICE open. <b className="text-slate-200">Construction</b>:{" "}
          {d.b3_study.arabica.close_gap_note} — the factor is the part of B3&rsquo;s day that KC could not already
          know, roll-cleaned on both legs, knowable ~21:00 London (timing valid for the 03:00 UTC firing).
        </p>
        <table className="w-full text-[11px] mb-2">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-700 text-left">
              <th className="py-1 pr-2">Walk-forward run</th><th className="py-1 pr-2 text-right">OOS days</th>
              <th className="py-1 pr-2 text-right">Accuracy</th><th className="py-1 pr-2 text-right">Baseline</th>
              <th className="py-1 pr-2 text-right">Edge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 font-mono">
            <tr>
              <td className="py-1 pr-2 text-slate-300">Model (kc_after + roll-cycle), full window</td>
              <td className="py-1 pr-2 text-right">{g.baseline.n}</td>
              <td className="py-1 pr-2 text-right">{g.baseline.acc}%</td>
              <td className="py-1 pr-2 text-right">{g.baseline.base}%</td>
              <td className="py-1 pr-2 text-right text-emerald-400">+{g.baseline.edge}pp</td>
            </tr>
            {g.b3_univariate && (
              <tr>
                <td className="py-1 pr-2 text-slate-300">B3 residual alone</td>
                <td className="py-1 pr-2 text-right">{g.b3_univariate.n}</td>
                <td className="py-1 pr-2 text-right">{g.b3_univariate.acc}%</td>
                <td className="py-1 pr-2 text-right">{g.b3_univariate.base}%</td>
                <td className="py-1 pr-2 text-right text-red-400">{g.b3_univariate.edge}pp</td>
              </tr>
            )}
            {b3m.base && b3m.with_b3 && (
              <>
                <tr>
                  <td className="py-1 pr-2 text-slate-300">Model, matched B3 window ({b3m.base.span[0]} →)</td>
                  <td className="py-1 pr-2 text-right">{b3m.base.n}</td>
                  <td className="py-1 pr-2 text-right">{b3m.base.acc}%</td>
                  <td className="py-1 pr-2 text-right">{b3m.base.base}%</td>
                  <td className="py-1 pr-2 text-right text-emerald-400">+{b3m.base.edge}pp</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-slate-300">Model + B3 residual, same window</td>
                  <td className="py-1 pr-2 text-right">{b3m.with_b3.n}</td>
                  <td className="py-1 pr-2 text-right">{b3m.with_b3.acc}%</td>
                  <td className="py-1 pr-2 text-right">{b3m.with_b3.base}%</td>
                  <td className="py-1 pr-2 text-right text-emerald-400">+{b3m.with_b3.edge}pp</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        <div className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
          <p>
            <b className="text-slate-200">Verdict (arabica): rejected at the gate.</b> Marginal
            {" "}<b className="text-slate-200">{fr(b3m.marginal)}pp</b> on the matched window; of the
            {" "}{b3m.flips} calls B3 flipped, it won {b3m.flips_won} ({b3m.flips ? Math.round(b3m.flips_won / b3m.flips * 100) : 0}% —
            a coin toss). The lead correlation is flat every year. Once KC&rsquo;s own close is known, B3&rsquo;s
            extra 2.4 hours have carried no measurable news for the next London open — BRL noise dominates the
            residual. The ICF file grows daily; the standing retest trigger is ~400 matched OOS days
            <span className="text-slate-500"> (~mid-2027)</span>.
          </p>
          <p>
            <b className="text-slate-200">Verdict (conilon): data-starved, wait.</b> Timing is viable — B3&rsquo;s
            CNL settle prints ~3h after the RC close and well before the 03:00 firing — but the accumulator holds
            {" "}{d.b3_study.conilon.cnl_sessions} sessions (B3 exposes no history endpoint; collection started
            2026-08). Per the evidence rule it cannot enter the model; retest at ~300 sessions, zero new
            infrastructure needed. The exact Vietnam-physical precedent.
          </p>
        </div>
      </div>

      {d.power && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Power analysis — a coin flip overall, but does STRONG variation predict?
          </div>
          <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
            The fair follow-up to the rejection: maybe B3 only speaks when it moves <em>hard</em>. Test: bucket the
            {" "}{d.power.n} sessions by the residual&rsquo;s past-only |z| (expanding std — no look-ahead) and ask
            whether sign accuracy <em>rises</em> with strength, the way the model&rsquo;s own confidence curve does
            (56.5% → 63.6% as |p−50| grows). That monotone rise is what a real conditional signal looks like.
          </p>
          <table className="w-full text-[11px] mb-2">
            <thead>
              <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-700 text-left">
                <th className="py-1 pr-2">B3 move strength</th><th className="py-1 pr-2 text-right">n</th>
                <th className="py-1 pr-2 text-right">B3-sign accuracy</th>
                <th className="py-1 pr-2 text-right">Blind majority</th>
                <th className="py-1 pr-2 text-right">Skill</th>
                <th className="py-1 pr-2 text-right">Avg |gap|</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono">
              {d.power.buckets.map(b => (
                <tr key={b.band}>
                  <td className="py-1 pr-2 text-slate-300">{b.band}</td>
                  <td className="py-1 pr-2 text-right">{b.n}</td>
                  <td className="py-1 pr-2 text-right">{b.acc != null ? `${b.acc}%` : "—"}</td>
                  <td className="py-1 pr-2 text-right">{b.blind != null ? `${b.blind}%` : "—"}</td>
                  <td className={`py-1 pr-2 text-right ${b.skill != null && b.skill > 2 ? "text-emerald-400" : b.skill != null && b.skill < -2 ? "text-red-400" : "text-slate-400"}`}>
                    {b.skill != null ? `${b.skill > 0 ? "+" : ""}${b.skill}pp` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right text-slate-500">{b.avg_abs_gap != null ? `${b.avg_abs_gap}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
            <p>
              <b className="text-slate-200">No — strength does not rescue the factor.</b> The curve is
              non-monotone: flat in the middle band, and the strongest bucket (|z| ≥ 2) lands at
              {" "}<b className="text-red-400">27.3% sign accuracy</b> — the biggest B3 late-window moves have
              pointed the <em>wrong way</em> for the next open, a reversal shape rather than continuation.
            </p>
            <p>
              <b className="text-slate-200">And the inverted read is not promotable either.</b> Fading the strong
              B3 move would have hit ~73% on those 22 days, but against the bucket&rsquo;s own blind-majority
              baseline that is binomial z ≈ {d.power.inverted_tail_z} — after slicing multiple buckets, well below
              any honest bar. It is logged as an accumulation flag: if the wrong-way tail persists as ICF data
              accrues (~40 tail days), it earns a re-look as a <em>fade</em> signal. Until then, neither the
              level, the sign, nor the strength of the B3 late window changes the model.
            </p>
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-500 italic">
        Same harness as every prior feature decision: expanding walk-forward, standardise-on-past, refit every 5,
        marginals on matched OOS dates vs the rolling-majority baseline. Full evidence trail:{" "}
        <span className="font-mono not-italic">docs/research/open-price-direction-findings.md</span> · data:{" "}
        <span className="font-mono not-italic">open_direction_factors.json</span>.
      </p>
    </div>
  );
}
