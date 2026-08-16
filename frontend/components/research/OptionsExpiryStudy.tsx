"use client";
// Options expiry and the ITM overhang — Research A of the options program.
// Historical event study on 55 expiries (futures side), the live countdown
// with the full board (predicted side), and the accumulating event ledger.
// Data: options_expiry_study.json (backend/scraper/exporters/options_expiry_study.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, ScatterChart, Scatter, Bar, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, RefTable } from "./methodology/prose";

interface Agg { n: number; mean?: number; median?: number; t?: number }
interface Ev {
  contract: string; expiry: string; pre5_pct?: number; day_pct?: number;
  post1_pct?: number; post3_pct?: number; post5_pct?: number;
  oi_jump_pct?: number; jump_vs_typical?: number;
}
interface Hist {
  root: string; n_events: number; events: Ev[];
  day: Agg; post3: Agg; post5: Agg; absmove_ratio: Agg; absmove_excess: Agg;
  prepost: { n: number; corr?: number; continuation_pct?: number };
  roll_collapse?: { n: number; mean_abs_pct?: number; median_abs_pct?: number };
}
interface CountPt {
  date: string; dte?: number; call_oi?: number; put_oi?: number;
  itm_call_oi?: number; itm_put_oi?: number; fut_oi?: number; future?: number;
  atm_iv?: number; itm_pct?: number; itm_vs_fut_pct?: number;
}
interface Live {
  contract: string; expiry_rule: string;
  countdown: CountPt[];
  max_pain_series: { date: string; max_pain: number; future: number; dist_pct: number }[];
  ladder: { strike: number; call_oi: number; put_oi: number }[] | null;
  ladder_date: string | null;
  now: CountPt;
}
interface Doc {
  generated_at: string;
  method: Record<string, string>;
  historical: Record<"arabica" | "robusta", Hist>;
  live: Record<"arabica" | "robusta", Live | null>;
  ledger: { events: { contract: string; market: string; expiry: string }[] };
}

// KC amber / RC emerald matches the app's market colours; both validated on slate-900.
const C = { kc: "#d97706", rc: "#059669", call: "#059669", put: "#d97706", maxpain: "#8b5cf6", fut: "#38bdf8" };
const pc = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const sig = (t?: number) => (t != null && Math.abs(t) > 1.97);

