"use client";
// OI walls as support/resistance — Research F of the options program. The
// directional crossing test with matched-distance controls, its falsification
// family, and the live wall map. Data: options_oi_walls.json
// (backend/scraper/exporters/options_oi_walls.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, RefTable } from "./methodology/prose";

interface SideStat { wall_n: number; wall_rate: number | null; light_n: number; light_rate: number | null }
interface Study {
  era: string; n_sessions: number;
  directional: {
    diff: number | null; t: number | null; wall_rate: number | null; light_rate: number | null;
    halves: (number | null)[]; sides: Record<"call_above" | "put_below", SideStat>;
  };
  undirected_bands: { band: string; n: number; diff: number | null; t: number | null }[];
  round_control: { n: number; diff: number | null; t: number | null };
  monster: { n: number; wall_rate: number | null; light_rate: number | null };
  magnet: { n: number; r: number | null; t: number | null } | null;
}
interface Wall { strike: number; side: "support" | "resistance"; oi: number; dist_pct: number }
interface Live {
  as_of: string; u: string; px: number; ladder: Wall[];
  history_strikes: string[]; history: Record<string, string | number>[];
}
interface Market { study: Study; live: Live }
interface Doc {
  generated_at: string; method: Record<string, string>;
  pooled_z_directional: number | null;
  markets: { arabica: Market; robusta: Market };
}

