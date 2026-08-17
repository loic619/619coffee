"use client";
// The gamma map — Research B of the options program. Net dealer gamma by
// price level (walls, flip point) reconstructed with Black-76 from the
// boards archive, plus the vol-regime test on the tracked-complex history.
// Data: options_gamma_map.json (backend/scraper/exporters/options_gamma_map.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  CartesianGrid, Cell,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

interface GridPt { pct: number; price: number; net_lots_per_1pct: number | null }
interface StrikePt { strike: number; net_lots_per_1pct: number }
interface LiveMap {
  date?: string; front: string; future: number; dte: number;
  boards: { u: string; dte: number }[];
  spot_net_lots_per_1pct: number | null; flip_price: number | null; flip_pct: number | null;
  by_strike: StrikePt[]; grid: GridPt[]; walls: StrikePt[];
}
interface Auto { n: number; r?: number; t?: number }
interface Regime {
  n: number; start?: string; end?: string; n_pos?: number; n_neg?: number;
  absret_next_pos?: number; absret_next_neg?: number; absret_t?: number;
  tercile?: { k: number; absret_low_gex: number; absret_high_gex: number; t: number };
  autocorr_pos_gex?: Auto; autocorr_neg_gex?: Auto;
}
interface Market {
  series: { date: string; net_lots_per_1pct: number; gross_lots_per_1pct: number }[];
  live: LiveMap | null; regime: Regime;
}
interface Doc {
  generated_at: string; method: Record<string, string>;
  markets: Record<"arabica" | "robusta", Market>;
}

const POS = "#059669", NEG = "#d97706", FLIP = "#8b5cf6", FUT = "#38bdf8";
const n1 = (v?: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 1 }));

