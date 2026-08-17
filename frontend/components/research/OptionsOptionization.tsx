"use client";
// The optionization ratio — Research G of the options program. Options OI vs
// futures OI matched per contract, the lifecycle/migration evidence, and the
// delta-equivalent book our futures-only COT feed cannot see.
// Data: options_optionization.json (exporters/options_optionization.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

interface SeriesPt { date: string; opt: number; fut: number; ratio: number }
interface CotRow { t: string; dw_net: number; mm_net: number; pmpu_net: number; share_of_mm: number | null }
interface Market {
  series: SeriesPt[]; monthly: { month: string; ratio: number }[];
  matched_dte: Record<string, number>[];
  curves: Record<string, { dte: number; ratio: number }[]>;
  cot: CotRow[]; quarterly_share: { q: string; share: number }[];
  now: {
    total: SeriesPt | null;
    per_board: { u: string; dte: number; opt: number; fut: number; ratio: number }[];
    latest_cot: CotRow | null;
  };
}
interface Doc {
  generated_at: string; method: Record<string, string>;
  markets: { arabica: Market; robusta: Market };
}

const KC = "#0284c7", RC = "#059669", THIRD = "#8b5cf6";
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const lots = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString()}`);

export default function OptionsOptionization() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_optionization.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const ratioSeries = useMemo(() => {
    if (!d) return [];
    const rc = new Map(d.markets.robusta.series.map(x => [x.date, x.ratio]));
    return d.markets.arabica.series.map(x => ({
      date: x.date, kc: x.ratio, rc: rc.get(x.date) ?? null,
    }));
  }, [d]);

  const rcCurves = useMemo(() => {
    if (!d) return { data: [] as Record<string, number>[], keys: [] as string[] };
    const keys = Object.keys(d.markets.robusta.curves).sort();
    const byDte = new Map<number, Record<string, number>>();
    for (const u of keys) {
      for (const p of d.markets.robusta.curves[u]) {
        if (!byDte.has(p.dte)) byDte.set(p.dte, { dte: p.dte });
        (byDte.get(p.dte) as Record<string, number>)[u] = p.ratio;
      }
    }
    return { data: Array.from(byDte.values()).sort((a, b) => b.dte - a.dte), keys };
  }, [d]);

  const kcCot = useMemo(() => (d?.markets.arabica.cot ?? []).map(x => ({
    t: x.t, dw_net: x.dw_net, mm_net: x.mm_net,
  })), [d]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_optionization.json not published yet — run the exporter.
    </div>;
  }
  if (!d) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.markets.arabica, kr = d.markets.robusta;
  const kaNow = ka.now.total, krNow = kr.now.total;
  const kaCot = ka.now.latest_cot, krCot = kr.now.latest_cot;
  const julyPeak = ka.monthly.find(m => m.month === "2026-07")?.ratio;
  const rmu10 = kr.matched_dte.find(r => r.dte === 10)?.RMU26;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> How much of coffee&rsquo;s open risk lives in options rather than futures? For the
        tracked front complex, <strong>arabica crossed parity this year</strong>: option open interest on the KC
        boards now stands at <strong>{kaNow?.ratio}× their futures OI</strong> ({kaNow?.opt.toLocaleString()} option
        lots against {kaNow?.fut.toLocaleString()} futures), up from 0.89× in January with a July monthly peak of
        {" "}{julyPeak}×; robusta runs at <strong>{krNow?.ratio}×</strong> and has roughly doubled over the same
        stretch. The migration evidence is clean where it can be clean — each successive robusta board is markedly
        more optionized than its predecessor at the same point of life — and honestly confounded in KC, where the
        lead board carries the whole options market. The consequence for this site&rsquo;s positioning work is
        concrete: our COT feed is the CFTC&rsquo;s <em>futures-only</em> series, and the options book it cannot see
        currently carries <strong>{lots(kaCot?.dw_net)} lots of delta-equivalent net length in KC — about
        {" "}{kaCot?.share_of_mm != null ? Math.round(kaCot.share_of_mm * 100) : "—"}% of the managed-money
        net</strong> — a book whose delta flipped from short to long as frost season approached.
      </P>

      <H2>1 · Construction, and what this ratio is not</H2>
      <UL>
        <LI><strong>Matched pairs only</strong>: total option OI (calls + puts) on the tracked boards ÷ futures OI
          of the <em>same contracts</em>, per session. Untracked futures months (KCU26 and the rest of the strip)
          are excluded from both sides — this is the <em>front-complex</em> ratio, not &ldquo;all coffee options
          over all coffee futures&rdquo;.</LI>
        <LI><strong>The series starts 2026-01</strong>, when the tracked boards became the live front complex;
          before that the boards existed but their options market hadn&rsquo;t been born (the same scope note as
          Research E and F).</LI>
        <LI><strong>The COT overlay</strong> converts the options book to futures-equivalent lots via Black-76
          deltas from stored IVs (the standing convention), sampled at each COT Tuesday. Our COT source is
          {" "}<Code>fut_disagg</Code> — the CFTC&rsquo;s futures-<em>only</em> disaggregated file (ICE London
          equivalently for RC) — so none of that delta is inside the cohort numbers on the COT tab.</LI>
      </UL>

      <H2>2 · The year the front complex crossed parity</H2>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Options OI ÷ futures OI — tracked boards, daily</h4>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ratioSeries} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v}×`} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [`${Number(v).toFixed(2)}×`, n === "kc" ? "KC arabica" : "RC robusta"]} />
              <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 3"
                label={{ value: "parity — options OI = futures OI", fontSize: 9, fill: "#94a3b8", position: "insideBottomRight" }} />
              <Line dataKey="kc" stroke={KC} dot={false} strokeWidth={1.7} name="kc" />
              <Line dataKey="rc" stroke={RC} dot={false} strokeWidth={1.4} name="rc" />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "kc" ? "KC arabica" : "RC robusta"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          KC pushed through parity in April and has stayed above it; the July excursion to ~1.6× is frost-season
          option demand on a shrinking futures book.
        </p>
      </div>
      <RefTable head={["Board", "DTE", "Option OI", "Futures OI", "Ratio"]} rows={[
        ...ka.now.per_board.map(b => [b.u, `${b.dte}d`, b.opt.toLocaleString(), b.fut.toLocaleString(), `${b.ratio}×`]),
        ...kr.now.per_board.map(b => [b.u, `${b.dte}d`, b.opt.toLocaleString(), b.fut.toLocaleString(), `${b.ratio}×`]),
      ]} />
      <P>
        The gradient inside each market is steep: <strong>KCZ26 alone runs
        {" "}{ka.now.per_board[0]?.ratio}×</strong> while the third board sits at
        {" "}{ka.now.per_board[2]?.ratio}× — options interest concentrates hard on the lead board, which matters
        for reading the migration evidence below.
      </P>

      <H2>3 · Lifecycle and migration — clean in robusta, confounded in arabica</H2>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">RC boards: ratio vs days to expiry — each vintage more optionized</h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rcCurves.data} margin={{ top: 6, right: 8, bottom: 14, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="dte" type="number" reversed domain={["dataMax", "dataMin"]}
                tick={{ fontSize: 9, fill: "#64748b" }}
                label={{ value: "days to expiry (time flows →)", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 10 }} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v}×`} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [`${Number(v).toFixed(2)}×`, String(n)]}
                labelFormatter={(v) => `${v} days to expiry`} />
              <ReferenceLine y={1} stroke="#475569" strokeDasharray="4 3" />
              {rcCurves.keys.map((u, i) => (
                <Line key={u} dataKey={u} stroke={[THIRD, KC, RC][i % 3]} dot={false} strokeWidth={1.5}
                  name={u} connectNulls />
              ))}
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <RefTable head={["DTE", "RMU26", "RMX26", "RMF27"]} rows={
        kr.matched_dte.filter(r => r.dte >= 60).map(r => [
          `${r.dte}d`, r.RMU26 != null ? `${r.RMU26}×` : "—",
          r.RMX26 != null ? `${r.RMX26}×` : "—", r.RMF27 != null ? `${r.RMF27}×` : "—",
        ])
      } />
      <UL>
        <LI><strong>Robusta&rsquo;s migration is real at matched life-stage</strong>: at 150 days out, RMU26 ran
          0.53× — its successor RMX26 hit 0.96× at the same point, roughly double, and RMF27 is building earlier
          than either. Successive vintages carry more of their risk in options.</LI>
        <LI><strong>KC&rsquo;s version of this table is confounded and we say so</strong>: KCZ26 beats its
          successors at every matched dte (1.11× vs 0.73× vs 0.45× at 300d) — but KCZ26 is <em>the</em> lead
          option board carrying the whole market&rsquo;s activity, so board <em>role</em> and vintage can&rsquo;t
          be separated until the roll hands leadership to KCH27. That handoff is the clean experiment, and it is
          months away, on schedule, and free.</LI>
        <LI><strong>The expiry spike is mechanical and diagnostic</strong>: RMU26&rsquo;s ratio jumped to
          {" "}{rmu10}× at 10 days out — futures roll to the next month while options sit to expiry, exactly the
          roll-entanglement the expiry paper measured. A ratio spike into expiry is the roll, not a positioning
          signal.</LI>
      </UL>

      <H2>4 · The book COT cannot see</H2>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">KC: managed-money net (futures-only COT) vs the options book&rsquo;s delta-equivalent net — lots</h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={kcCot} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={40} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={52}
                tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [lots(Number(v)), n === "mm_net" ? "MM net (futures-only COT)" : "options Δ-equivalent net"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="mm_net" stroke={KC} dot={false} strokeWidth={1.6} name="mm_net" />
              <Line dataKey="dw_net" stroke={THIRD} dot={false} strokeWidth={1.4} strokeDasharray="5 3" name="dw_net" />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "mm_net" ? "MM net (futures-only COT)" : "options Δ-equivalent net"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <RefTable head={["", "KC arabica", "RC robusta"]} rows={[
        ["Options Δ-net now", `${lots(kaCot?.dw_net)} lots`, `${lots(krCot?.dw_net)} lots`],
        ["MM net (futures-only)", `${lots(kaCot?.mm_net)} lots`, `${lots(krCot?.mm_net)} lots`],
        ["Δ-net as share of MM", kaCot?.share_of_mm != null ? `${Math.round(kaCot.share_of_mm * 100)}%` : "—",
          krCot?.share_of_mm != null ? `${Math.round(krCot.share_of_mm * 100)}%` : "—"],
        ["Share by quarter", ka.quarterly_share.map(q => `${q.q.slice(5)}: ${Math.round(q.share * 100)}%`).join(" · "),
          kr.quarterly_share.map(q => `${q.q.slice(5)}: ${Math.round(q.share * 100)}%`).join(" · ")],
      ]} />
      <Highlight>
        The quarterly row is the story: the options book&rsquo;s delta was net <em>short</em> through Q1–Q2 and
        flipped decisively <em>long</em> in Q3 — precisely as the skew paper&rsquo;s call wing steepened into frost
        season. Anyone reading the COT tab&rsquo;s managed-money net as &ldquo;the&rdquo; spec position is missing a
        book currently worth a quarter to a third of it, with its own seasonal sign.
      </Highlight>

      <H2>5 · What this changes here</H2>
      <UL>
        <LI><strong>Level reads of positioning should carry the adjunct</strong>: MM net {lots(kaCot?.mm_net)} is
          the futures book only; the honest spec-pressure read is that number <em>plus</em> awareness of
          {" "}{lots(kaCot?.dw_net)} delta-equivalent lots in options (unattributed across cohorts — see
          Limits).</LI>
        <LI><strong>The intraweek nowcast is unaffected</strong> — it targets the futures-only print and remains
          correct for it; this paper documents what that print does not contain.</LI>
        <LI><strong>A natural follow-up when warranted</strong>: the CFTC also publishes a combined
          futures-and-options disaggregated file. Fetching it alongside <Code>fut_disagg</Code> would let the COT
          tab show both, and the gap between them is exactly this paper&rsquo;s delta book, cohort-attributed by
          the CFTC itself.</LI>
        <LI><strong>Watch the parity ratio as a structure metric</strong>: it recomputes nightly; the KCZ26 → KCH27
          leadership handoff will be its first clean migration experiment.</LI>
      </UL>

      <H2>6 · Limits</H2>
      <UL>
        <LI><strong>Attribution is unknown.</strong> The delta-equivalent net is the whole options book — commercials,
          funds and dealers together — not a managed-money position. It sizes what futures-only COT omits; it does
          not say who holds it.</LI>
        <LI><strong>Front complex only.</strong> Untracked strip months carry futures OI (KCU26 held ~27k lots into
          its expiry) and some options; the ratio here is the tracked-boards pair, stated as such.</LI>
        <LI><strong>One year of era.</strong> The parity crossing is a 2026 fact on our archive; whether it is
          secular migration or a vol-regime artifact needs the KCH27 handoff and beyond.</LI>
        <LI><strong>Deltas inherit settlement-IV noise</strong> on illiquid strikes (standing caveat), and OI is a
          session stale (vendor overnight update).</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        options_oi.json (per-board option and futures OI, session-dated); boards archive (per-strike OI + IV for
        the delta conversion); cot.json (CFTC <Code>fut_disagg</Code> NY / ICE London weekly). Ratio, curves and
        the COT overlay recomputed on every export from <Code>options_optionization.json</Code>.
      </P>
    </div>
  );
}
