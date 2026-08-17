"use client";
// Options flow as a faster COT — Research E of the options program. Daily
// option OI flow aligned to the weekly managed-money print: the price
// baseline, the incremental test, the full sweep, and the live price-implied
// nowcast. Data: options_flow_cot.json (exporters/options_flow_cot.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ReferenceLine,
  CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

interface Week { t: string; dmm: number; dw: number; dc: number; dp: number; ret: number }
interface Chan { r: number | null; t: number | null; partial_ret?: number | null; t_partial?: number | null; partial_dmm?: number | null; halves?: (number | null)[] }
interface Stats {
  n: number; start: string | null; end: string | null;
  r_mm_ret: number | null; r2_mm_ret: number | null;
  same_week: Record<"dw" | "dc" | "dp", Chan>;
  lead: Record<"dw" | "dc" | "dp", Chan>;
  ret_transfer: { r: number | null; t: number | null };
  daily: { n: number; r: number | null; t: number | null };
}
interface Beta {
  slope_lots_per_pct: number | null; intercept: number | null; week_of: string;
  sessions_so_far: number; ret_so_far: number | null; flow_dw_so_far: number | null;
  nowcast_dmm: number | null;
}
interface Market { weeks: Week[]; stats: Stats; beta: Beta }
interface Doc {
  generated_at: string; method: Record<string, string>;
  sweep: { market: string; test: string; r: number | null; t: number | null }[];
  markets: { arabica: Market; robusta: Market };
}

