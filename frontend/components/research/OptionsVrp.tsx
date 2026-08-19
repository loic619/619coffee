"use client";
// The variance risk premium — Research C of the options program. Implied vs
// subsequently-realized vol per market and DTE bucket, the one life-matched
// datapoint, and the live IV-vs-trailing-RV spread with its percentile.
// Data: options_vrp.json (backend/scraper/exporters/options_vrp.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "./methodology/prose";

interface Agg {
  n: number; start?: string; end?: string; mean_iv?: number; mean_rv?: number;
  mean_vrp?: number; median_vrp?: number; share_positive?: number;
  n_blocks?: number; t_blocks?: number; first_half_vrp?: number; second_half_vrp?: number;
}
interface SeriesPt { date: string; contract: string; dte: number; iv: number; rv_fwd: number; vrp: number }
interface Market {
  spread_now: { date: string; spread: number; percentile: number; n: number } | null;
  all: Agg; by_bucket: Record<string, Agg>;
  series: SeriesPt[];
  life_matched: { contract: string; window: string; sessions: number; mean_iv: number; rv: number; vrp: number } | null;
  latest: Record<string, { date: string; dte: number; iv: number; rv_trailing: number | null }>;
}
interface Doc {
  generated_at: string; method: Record<string, string>;
  markets: Record<"arabica" | "robusta", Market>;
}

const IV = "#818cf8", RV = "#38bdf8", VRP = "#8b5cf6";
const pt = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);

