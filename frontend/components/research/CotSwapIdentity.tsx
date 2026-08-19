"use client";
// Are swap dealers commercials or speculators? Three behavioural tests on the
// disaggregated COT, both contracts, long and short legs kept separate.
// Data: cot_swap_identity.json (backend/scraper/exporters/cot_swap_identity.py).
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend, Cell, LabelList } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "./methodology/prose";

interface Cohort {
  share_oi_pct: number; mean_lots: number;
  price_response_r: number; price_response_t: number; significant: boolean;
  ar1: number; weekly_turnover_pct: number;
}
interface Leg {
  vs_pmpu_1w: number; vs_mm_1w: number; vs_pmpu_1w_t: number; vs_mm_1w_t: number;
  vs_pmpu_1w_partial: number; vs_mm_1w_partial: number;
  vs_pmpu_4w_partial: number; vs_mm_4w_partial: number;
  leadlag: { k: number; pmpu: number; mm: number }[];
  price_response_first_half: number; price_response_second_half: number;
}
interface RollPt { date: string; vs_pmpu?: number; vs_mm?: number; pmpu?: number; swap?: number; mm?: number }
interface Market {
  label: string; contract: string; weeks: number; start: string; end: string;
  price_window: { start: string; end: string; weeks: number };
  cohorts: Record<string, Cohort>;
  legs: Record<string, Leg>;
  rolling: Record<string, RollPt[]>;
}
interface Doc {
  generated_at: string;
  method: Record<string, string | number>;
  markets: Record<string, Market>;
}

