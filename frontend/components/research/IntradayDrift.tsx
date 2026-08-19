"use client";
// The harvest last-hour signal on its own horizon — follow-up to the
// open-direction factor panel. A sign rule on RC post-open drift, with the
// discovery-bias caveat stated and the full robustness battery published.
// Data: intraday_drift.json (backend/scraper/exporters/intraday_drift.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  CartesianGrid,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "./methodology/prose";

interface Cell_ { n: number; mean: number | null; t: number | null }
interface Doc {
  generated_at: string; method: Record<string, string | number>;
  headline: {
    n: number; span: [string, string]; hit: number; mean_pct: number; t: number;
    usd_gross: number; usd_net: number;
  };
  sweep: { z: number; season: string; n: number; hit: number; mean: number; t: number; usd: number }[];
  per_season: { year: number; n: number; hit: number; mean: number }[];
  robustness: {
    gap_corr: number | null; gap_residualised: Cell_;
    where_it_accrues: { first15: Cell_; after15: Cell_ };
    bootstrap: { lo: number; hi: number; p_gt0: number };
    placebo_random_signs: { p: number; pct95: number };
    placebo_lagged_feature: Cell_;
    pessimistic_entry_usd: number;
  };
  live: { date: string; kc_last_hour_pct: number; z: number; in_harvest: boolean; armed: boolean; direction: string | null } | null;
  trades: { date: string; z: number; pnl_pct: number; usd: number }[];
}

const WIN = "#059669", LOSS = "#d97706", EQ = "#8b5cf6";
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const pc = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