export default function OptionsGammaMap() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("robusta");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_gamma_map.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = d?.markets?.[mkt];
  const live = m?.live ?? null;

  const seriesChart = useMemo(
    () => (m?.series ?? []).map(s => ({ date: s.date, net: s.net_lots_per_1pct })),
    [m],
  );

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_gamma_map.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !m) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.markets.arabica, kr = d.markets.robusta;
  const reg = m.regime;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> Dealers who are net <em>long</em> gamma hedge by leaning against the market —
        buying dips, selling rips — and dampen moves; net <em>short</em> gamma flips that hedging into chasing, and
        amplifies them. This study reconstructs <strong>net dealer gamma by price level</strong> for both contracts
        with Black-76 from every archived board&rsquo;s per-strike IV and open interest, publishing the daily
        <strong> gamma map</strong>: how many futures lots hedgers must trade per 1% move, at which prices the sign
        flips, and where the walls sit. Today&rsquo;s read:
        {" "}<strong>{ka.live?.front}</strong> {n1(ka.live?.spot_net_lots_per_1pct)} lots/1% at spot (flip
        {" "}{n1(ka.live?.flip_price)}, {ka.live?.flip_pct}%) —
        {" "}<strong>{kr.live?.front}</strong> {n1(kr.live?.spot_net_lots_per_1pct)} lots/1% (flip
        {" "}{n1(kr.live?.flip_price)}, +{kr.live?.flip_pct}%). The regime backtest runs on the tracked complex and
        is honestly attenuated — the archive only began holding true front boards in mid-2026 — with one
        theory-consistent result already visible and one that contradicts the textbook, both reported.
      </P>

      <H2>1 · The mechanism, and the convention underneath it</H2>
      <UL>
        <LI><strong>Gamma is the hedger&rsquo;s re-trading need.</strong> An option book&rsquo;s delta changes as the
          future moves; whoever hedges it must trade the change. Net long gamma → hedging trades <em>against</em> the
          move (stabilising); net short → <em>with</em> it (amplifying). The unit throughout is tangible:
          <strong> futures lots per 1% move</strong> (γ × OI × F × 1%).</LI>
        <LI><strong>The dealer-side convention.</strong> Position data shows who holds options, not who is short the
          other side. This map uses the standard &ldquo;naive GEX&rdquo; assumption — dealers long the calls, short
          the puts — so net dealer gamma per strike is <Code>γc·OIc − γp·OIp</Code>. It is a convention, not an
          observation; in coffee, where producers <em>buy</em> puts and roasters <em>buy</em> calls through banks,
          it is at least directionally defensible, and the flip point survives moderate violations because it depends
          on the call/put OI <em>mix</em>, not its level.</LI>
        <LI><strong>Reconstruction.</strong> γ = φ(d1)/(F·σ·√T) per strike from each board&rsquo;s own stored IV
          (populated across the entire archive), settlement and days-to-expiry — no external inputs.</LI>
      </UL>

      <H2>2 · The live map</H2>
      <div className="flex flex-wrap items-center gap-2 my-2 text-[11px]">
        <span className="text-slate-500">Market:</span>
        {(["robusta", "arabica"] as const).map(k => (
          <button key={k} onClick={() => setMkt(k)}
            className={`px-2 py-1 rounded border ${mkt === k ? "bg-slate-800 text-indigo-300 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {k === "robusta" ? `RC — ${kr.live?.front}` : `KC — ${ka.live?.front}`}
          </button>
        ))}
      </div>
      {live && (
        <>
          <P>
            <strong>{live.front}</strong> ({live.dte} days to option expiry, board of {live.date}, boards summed:
            {" "}{live.boards.map(b => b.u).join(", ")}): at the {live.future.toLocaleString()} settlement dealers
            carry <strong>{n1(live.spot_net_lots_per_1pct)} lots of hedging per 1% move</strong> —
            {(live.spot_net_lots_per_1pct ?? 0) >= 0 ? " long gamma, hedging leans against the market" : " short gamma, hedging chases the market"}.
            The sign flips at <strong>{n1(live.flip_price)}</strong> ({(live.flip_pct ?? 0) > 0 ? "+" : ""}{live.flip_pct}% from spot).
          </P>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
            <h4 className="text-xs font-bold text-slate-100 mb-1">Net dealer gamma vs price level — {live.front}</h4>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={live.grid} margin={{ top: 6, right: 10, bottom: 14, left: -6 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="price" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={40}
                    tickFormatter={(v: number) => v.toLocaleString()}
                    label={{ value: "hypothetical price", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 10 }} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={46} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${n1(Number(v))} lots / 1%`, "net dealer gamma"]}
                    labelFormatter={(l) => `price ${Number(l).toLocaleString()}`} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <ReferenceLine x={live.future} stroke={FUT} strokeWidth={1.5}
                    label={{ value: "spot", fill: FUT, fontSize: 9, position: "top" }} />
                  {live.flip_price && <ReferenceLine x={live.flip_price} stroke={FLIP} strokeDasharray="4 3"
                    label={{ value: "flip", fill: FLIP, fontSize: 9, position: "insideTopRight" }} />}
                  <Line dataKey="net_lots_per_1pct" stroke="#818cf8" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500 italic mt-1">
              Sticky-strike re-pricing of every live board across ±15%. Above the zero line hedging stabilises;
              below it, hedging amplifies. The violet dashed line is the regime boundary.
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
            <h4 className="text-xs font-bold text-slate-100 mb-1">Where the gamma sits — front board, by strike</h4>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={live.by_strike} margin={{ top: 6, right: 10, bottom: 14, left: -6 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={26}
                    label={{ value: "strike", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 10 }} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={46} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${n1(Number(v))} lots / 1%`, "net dealer gamma"]} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <ReferenceLine x={live.future} stroke={FUT} strokeWidth={1.5}
                    label={{ value: "spot", fill: FUT, fontSize: 9, position: "top" }} />
                  <Bar dataKey="net_lots_per_1pct" maxBarSize={10}>
                    {live.by_strike.map(b => (
                      <Cell key={b.strike} fill={b.net_lots_per_1pct >= 0 ? POS : NEG} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500 italic mt-1">
              Green strikes add stabilising gamma (call-heavy), amber strikes add amplifying gamma (put-heavy).
              The three biggest walls: {live.walls.map(w => `${w.strike.toLocaleString()} (${n1(w.net_lots_per_1pct)})`).join(" · ")}.
            </p>
          </div>
          {mkt === "robusta" && (
            <Highlight>
              The read that matters this week: {live.front} sits in <strong>short-gamma territory</strong>, only
              {" "}{live.flip_pct}% below its flip, with option expiry days away and (per the expiry study one card
              up) an ITM stock worth ~38% of the future&rsquo;s open interest. Below the flip, hedging pressure
              amplifies dips; the heavy {n1(live.walls?.[0]?.strike)} put wall above is where that pressure is
              anchored. This is the configuration in which expiry-week moves get exaggerated rather than pinned.
            </Highlight>
          )}
        </>
      )}

      <H2>3 · The regime test — attenuated, and it says two things</H2>
      <P>
        Does the gamma sign actually change how the market moves? The honest scope first: the boards archive only
        ever tracked the currently-listed contracts, so before mid-2026 the series below measures the gamma of
        <em> back-month</em> boards — real OI, real gamma, but missing the front boards where gamma concentrates.
        Conditioning is on the <em>sign</em> and on the trailing-120-session <em>percentile</em>, never the raw
        level (which trends mechanically as boards mature).
      </P>
      <RefTable head={["Test", "KC arabica", "RC robusta"]} rows={[
        ["Window", `${ka.regime.start} → ${ka.regime.end} (${ka.regime.n})`, `${kr.regime.start} → ${kr.regime.end} (${kr.regime.n})`],
        ["Days net-long / net-short gamma", `${ka.regime.n_pos} / ${ka.regime.n_neg}`, `${kr.regime.n_pos} / ${kr.regime.n_neg}`],
        ["Next-day autocorr, long-gamma days", `${ka.regime.autocorr_pos_gex?.r} (t ${ka.regime.autocorr_pos_gex?.t}) *`, `${kr.regime.autocorr_pos_gex?.r} (t ${kr.regime.autocorr_pos_gex?.t})`],
        ["Next-day autocorr, short-gamma days", `${ka.regime.autocorr_neg_gex?.r} (t ${ka.regime.autocorr_neg_gex?.t})`, `${kr.regime.autocorr_neg_gex?.r} (t ${kr.regime.autocorr_neg_gex?.t}) *`],
        ["Next |ret|: high vs low GEX tercile", `${ka.regime.tercile?.absret_high_gex}% vs ${ka.regime.tercile?.absret_low_gex}% (t ${ka.regime.tercile?.t}) *`, `${kr.regime.tercile?.absret_high_gex}% vs ${kr.regime.tercile?.absret_low_gex}% (t ${kr.regime.tercile?.t})`],
      ]} />
      <UL>
        <LI><strong>The theory-consistent result: mean reversion under long gamma.</strong> On KC&rsquo;s net-long
          days the next session <em>reverses</em> the previous one — autocorrelation
          {" "}<strong>{reg && ka.regime.autocorr_pos_gex?.r}</strong> (t {ka.regime.autocorr_pos_gex?.t},
          significant) against effectively zero ({ka.regime.autocorr_neg_gex?.r}) on short-gamma days. That is
          exactly what dealer hedging that leans against the market should produce.</LI>
        <LI><strong>The contrary result: high relative gamma did not damp KC.</strong> The high-GEX tercile was
          <em> livelier</em> the next day (2.14% vs 1.58%, t −2.92) — the opposite of the dampening story. The likely
          culprit is the attenuation: our tracked boards&rsquo; gamma peaked exactly when the 2025-26 vol regime did,
          and a trailing percentile cannot fully separate the two. Reported, not hidden — and the reason the clean
          verdict waits for front-board data.</LI>
        <LI><strong>Robusta is directionally similar and weaker</strong>: mildly negative autocorrelation under both
          signs (−0.22 / −0.18), no tercile effect. Its long-gamma sample is thin ({kr.regime.n_pos} days).</LI>
      </UL>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Net dealer gamma at spot — tracked complex, daily</h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={seriesChart} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={46} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v) => [`${n1(Number(v))} lots / 1%`, "net dealer gamma at spot"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="net" stroke="#818cf8" dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          {mkt === "robusta"
            ? "Persistently short gamma — the put-heavy hedging structure of a producer market — with brief long-gamma islands."
            : "Mostly short gamma through the 2025-26 rally, flipping long as the board matured and call OI built above the market."}
        </p>
      </div>

      <H2>4 · Scope, and how this cleans itself up</H2>
      <UL>
        <LI>Front-board gamma history begins <strong>Jul-2026 for RC</strong> (RMN26&rsquo;s death made RMU26 the
          front) and <strong>Aug-2026 for KC</strong> (KCU26&rsquo;s options died on the 14th). From now on the daily
          archive holds true fronts before they die, so the regime series accumulates clean at ~250 sessions/year —
          re-run the two tests above on the post-cutover sample once it reaches a year.</LI>
        <LI>The map itself is unaffected by the history problem: it is computed fresh each session from the live
          boards, and the flip/walls read is already production-grade.</LI>
      </UL>

      <H2>5 · Limits</H2>
      <UL>
        <LI>The dealer-side convention is the standard one and untested in coffee; a producer-heavy put book hedged
          by banks fits it, fund-sold volatility does not. The <em>sign at spot</em> is convention-sensitive; the
          flip location less so.</LI>
        <LI>Sticky-strike IVs across the ±15% grid — no smile dynamics; fine near spot, rough at the wings.</LI>
        <LI>Closing OI publishes the next morning, so the live map is always one session behind the price.</LI>
        <LI>Next-day autocorrelation conditional on gamma sign is a coarse test with unequal sample sizes; the KC
          long-gamma result (n = {ka.regime.autocorr_pos_gex?.n}) clears 5% but would not survive a much finer
          multiple-comparison correction. It is a strong lean, pending the clean series.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Per-strike OI and IV: daily boards archive since 2024-06 (565 sessions). {d.method.gamma}{" "}
        {d.method.convention} {d.method.units} Front-contract returns from the continuous settlement series.
        Statistics recomputed on every export from <Code>options_gamma_map.json</Code>.
      </P>
    </div>
  );
}