// PMPU = commercial pole, MM = speculative pole, Swap = the cohort under test.
// Fixed order, never cycled; validated for CVD separation on the slate surface.
const C = { pmpu: "#059669", swap: "#8b5cf6", mm: "#d97706" };
const NAME: Record<string, string> = { pmpu: "PMPU (commercial)", swap: "Swap dealers", mm: "Managed money" };
const n3 = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3)}`);

export default function CotSwapIdentity() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<"ny" | "ldn">("ny");
  const [side, setSide] = useState<"long" | "short">("long");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/cot_swap_identity.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = d?.markets?.[mkt];

  const prBars = useMemo(() => {
    if (!m) return [];
    return ["pmpu", "swap", "mm"].map(c => {
      const co = m.cohorts[`${c}_${side}`];
      return { key: c, name: NAME[c], r: co?.price_response_r ?? 0, sig: co?.significant ?? false, t: co?.price_response_t ?? 0 };
    });
  }, [m, side]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      cot_swap_identity.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !m) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const leg = m.legs[side];
  const swap = m.cohorts[`swap_${side}`];
  const pmpu = m.cohorts[`pmpu_${side}`];
  const mm = m.cohorts[`mm_${side}`];
  const co = m.rolling[`comovement_${side}`] ?? [];
  const pr = m.rolling[`price_response_${side}`] ?? [];

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> The disaggregated COT splits reportable positions into Producer/Merchant/Processor/
        User (PMPU), Swap Dealers, Managed Money and Other. PMPU is the commercial pole and managed money the
        speculative one; <strong>swap dealers are the contested cohort</strong>, and the usual shortcut — folding them
        into a &ldquo;commercial net&rdquo; next to PMPU — is an assumption, not a finding. This note tests it on
        {" "}{m.weeks} weekly reports ({m.start} → {m.end}) for both contracts, with the <strong>long and short legs
        kept separate throughout</strong>, because a swap book hedging index length has nothing in common with one
        hedging an OTC producer deal. The answer: <strong>swaps are neither</strong>. They do not co-move with PMPU,
        they do not co-move with managed money, and — the discriminating test — they show <em>no</em> price response
        in either direction while both poles show large, stable, opposite ones. They are a third category: a slow,
        price-inelastic, intermediated book.
      </P>

      <div className="flex flex-wrap items-center gap-2 my-3 text-[11px]">
        <span className="text-slate-500">Contract:</span>
        {(Object.entries(d.markets) as [string, Market][]).map(([k, v]) => (
          <button key={k} onClick={() => setMkt(k as "ny" | "ldn")}
            className={`px-2 py-1 rounded border ${mkt === k ? "bg-slate-800 text-amber-400 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {v.label}
          </button>
        ))}
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">Leg:</span>
        {(["long", "short"] as const).map(s => (
          <button key={s} onClick={() => setSide(s)}
            className={`px-2 py-1 rounded border ${side === s ? "bg-slate-800 text-amber-400 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {s === "long" ? "Long leg" : "Short leg"}
          </button>
        ))}
      </div>

      <H2>1 · Why the label matters, and how to settle it</H2>
      <P>
        Every net-positioning read depends on which side of the ledger swaps sit. On the {side} leg of
        {" "}{m.contract} they carry <strong>{swap?.share_oi_pct?.toFixed(1)}% of open interest</strong> — put them
        with the commercials and the &ldquo;trade&rdquo; looks bigger and the spec float smaller; put them with the
        funds and the opposite. Our own intraweek flow model currently pools them with PMPU and the non-reportables
        when it splits producer from roaster flow, so the question is live in this codebase.
      </P>
      <P>
        Labels can&rsquo;t settle it — behaviour can. Three tests, all run on <strong>weekly changes</strong> rather
        than levels, because every cohort&rsquo;s level trends with open interest and level correlations are largely
        spurious:
      </P>
      <UL>
        <LI><strong>Co-movement</strong> — does the swap leg move with PMPU, or with managed money? Reported raw and
          partialled on ΔOI, because the report&rsquo;s adding-up constraint (Σ longs = Σ shorts = OI) mechanically
          pushes cohorts apart whenever OI is flat. That artefact is why the partials below run negative.</LI>
        <LI><strong>Price response</strong> — the discriminating test. A hedger leans <em>against</em> the move: a
          rally makes forward selling attractive and marks the physical book up, so commercials sell into strength.
          A speculator leans <em>with</em> it. The sign of <Code>corr(Δposition, weekly return)</Code> sorts the poles
          with no reference to any label — and where the swap leg falls between them is the answer.</LI>
        <LI><strong>Persistence</strong> — how sticky is the book? Weekly turnover and the AR(1) of the level. A
          passive intermediated book barely moves; an active spec book churns.</LI>
      </UL>

      <H2>2 · The discriminating test — who leans which way?</H2>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">
          Price response, {side} leg — {m.label} · {m.price_window.weeks} weeks
        </h4>
        <div style={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={prBars} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 96 }}>
              <CartesianGrid stroke="#1e293b" horizontal={false} />
              <XAxis type="number" domain={[-0.6, 0.6]} tick={{ fontSize: 9, fill: "#64748b" }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#cbd5e1" }} width={92} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, _n, p) => {
                  const row = p?.payload as { t?: number; sig?: boolean } | undefined;
                  return [`r = ${Number(v).toFixed(3)}  (t ${row?.t?.toFixed(2)}${row?.sig ? "" : ", n.s."})`, "vs weekly return"];
                }} />
              <ReferenceLine x={0} stroke="#475569" />
              <Bar dataKey="r" radius={[3, 3, 3, 3]} barSize={20}>
                {prBars.map(b => (
                  <Cell key={b.key} fill={C[b.key as keyof typeof C]} fillOpacity={b.sig ? 0.95 : 0.35} />
                ))}
                <LabelList dataKey="r" position="right" formatter={(v: unknown) => {
                  const row = prBars.find(x => x.r === v);
                  return `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}${row?.sig ? "" : " n.s."}`;
                }} style={{ fontSize: 10, fill: "#94a3b8" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Solid bars are significant at 5%; faded bars marked <em>n.s.</em> are indistinguishable from zero. Left of
          the line = leans against the move (hedger-like); right = leans with it (speculator-like).
        </p>
      </div>
      <UL>
        <LI><strong>The two poles behave exactly as theory says, and strongly.</strong> On the {side} leg PMPU prints
          {" "}{n3(pmpu?.price_response_r)} (t {pmpu?.price_response_t?.toFixed(2)}) and managed money
          {" "}{n3(mm?.price_response_r)} (t {mm?.price_response_t?.toFixed(2)}) — opposite signs, both far beyond the
          5% threshold. The test works.</LI>
        <LI><strong>Swaps print {n3(swap?.price_response_r)} (t {swap?.price_response_t?.toFixed(2)})
          {swap?.significant ? "" : " — not significantly different from zero"}.</strong> They neither lean against
          the move nor chase it.</LI>
        <LI><strong>And the point estimate isn&rsquo;t stable</strong>: split the window in half and the swap
          coefficient goes {n3(leg?.price_response_first_half)} → {n3(leg?.price_response_second_half)}, while the
          poles hold their sign in both halves. An unstable, insignificant coefficient is not weak evidence of a
          category — it is evidence of <em>no</em> price-driven behaviour at all.</LI>
      </UL>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Rolling 52-week price response — {side} leg</h4>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pr} margin={{ top: 6, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis domain={[-1, 1]} tick={{ fontSize: 9, fill: "#64748b" }} width={42} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [v == null ? "—" : Number(v).toFixed(2), NAME[String(n)] ?? String(n)]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="pmpu" stroke={C.pmpu} dot={false} strokeWidth={1.8} connectNulls />
              <Line dataKey="swap" stroke={C.swap} dot={false} strokeWidth={2.2} connectNulls />
              <Line dataKey="mm" stroke={C.mm} dot={false} strokeWidth={1.8} connectNulls />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{NAME[n] ?? n}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The commercial and speculative lines stay on their own sides of zero for the whole window. The swap line
          wanders across it — which is what &ldquo;no price response&rdquo; looks like through time.
        </p>
      </div>

      <H2>3 · Co-movement — swaps track neither pole</H2>
      <P>
        If swaps were simply an extension of the commercial book, their weekly changes would move with PMPU&rsquo;s.
        They don&rsquo;t — and they don&rsquo;t move with managed money either.
      </P>
      <RefTable head={["Test", "Swap vs PMPU", "Swap vs managed money"]} rows={[
        ["Δ1 week, raw", `${n3(leg?.vs_pmpu_1w)} (t ${leg?.vs_pmpu_1w_t?.toFixed(2)})`, `${n3(leg?.vs_mm_1w)} (t ${leg?.vs_mm_1w_t?.toFixed(2)})`],
        ["Δ1 week, controlling ΔOI", n3(leg?.vs_pmpu_1w_partial), n3(leg?.vs_mm_1w_partial)],
        ["Δ4 weeks, controlling ΔOI", n3(leg?.vs_pmpu_4w_partial), n3(leg?.vs_mm_4w_partial)],
        ["Δ1w, swap lagged 1 week behind", n3(leg?.leadlag?.[1]?.pmpu), n3(leg?.leadlag?.[1]?.mm)],
        ["Δ1w, swap lagged 2 weeks behind", n3(leg?.leadlag?.[2]?.pmpu), n3(leg?.leadlag?.[2]?.mm)],
      ]} />
      <P>
        Nothing reaches a magnitude worth acting on, at any horizon, in either direction, and the lagged columns rule
        out swaps simply <em>following</em> one pole with a reporting delay. Read the negative partials with care: they
        are largely the adding-up constraint talking, not evidence that swaps trade <em>against</em> commercials.
      </P>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Rolling 52-week co-movement of Δswap — {side} leg</h4>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={co} margin={{ top: 6, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis domain={[-1, 1]} tick={{ fontSize: 9, fill: "#64748b" }} width={42} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [v == null ? "—" : Number(v).toFixed(2), n === "vs_pmpu" ? "vs PMPU" : "vs managed money"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="vs_pmpu" stroke={C.pmpu} dot={false} strokeWidth={1.8} connectNulls />
              <Line dataKey="vs_mm" stroke={C.mm} dot={false} strokeWidth={1.8} connectNulls />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "vs_pmpu" ? "vs PMPU" : "vs managed money"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <H2>4 · Persistence — the tell</H2>
      <P>
        The third test is where swaps stop looking like anything else in the report.
      </P>
      <RefTable head={["Cohort", "Share of OI", "Weekly turnover", "AR(1)"]} rows={["pmpu", "swap", "mm"].map(c => {
        const x = m.cohorts[`${c}_${side}`];
        return [NAME[c], `${x?.share_oi_pct?.toFixed(1)}%`, `${x?.weekly_turnover_pct?.toFixed(1)}%`, x?.ar1?.toFixed(3) ?? "—"];
      })} />
      <P>
        On the {side} leg of {m.contract}, the swap book turns over
        {" "}<strong>{swap?.weekly_turnover_pct?.toFixed(1)}% a week</strong> against
        {" "}{pmpu?.weekly_turnover_pct?.toFixed(1)}% for the commercials and
        {" "}{mm?.weekly_turnover_pct?.toFixed(1)}% for managed money.
        {mkt === "ny" && side === "long" && (
          <> That makes the New York swap long book the <strong>stickiest cohort in the entire report</strong> — an
            AR(1) of {swap?.ar1?.toFixed(3)} and barely two percent of the position changing hands in a week. That is
            not a view being expressed; it is a structural position being carried.</>
        )}
      </P>

      <H2>5 · Verdict, and the leg asymmetry</H2>
      <Highlight>
        <strong>Swaps are not commercials, and they are not speculators — they are a third thing.</strong> No
        co-movement with either pole at any horizon, no significant price response in either direction, and a book far
        stickier than either. The behaviour is that of an <em>intermediary</em> carrying the futures offset of an OTC
        or index exposure, which is exactly what a swap dealer is. Their positions belong in their own bucket, not
        folded into a commercial net.
      </Highlight>
      <P>
        The two legs are worth separating, as suspected — but the evidence for a split is directional, not
        established, and it deserves to be stated that way:
      </P>
      <UL>
        <LI><strong>Long legs sit on the speculative side of zero in both contracts</strong> (New York
          {" "}{n3(d.markets.ny?.cohorts?.swap_long?.price_response_r)}, London
          {" "}{n3(d.markets.ldn?.cohorts?.swap_long?.price_response_r)}) — the <em>opposite</em> sign to PMPU longs,
          which are firmly negative in both. Neither is significant, so this is a lean, not a finding. Combined with
          extreme stickiness, it fits passive index length carried through a dealer far better than it fits a
          commercial hedging physical coffee.</LI>
        <LI><strong>Short legs never look speculative.</strong> London prints
          {" "}{n3(d.markets.ldn?.cohorts?.swap_short?.price_response_r)} and New York
          {" "}{n3(d.markets.ny?.cohorts?.swap_short?.price_response_r)} — the same sign as PMPU shorts (positive:
          adding shorts into rallies) or flat, and never the negative of managed money. If any part of the swap book
          is commercial in character, it is this one.</LI>
        <LI><strong>The two contracts differ in scale, not in kind.</strong> Swaps are a much bigger share of New York
          ({d.markets.ny?.cohorts?.swap_long?.share_oi_pct?.toFixed(1)}% of OI long) than of London
          ({d.markets.ldn?.cohorts?.swap_long?.share_oi_pct?.toFixed(1)}%), and the London book is markedly more
          mobile — but the same three test results hold in both.</LI>
      </UL>

      <H2>6 · What this changes here</H2>
      <UL>
        <LI><strong>Don&rsquo;t add swaps to a commercial net.</strong> On the New York long leg that would move
          {" "}{d.markets.ny?.cohorts?.swap_long?.share_oi_pct?.toFixed(1)}% of open interest into a bucket whose
          defining behaviour — leaning against the market — swaps do not display.</LI>
        <LI><strong>Don&rsquo;t add them to the spec float either.</strong> A book turning over two percent a week
          carries none of the reflexive risk that makes managed-money length interesting.</LI>
        <LI><strong>Flagged for the intraweek model</strong>: <Code>estimateIntraweekFlow</Code> pools swap positions
          with PMPU, other and non-reportables to derive producer and roaster shares. On this evidence the swap long
          leg does not belong in that pool. Re-testing the model with swaps excluded is the natural follow-up — a
          change to a live signal, so it wants its own study rather than a quiet edit here.</LI>
        <LI><strong>Where swaps <em>are</em> informative</strong>: as a slow-moving stock, not a flow. A structural
          shift in the swap book — the kind that takes months, not weeks — is a change in index or OTC exposure to
          coffee, which is worth watching precisely because it does not respond to price.</LI>
      </UL>

      <H2>7 · Limits</H2>
      <UL>
        <LI>The price-response test runs on {m.price_window.weeks} weeks ({m.price_window.start} →
          {" "}{m.price_window.end}), shorter than the {m.weeks}-week COT window, because our front-month price
          history starts later. The co-movement and persistence tests use the full window.</LI>
        <LI>The adding-up constraint means no two cohorts are independent. Partials on ΔOI reduce it; they do not
          eliminate it, and negative partials should not be over-read.</LI>
        <LI>We see only the futures leg. A swap dealer&rsquo;s book is by construction offset by OTC exposure we
          cannot observe — so &ldquo;no price response in futures&rdquo; is a statement about the hedge, not about
          the dealer&rsquo;s total risk.</LI>
        <LI>A null result is not proof of absence: with these n, a true price response smaller than about ±0.15 would
          not be reliably detected. The claim is that swaps show <em>nothing like</em> the ±0.3–0.5 responses both
          poles display, not that their response is exactly zero.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        CFTC Disaggregated Commitments of Traders — futures-only, ICE US Coffee C and ICE Futures Europe Robusta,
        weekly Tuesday reports, {m.start} → {m.end}. Returns are front-contract, aligned to the reporting date.
        {" "}<Code>{String(d.method.comovement)}</Code> Statistics recomputed on every export from
        {" "}<Code>cot_swap_identity.json</Code>.
      </P>
      <DataFiles files={["cot_swap_identity.json", "cot.json"]} />
    </div>
  );
}