const MM = "#0284c7", FLOW = "#8b5cf6";
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const sg = (v?: number | null, d = 0) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { maximumFractionDigits: d })}`);
const CHAN_LABEL: Record<string, string> = {
  dw: "Δ-weighted net flow", dc: "call OI flow", dp: "put OI flow",
};

export default function OptionsFlowCot() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("arabica");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_flow_cot.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = d?.markets?.[mkt];
  const scatter = useMemo(() => (m?.weeks ?? []).map(w => ({ ret: w.ret, dmm: w.dmm })), [m]);
  const fitLine = useMemo(() => {
    if (!m?.beta.slope_lots_per_pct == null || !m) return [];
    const xs = (m.weeks ?? []).map(w => w.ret);
    if (!xs.length || m.beta.slope_lots_per_pct == null || m.beta.intercept == null) return [];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    return [
      { ret: x0, fit: m.beta.intercept + m.beta.slope_lots_per_pct * x0 },
      { ret: x1, fit: m.beta.intercept + m.beta.slope_lots_per_pct * x1 },
    ];
  }, [m]);
  const kcLead = useMemo(() => {
    const w = d?.markets?.arabica?.weeks ?? [];
    return w.slice(0, -1).map((x, i) => ({ t: x.t, dw: x.dw, dmm_next: w[i + 1].dmm }));
  }, [d]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_flow_cot.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !m) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.markets.arabica, kr = d.markets.robusta;
  const leadKC = ka.stats.lead.dw;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> The COT report is weekly and three days stale by the time it prints; option open
        interest updates every day. If call/put OI builds led the managed-money futures print, options flow would be
        a genuinely faster positioning read. On {ka.stats.n} aligned weeks the answer has three layers.
        {" "}<strong>First, the print is mostly the tape</strong>: the week&rsquo;s own price move explains the
        managed-money change at r = {ka.stats.r_mm_ret} (KC) / {kr.stats.r_mm_ret} (RC) — roughly
        {" "}{Math.round((ka.stats.r2_mm_ret ?? 0) * 100)}–{Math.round((kr.stats.r2_mm_ret ?? 0) * 100)}% of the
        variance, knowable Tuesday night. <strong>Second, options flow adds nothing significant on top</strong> —
        every same-week channel&rsquo;s partial correlation given the return fails significance.
        {" "}<strong>Third, one lead survives its controls and is flagged, not concluded</strong>: KC delta-weighted
        flow vs <em>next</em> week&rsquo;s print (r {leadKC.r}, t {leadKC.t}) — but it is one of sixteen tests run,
        below the sweep-honest bar, and it does not transfer to returns. The genuinely usable output is the
        {" "}<strong>price-implied ΔMM nowcast</strong>, now published live for the current COT week.
      </P>

      <H2>1 · Construction, and where the data can honestly speak</H2>
      <UL>
        <LI><strong>OI re-dating</strong>: the OI printed on session D reflects the close of D−1 (the newest
          session&rsquo;s OI is always null in the archive). Flow attributed to session D is
          {" "}<Code>OI(printed D+1) − OI(printed D)</Code>, summed per board over boards present on both sessions —
          no board-add jumps.</LI>
        <LI><strong>Three channels per market</strong>: raw call OI flow, raw put OI flow, and a futures-equivalent
          {" "}<em>delta-weighted net</em> (Σ ΔOI·Δ, Black-76 deltas from the stored IVs — the skew paper&rsquo;s
          convention). Weekly windows follow the COT calendar: sessions in (prev&nbsp;Tuesday,&nbsp;Tuesday],
          against the same Tuesday-to-Tuesday managed-money net change (NY for KC, London for RC).</LI>
        <LI><strong>Scope honesty</strong>: the tracked boards carried almost no OI before they became the front of
          the curve — KC tracked option OI was ~0 through mid-2025, 13k lots by Dec-2025, 146k by Aug-2026. The
          weekly study therefore starts <strong>2026-01: {ka.stats.n} weeks</strong>, and grows by one every
          Friday.</LI>
      </UL>

      <H2>2 · The uncomfortable baseline — the print is mostly the tape</H2>
      <P>
        Managed money in coffee trades with price inside the week: Δ(MM net) vs the same week&rsquo;s return runs
        {" "}<strong>r = {ka.stats.r_mm_ret} in KC and {kr.stats.r_mm_ret} in RC</strong>. Before asking whether
        options flow helps, this is the bar it must clear — anything correlated with price will &ldquo;predict&rdquo;
        the print for free. It is also, on its own, the practical result: over half the Friday number is computable
        from the tape at the Tuesday close, which is precisely the mechanism the intraweek nowcast on the COT tab
        exploits.
      </P>
      <div className="flex flex-wrap items-center gap-2 my-2 text-[11px]">
        <span className="text-slate-500">Market:</span>
        {(["arabica", "robusta"] as const).map(k => (
          <button key={k} onClick={() => setMkt(k)}
            className={`px-2 py-1 rounded border ${mkt === k ? "bg-slate-800 text-indigo-300 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {k === "arabica" ? "KC arabica" : "RC robusta"}
          </button>
        ))}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">
          Δ managed-money net vs the week&rsquo;s return — {m.stats.n} COT weeks
        </h4>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 6, right: 8, bottom: 14, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="ret" type="number" tick={{ fontSize: 9, fill: "#64748b" }}
                domain={["auto", "auto"]}
                label={{ value: "week return, %", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 10 }} />
              <YAxis dataKey="dmm" type="number" tick={{ fontSize: 9, fill: "#64748b" }} width={52}
                tickFormatter={(v: number) => v.toLocaleString()}
                label={{ value: "Δ MM net, lots", fontSize: 9, fill: "#64748b", angle: -90, position: "insideLeft", dx: 6 }} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [Number(v).toLocaleString(), n === "dmm" ? "Δ MM net (lots)" : "fit"]}
                labelFormatter={(v) => `week return ${v}%`} />
              <ReferenceLine y={0} stroke="#475569" />
              <ReferenceLine x={0} stroke="#475569" />
              <Scatter data={scatter} dataKey="dmm" fill={MM} name="dmm" />
              <Line data={fitLine} dataKey="fit" stroke="#64748b" strokeDasharray="5 3" dot={false} strokeWidth={1.2} name="fit" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Slope ≈ {sg(m.beta.slope_lots_per_pct)} lots per 1% weekly move (r² {m.stats.r2_mm_ret}). The dashed fit
          is the whole &ldquo;faster COT&rdquo; that price alone already delivers.
        </p>
      </div>

      <H2>3 · Does options flow sharpen the nowcast? No — not yet, not detectably</H2>
      <RefTable head={["Market", "Channel", "Same-week r", "Partial | return", "t"]} rows={
        (["arabica", "robusta"] as const).flatMap(k =>
          (["dw", "dc", "dp"] as const).map(ch => [
            k === "arabica" ? "KC" : "RC", CHAN_LABEL[ch],
            `${d.markets[k].stats.same_week[ch].r}`,
            `${d.markets[k].stats.same_week[ch].partial_ret}`,
            `${d.markets[k].stats.same_week[ch].t_partial}`,
          ]))
      } />
      <P>
        Partialling the week&rsquo;s return out, no channel in either market clears t = 2. The best case — RC call
        flow at partial {kr.stats.same_week.dc.partial_ret} (t {kr.stats.same_week.dc.t_partial}) — would add about
        four points of R² if taken at face value, and it does not survive the sweep accounting below. On the
        evidence so far, once you know the week&rsquo;s price you know what options flow would have told you.
      </P>

      <H2>4 · The sweep, stated in full</H2>
      <P>
        Sixteen channel × market × horizon tests were run for this paper. All of them are listed — reporting only
        the survivors would manufacture significance. With sixteen draws, the honest bar sits near |t| ≈ 3, not 2.
      </P>
      <RefTable head={["Market", "Test", "r", "naive t"]} rows={
        d.sweep.map(s => [s.market, s.test, `${s.r}`, `${s.t}`])
      } />
      <P>
        Two rows cross the naive bar and neither crosses the honest one: the KC delta-weighted lead (next section)
        and a <em>contrarian</em> RC daily read (flow up → next day down, t {kr.stats.daily.t} on
        {" "}{kr.stats.daily.n} sessions) that contradicts the RC weekly null and has no mechanism we&rsquo;d
        defend. Both are recorded as accumulation candidates, nothing more.
      </P>

      <H2>5 · The one lead worth watching — KC flow vs next week&rsquo;s print</H2>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">
          KC: this week&rsquo;s Δ-weighted options flow vs NEXT week&rsquo;s Δ MM — both in lots
        </h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={kcLead} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={40} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={52}
                tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [Number(v).toLocaleString(), n === "dw" ? "options flow, week t" : "Δ MM net, week t+1"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="dmm_next" stroke={MM} dot={false} strokeWidth={1.6} name="dmm_next" />
              <Line dataKey="dw" stroke={FLOW} dot={false} strokeWidth={1.4} strokeDasharray="5 3" name="dw" />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "dw" ? "Δ-weighted options flow, week t" : "Δ MM net, week t+1"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <UL>
        <LI>r = {leadKC.r} (t {leadKC.t}), and it survives its controls: partial given the week&rsquo;s return
          {" "}{leadKC.partial_ret}, partial given the same week&rsquo;s own ΔMM {leadKC.partial_dmm}; split halves
          same-signed ({leadKC.halves?.[0]} / {leadKC.halves?.[1]}).</LI>
        <LI><strong>Why it is not a conclusion</strong>: it is one of sixteen tests (sweep-adjusted, borderline); the
          window is {ka.stats.n} weeks; and it does <em>not</em> transfer to price — KC flow vs next week&rsquo;s
          return is r {ka.stats.ret_transfer.r} (t {ka.stats.ret_transfer.t}). If real, options flow front-runs
          managed-money <em>positioning</em>, not returns — consistent with the skew and VRP papers&rsquo; refrain
          that coffee options encode state, not direction.</LI>
        <LI><strong>Re-test gate</strong>: revisit when the window reaches ~60 weeks; the bar is a lead partial
          above t ≈ 3 <em>or</em> t ≈ 2.5 with a nonzero return transfer.</LI>
      </UL>

      <H2>6 · The current read — the part of Friday you can know today</H2>
      <RefTable head={["Market", "COT week of", "Sessions in", "Return so far", "Options flow so far", "Price-implied ΔMM"]} rows={[
        ["KC", ka.beta.week_of, `${ka.beta.sessions_so_far}`, `${ka.beta.ret_so_far}%`, `${sg(ka.beta.flow_dw_so_far)} lots`, `${sg(ka.beta.nowcast_dmm)} lots`],
        ["RC", kr.beta.week_of, `${kr.beta.sessions_so_far}`, `${kr.beta.ret_so_far}%`, `${sg(kr.beta.flow_dw_so_far)} lots`, `${sg(kr.beta.nowcast_dmm)} lots`],
      ]} />
      <Highlight>
        The nowcast column is the paper&rsquo;s deliverable: slope × week-to-date return, refit on every export.
        This is the defensible &ldquo;faster COT&rdquo; — price, published three days before the CFTC gets there.
        The options-flow column rides along so that if the flagged lead firms up as weeks accumulate, the series
        needed to exploit it will already exist.
      </Highlight>

      <H2>7 · Limits</H2>
      <UL>
        <LI><strong>{ka.stats.n} weeks.</strong> Every statistic here is a 2026-era estimate; the tracked boards
          simply did not carry OI before that. The study re-runs nightly and each Friday adds a week.</LI>
        <LI><strong>The tracked boards are the front complex, not the whole market.</strong> Flow in unlisted
          strikes and older boards is invisible; the delta-weighted aggregate is a proxy for total dealer-facing
          flow.</LI>
        <LI><strong>Deltas from settlement IVs</strong> inherit settlement noise on illiquid strikes (the same
          caveat as the gamma map and skew papers), and OI attribution to sessions depends on the vendor&rsquo;s
          overnight update discipline.</LI>
        <LI><strong>ΔMM ≠ all speculative flow</strong>: the swap-identity paper showed the swap cohort carries
          spec-like flow too; a broader &ldquo;spec complex&rdquo; target is a natural follow-up once the window is
          longer.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Boards archive (per-strike OI + IV, OI re-dated one session); weekly COT (CFTC disaggregated for NY, ICE
        London for RC) from <Code>cot.json</Code>; Black-76 deltas from stored IVs. All sixteen tests reported;
        statistics and the live nowcast recomputed on every export from <Code>options_flow_cot.json</Code>.
      </P>
    </div>
  );
}