const SUPPORT = "#059669", RESIST = "#d97706";
const HIST = ["#0284c7", "#059669", "#8b5cf6"];
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const pc = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const pp = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`);

export default function OptionsOiWalls() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("arabica");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_oi_walls.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = d?.markets?.[mkt];
  const ladder = useMemo(() => (m?.live?.ladder ?? []).map(w => ({
    strike: String(w.strike), oi: w.oi, side: w.side,
  })), [m]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_oi_walls.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !m) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.markets.arabica.study, kr = d.markets.robusta.study;
  const kaD = ka.directional, krD = kr.directional;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> Option open interest piles up at specific strikes — walls — and floor lore says a
        heavy call strike above the market is resistance and a heavy put strike below is support. Tested at
        settlement resolution with matched-distance controls, <strong>the lore holds, in both markets
        independently</strong>: a directional wall within 3% of spot is settled through on
        {" "}<strong>{pc(kaD.wall_rate)} of sessions in KC against {pc(kaD.light_rate)} for light strikes at the
        same distance</strong> ({pp(kaD.diff)}, t {kaD.t}); robusta shows {pc(krD.wall_rate)} vs
        {" "}{pc(krD.light_rate)} ({pp(krD.diff)}, t {krD.t}). Pooled, the pre-specified classic construction
        stands at <strong>z ≈ {d.pooled_z_directional}</strong> — while every alternative construction we tried
        (undirected OI, monster-only walls, round numbers, a magnet test) shows nothing. The wings hold where the
        side-relevant OI sits, and today&rsquo;s map has KC boxed between a {d.markets.arabica.live.ladder.find(w => w.side === "support")?.strike} put
        wall and a {[...d.markets.arabica.live.ladder].reverse().find(w => w.side === "resistance")?.strike} call wall.
      </P>

      <H2>1 · Construction — a barrier test that can&rsquo;t cheat</H2>
      <UL>
        <LI><strong>Walls are directional and side-specific</strong>: for strikes within 3% of spot, the
          side-relevant OI — <em>call</em> OI above the market, <em>put</em> OI below — at ≥ 4× the median nonzero
          strike OI in the ±6% window and above an absolute floor (KC 500 / RC 300 lots). Controls are light
          strikes (total OI ≤ median) <em>in the same window</em>, so distance is matched by construction.</LI>
        <LI><strong>Crossing is settlement-to-settlement on the same board</strong>: strike K is crossed between
          consecutive sessions when <Code>min(F₀,F₁) &lt; K ≤ max(F₀,F₁)</Code>. Intraday touches and rejections
          are invisible — this measures whether settlements <em>end up beyond</em> the level, the coarser and
          harder claim.</LI>
        <LI><strong>Inference is session-clustered</strong>: one price path crossing four adjacent strikes is one
          observation, not four — the t-stat runs on per-session paired differences (wall share − light
          share).</LI>
        <LI><strong>Era honesty</strong>: walls need OI, and the tracked boards carry it only from the 2026 front
          era (KC {ka.era}, RC {kr.era}) — {ka.n_sessions} and {kr.n_sessions} paired sessions respectively. The
          robusta cell is thin and says so.</LI>
      </UL>

      <H2>2 · The result — walls shave a third to a half off the crossing rate</H2>
      <RefTable head={["", "KC arabica", "RC robusta"]} rows={[
        ["Paired sessions", `${ka.n_sessions}`, `${kr.n_sessions}`],
        ["Wall crossing rate", pc(kaD.wall_rate), pc(krD.wall_rate)],
        ["Light-strike rate, same distance", pc(kaD.light_rate), pc(krD.light_rate)],
        ["Difference", `${pp(kaD.diff)} (t ${kaD.t})`, `${pp(krD.diff)} (t ${krD.t})`],
        ["Split halves", `${pp(kaD.halves[0])} / ${pp(kaD.halves[1])}`, `${pp(krD.halves[0])} / ${pp(krD.halves[1])}`],
        ["Pooled (Stouffer)", `z ≈ ${d.pooled_z_directional}`, "—"],
      ]} />
      <UL>
        <LI><strong>Both markets, same sign, independently at the naive bar</strong> — and the halves agree in
          both ({pp(kaD.halves[0])}/{pp(kaD.halves[1])} KC, {pp(krD.halves[0])}/{pp(krD.halves[1])} RC). Two
          independent replications of a pre-specified hypothesis pool to z ≈ {d.pooled_z_directional}, which
          survives even the sweep-adjusted reading.</LI>
        <LI><strong>Support has been the stronger side in KC</strong>: put walls below settled through on
          {" "}{pc(kaD.sides.put_below.wall_rate)} of strike-observations vs {pc(kaD.sides.put_below.light_rate)}
          {" "}for light strikes; call walls above {pc(kaD.sides.call_above.wall_rate)} vs
          {" "}{pc(kaD.sides.call_above.light_rate)}. In RC the call-above cell is small but stark:
          {" "}{krD.sides.call_above.wall_n} wall observations, <strong>none crossed</strong>.</LI>
        <LI><strong>Read the size correctly</strong>: a wall does not make a level impassable — it takes the
          one-session crossing probability from roughly a quarter to a sixth (KC) or a tenth (RC). Barriers
          slow settlements; they do not stop trends.</LI>
      </UL>

      <H2>3 · The falsification family — everything else is null, which is the point</H2>
      <RefTable head={["Variant", "KC", "RC", "Verdict"]} rows={[
        ["Undirected total-OI walls (5 distance bands)",
          ka.undirected_bands.map(b => `${b.t}`).join(" / "),
          kr.undirected_bands.map(b => `${b.t}`).join(" / "),
          "all |t| < 2 — null"],
        ["Monster walls only (≥10× median)",
          `${pc(ka.monster.wall_rate)} vs ${pc(ka.monster.light_rate)} (n ${ka.monster.n})`,
          `${pc(kr.monster.wall_rate)} vs ${pc(kr.monster.light_rate)} (n ${kr.monster.n})`,
          "no extra effect; RC cell is noise"],
        ["Round vs non-round (light strikes only)",
          `${pp(ka.round_control.diff)} (t ${ka.round_control.t})`,
          `${pp(kr.round_control.diff)} (t ${kr.round_control.t})`,
          "roundness alone does nothing"],
        ["Magnet (drift toward biggest wall, 3 sessions)",
          `r ${ka.magnet?.r} (t ${ka.magnet?.t})`,
          `r ${kr.magnet?.r} (t ${kr.magnet?.t})`,
          "walls don't attract"],
      ]} />
      <P>
        Roughly eighteen tests were run across this paper; the directional construction was the pre-specified
        primary (it is the classic hypothesis this study set out to check), and it is the only one that fires. The
        nulls are not failures — they localise the mechanism. It is not big OI anywhere (undirected: null), not
        psychological round numbers (null among light strikes), not sheer size (monsters add nothing), and not
        attraction (no magnet). It is specifically <em>the side of the book that loses money through the level</em>
        — call writers above, put writers below — which is where hedging and defence concentrate.
      </P>

      <H2>4 · The live map</H2>
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
          Today&rsquo;s walls — side-relevant OI within ±6% of {m.live.u} at {m.live.px} (as of {m.live.as_of})
        </h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ladder} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={52}
                tickFormatter={(v: number) => v.toLocaleString()}
                label={{ value: "side OI, lots", fontSize: 9, fill: "#64748b", angle: -90, position: "insideLeft", dx: 6 }} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, _n, e) => [`${Number(v).toLocaleString()} lots`, (e?.payload as { side?: string })?.side === "support" ? "put OI (support)" : "call OI (resistance)"]} />
              <Bar dataKey="oi" radius={[4, 4, 0, 0]} maxBarSize={34}>
                {ladder.map((w, i) => <Cell key={i} fill={w.side === "support" ? SUPPORT : RESIST} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          <span style={{ color: SUPPORT }}>■</span> put OI below spot (support) ·{" "}
          <span style={{ color: RESIST }}>■</span> call OI above spot (resistance). Spot sits between the tallest
          bars on each side.
        </p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">How today&rsquo;s big walls were built — side OI, trailing {m.live.history.length} sessions</h4>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={m.live.history} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={52}
                tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [`${Number(v).toLocaleString()} lots`, `strike ${n}`]} />
              {m.live.history_strikes.map((s, i) => (
                <Line key={s} dataKey={s} stroke={HIST[i % HIST.length]} dot={false} strokeWidth={1.6} name={s} />
              ))}
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>strike {n}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Walls are built, not born — OI accumulates over weeks. A wall that grew while price approached it is
          fresh defence; one left over from an old range is stale and, on this data, still counts.
        </p>
      </div>
      <RefTable head={["Strike", "Side", "Side OI", "Distance from spot"]} rows={
        m.live.ladder.map(w => [String(w.strike), w.side, w.oi.toLocaleString(), `${w.dist_pct > 0 ? "+" : ""}${w.dist_pct}%`])
      } />

      <H2>5 · What this changes here</H2>
      <UL>
        <LI><strong>Pairs with the gamma map</strong>: that card asks where hedge <em>flow</em> stabilises or
          amplifies; this one shows where the <em>stock</em> of positions defends a level. When the gamma flip and
          a directional wall coincide, both mechanisms point the same way.</LI>
        <LI><strong>How to use the number</strong>: near a heavy wall, the base rate of settling through in one
          session drops by roughly a third (KC) to a half (RC). That informs stop placement and target realism
          around the mapped strikes — it is a friction estimate, <em>not</em> a directional signal: the magnet
          test says walls do not pull price toward them, and nothing here predicts sign.</LI>
        <LI><strong>Watch the RMU26 handoff</strong>: wall maps re-draw at expiry as OI migrates to the next
          board — the accumulation chart above will show the new front board&rsquo;s walls building.</LI>
      </UL>

      <H2>6 · Limits</H2>
      <UL>
        <LI><strong>Settlement resolution.</strong> Intraday probes and rejections at walls are invisible; the
          effect measured here is the end-of-day version, which likely understates intraday interaction.</LI>
        <LI><strong>{kr.n_sessions} robusta sessions.</strong> The RC replication is directionally clean but
          thin; its cell sizes (11 call-wall observations) demand humility. Both rebuild nightly.</LI>
        <LI><strong>Walls are endogenous.</strong> OI may accumulate at levels the market already trades around
          — the matched-distance, matched-window design controls geometry, not the deeper &ldquo;why is the OI
          there&rdquo; question. The falsification family narrows the story to side-specific OI, but a causal
          claim would need order-level data we don&rsquo;t have.</LI>
        <LI><strong>OI is a day stale</strong> (vendor updates overnight, same re-dating caveat as Research E),
          so the live map reflects the second-most-recent close.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Boards archive (per-strike call/put OI, near board dte ≥ 7); crossings on same-board consecutive
        settlements; session-clustered paired inference. All ~18 tested variants reported. Statistics and the
        live wall map recomputed on every export from <Code>options_oi_walls.json</Code>.
      </P>
    </div>
  );
}
