"use client";
// From the port to the shelf — the research-tab rendering of the study in
// backend/research/retail_passthrough. The paper (REPORT.md) is the reference;
// this page draws the same tables and figures from the exporter's payload and
// adds no number of its own.
//
// Colour: the two legs of the trade keep one identity each throughout — green
// coffee in the aqua categorical slot, the shelf price in the dark-yellow one.
// Red and blue appear only as STATE, never as series identity: red marks a
// rising green price and blue a falling one, so "rockets" and "feathers" read
// the same way on every panel. Grey means "did not clear its test".
import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, ReferenceLine,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { useFetchJson } from "@/lib/useFetchJson";
import { Paper, H2, H, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "./methodology/prose";

const C_GREEN = "#199e70";    // the green leg — categorical slot 3
const C_SHELF = "#c98500";    // the shelf price — slot 4
const C_UP = "#e66767";       // a RISING green price / a shelf above its level
const C_DOWN = "#3987e5";     // a FALLING green price / a shelf below its level
const C_MUTE = "#64748b";     // did not clear its test
const GRID = "#1e293b";
const TT = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const TICK = { fontSize: 9, fill: "#64748b" };
const PAPER_URL = "https://github.com/loic619/619coffee/blob/main/backend/research/retail_passthrough/REPORT.md";

// ── payload ──────────────────────────────────────────────────────────────────

interface SeriesRow { m: string; green: number | null; us: number | null; us2: number | null; eu: number | null; br: number | null }
interface LagRow {
  lag: number; pearson: number | null; spearman: number | null; n: number | null; n_eff: number | null;
  p_bartlett: number | null; q_bh: number | null; p_surrogate: number | null; sur_q95_abs: number | null;
}
interface ProfilePt { lag: number; r: number | null; band: number | null }
interface MarketRow {
  /** joins this row to its lag profile in `cross_market_profiles`. */
  key: string | null;
  market: string | null; retail_series: string | null; currency: string | null; n: number | null;
  first: string | null; last: string | null; peak_lag: number | null; peak_r: number | null;
  band_lo: number | null; band_hi: number | null; p_max_surrogate: number | null; eg_p: number | null;
  cointegrated_5pct: string | null; theta: number | null; theta_se_hac: number | null; n_eff: number | null;
  slope_12m_lag5: number | null; slope_p_hac: number | null; cost_share_break_even: number | null;
  asym_correction_p_boot: number | null;
}
interface BetaRow { lag: number | null; beta: number | null; p: number | null; cumulative: number | null }
interface GridRow { retail_usd_per_kg: number | null; retail_usd_per_lb: number | null; green_cost_share: number | null; passthrough_rate: number | null }
interface RobRow {
  market: string | null; spec: string | null; n: number | null; first: string | null; last: string | null;
  eg_p: number | null; cointegrated_5pct: string | null; theta: number | null; theta_se_hac: number | null;
  n_eff: number | null; cum_passthrough_12m: number | null; slope_12m_lag5: number | null; slope_p_hac: number | null;
}
interface SubRow { sample: string | null; n: number | null; first: string | null; last: string | null; eg_p: number | null; theta: number | null; slope_12m_lag5: number | null; slope_p_hac: number | null }
interface DemandRow { lag: number | null; elasticity: number | null; se_hac: number | null; p: number | null; n: number | null }
interface YieldRow { roast_yield: number | null; green_usd_per_kg_roasted: number | null; implied_retail_usd_per_kg: number | null; implied_retail_usd_per_lb: number | null }
interface Headline {
  market: string; retail_series: string; n: number; first: string; last: string; months_missing: string[];
  peak_lag: number; peak_r: number; band_lo: number; band_hi: number; p_max_surrogate: number;
  cointegrated: boolean; eg_p: number; theta: number; theta_se: number; n_eff: number;
  beta_impact: number; beta_impact_p: number; cum_12m: number; slope_12m: number; slope_n_eff: number;
  implied_retail_kg: number; mean_green_kg: number;
  episode: { start: string; end: string; green_delta_usd_per_kg: number; retail_pct: number; cost_share_break_even: number };
  asymmetry: {
    gamma_pos: number; gamma_neg: number; gamma_pos_se: number; gamma_neg_se: number;
    half_life_pos: number; half_life_neg: number;
    p_correction_asymptotic: number; p_correction_bootstrap: number; p_shortrun_bootstrap: number; verdict: string;
  };
  demand: { best_lag: number; best_elasticity: number; best_p: number; n_sig_05: number; n_lags_tested: number };
}
interface Payload {
  generated_at: string;
  headline: Headline;
  caveats: string[];
  markets_not_covered: Record<string, string>;
  series: SeriesRow[];
  lag_profile: LagRow[];
  cross_market: MarketRow[];
  cross_market_profiles: Record<string, ProfilePt[]>;
  betas: BetaRow[];
  cost_share_grid: GridRow[];
  robustness: RobRow[];
  subsamples: SubRow[];
  demand_by_lag: DemandRow[];
  roast_yield: YieldRow[];
}

// ── formatting ───────────────────────────────────────────────────────────────

const f = (v: number | null | undefined, nd = 3) => (v == null || !isFinite(v) ? "—" : v.toFixed(nd));
const pct = (v: number | null | undefined, nd = 0) => (v == null ? "—" : `${(v * 100).toFixed(nd)} %`);
const usd = (v: number | null | undefined, nd = 2) => (v == null ? "—" : `$${v.toFixed(nd)}`);
/** p-values: never print "0.000" for something that is merely small. */
const fp = (v: number | null | undefined) => (v == null ? "—" : v < 0.001 ? "< 0.001" : v.toFixed(3));
const yes = (v: string | null | undefined) => String(v) === "True" || String(v) === "true";

const MARKET_LABEL: Record<string, string> = {
  us: "United States · SEFP01",
  us_sefp02: "United States · SEFP02",
  eu_usd: "Euro area · green in USD",
  eu_eur: "Euro area · green in EUR",
  br_usd: "Brazil · green in USD",
  br_brl: "Brazil · green in BRL",
};
const MARKET_ORDER = ["us", "us_sefp02", "eu_usd", "eu_eur", "br_usd", "br_brl"];

export default function RetailPassthrough() {
  const { data: d, error } = useFetchJson<Payload>("/data/retail_passthrough.json");
  const [gridUnit, setGridUnit] = useState<"lb" | "kg">("lb");

  const H0 = d?.headline;

  const levels = useMemo(() => (d ? d.series.filter(s => s.green != null || s.us != null) : []), [d]);
  const lagChart = useMemo(() => (d ? d.lag_profile.map(r => ({
    lag: r.lag,
    r: r.pearson,
    band: r.sur_q95_abs,
    negBand: r.sur_q95_abs == null ? null : -r.sur_q95_abs,
    inBand: H0 != null && r.lag >= H0.band_lo && r.lag <= H0.band_hi,
    clears: r.pearson != null && r.sur_q95_abs != null && Math.abs(r.pearson) > r.sur_q95_abs,
    n_eff: r.n_eff, q: r.q_bh,
  })) : []), [d, H0]);
  const cumChart = useMemo(() => (d ? d.betas.map(b => ({ lag: b.lag, cum: b.cumulative, beta: b.beta, p: b.p })) : []), [d]);
  const gridChart = useMemo(() => (d ? d.cost_share_grid.map(g => ({
    price: gridUnit === "lb" ? g.retail_usd_per_lb : g.retail_usd_per_kg,
    rate: g.passthrough_rate, share: g.green_cost_share,
  })) : []), [d, gridUnit]);
  const demandChart = useMemo(() => (d ? d.demand_by_lag.map(r => ({
    lag: r.lag, e: r.elasticity, err: r.se_hac == null ? 0 : 1.96 * r.se_hac, p: r.p,
  })) : []), [d]);
  const asymChart = useMemo(() => (H0 ? [
    { k: "shelf ABOVE its long-run level", g: H0.asymmetry.gamma_pos,
      err: 1.96 * H0.asymmetry.gamma_pos_se, half: H0.asymmetry.half_life_pos },
    { k: "shelf BELOW its long-run level", g: H0.asymmetry.gamma_neg,
      err: 1.96 * H0.asymmetry.gamma_neg_se, half: H0.asymmetry.half_life_neg },
  ] : []), [H0]);
  const marketKeys = useMemo(() => {
    if (!d) return [];
    const have = Object.keys(d.cross_market_profiles);
    return MARKET_ORDER.filter(k => have.indexOf(k) >= 0);
  }, [d]);
  const usRow = useMemo(() => d?.cross_market.find(r => (r.market || "").indexOf("United States") === 0 && (r.retail_series || "").indexOf("SEFP01") >= 0), [d]);

  return (
    <Paper tone="rose" updated="2026-09-06" kicker="Demand · retail pass-through"
      title="From the port to the shelf"
      subtitle="A green move reaches the US shelf over 3–9 months and about 29 % of it survives as an elasticity — which is near-complete pass-through, not a fifth, once you divide by the green cost share nobody was measuring">

      <P>
        <strong>Abstract.</strong> An idea-box note reported that a 12-month change in the green price predicts the
        US retail coffee index five months later with a slope of about 0.18, and read that as{" "}
        <em>&ldquo;only a fifth of a green move survives to the shelf.&rdquo;</em> The slope replicates and survives
        deflation. The reading does not. A log-log slope is an <strong>elasticity</strong>, and an elasticity only
        becomes a pass-through rate once divided by green coffee&rsquo;s share of the retail price — a denominator no
        series in this repository holds. This study bounds it from the inside instead, then asks the same four
        questions of every consuming market the data reach. The answer to &ldquo;is it the same everywhere?&rdquo;
        is <strong>no</strong> for the timing and <strong>yes</strong> for the magnitude.
      </P>

      {error && <P className="text-slate-400">retail_passthrough.json could not be loaded.</P>}
      {!d && !error && <P className="text-slate-400">Reading the study…</P>}

      {d && H0 && (
        <>
          <H2>Verdict</H2>
          <RefTable head={["question", "answer", "status"]} rows={[
            [<>When does it arrive?</>,
              <span key="a" className="whitespace-normal font-sans text-slate-300">A <strong>band of {H0.band_lo}–{H0.band_hi} months</strong>, peaking at {H0.peak_lag} (r = {f(H0.peak_r, 2)}). Nothing at all arrives in the first month (β₀ = {f(H0.beta_impact)}, p = {f(H0.beta_impact_p, 2)}).</span>,
              <span key="a2" className="whitespace-normal font-sans text-slate-300">🟢 family-wise surrogate p = {fp(H0.p_max_surrogate)}</span>],
            [<>How much arrives?</>,
              <span key="b" className="whitespace-normal font-sans text-slate-300">Long-run elasticity <strong>θ = {f(H0.theta)}</strong> (HAC SE {f(H0.theta_se)}); the levels cointegrate (Engle–Granger p = {fp(H0.eg_p)}), so this is a real long run and not a spurious regression.</span>,
              <span key="b2" className="whitespace-normal font-sans text-slate-300">🟢 but n_eff = <strong>{f(H0.n_eff, 1)}</strong>, not {H0.n}</span>],
            [<>Is {f(H0.theta, 2)} a lot or a little?</>,
              <span key="c" className="whitespace-normal font-sans text-slate-300">θ inverted at the sample-mean green cost implies a shelf price of <strong>{usd(H0.implied_retail_kg)}/kg</strong> ({usd(H0.implied_retail_kg / 2.20462)}/lb) — the price at which pass-through is exactly complete. And complete pass-through in <em>dollars</em> over {H0.episode.start}→{H0.episode.end} needs only that green was under <strong>{pct(H0.episode.cost_share_break_even)}</strong> of the base shelf price.</span>,
              <span key="c2" className="whitespace-normal font-sans text-slate-300">🟡 argued, not measured — the repo has no retail price <em>level</em></span>],
            [<>Do rises pass faster than falls?</>,
              <span key="d" className="whitespace-normal font-sans text-slate-300">The point estimates say yes and by a lot — a shelf below its long-run level is pulled up with a <strong>{f(H0.asymmetry.half_life_neg, 1)}-month</strong> half-life, one above it takes <strong>{f(H0.asymmetry.half_life_pos, 1)} months</strong>. The size-corrected p is {f(H0.asymmetry.p_correction_bootstrap)}, against an asymptotic {f(H0.asymmetry.p_correction_asymptotic)} that cannot be trusted here.</span>,
              <span key="d2" className="whitespace-normal font-sans text-slate-300">🟡 <strong>not established</strong></span>],
            [<>Is it the same everywhere?</>,
              <span key="e" className="whitespace-normal font-sans text-slate-300">No on timing: of six market × currency specifications, <strong>only the United States clears a family-wise test</strong>. Yes on magnitude: 12-month slopes of {f(usRow?.slope_12m_lag5, 2)} (US) and {f(d.cross_market.find(r => (r.market || "").indexOf("Euro") === 0)?.slope_12m_lag5, 2)} (euro area), and a break-even cost share of 24–34 % in every consuming market.</span>,
              <span key="e2" className="whitespace-normal font-sans text-slate-300">🟢 magnitude · 🔴 timing</span>],
            [<>Did the spike cut demand?</>,
              <span key="g" className="whitespace-normal font-sans text-slate-300">German coffee-tax volume shows <strong>{H0.demand.n_sig_05} of {H0.demand.n_lags_tested}</strong> lags significant at 5 %. The largest coefficient is {f(H0.demand.best_elasticity, 2)} at lag {H0.demand.best_lag}, p = {f(H0.demand.best_p, 3)}.</span>,
              <span key="g2" className="whitespace-normal font-sans text-slate-300">🔴 no evidence</span>],
          ]} />

          <Highlight>
            <strong>The correction the study exists to make.</strong> θ = {f(H0.theta)} is only &ldquo;a fifth
            survives&rdquo; if green is a fifth of the shelf price. Under <em>complete</em> pass-through θ does not
            measure a fraction at all — it <em>is</em> the green cost share, because d ln R / d ln G = (∂R/∂G)(G/R)
            and ∂R/∂G is the green needed per unit sold. So the number cannot be read without a denominator, and the
            repository holds no retail price per kilo to supply one. What it can do is put a bound on it: over{" "}
            {H0.episode.start}→{H0.episode.end} the green bill rose <strong>{usd(H0.episode.green_delta_usd_per_kg)}/kg</strong>{" "}
            of roasted coffee while the shelf index rose <strong>{f(H0.episode.retail_pct, 0)} %</strong>. For the
            shelf to have carried the whole increase, green need only have been under{" "}
            <strong>{pct(H0.episode.cost_share_break_even)}</strong> of the {H0.episode.start} price. That is not a
            demanding bar.
          </Highlight>

          <H2>1 · The two legs, and what is missing from them</H2>
          <P>
            The green leg is the ICO indicator pair (Other Milds and Robustas) from the World Bank Pink Sheet, blended
            70/30 and converted into <strong>US dollars per kilo of roasted coffee</strong> at a 0.84 roast yield — a
            roaster loses about 16 % of the green weight to water, so a kilo on the shelf embodies about 1.19 kg of
            green, and skipping that step understates the green share by a fifth. The series is reused from the ENSO
            study&rsquo;s committed output, so one series has one provenance record rather than two copies that can
            drift. The retail leg is four consumer price <em>indices</em>.
          </P>
          <RefTable head={["series", "source", "period", "role"]} rows={
            d.cross_market.map((r, i) => [
              r.market ?? "—",
              r.retail_series ?? "—",
              `${r.first} → ${r.last} (${r.n} months, green in ${r.currency})`,
              i === 0 ? "headline" : yes(r.cointegrated_5pct) ? "cointegrates" : "no long-run relationship to read",
            ])} />
          <P>
            <strong>They are indices, not prices.</strong> Their bases are arbitrary, so only their changes are
            comparable and none of them yields a price per kilo. That single limitation is what section 3 is built
            around, and closing it — one official average-price series, BLS <Code>APU0000717311</Code> for US ground
            roast or Japan&rsquo;s Retail Price Survey in ¥ per 100 g — would convert every bound in this study into
            a measurement. It is the highest-value fetch available.
          </P>
          <UL>
            {d.caveats.map((c, i) => <LI key={i}>{c}</LI>)}
          </UL>

          <H>Chart 1 · the two legs</H>
          <P className="text-slate-400">
            Own panels, never one chart: a green cost in dollars per kilo and an index with an arbitrary base do not
            share a scale, and overlaying them would invent a relationship the eye then &ldquo;sees&rdquo;.
          </P>
          <div className="h-40 my-2">
            <ResponsiveContainer>
              <ComposedChart data={levels} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="m" tick={TICK} minTickGap={48} />
                <YAxis tick={TICK} width={38} domain={["auto", "auto"]} />
                <Tooltip contentStyle={TT} formatter={(v) => [`$${Number(v).toFixed(2)}/kg`, "green cost"]} />
                <Line type="monotone" dataKey="green" stroke={C_GREEN} dot={false} strokeWidth={1.6} name="green, USD/kg roasted-equivalent" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="h-40 my-2">
            <ResponsiveContainer>
              <ComposedChart data={levels} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="m" tick={TICK} minTickGap={48} />
                <YAxis tick={TICK} width={38} domain={["auto", "auto"]} />
                <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(1), "US retail index"]} />
                <Line type="monotone" dataKey="us" stroke={C_SHELF} dot={false} strokeWidth={1.6} name="US retail coffee index (SEFP01)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <H2>2 · When — a band, not a spike</H2>
          <P>
            Correlations of monthly log changes at every lag from 0 to 24, with three layers of protection against
            the obvious failure mode of scanning 25 lags and reporting the best one: Bartlett effective sample sizes
            so the p-values price in both series&rsquo; persistence, BH false-discovery control across the lags, and
            a <strong>max-|r| phase-randomised surrogate test</strong> — 2,000 surrogates preserving each
            series&rsquo; own spectrum, with the p-value taken from the fraction whose <em>largest</em> |r| over the
            whole range beats the observed largest. That family-wise number is {fp(H0.p_max_surrogate)}, and it is the
            one quoted here.
          </P>
          <div className="h-56 my-3">
            <ResponsiveContainer>
              <ComposedChart data={lagChart} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="lag" tick={TICK} label={{ value: "months from a green move to the shelf", position: "insideBottom", offset: -2, style: { fontSize: 9, fill: "#64748b" } }} />
                <YAxis tick={TICK} width={38} domain={[-0.36, 0.42]} />
                <Tooltip contentStyle={TT} formatter={(v, k) => [Number(v).toFixed(3), k === "r" ? "correlation" : String(k)]} />
                <ReferenceLine y={0} stroke="#475569" />
                <Bar dataKey="r" name="r">
                  {lagChart.map((p, i) => <Cell key={i} fill={p.clears ? C_GREEN : C_MUTE} />)}
                </Bar>
                <Line type="monotone" dataKey="band" stroke="#94a3b8" dot={false} strokeWidth={1} strokeDasharray="4 3" name="95 % of surrogates" />
                <Line type="monotone" dataKey="negBand" stroke="#94a3b8" dot={false} strokeWidth={1} strokeDasharray="4 3" name="" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <P>
            The peak is at month {H0.peak_lag} and the contemporaneous correlation is <strong>zero</strong>: whatever
            moves the shelf this month, it is not this month&rsquo;s green price. But the peak is a plateau, not a
            spike — every lag from {H0.band_lo} to {H0.band_hi} clears its own envelope and they are not
            distinguishable from one another. Quoting &ldquo;five months&rdquo; as <em>the</em> lag invents a
            precision the data do not carry; the argmax is fragile enough that recovering one missing observation
            moved it between 5 and 6.
          </P>
          <Highlight>
            <strong>The missing month.</strong> Both US CPI series have no {H0.months_missing.join(", ") || "gap"}.
            Dropping a missing value <em>before</em> differencing silently closes the hole, and the month after it is
            then differenced against two months back while wearing a one-month label. The first version of this study
            did exactly that. Fixing it moved the correlation peak by a month and — see section 5 — flipped the
            asymmetry verdict. Every estimator now runs on a gap-free monthly grid with the hole preserved.
          </Highlight>

          <H2>3 · How much — and the denominator</H2>
          <P>
            &ldquo;How much survives&rdquo; and &ldquo;how fast&rdquo; are two coefficients, and a single regression
            on 12-month changes conflates them. An error-correction model separates them: a long-run elasticity θ
            from the level relationship, a distributed lag of short-run effects, and an adjustment speed γ. The level
            regression only means anything if the two series <strong>cointegrate</strong>, which is tested first —
            here Engle–Granger p = {fp(H0.eg_p)}, so it does.
          </P>
          <div className="h-52 my-3">
            <ResponsiveContainer>
              <ComposedChart data={cumChart} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="lag" tick={TICK} label={{ value: "months since the green move", position: "insideBottom", offset: -2, style: { fontSize: 9, fill: "#64748b" } }} />
                {/* θ sits ABOVE the cumulative curve's maximum, so an auto
                    domain clips the one line this chart exists to compare
                    against. Reserve room for θ and its upper HAC bound. */}
                <YAxis tick={TICK} width={38}
                  domain={[(min: number) => Math.min(min, -0.02),
                    () => Math.ceil((H0.theta + 1.96 * H0.theta_se) * 100) / 100]} />
                <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(3), "cumulative Σβ"]} />
                <ReferenceLine y={0} stroke="#475569" />
                <ReferenceLine y={H0.theta} stroke={C_GREEN} strokeWidth={1.4}
                  label={{ value: `long-run θ = ${f(H0.theta)}`, position: "insideTopRight", style: { fontSize: 9, fill: C_GREEN } }} />
                <ReferenceLine y={H0.slope_12m} stroke={C_SHELF} strokeDasharray="3 3"
                  label={{ value: `the 12-month slope = ${f(H0.slope_12m)}`, position: "insideBottomRight", style: { fontSize: 9, fill: C_SHELF } }} />
                <Line type="monotone" dataKey="cum" stroke={C_SHELF} strokeWidth={1.8} dot={{ r: 2 }} name="cumulative short-run pass-through" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <P>
            A green move arrives at essentially nothing on impact and accumulates to θ over about a year:{" "}
            {f(H0.cum_12m)} by month 12 against a long-run {f(H0.theta)}. The 12-month slope of {f(H0.slope_12m)} sits
            between the impact effect and the long run, which is what such a slope has to do — it is a weighted blend
            of the two, and reporting it as &ldquo;how much survives&rdquo; answers neither question. Its 168
            observations carry an effective sample of <strong>{f(H0.slope_n_eff, 1)}</strong>, because 12-month
            windows overlap eleven times in twelve.
          </P>

          <H>The identity, inverted</H>
          <P>
            Under complete long-run pass-through θ <em>is</em> the green cost share, so it implies a shelf price:
            retail = (green cost per roasted kg) ÷ θ. At the sample-mean green cost of{" "}
            {usd(H0.mean_green_kg)}/kg that is <strong>{usd(H0.implied_retail_kg)}/kg</strong>, or{" "}
            {usd(H0.implied_retail_kg / 2.20462)}/lb. A reader who paid less than that on average is looking at
            incomplete pass-through; one who paid more is looking at over-shooting. The chart hands over the whole
            range rather than asserting a price the repository does not hold.
          </P>
          <div className="flex items-center gap-2 my-2 text-[11px]">
            <span className="text-slate-500">shelf price in</span>
            {(["lb", "kg"] as const).map(u => (
              <button key={u} onClick={() => setGridUnit(u)}
                className={`px-2 py-0.5 rounded border ${gridUnit === u ? "border-rose-400/60 text-rose-300" : "border-slate-700 text-slate-500"}`}>
                USD / {u}
              </button>
            ))}
          </div>
          <div className="h-52 my-2">
            <ResponsiveContainer>
              <ComposedChart data={gridChart} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="price" type="number" tick={TICK} domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                  label={{ value: `assumed shelf price, USD per ${gridUnit} — the reader supplies this`, position: "insideBottom", offset: -2, style: { fontSize: 9, fill: "#64748b" } }} />
                <YAxis tick={TICK} width={38} />
                <Tooltip contentStyle={TT} formatter={(v, k) => [Number(v).toFixed(2), k === "rate" ? "θ ÷ cost share" : "green cost share"]}
                  labelFormatter={(l) => `$${Number(l).toFixed(2)}/${gridUnit}`} />
                <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="4 3"
                  label={{ value: "complete pass-through", position: "insideTopLeft", style: { fontSize: 9, fill: "#94a3b8" } }} />
                {/* solved, not read off the grid: θ equals the cost share exactly at G ÷ θ */}
                <ReferenceLine x={gridUnit === "lb" ? H0.implied_retail_kg / 2.20462 : H0.implied_retail_kg}
                  stroke={C_SHELF} strokeDasharray="2 3"
                  label={{ value: "θ = the cost share here", position: "insideTopRight", style: { fontSize: 9, fill: C_SHELF } }} />
                <Line type="monotone" dataKey="rate" stroke={C_GREEN} strokeWidth={1.8} dot={{ r: 2 }} name="θ ÷ green cost share" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <RefTable head={[`shelf price (USD/${gridUnit})`, "implied green cost share", "θ ÷ share"]} rows={
            d.cost_share_grid.map(g => [
              usd(gridUnit === "lb" ? g.retail_usd_per_lb : g.retail_usd_per_kg),
              f(g.green_cost_share, 2),
              <span key="r" className={((g.passthrough_rate ?? 0) >= 1) ? "text-emerald-400" : "text-slate-300"}>{f(g.passthrough_rate, 2)}</span>,
            ])} />

          <H>The dollar test, which needs no price level at all</H>
          <P>
            Over a window the green bill rose by a known number of dollars Δ$ and the retail index rose by a known
            factor f. For the shelf to have carried the whole increase, the base shelf price P₀ must satisfy
            P₀(f − 1) ≥ Δ$. Dividing through by the base green cost, complete pass-through needs only that green was
            under <Code>G₀(f − 1) / Δ$</Code> of the base shelf price — a bound on a <em>share</em>, and a share has a
            ceiling of 1 whatever the price was. Over {H0.episode.start}→{H0.episode.end} that bound is{" "}
            <strong>{pct(H0.episode.cost_share_break_even)}</strong>.
          </P>
          <P>
            Run the same test to the green <em>peak</em> instead and the bound tightens to about 12 %, because at the
            top of the spike the shelf was still behind. An observer measuring then would have concluded — correctly,
            for that moment — that the roaster was absorbing most of the increase. Seventeen months later green had
            fallen back and the shelf was still climbing. That is the {H0.band_lo}–{H0.band_hi} month band showing up
            in dollars, and it is why the folk story exists.
          </P>

          <H2>4 · Is it the same everywhere?</H2>
          <P>
            Six market × currency specifications, each asked the same questions. Where a market&rsquo;s index is
            denominated in its own currency the green leg is converted into that currency first, because a euro shelf
            price regressed on a dollar green cost is partly a regression on the exchange rate.
          </P>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 my-3">
            {marketKeys.map(k => {
              const row = d.cross_market.find(r => r.key === k);
              const ok = row != null && row.p_max_surrogate != null && row.p_max_surrogate < 0.05;
              const pts = d.cross_market_profiles[k].map(p => ({
                lag: p.lag, r: p.r, band: p.band, negBand: p.band == null ? null : -p.band,
                clears: p.r != null && p.band != null && Math.abs(p.r) > p.band && ok,
              }));
              return (
                <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
                  <div className="text-[10px] text-slate-300 font-semibold">{MARKET_LABEL[k] ?? k}</div>
                  <div className={`text-[10px] mb-1 ${ok ? "text-emerald-400" : "text-slate-500"}`}>
                    family p = {fp(row?.p_max_surrogate)}{ok ? "" : " · not significant"}
                  </div>
                  <div className="h-28">
                    <ResponsiveContainer>
                      <ComposedChart data={pts} margin={{ top: 2, right: 2, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                        <XAxis dataKey="lag" tick={{ fontSize: 8, fill: "#64748b" }} />
                        <YAxis tick={{ fontSize: 8, fill: "#64748b" }} width={26} domain={[-0.45, 0.45]}
                          ticks={[-0.4, -0.2, 0, 0.2, 0.4]} tickFormatter={(v) => Number(v).toFixed(1)} />
                        <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(3), "r"]} />
                        <ReferenceLine y={0} stroke="#475569" />
                        <Bar dataKey="r">
                          {pts.map((p, i) => <Cell key={i} fill={p.clears ? C_GREEN : C_MUTE} />)}
                        </Bar>
                        <Line type="monotone" dataKey="band" stroke="#94a3b8" dot={false} strokeWidth={0.8} strokeDasharray="3 3" />
                        <Line type="monotone" dataKey="negBand" stroke="#94a3b8" dot={false} strokeWidth={0.8} strokeDasharray="3 3" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
          <RefTable head={["market", "n", "peak", "band", "family p", "cointegrates", "θ", "12-m slope", "break-even share"]} rows={
            d.cross_market.map(r => [
              <span key="m" className="whitespace-normal">{r.market}<br /><span className="text-slate-500">green in {r.currency}</span></span>,
              String(r.n ?? "—"),
              r.peak_lag == null ? "—" : `${r.peak_lag} m`,
              r.band_lo == null ? "—" : `${r.band_lo}–${r.band_hi}`,
              <span key="p" className={(r.p_max_surrogate ?? 1) < 0.05 ? "text-emerald-400" : "text-slate-500"}>{fp(r.p_max_surrogate)}</span>,
              yes(r.cointegrated_5pct) ? <span key="c" className="text-emerald-400">yes</span> : <span key="c" className="text-slate-500">no (p = {fp(r.eg_p)})</span>,
              yes(r.cointegrated_5pct) ? f(r.theta, 2) : <span key="t" className="text-slate-500">{f(r.theta, 2)}*</span>,
              f(r.slope_12m_lag5, 2),
              pct(r.cost_share_break_even),
            ])} />
          <P className="text-slate-400 text-xs">
            * a θ from a level regression that did not cointegrate. Shown to demonstrate that it lands in the same
            place as the US, not offered as an estimate.
          </P>
          <UL>
            <LI><strong>The timing does not travel.</strong> Only the United States clears the family-wise test. The
              euro area at p ≈ 0.08 is <em>suggestive</em> — its profile has a visible hump from month 4 to 16 — but
              with 121 months against the US&rsquo;s {H0.n} the surrogate envelope is half again as wide, and a hump
              that does not clear it is not a result. Brazil is noise at every lag in both currencies.</LI>
            <LI><strong>The magnitude does travel</strong>, at least between the US and the euro area: 12-month slopes
              of {f(usRow?.slope_12m_lag5, 2)} and {f(d.cross_market.find(r => (r.market || "").indexOf("Euro") === 0)?.slope_12m_lag5, 2)}, and θ of {f(H0.theta, 2)} against {f(d.cross_market.find(r => (r.market || "").indexOf("Euro") === 0)?.theta, 2)}.</LI>
            <LI><strong>The break-even cost share is the most portable finding here</strong> — 24–34 % in every
              consuming market, computed independently in each. Whatever else differs, no market&rsquo;s shelf moved
              so little that &ldquo;only a fifth survives&rdquo; is the natural reading.</LI>
            <LI><strong>Currency matters and cannot be separated from sample length.</strong> Converting the euro-area
              green leg into euros moves the peak from month 11 to 6 — but it also cuts the sample from 121 months to
              72, because the repo&rsquo;s FX history starts in 2020. Both are reported; neither is preferred.</LI>
            <LI><strong>Brazil is a different question, not a weaker answer.</strong> It is a <em>producing</em>
              country whose roasters buy from the local crop, so its shelf has no reason to track a world indicator
              month by month — and it does not. Its index nonetheless rose 65 % over the same window, the largest
              move of any market here. Brazil&rsquo;s shelf moved most and tracked the world price least.</LI>
          </UL>
          <P>
            <strong>Japan and China could not be tested</strong>: the repository holds no retail coffee price series
            for either. Japan is the gap worth closing first — its Statistics Bureau Retail Price Survey publishes
            coffee at an actual ¥ per 100 g, a price <em>level</em> in the world&rsquo;s third-largest importing
            market, which would also close this study&rsquo;s single biggest limitation. China&rsquo;s NBS publishes
            CPI subcategories but no monthly coffee line. Online listings (Amazon and similar) were considered and
            rejected: there is no retrievable monthly history going back years, so a lag structure cannot be
            estimated from them at all, and a snapshot of today&rsquo;s prices cannot answer a question about timing.
          </P>

          <H2>5 · Rockets and feathers — the point estimates say yes, the test does not</H2>
          <div className="h-44 my-3">
            <ResponsiveContainer>
              <BarChart data={asymChart} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="k" tick={TICK} />
                {/* anchored at zero: γ⁺ is small, and an auto domain starting at
                    −0.025 would flatten it into a line beside γ⁻'s slab */}
                <YAxis tick={TICK} width={44} tickFormatter={(v) => Number(v).toFixed(2)}
                  domain={[() => Math.floor((H0.asymmetry.gamma_neg - 2.2 * H0.asymmetry.gamma_neg_se) * 20) / 20, 0]} />
                <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(3), "monthly correction speed γ"]} />
                <ReferenceLine y={0} stroke="#475569" />
                <Bar dataKey="g" name="γ" maxBarSize={64}>
                  <Cell fill={C_UP} />
                  <Cell fill={C_DOWN} />
                  <ErrorBar dataKey="err" stroke="#94a3b8" width={5} strokeWidth={1} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <P>
            When the shelf price sits <em>below</em> the level green justifies, it is pulled up with a{" "}
            <strong>{f(H0.asymmetry.half_life_neg, 1)}-month half-life</strong> (γ = {f(H0.asymmetry.gamma_neg)}).
            When it sits <em>above</em>, the half-life is <strong>{f(H0.asymmetry.half_life_pos, 1)} months</strong>{" "}
            (γ = {f(H0.asymmetry.gamma_pos)}), which over any horizon anyone trades is close to no correction at all.
            A factor of four, in the textbook direction.
          </P>
          <Highlight>
            <strong>It does not survive a correctly-sized test, and the reason is worth stating.</strong> The
            asymptotic HAC Wald test over-rejects here: on symmetric synthetic data built the way this study&rsquo;s
            own test suite builds it, a nominal 5 % test fires about 10 % of the time. So the null is simulated — the
            fitted <em>symmetric</em> model is run forward on the real green series with its residuals resampled in
            12-month blocks, 1,000 times. The asymptotic p of {f(H0.asymmetry.p_correction_asymptotic)} becomes{" "}
            <strong>{f(H0.asymmetry.p_correction_bootstrap)}</strong>, and two asymmetry tests are run, so the
            Bonferroni-halved threshold is 0.025. The short-run split — the place the original note looked — is
            nowhere near, at {f(H0.asymmetry.p_shortrun_bootstrap)}. Verdict:{" "}
            <strong>{H0.asymmetry.verdict}</strong>. An earlier version of this page said otherwise, on a p of 0.014,
            before the missing month of section 2 was fixed.
          </Highlight>

          <H2>6 · Demand — the null</H2>
          <P>
            German coffee-tax receipts divided by the statutory €2.19/kg give monthly tonnes cleared to consumption:
            the only monthly <em>quantity</em> series in this repository for a consuming market, and what makes the
            question askable at all. Regressed against the retail price at lags 0–12 with month dummies, because
            coffee clearances have a hard December.
          </P>
          <div className="h-44 my-3">
            <ResponsiveContainer>
              <ComposedChart data={demandChart} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="lag" tick={TICK} label={{ value: "months from a price move to the tax receipt", position: "insideBottom", offset: -2, style: { fontSize: 9, fill: "#64748b" } }} />
                <YAxis tick={TICK} width={38} />
                <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(2), "elasticity"]} />
                <ReferenceLine y={0} stroke="#475569" />
                <Bar dataKey="e" fill={C_MUTE} name="elasticity">
                  <ErrorBar dataKey="err" stroke="#94a3b8" width={3} strokeWidth={1} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <P>
            <strong>{H0.demand.n_sig_05} of {H0.demand.n_lags_tested} lags significant at 5 %.</strong> The HAC test
            in this specification over-rejects mildly — about 6.8 % at a nominal 5 %, measured over 400 replications —
            which means the distortion only ever <em>manufactures</em> a demand response. Finding none is the
            conservative direction. The caveats cut both ways: the price is an EU basket rather than a German one,
            the volume mixes soluble coffee taxed at a different rate, and receipts are booked on duty payment rather
            than at the till. Any of those could hide a real elasticity; none of them manufactures the null.
          </P>

          <H2>7 · Robustness, and the caveat that outranks the others</H2>
          <RefTable head={["specification", "n", "cointegrates", "θ", "12-m slope"]} rows={
            d.robustness.map(r => [
              <span key="s" className="whitespace-normal">{r.market}<br /><span className="text-slate-500">{r.spec}</span></span>,
              String(r.n ?? "—"),
              yes(r.cointegrated_5pct) ? <span key="c" className="text-emerald-400">yes</span> : <span key="c" className="text-slate-500">no (p = {fp(r.eg_p)})</span>,
              `${f(r.theta, 3)} ± ${f((r.theta_se_hac ?? 0) * 1.96, 3)}`,
              `${f(r.slope_12m_lag5, 3)} (p ${fp(r.slope_p_hac)})`,
            ])} />
          <P>
            θ sits between 0.27 and 0.30 across every green definition — the blend weight, which had to be assumed,
            barely matters, and pure arabica, pure robusta, 50/50 and 90/10 all land inside the headline&rsquo;s
            confidence interval. Deflation does not kill the slope either, which was the original note&rsquo;s most
            exposed claim and it survives.
          </P>
          <RefTable head={["sample", "n", "cointegrates", "θ", "12-m slope"]} rows={
            d.subsamples.map(r => [
              r.sample ?? "—", String(r.n ?? "—"),
              (r.eg_p ?? 1) < 0.05 ? <span key="c" className="text-emerald-400">yes (p = {fp(r.eg_p)})</span> : <span key="c" className="text-slate-500">no (p = {fp(r.eg_p)})</span>,
              f(r.theta, 3), f(r.slope_12m_lag5, 3),
            ])} />
          <Highlight>
            <strong>The long-run relationship is identified by the 2020s spike.</strong> Before 2020 the two series do
            not cointegrate at all and θ is less than half its full-sample value. Two readings, and the data cannot
            separate them: either pass-through genuinely strengthened, or the pre-2020 window simply lacks a shock
            large enough to identify a long run — green moved between $2.78 and $6.41 over nine years, and most of
            that was noise around $3.50. The second is the more parsimonious explanation, and it is why the effective
            sample size of <strong>{f(H0.n_eff, 1)}</strong> is quoted beside θ everywhere in this study rather than
            the {H0.n} months.
          </Highlight>

          <H2>8 · What would change the answer</H2>
          <UL>
            <LI><strong>One retail price level.</strong> BLS <Code>APU0000717311</Code> (US ground roast, per lb) or
              Japan&rsquo;s Retail Price Survey (¥ per 100 g) turns every bound in section 3 into a measurement. It
              is by a wide margin the highest-value addition to this study.</LI>
            <LI><strong>A second large episode.</strong> Nothing can be done about this except waiting, but it is why
              the θ here is reported with an effective n of {f(H0.n_eff, 1)}.</LI>
            <LI><strong>A Japanese or Chinese retail series</strong>, so the cross-market answer covers more than the
              US, the euro area and Brazil.</LI>
            <LI><strong>The actual arabica/robusta mix in each retail basket.</strong> The 70/30 blend is an
              assumption; section 7 shows it barely matters, which is luck rather than design.</LI>
            <LI><strong>Verification of the two US series&rsquo; names.</strong> The payload calls SEFP01
              &ldquo;Coffee, all&rdquo; and SEFP02 &ldquo;Roasted coffee&rdquo;, but an aggregate cannot be more
              volatile than its dominant component and SEFP01 is 2.5× more volatile on 12-month changes. This study
              cites both by series ID and treats the names as unverified.</LI>
          </UL>
          <RefTable head={["roast yield", "green, USD/kg roasted", "implied shelf, USD/kg", "USD/lb"]} rows={
            d.roast_yield.map(r => [f(r.roast_yield, 2), usd(r.green_usd_per_kg_roasted), usd(r.implied_retail_usd_per_kg), usd(r.implied_retail_usd_per_lb)])} />
          <P className="text-slate-400 text-xs">
            θ is a log-log slope and is invariant to the roast yield; the yield only moves the level the anchor
            inverts to, by about ±5 % across a light-to-dark range.
          </P>

          {/* DataFiles HEADs each entry under /data/, so it takes payload
              filenames only — repo paths belong in the prose below it. */}
          <DataFiles files={["retail_passthrough.json"]}
            note={`This page's payload, generated ${d.generated_at}. The paper, every result table, the nine figures and the reproducible pipeline are in the repository:`} />
          <P className="text-slate-400">
            <a href={PAPER_URL} target="_blank" rel="noreferrer" className="text-rose-400 hover:underline">backend/research/retail_passthrough/REPORT.md</a> ·
            run <Code>PYTHONPATH=. python -m research.retail_passthrough.src.study</Code> from <Code>backend/</Code> to reproduce.
          </P>
        </>
      )}
    </Paper>
  );
}