export default function OptionsExpiryStudy() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"arabica" | "robusta">("robusta");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_expiry_study.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const scatter = useMemo(() => {
    if (!d) return { kc: [], rc: [] };
    const mk = (h: Hist) => h.events
      .filter(e => e.pre5_pct != null && e.post3_pct != null)
      .map(e => ({ x: e.pre5_pct as number, y: e.post3_pct as number, contract: e.contract, expiry: e.expiry }));
    return { kc: mk(d.historical.arabica), rc: mk(d.historical.robusta) };
  }, [d]);

  const live = d?.live?.[mkt] ?? null;
  const ladder = useMemo(() => {
    if (!live?.ladder) return [];
    const fut = live.now?.future ?? live.max_pain_series.at(-1)?.future;
    return live.ladder
      .filter(r => !fut || Math.abs(r.strike - fut) / fut <= 0.18)
      .map(r => ({ strike: r.strike, call: r.call_oi, put: -r.put_oi }));
  }, [live]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_expiry_study.json not published yet — run the exporter.
    </div>;
  }
  if (!d) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const ka = d.historical.arabica, kr = d.historical.robusta;
  const rm = d.live.robusta, kc = d.live.arabica;
  const now: CountPt = live?.now ?? { date: "" };
  const mp = live?.max_pain_series ?? [];
  const mpLast = mp.at(-1);

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> At option expiry, every in-the-money option auto-exercises into a futures
        position: the option book&rsquo;s ITM open interest converts, overnight, into futures OI. This study asks
        whether the size of that overhang — <strong>%ITM of option OI, and ITM OI relative to futures OI</strong> —
        tells you anything about how the future behaves into, at and after expiry. It runs in three honestly-separated
        layers: a <strong>{ka.n_events + kr.n_events}-event historical study</strong> (2021 → today, futures side
        only), the <strong>live countdown</strong> with the full board — {rm?.contract} expires
        {" "}{rm?.expiry_rule}, with ITM options equal to <strong>{pc(rm?.now?.itm_vs_fut_pct, 1)} of the
        future&rsquo;s entire open interest</strong> — and an <strong>event ledger</strong> that freezes each
        board&rsquo;s final state at death, because expired boards are unrecoverable upstream and the full-detail
        backtest can only be <em>accumulated</em> from here.
      </P>

      <H2>1 · The mechanism — and coffee&rsquo;s complication</H2>
      <UL>
        <LI><strong>Conversion.</strong> ITM calls become long futures, ITM puts become short futures, at the strike,
          overnight. The bigger the ITM stock relative to futures OI, the bigger the overnight change in who holds
          the futures market — and the more hedging flow has to be unwound or re-established around it.</LI>
        <LI><strong>Pinning.</strong> Into expiry, dealers hedging short-gamma books trade <em>toward</em> heavy
          strikes; the textbook prediction is the future gravitating to the strike ladder&rsquo;s payout minimum
          (&ldquo;max pain&rdquo;) when the ITM share is still in play.</LI>
        <LI><strong>Coffee&rsquo;s complication: expiry sits inside the delivery roll.</strong> KC options die on the
          2nd Friday of the month preceding the contract month; RC options on the 3rd Wednesday — both only a handful
          of sessions before first notice day. Around our 55 historical expiries, the future&rsquo;s own OI collapsed
          by a median <strong>{ka.roll_collapse?.median_abs_pct?.toFixed(0)}%</strong> (KC) and
          {" "}<strong>{kr.roll_collapse?.median_abs_pct?.toFixed(0)}%</strong> (RC) across the expiry window —
          the roll and the expiry are entangled, so unlike an equity &ldquo;opex&rdquo; study, expiry effects here can
          never be read in isolation from delivery effects. This also means the net futures-OI change at expiry
          <em> cannot</em> serve as a clean measure of realized conversion: exercise adds OI while the roll destroys
          it, and the roll wins.</LI>
      </UL>
      <RefTable head={["", "KC arabica", "RC robusta"]} rows={[
        ["Option expiry rule", "2nd Friday, month before contract month", "3rd Wednesday, month before expiry"],
        ["Sessions to FND (approx.)", "~3–5", "~5–7"],
        ["Historical events measured", `${ka.n_events}`, `${kr.n_events}`],
        ["OI collapse around expiry (median)", `${ka.roll_collapse?.median_abs_pct?.toFixed(0)}%`, `${kr.roll_collapse?.median_abs_pct?.toFixed(0)}%`],
      ]} />

      <H2>2 · Fifty-five expiries — what the futures side shows</H2>
      <P>
        For every expired contract in the 5-year per-contract archive, the price path around its rule-derived option
        expiry (5 sessions either side):
      </P>
      <RefTable head={["Statistic", "KC arabica", "RC robusta"]} rows={[
        ["Expiry-day return, mean", `${pc(ka.day.mean)} (t ${ka.day.t?.toFixed(2)})`, `${pc(kr.day.mean)} (t ${kr.day.t?.toFixed(2)})`],
        ["Post-expiry drift, 3 sessions", `${pc(ka.post3.mean)} (t ${ka.post3.t?.toFixed(2)})`, `${pc(kr.post3.mean)} (t ${kr.post3.t?.toFixed(2)})`],
        ["Post-expiry drift, 5 sessions", `${pc(ka.post5.mean)} (t ${ka.post5.t?.toFixed(2)})`, `${pc(kr.post5.mean)} (t ${kr.post5.t?.toFixed(2)})`],
        ["Daily |move| after vs before", `${ka.absmove_excess.mean != null ? pc(ka.absmove_excess.mean * 100, 0) : "—"} (t ${ka.absmove_excess.t?.toFixed(2)})`,
          `${kr.absmove_excess.mean != null ? pc(kr.absmove_excess.mean * 100, 0) : "—"} (t ${kr.absmove_excess.t?.toFixed(2)})${sig(kr.absmove_excess.t) ? " *" : ""}`],
        ["corr(run-in, post-3 drift)", `${ka.prepost.corr != null ? (ka.prepost.corr > 0 ? "+" : "") + ka.prepost.corr.toFixed(2) : "—"} · ${ka.prepost.continuation_pct?.toFixed(0)}% continue`,
          `${kr.prepost.corr != null ? (kr.prepost.corr > 0 ? "+" : "") + kr.prepost.corr.toFixed(2) : "—"} · ${kr.prepost.continuation_pct?.toFixed(0)}% continue`],
      ]} />
      <UL>
        <LI><strong>No systematic drift.</strong> Expiry day and the sessions after it carry no reliable direction in
          either market — every directional mean is statistically zero. Whatever expiry does, it does not do it with
          a predictable sign across all events, which is exactly why the conditional question (does it depend on the
          ITM overhang?) needs the ledger.</LI>
        <LI><strong>Robusta gets livelier after expiry.</strong> RC daily moves average
          {" "}{kr.absmove_excess.mean != null ? pc(kr.absmove_excess.mean * 100, 0) : "—"} larger in the 5 sessions
          after expiry than the 5 before (t {kr.absmove_excess.t?.toFixed(2)} — significant). Consistent with pin
          release plus the contract&rsquo;s slide into the thin delivery period; the two are inseparable here, and the
          honest reading is &ldquo;expect bigger daily ranges after RM expiry&rdquo;, not a clean options effect. KC
          shows the same tilt without significance.</LI>
        <LI><strong>KC leans toward continuation.</strong> The pre-expiry 5-session move correlates
          {" "}+{ka.prepost.corr?.toFixed(2)} with the post-expiry 3-session move, and 60% of events continue in the
          run-in&rsquo;s direction — a lean against the &ldquo;pin unwinds and reverses&rdquo; folk wisdom. RC is
          flat on this test.</LI>
      </UL>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Run-in vs follow-through — one dot per expiry</h4>
        <div style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 10, bottom: 16, left: -8 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis type="number" dataKey="x" tick={{ fontSize: 9, fill: "#64748b" }}
                label={{ value: "5 sessions into expiry, %", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 12 }} />
              <YAxis type="number" dataKey="y" tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                label={{ value: "3 sessions after, %", fontSize: 9, fill: "#64748b", angle: -90, position: "insideLeft", dx: 14 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n === "x" ? "run-in" : "post-3"]}
                labelFormatter={() => ""} />
              <ReferenceLine x={0} stroke="#475569" />
              <ReferenceLine y={0} stroke="#475569" />
              <Scatter name="KC arabica" data={scatter.kc} fill={C.kc} fillOpacity={0.75} />
              <Scatter name="RC robusta" data={scatter.rc} fill={C.rc} fillOpacity={0.75} />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n}</span>} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Quadrants I and III are continuation, II and IV reversal. The amber cloud (KC) tilts along the diagonal —
          the continuation lean; the emerald cloud (RC) is symmetric.
        </p>
      </div>

      <H2>3 · Case zero — the live countdown</H2>
      <div className="flex flex-wrap items-center gap-2 my-2 text-[11px]">
        <span className="text-slate-500">Board:</span>
        {(["robusta", "arabica"] as const).map(k => (
          <button key={k} onClick={() => setMkt(k)}
            className={`px-2 py-1 rounded border ${mkt === k ? "bg-slate-800 text-indigo-300 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {k === "robusta" ? `${rm?.contract ?? "RM"} — expires ${rm?.expiry_rule ?? ""}` : `${kc?.contract ?? "KC"} — expires ${kc?.expiry_rule ?? ""}`}
          </button>
        ))}
      </div>
      {live && (
        <>
          <P>
            <strong>{live.contract}</strong> — option expiry <Code>{live.expiry_rule}</Code>, last full board
            {" "}{now.date} ({now.dte} days out): option OI {((now.call_oi ?? 0) + (now.put_oi ?? 0)).toLocaleString()}
            {" "}({now.put_oi?.toLocaleString()} puts vs {now.call_oi?.toLocaleString()} calls), of which
            {" "}<strong>{pc(now.itm_pct, 1)} is in the money</strong> — an ITM stock worth
            {" "}<strong>{pc(now.itm_vs_fut_pct, 1)} of the future&rsquo;s entire open interest</strong>. The future
            settled {mpLast?.future?.toLocaleString()} against a max-pain strike of
            {" "}{mpLast?.max_pain?.toLocaleString()} — {pc(mpLast?.dist_pct)} away.
          </P>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
            <h4 className="text-xs font-bold text-slate-100 mb-1">The overhang through time — {live.contract}</h4>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={live.countdown.filter(c => c.itm_pct != null)} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={46} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n === "itm_pct" ? "ITM share of option OI" : "ITM vs futures OI"]} />
                  <Line dataKey="itm_pct" stroke="#818cf8" dot={false} strokeWidth={1.8} name="itm_pct" />
                  <Line dataKey="itm_vs_fut_pct" stroke="#e879f9" dot={false} strokeWidth={1.8} name="itm_vs_fut_pct" />
                  <Legend verticalAlign="bottom" height={20} iconSize={8}
                    formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "itm_pct" ? "ITM % of option OI" : "ITM % of futures OI"}</span>} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
            <h4 className="text-xs font-bold text-slate-100 mb-1">
              The board {live.contract} dies with — OI by strike, {live.ladder_date}
            </h4>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ladder} margin={{ top: 6, right: 8, bottom: 14, left: -14 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={26}
                    label={{ value: "strike", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 10 }} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44}
                    tickFormatter={(v: number) => Math.abs(v).toLocaleString()} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    formatter={(v, n) => [Math.abs(Number(v)).toLocaleString() + " lots", n === "call" ? "calls" : "puts"]} />
                  <ReferenceLine y={0} stroke="#475569" />
                  {mpLast && <ReferenceLine x={mpLast.max_pain} stroke={C.maxpain} strokeDasharray="4 3"
                    label={{ value: "max pain", fill: C.maxpain, fontSize: 9, position: "top" }} />}
                  {mpLast && <ReferenceLine x={mpLast.future} stroke={C.fut} strokeWidth={1.5}
                    label={{ value: "future", fill: C.fut, fontSize: 9, position: "insideTopRight" }} />}
                  <Bar dataKey="call" name="call" fill={C.call} fillOpacity={0.85} maxBarSize={9} />
                  <Bar dataKey="put" name="put" fill={C.put} fillOpacity={0.85} maxBarSize={9} />
                  <Legend verticalAlign="bottom" height={20} iconSize={8}
                    formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "call" ? "calls (up)" : "puts (down)"}</span>} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500 italic mt-1">
              Calls plotted up, puts down; strikes within ±18% of the future. Everything left of the future line in
              the call stack and right of it in the put stack converts to futures at expiry.
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
            <h4 className="text-xs font-bold text-slate-100 mb-1">Distance to max pain — {live.contract}, daily</h4>
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={mp} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={46} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${Number(v).toFixed(2)}%`, "future vs max pain"]} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Line dataKey="dist_pct" stroke={C.maxpain} dot={false} strokeWidth={1.8} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500 italic mt-1">
              {mkt === "robusta"
                ? "The pin candidate: into the final week the future has closed to within half a percent of the ladder's payout minimum. One contract proves nothing — this is the observation the ledger will grade."
                : "Ninety days out, the future trades well above the ladder's payout minimum — max pain only means something near expiry, which is the point of the contrast."}
            </p>
          </div>
        </>
      )}

      <H2>4 · The ledger — why this study accumulates instead of backtesting</H2>
      <P>
        The full-detail cross-section — behaviour <em>conditional on %ITM</em>, which is the question — needs the
        board as it died. Those boards are unrecoverable upstream: the probe behind our options backfill established
        that the vendor returns nothing for a series once it expires (the KC September 2026 board was empty one day
        after its expiry). So this study is built to <strong>accumulate</strong>: every time a tracked board dies,
        its final state — ITM split, max pain, ladder — is frozen into <Code>options_expiry_ledger.json</Code>,
        append-once, and the historical layer gains one full-detail event per expiry (≈10 per year across both
        markets). {rm?.contract} will be entry #1 within days.
      </P>
      <UL>
        <LI><strong>Hypotheses the ledger will grade</strong> (stated before the evidence, so the grading is
          honest): (1) pinning strength scales with ITM share still at stake near the money; (2) post-expiry drift is
          conditional — a large ITM overhang leaves the market positioned like its exercised side and prone to
          continuation; (3) the futures-OI change at expiry equals conversion minus roll, so with the ledger&rsquo;s
          ITM count the roll leg becomes separable for the first time.</LI>
        <LI><strong>Current prediction on file</strong>: {rm?.contract} dies {rm?.expiry_rule} with
          {" "}{pc(rm?.now?.itm_pct, 1)} of its option OI in the money ({pc(rm?.now?.itm_vs_fut_pct, 1)} of futures
          OI) and the future {pc(rm && d.live.robusta?.max_pain_series.at(-1)?.dist_pct)} from max pain — graded
          next week.</LI>
      </UL>

      <H2>5 · Limits</H2>
      <UL>
        <LI>Historical expiry dates are rule-derived (2nd Friday / 3rd Wednesday), not vendor-confirmed; a rarely-hit
          KC proviso can pull expiry earlier when FND is close. Event alignment is therefore ±1 session for a small
          minority of events, and the jump window absorbs it.</LI>
        <LI>The futures-OI change around expiry is roll-dominated and is never presented as realized conversion; the
          conversion accounting starts with the ledger.</LI>
        <LI>The robusta liveliness result cannot be split between pin release and delivery-period thinness with the
          futures side alone — both mechanisms point the same way at the same time.</LI>
        <LI>Max pain is computed from closing OI, which publishes next morning — the live read is always one session
          behind the price.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Per-contract futures settlements and OI: 5-year archive (Barchart), 55 completed expiries measured. Live
        boards: daily per-strike OI archive since 2024-06 with ITM splits. {d.method.oi_dating} {d.method.max_pain}
        {" "}Statistics recomputed on every export from <Code>options_expiry_study.json</Code>.
      </P>
    </div>
  );
}