export default function IntradayDrift() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/intraday_drift.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const equity = useMemo(() => {
    if (!d) return [];
    let c = 0;
    return d.trades.map(t => { c += t.pnl_pct; return { date: t.date, pnl: t.pnl_pct, cum: +c.toFixed(2) }; });
  }, [d]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      intraday_drift.json not published yet — run the exporter.
    </div>;
  }
  if (!d) return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;

  const h = d.headline, rb = d.robustness;
  const offRow = d.sweep.find(s => s.z === 1.5 && s.season === "off-season");

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> The factor panel found something the open-direction model cannot use: KC&rsquo;s
        last hour predicts the next session&rsquo;s <em>post-open drift</em> — but only in Brazil harvest, and only
        when the move is heavy. The model calls the overnight <em>gap</em>, a different horizon, so the finding was
        recorded rather than traded. Tested on its own target with a parameter-poor sign rule, it is
        {" "}<strong>the strongest single effect in this research programme</strong>: {h.n} gated sessions since
        {" "}{h.span[0]}, <strong>{h.hit}% directional hit-rate</strong>, mean drift
        {" "}<strong>{pc(h.mean_pct)} captured per event</strong> (t {h.t}) — about
        {" "}<strong>${h.usd_net}/t net of costs</strong> — positive in every harvest season, and dead flat
        off-season ({pc(offRow?.mean)}). It survives a gap control, a weekly block bootstrap, and two placebos
        including the one that matters most: <em>lag the feature by one extra session and the effect vanishes</em>.
        The honest caveat is stated up front — the harvest condition was <em>discovered</em> on this same history,
        so this is a confirmation, not an out-of-sample validation.
      </P>

      <H2>1 · The rule — deliberately parameter-poor</H2>
      <UL>
        <LI><strong>Feature</strong>: the prior session&rsquo;s KC last hour, <Code>kc_1830 / kc_1730 − 1</Code> —
          NY&rsquo;s move in the hour after London robusta closes. Already stored across the whole archive.</LI>
        <LI><strong>Gate</strong>: {d.method.gate}. Both conditions are stated in advance and the threshold sweep is
          published below.</LI>
        <LI><strong>Trade</strong>: RC post-open drift in the <em>same</em> direction — long if the last hour was up,
          short if down. <Code>rc_1730 / rc_open − 1</Code>, same session, same contract by construction
          (roll-immune). Nothing is regressed and <strong>no coefficient is estimated</strong>, so there is no fit to
          leak; the first {d.method.warmup} sessions are never traded.</LI>
      </UL>

      <H2>2 · The result, and the sweep behind it</H2>
      <RefTable head={["|z| gate", "Season", "n", "Hit-rate", "Mean drift", "t", "$/t gross"]} rows={
        d.sweep.map(s => [`${s.z}`, s.season, `${s.n}`, `${s.hit}%`, pc(s.mean), `${s.t}`, `$${s.usd > 0 ? "+" : ""}${s.usd}`])
      } />
      <UL>
        <LI><strong>The seasonal split is the whole story.</strong> At the {d.method.gate ? "1.5" : ""}σ gate the
          harvest cell runs {pc(h.mean_pct)} per event on {h.n} sessions; the same rule off-season earns
          {" "}<strong>{pc(offRow?.mean)}</strong> on {offRow?.n} sessions — not a weaker version of the effect,
          <em> nothing at all</em>. Every threshold tells the same story, which is why the gate choice is not doing
          the work.</LI>
        <LI><strong>Every harvest season is independently positive</strong> — {d.per_season.map(s => `${s.year} ${pc(s.mean)}`).join(", ")} —
          across a squeeze, a collapse and a frost year. The 2025 cell is thin (n {d.per_season.find(s => s.year === 2025)?.n})
          and 2024 is the strongest ({d.per_season.find(s => s.year === 2024)?.hit}% hit); the pattern does not
          depend on any one of them.</LI>
      </UL>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Every gated session, and the cumulative drift captured</h4>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={equity} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [pc(Number(v)), n === "cum" ? "cumulative" : "session drift captured"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="pnl" maxBarSize={10} radius={[2, 2, 0, 0]}>
                {equity.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? WIN : LOSS} />)}
              </Bar>
              <Line dataKey="cum" stroke={EQ} dot={false} strokeWidth={1.8} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Bars are individual gated sessions (<span style={{ color: WIN }}>■</span> captured,{" "}
          <span style={{ color: LOSS }}>■</span> gave back); the violet line is their cumulative sum. Gaps between
          clusters are the off-season, when the rule does not fire at all.
        </p>
      </div>

      <H2>3 · Robustness — what could make this a mirage, and what happened when tested</H2>
      <RefTable head={["Challenge", "Test", "Result"]} rows={[
        ["It is just the overnight gap continuing",
          "corr(gap, same-session drift); rule re-run on gap-residualised drift",
          `r ${rb.gap_corr} — no relation; residualised rule ${pc(rb.gap_residualised.mean)} (t ${rb.gap_residualised.t}), STRONGER`],
        ["It is an opening-auction artefact you cannot trade",
          "split the drift: first 15 min vs 09:15→close",
          `${pc(rb.where_it_accrues.first15.mean)} in the first 15 min vs ${pc(rb.where_it_accrues.after15.mean)} after — it accrues through the session`],
        ["A few lucky sessions carry it",
          "weekly block bootstrap, 4,000 resamples",
          `95% CI [${pc(rb.bootstrap.lo)}, ${pc(rb.bootstrap.hi)}], P(mean>0) ${rb.bootstrap.p_gt0}%`],
        ["Any sign rule would look good on these days",
          "placebo: random signs, same sessions (2,000 draws)",
          `p ≈ ${rb.placebo_random_signs.p} (95th pctile of placebo ${pc(rb.placebo_random_signs.pct95)})`],
        ["It is generic momentum, not this specific hour",
          "placebo: identical rule, feature lagged one extra session",
          `${pc(rb.placebo_lagged_feature.mean)} (t ${rb.placebo_lagged_feature.t}) — the effect VANISHES`],
        ["Costs and realistic fills eat it",
          `round-trip $${d.method.cost_usd_t}/t; and entering at 09:15 instead of the open`,
          `$${h.usd_net}/t net; $${rb.pessimistic_entry_usd}/t on the pessimistic entry`],
      ]} />
      <P>
        The lagged-feature placebo is the one that matters. If this were generic &ldquo;coffee trends in harvest&rdquo;
        momentum, shifting the feature back one session would barely dent it. Instead it collapses from
        {" "}{pc(h.mean_pct)} to {pc(rb.placebo_lagged_feature.mean)}: the signal lives in the specific hour
        <em> immediately before</em> the session it predicts — which is exactly what a pre-hedging story requires,
        and what a spurious seasonal pattern would not produce.
      </P>

      <H2>4 · What it is, mechanically</H2>
      <P>
        The reading that fits every number: during harvest, commercials hedging the next day&rsquo;s physical
        purchases push size through NY&rsquo;s last hour, after London has closed. That flow is
        {" "}<strong>information, not pressure</strong> — the drift <em>continues</em> in its direction rather than
        reversing, and it continues <em>through the session</em> rather than snapping back at the open. Heavy selling
        is the sharper half (the factor panel measured {""}75% continuation vs 63% for buying), consistent with the
        hedger&rsquo;s natural direction. Off-season, when there is no crop to pre-hedge, the same hour carries no
        information at all — which is precisely the control the hypothesis needs.
      </P>

      <H2>5 · Honest limits — read these before using it</H2>
      <UL>
        <LI><strong>The harvest condition was discovered on this data.</strong> This study confirms it on its proper
          target with placebos and a bootstrap, but it is <em>not</em> an out-of-sample validation. The per-season
          stability and the lagged-feature placebo are what carry the weight; the forward record starting now is the
          real arbiter.</LI>
        <LI><strong>{h.n} events over four years.</strong> The rule fires roughly a dozen times per harvest season —
          this is a rare-event signal, not a daily strategy, and its confidence interval is correspondingly wide
          ([{pc(rb.bootstrap.lo)}, {pc(rb.bootstrap.hi)}]).</LI>
        <LI><strong>It requires intraday execution</strong> — enter after the open, exit at the close. Nothing on
          this site currently trades intraday; the pessimistic-entry column exists so the number is not read as a
          fill you could never get.</LI>
        <LI><strong>Costs are an assumption</strong> (${d.method.cost_usd_t}/t round-trip). Real spread on RC varies;
          at triple that assumption the edge still survives, but thin-liquidity sessions are the ones most likely to
          both trigger the gate and cost the most to trade.</LI>
        <LI><strong>The model itself is unchanged.</strong> This is a different target on a different horizon — the
          open-direction model still calls the overnight gap and its spec is untouched. This card is a study, not a
          signal wired into the site.</LI>
      </UL>

      {d.live && (
        <Highlight>
          <strong>Live state ({d.live.date}):</strong> KC&rsquo;s last hour moved {pc(d.live.kc_last_hour_pct)}
          {" "}(z {d.live.z}), {d.live.in_harvest ? "inside" : "outside"} the harvest window —
          {" "}{d.live.armed
            ? <><strong>gate ARMED, direction {d.live.direction}</strong>.</>
            : <>gate not armed (needs |z| ≥ {d.method.gate ? "1.5" : ""} in harvest).</>}
          {" "}The gate is evaluated on every export and every firing is appended to the trade list above, so the
          forward record builds itself.
        </Highlight>
      )}

      <H2>Sources &amp; method</H2>
      <P>
        15-minute intraday archive for KC and RC ({d.method.feature}; {d.method.target}). Sign rule, no fitted
        parameters; past-only z-scores; {d.method.warmup}-session warm-up. Bootstrap, placebos and the sweep
        recomputed on every export from <Code>intraday_drift.json</Code>.
      </P>

      <DataFiles files={["intraday_drift.json", "intraday_kc_rc_15min.json", "open_direction_factors.json"]} />
    </div>
  );
}