export default function OptionsVrp() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("arabica");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_vrp.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = d?.markets?.[mkt];
  const series = useMemo(() => m?.series ?? [], [m]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_vrp.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !m) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.markets.arabica, kr = d.markets.robusta;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> Option premiums embed a volatility forecast; whoever sells them earns the gap
        between that forecast and what the future subsequently realizes — the <strong>variance risk premium</strong>.
        In equities and most commodities that gap is famously positive: sellers get paid to carry the tail. Coffee,
        on this data, is different. Over {ka.all.n?.toLocaleString()} contract-sessions of arabica the premium is
        {" "}<strong>{pt(ka.all.mean_vrp)} vol points — statistically zero</strong> (IV {ka.all.mean_iv} vs realized
        {" "}{ka.all.mean_rv}, positive on only {ka.all.share_positive}% of days); robusta shows a modest
        {" "}<strong>{pt(kr.all.mean_vrp)}-point lean</strong> that also fails significance. The one
        <em> life-matched</em> datapoint we hold — {kr.life_matched?.contract} over its whole
        {" "}{kr.life_matched?.sessions}-session life — priced vol at {kr.life_matched?.mean_iv} against
        {" "}{kr.life_matched?.rv} realized: <strong>almost exactly fair</strong>. Coffee IV has been an honest
        forecast, not a seller&rsquo;s carry — which makes the current moment notable:
        {" "}<strong>KC implied now sits {pt(ka.spread_now?.spread)} points above trailing realized, the
        {" "}{ka.spread_now?.percentile}th percentile of its own history</strong>.
      </P>

      <H2>1 · Construction, and two honesty rules</H2>
      <UL>
        <LI><strong>Implied</strong>: ATM IV per session per board — call/put IVs interpolated at the settlement,
          from the boards archive ({d.method.iv.includes("Black-76") ? "Black-76-implied from settlement premiums where the vendor serves none" : ""}).
          {" "}<strong>Realized</strong>: annualized close-to-close vol of the <em>same contract&rsquo;s</em> own
          settlements over the next 21 sessions. <Code>VRP = IV − forward RV</Code>, vol points.</LI>
        <LI><strong>Horizon mismatch, stated</strong>: the IV covers the option&rsquo;s remaining life (often months),
          the RV window is fixed at one month. This is the standard practical VRP — &ldquo;what vol level did you buy
          vs what showed up next month&rdquo; — not a delta-hedged replication P&amp;L. The life-matched RMU26 case
          below is the exception.</LI>
        <LI><strong>Overlap, corrected</strong>: daily observations share their RV windows, which inflates naive
          t-stats. Level statistics use all days; <em>significance uses non-overlapping 21-session blocks only</em>
          ({ka.all.n_blocks} blocks KC, {kr.all.n_blocks} RC).</LI>
      </UL>

      <H2>2 · The premium that isn&rsquo;t there</H2>
      <RefTable head={["", "KC arabica", "RC robusta"]} rows={[
        ["Window", `${ka.all.start} → ${ka.all.end}`, `${kr.all.start} → ${kr.all.end}`],
        ["Contract-sessions (blocks)", `${ka.all.n?.toLocaleString()} (${ka.all.n_blocks})`, `${kr.all.n?.toLocaleString()} (${kr.all.n_blocks})`],
        ["Mean implied vol", `${ka.all.mean_iv}`, `${kr.all.mean_iv}`],
        ["Mean forward realized vol", `${ka.all.mean_rv}`, `${kr.all.mean_rv}`],
        ["VRP, mean (median)", `${pt(ka.all.mean_vrp)} (${pt(ka.all.median_vrp)})`, `${pt(kr.all.mean_vrp)} (${pt(kr.all.median_vrp)})`],
        ["Days IV > realized", `${ka.all.share_positive}%`, `${kr.all.share_positive}%`],
        ["t (non-overlapping blocks)", `${ka.all.t_blocks}`, `${kr.all.t_blocks}`],
        ["Split halves", `${pt(ka.all.first_half_vrp)} / ${pt(ka.all.second_half_vrp)}`, `${pt(kr.all.first_half_vrp)} / ${pt(kr.all.second_half_vrp)}`],
      ]} />
      <UL>
        <LI><strong>Arabica pays the seller nothing.</strong> A coin-flip share of positive days, a negative mean, an
          insignificant t. Over a window containing the 2024-26 squeeze and the 2025-26 collapse, KC options were,
          if anything, slightly <em>cheap</em> — realized vol beat the forecast. The frost/drought tail is priced
          roughly at cost.</LI>
        <LI><strong>Robusta leans positive but proves nothing</strong>: {pt(kr.all.mean_vrp)} mean,
          {" "}{kr.all.share_positive}% positive days (a real asymmetry), t {kr.all.t_blocks} — and the halves
          disagree ({pt(kr.all.first_half_vrp)} → {pt(kr.all.second_half_vrp)}). A lean worth re-testing as the
          series grows, not a carry to trade today.</LI>
        <LI><strong>By maturity, nothing changes the verdict</strong>: robusta&rsquo;s mid-bucket premium
          ({pt(kr.by_bucket.mid?.mean_vrp)} pts, {kr.by_bucket.mid?.share_positive}% positive) is the strongest
          pocket but rides on {kr.by_bucket.mid?.n} sessions; KC&rsquo;s buckets are zero-to-negative
          throughout.</LI>
      </UL>
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
          Implied vs what showed up — nearest tracked board, daily
        </h4>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40} tickFormatter={(v: number) => `${v}`}
                label={{ value: "vol, %", fontSize: 9, fill: "#64748b", angle: -90, position: "insideLeft", dx: 14 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n === "iv" ? "implied (ATM)" : "realized, next 21 sessions"]} />
              <Line dataKey="iv" stroke={IV} dot={false} strokeWidth={1.8} name="iv" />
              <Line dataKey="rv_fwd" stroke={RV} dot={false} strokeWidth={1.4} name="rv_fwd" strokeDasharray="5 3" />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "iv" ? "implied (ATM)" : "realized, next 21 sessions"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The dashed line is what the solid line was trying to forecast, shifted into its future. Where solid rides
          above dashed, option buyers overpaid; below, sellers undercharged. The series stops 21 sessions short of
          today because the forecast&rsquo;s outcome isn&rsquo;t known yet.
        </p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">The premium itself — IV minus forward realized</h4>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v) => [`${pt(Number(v))} pts`, "VRP"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="vrp" stroke={VRP} dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <H2>3 · The one clean datapoint — a whole life, matched</H2>
      {kr.life_matched && (
        <P>
          {kr.life_matched.contract} is the only contract our archive has observed over essentially its entire
          optioned life ({kr.life_matched.window}, {kr.life_matched.sessions} sessions) — so for it, and only it, the
          horizon mismatch disappears: average implied over the window <strong>{kr.life_matched.mean_iv}%</strong>,
          realized over the same window <strong>{kr.life_matched.rv}%</strong> — a premium of
          {" "}<strong>{pt(kr.life_matched.vrp)} points</strong>. One datapoint proves nothing on its own, but it
          lands exactly where the block statistics point: coffee vol priced roughly fair. Each future expiry adds one
          more life-matched observation, the same accumulation pattern as the expiry ledger.
        </P>
      )}

      <H2>4 · The current read — an unusually expensive forecast</H2>
      <RefTable head={["Board", "DTE", "Implied now", "Trailing 21-session RV", "Spread"]} rows={
        (["arabica", "robusta"] as const).flatMap(k =>
          Object.entries(d.markets[k].latest).map(([u, v]) => [
            u, `${v.dte}d`, `${v.iv}%`, v.rv_trailing != null ? `${v.rv_trailing}%` : "—",
            v.rv_trailing != null ? `${pt(v.iv - v.rv_trailing)} pts` : "—",
          ]))
      } />
      <Highlight>
        As of {ka.spread_now?.date}, KC&rsquo;s nearest board prices <strong>{pt(ka.spread_now?.spread)} vol points
        more than the market has recently delivered — the {ka.spread_now?.percentile}th percentile</strong> of that
        spread&rsquo;s own {ka.spread_now?.n}-session history; robusta is at {pt(kr.spread_now?.spread)} points (the
        {" "}{kr.spread_now?.percentile}th). Read against §2, this is <em>not</em> normal seller&rsquo;s richness —
        coffee IV hasn&rsquo;t carried a habitual premium. It is the options market pricing an <em>event window</em>:
        Brazilian frost season, a fresh crop being priced, and (per the two cards above) an expiry week in
        short-gamma territory. History says this forecast is usually honest; whether it is this time is exactly what
        the next 21 sessions settle.
      </Highlight>

      <H2>5 · What this changes here</H2>
      <UL>
        <LI><strong>Do not model coffee options income as carry.</strong> Any future strategy card that assumes
          selling coffee vol earns the equity-style premium is contradicted by this data — KC sellers earned nothing
          net over two full years including a super-cycle.</LI>
        <LI><strong>IV is usable as an honest forecast.</strong> Since the premium is ~zero, ATM IV can feed other
          models (the Differential Model&rsquo;s option-curve box, the intraweek nowcast&rsquo;s risk scaling) as an
          unbiased expected-vol input rather than needing a haircut.</LI>
        <LI><strong>The spread percentile is the actionable series</strong>: at the {ka.spread_now?.percentile}th
          percentile it flags an event premium worth watching into September — and it now recomputes on every
          export.</LI>
      </UL>

      <H2>6 · Limits</H2>
      <UL>
        <LI>The window is one macro regime (2024-26): a squeeze, a collapse, a frost season. A structural premium
          could exist and be masked by it — or the reverse. The block t-stats say &ldquo;not detectable&rdquo;, not
          &ldquo;absent&rdquo;.</LI>
        <LI>ATM IV from settlement premiums inherits settlement noise on illiquid strikes; the bracketing
          interpolation limits but does not remove it.</LI>
        <LI>Close-to-close realized vol ignores intraday range; a Parkinson estimator would run ~10-20% hotter,
          which would push the measured premium <em>further</em> negative — the conclusion is robust to that
          choice in one direction only, and that direction is against the seller.</LI>
        <LI>The tracked boards skew far-dated for much of the window (same scope note as the gamma map); the near
          bucket is thin. Front-board VRP accumulates cleanly from mid-2026 onward.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Boards archive (565 sessions, per-strike IV), per-contract settlement archive (5y). {d.method.rv}{" "}
        {d.method.significance} Statistics recomputed on every export from <Code>options_vrp.json</Code>.
      </P>
      <DataFiles files={["options_vrp.json"]} />
    </div>
  );
}
