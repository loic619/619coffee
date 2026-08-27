"use client";
// Certified stocks vs the 1st/2nd calendar spread — does the textbook hold?
//
// Theory of storage: when the exchange is empty, whoever needs coffee now has
// to outbid whoever holds it, so the front trades over the deferred. When
// stocks are ample there is nothing to bid for and the curve pays carry.
// Brokers publish this as a scatter with a fitted decay curve through it.
//
// We can check it instead of assuming it, and the answer differs by market —
// which is the whole reason this page exists rather than a single chart.
import { useEffect, useState } from "react";
import {
  CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

// Recency ramp: newest is loud, history recedes to a wash. The eye should find
// "where are we now" before it reads anything else on the chart.
const C_CURRENT  = "#ef4444";   // most recent month
const C_PREV     = "#f97316";   // the month before
const C_RECENT4  = "#1e40af";   // the four before that
const C_HISTORIC = "#93c5fd";   // everything older, shaded back

interface Point { month: string; stocks_k_bags: number; spread: number; spread_pct: number }
interface Analysis {
  n: number; spearman?: number | null;
  first_half?: { span: [string, string] | null; spearman: number | null };
  second_half?: { span: [string, string] | null; spearman: number | null };
  holds_in_both_halves?: boolean | null;
}
interface Mkt {
  label: string; unit: string; points: Point[];
  analysis: Analysis; analysis_pct: Analysis;
  latest: {
    date: string; spread: number; spread_pct: number;
    front: string; second: string; front_price: number;
  } | null;
}
interface Payload { sign_convention: string; markets: Record<string, Mkt> }

/** Which unit the spread axis is drawn in.
 *
 *  "native" is what the trade quotes — c/lb on KC, $/t on RC. "pct" is the
 *  spread as a share of the front contract's price. The second is the only one
 *  that survives a change of price level: 40 $/t against robusta at 1,500 is a
 *  real carry, the same 40 $/t at 5,600 is noise, and the absolute axis draws
 *  them at the same height. It is also the only way the two panels below can be
 *  read against each other at all — c/lb and $/t cannot share a scale. */
type Mode = "native" | "pct";

/** Newest-first index → colour band. Four bands, per the recency ramp above. */
export function band(idxFromEnd: number): string {
  if (idxFromEnd === 0) return C_CURRENT;
  if (idxFromEnd === 1) return C_PREV;
  if (idxFromEnd <= 5) return C_RECENT4;
  return C_HISTORIC;
}
export function bandOpacity(idxFromEnd: number): number {
  if (idxFromEnd === 0) return 1;
  if (idxFromEnd === 1) return 0.95;
  if (idxFromEnd <= 5) return 0.85;
  return 0.35;
}
/** Recent points are drawn larger as well as brighter — colour alone fails for
 *  a reader who cannot separate red from orange. */
export function bandSize(idxFromEnd: number): number {
  if (idxFromEnd === 0) return 300;
  if (idxFromEnd === 1) return 170;
  if (idxFromEnd <= 5) return 110;
  return 40;
}

const fmtK = (v: number) => `${Math.round(v).toLocaleString()}k`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

/** The spread in whichever unit is on the axis, signed so backwardation reads
 *  as a plus. */
export function fmtSpread(v: number, mode: Mode, unit: string): string {
  const sign = v >= 0 ? "+" : "";
  return mode === "pct" ? `${sign}${v.toFixed(2)}%` : `${sign}${v.toFixed(1)} ${unit}`;
}

function UnitToggle({ mode, onMode, unit }: { mode: Mode; onMode: (m: Mode) => void; unit: string }) {
  return (
    <div className="flex items-center gap-1">
      {([["native", unit], ["pct", "% of front"]] as [Mode, string][]).map(([k, label]) => (
        <button key={k} type="button" onClick={() => onMode(k)}
          aria-pressed={mode === k}
          className={`rounded border px-2 py-0.5 text-[10px] transition ${
            mode === k
              ? "border-sky-500 bg-sky-600 font-semibold text-slate-950"
              : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Chart({ m, unit, mode, onMode }:
  { m: Mkt; unit: string; mode: Mode; onMode: (mo: Mode) => void }) {
  const n = m.points.length;
  const rows = m.points.map((p, i) => ({ ...p, age: n - 1 - i }));
  const a = mode === "pct" ? m.analysis_pct : m.analysis;
  const key = mode === "pct" ? "spread_pct" : "spread";
  const axisLabel = mode === "pct" ? "1/2 spread (% of front price)" : `1/2 spread (${unit})`;
  return (
    <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          {m.label} — 1st/2nd spread vs certified stocks
        </div>
        <UnitToggle mode={mode} onMode={onMode} unit={unit} />
      </div>
      <div className="mb-2 text-[10px] text-slate-500">
        {mode === "pct"
          ? "Monthly average of the DAILY spread-over-front-price ratio (positive = backwardation) "
          : `Monthly average spread (${unit}, positive = backwardation) `}
        against end-month exchange stocks.
        {a.n ? ` ${a.n} months.` : ""}
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 14, bottom: 18, left: 6 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis type="number" dataKey="stocks_k_bags" name="Certified stocks"
              tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={fmtK}
              label={{ value: "Certified stocks (000s bags)", position: "insideBottom",
                offset: -10, fill: "#64748b", fontSize: 10 }} />
            <YAxis type="number" dataKey={key} name="1/2 spread"
              tick={{ fontSize: 9, fill: "#64748b" }} width={52}
              tickFormatter={mode === "pct" ? fmtPct : undefined}
              label={{ value: axisLabel, angle: -90, position: "insideLeft",
                fill: "#64748b", fontSize: 10 }} />
            <ZAxis type="number" dataKey="z" range={[40, 300]} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "#475569" }}
              contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                borderRadius: 8, fontSize: 11 }}
              formatter={(v, name) => [
                name === "Certified stocks" ? fmtK(Number(v)) : fmtSpread(Number(v), mode, unit),
                String(name)]}
              labelFormatter={() => ""}
              itemSorter={(i) => (i.name === "Certified stocks" ? -1 : 1)} />
            <Scatter data={rows.map(r => ({ ...r, z: bandSize(r.age) }))} isAnimationActive={false}>
              {rows.map(r => (
                <Cell key={r.month} fill={band(r.age)} fillOpacity={bandOpacity(r.age)}
                  stroke={r.age <= 1 ? "#0f172a" : "none"} strokeWidth={1.5} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {([["most recent month", C_CURRENT], ["previous month", C_PREV],
           ["previous 4 months", C_RECENT4], ["earlier history", C_HISTORIC]] as [string, string][])
          .map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}
            </span>
          ))}
      </div>
      {m.latest && (
        <div className="mt-2 text-[10px] text-slate-500">
          Latest board {m.latest.date}: <Code>{m.latest.front}</Code> −{" "}
          <Code>{m.latest.second}</Code> ={" "}
          <span className={m.latest.spread >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
            {fmtSpread(mode === "pct" ? m.latest.spread_pct : m.latest.spread, mode, unit)}
          </span>{" "}
          {mode === "pct" && <>of {m.latest.front_price} {unit} </>}
          — {m.latest.spread >= 0 ? "backwardation" : "contango"}.
        </div>
      )}
    </div>
  );
}

/** Both units, side by side and always both.
 *
 *  The percentage is not a redrawing of the absolute spread — it is divided by
 *  a price level that moved a long way over this sample, so the rank
 *  correlation can genuinely differ. Showing only the unit currently on the
 *  axis would hide whether the result is a property of the market or of the
 *  unit it was measured in, which is exactly the question a unit toggle
 *  invites. */
function Verdict({ a, aPct, label, unit }:
  { a: Analysis; aPct: Analysis; label: string; unit: string }) {
  if (a.spearman == null) return null;
  const ok = a.holds_in_both_halves;
  const okPct = aPct.holds_in_both_halves;
  const num = (v: number | null | undefined, warn?: boolean) => (
    <span className={warn ? "font-semibold text-amber-400" : ""}>{v?.toFixed(3) ?? "—"}</span>
  );
  return (
    <RefTable
      head={[label, "Sample", `in ${unit}`, "in % of front"]}
      rows={[
        ["Whole sample", `${a.n} months`,
          <span key="f" className="font-semibold text-slate-200">{a.spearman.toFixed(3)}</span>,
          <span key="fp" className="font-semibold text-slate-200">
            {aPct.spearman?.toFixed(3) ?? "—"}
          </span>],
        ["First half", a.first_half?.span?.join(" → ") ?? "—",
          num(a.first_half?.spearman), num(aPct.first_half?.spearman)],
        ["Second half", a.second_half?.span?.join(" → ") ?? "—",
          num(a.second_half?.spearman, !ok), num(aPct.second_half?.spearman, !okPct)],
        [<strong key="v">Holds throughout?</strong>, "",
          <span key="vv" className={ok ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
            {ok ? "yes" : "no — see below"}
          </span>,
          <span key="vp" className={okPct ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
            {okPct ? "yes" : "no — see below"}
          </span>],
      ]}
    />
  );
}

export default function CertStocksSpread() {
  const [d, setD] = useState<Payload | null | false>(null);
  // One toggle, both panels. Flipping to % is almost always about comparing
  // London with New York, and having to click it twice — then finding the two
  // figures on different units when you scroll between them — defeats it.
  const [mode, setMode] = useState<Mode>("native");
  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Payload>("/data/front_spread.json")
      .then(p => { if (alive) setD(p); })
      .catch(() => { if (alive) setD(false); });
    return () => { alive = false; };
  }, []);

  // `d` is Payload | null (loading) | false (failed); truthiness excludes both
  // non-payload states, so the markets are only read once one exists.
  const ara = d ? d.markets.arabica : null;
  const rob = d ? d.markets.robusta : null;

  return (
    <Paper
      tone="sky"
      updated="2026-08-26"
      kicker="Curve structure · Theory of storage"
      title="Certified stocks and the front spread — does the textbook hold?"
      subtitle="The scatter every broker publishes, rebuilt on our own five years of contract boards — and checked in halves, which is where the two markets part company"
    >
      <P>
        <strong>Abstract.</strong> The theory of storage says an empty exchange forces the front contract
        over the deferred: if you need coffee now and nobody is holding it, you outbid the holder. Ample
        stocks reverse it and the curve pays carry. The relationship is usually shown as a scatter of the
        1st/2nd spread against certified stocks with a decay curve fitted through it. We rebuilt it from the
        app&rsquo;s own per-contract archive. <strong>For arabica it holds, and strengthens.</strong> For
        robusta the pooled number looks usable and is <strong>carried entirely by the first half of the
        sample</strong> — since early 2024 the link has faded to nothing. A fitted curve through the pooled
        cloud would have hidden that completely. Each chart can be switched between the market&rsquo;s own
        unit and the spread as a share of the front price, which is what makes the two panels comparable at
        all.
      </P>

      {!ara && !rob && (
        <P className="text-slate-400">
          {d === false
            ? "The spread series could not be loaded, so nothing here is checked."
            : "Reading the contract archive…"}
        </P>
      )}

      {ara && rob && (
        <>
          <H2>1 · Method</H2>
          <UL>
            <LI><strong>Spread</strong> — front minus second nearby, from{" "}
              <Code>contract_prices_archive.json</Code>: five years of daily boards, every listed contract
              with price and open interest. Contracts are sorted by actual expiry, so the &ldquo;front&rdquo;
              is the nearest unexpired month rather than whatever the source happened to serialise first.
              Positive = backwardation. Note this is the <em>opposite</em> sign to the{" "}
              <Code>structure_*</Code> field on COT rows, which stores deferred minus front.</LI>
            <LI><strong>Stocks</strong> — last certified reading in each calendar month. Robusta publishes
              lots of 10 t; converted to 60-kg bags so both panels share a unit.</LI>
            <LI><strong>Monthly average, not month-end</strong> — the front contract&rsquo;s final days are
              thin and erratic, and one bad print would move a point meant to describe a whole month.</LI>
            <LI><strong>Two units, toggled on each chart</strong> — the market&rsquo;s own (c/lb, $/t) and the
              spread as a <em>share of the front price</em>. The absolute figure is what the trade quotes and
              what a broker chart shows, but it is not comparable across price regimes: 40 $/t with robusta at
              1,500 is a real carry and the same 40 $/t at 5,600 is noise, and an absolute axis plots them at
              the same height. It is also the only way these two panels can be read against each other, since
              c/lb and $/t cannot share a scale. The percentage is built from the <em>daily</em> ratio and then
              averaged, not from the month&rsquo;s average spread divided by its average price — the two differ
              whenever the price level moves inside the month. Both units are checked in the tables below,
              because a result that survives in only one of them is a result about the unit.</LI>
            <LI><strong>Rank correlation, no fitted curve</strong> — the relationship is curved, so a rank
              measure is the honest one. Fitting a decay line is a claim about functional form that this
              sample cannot support, and it is exactly what makes a broker scatter read as more settled
              than it is.</LI>
          </UL>

          <H2>2 · Arabica — the textbook holds</H2>
          <Chart m={ara} unit={ara.unit} mode={mode} onMode={setMode} />
          <Verdict a={ara.analysis} aPct={ara.analysis_pct} label="KC · Arabica" unit={ara.unit} />
          <P>
            Strongly negative across the whole sample, and <em>stronger</em> in the recent half than the
            early one. The shape is the expected one: the spread is flat and slightly negative wherever
            stocks are ample, and lifts sharply once stocks fall below roughly a million bags. The recent
            points sit at the steep end of that curve, which is the useful read — this is not a market
            sitting on the comfortable part of the relationship.
          </P>

          <H2>3 · Robusta — the relationship faded out</H2>
          <Chart m={rob} unit={rob.unit} mode={mode} onMode={setMode} />
          <Verdict a={rob.analysis} aPct={rob.analysis_pct} label="RC · Robusta" unit={rob.unit} />
          <Highlight>
            <strong>Read the halves, not the pooled number.</strong> Robusta&rsquo;s whole-sample
            correlation of <Code>{rob.analysis.spearman?.toFixed(3)}</Code> is the kind of figure that gets
            quoted as a weak-but-real relationship. It is not. It is{" "}
            <Code>{rob.analysis.first_half?.spearman?.toFixed(3)}</Code> in{" "}
            {rob.analysis.first_half?.span?.join("–")} and{" "}
            <Code>{rob.analysis.second_half?.spearman?.toFixed(3)}</Code> in{" "}
            {rob.analysis.second_half?.span?.join("–")}. The recent figure is positive, but it is small and
            not distinguishable from zero at this sample size — the claim it supports is that the
            relationship <em>went away</em>, not that it inverted. The two halves genuinely differ (a test on
            the difference between the two correlations returns p ≈ 0.0001), the result does not depend on
            where the sample is cut, and dropping any single month moves it by less than 0.07. It is also not
            an artifact of the unit: switch either chart to % of front price and the same split appears. What
            the recency colouring shows directly is that the recent points no longer sit on the historical
            cloud.
          </Highlight>
          <P>
            The decay is gradual rather than a break. Rolling 24-month windows run about −0.75, then −0.05,
            then +0.48 — and over the second half robusta certified stocks roughly doubled while the spread
            collapsed from a wide backwardation to roughly flat, which is two variables moving apart rather
            than one variable reversing its effect.
          </P>
          <P>
            A plausible reading, which this page does not claim to have tested: robusta certified stocks
            rebuilt hard off record lows through 2024–25 while the London curve stayed driven by Vietnamese
            origin flow rather than by what sat in exchange warehouses. Exchange stocks are a small and
            shrinking share of the robusta the world actually moves, so their information content about the
            curve can genuinely decay. Establishing that would need the origin-flow series alongside, and
            is a separate piece of work.
          </P>

          <H2>4 · What this does and does not license</H2>
          <UL>
            <LI><strong>Arabica</strong> — the stocks level is usable as context for the curve, and the
              recency colouring tells you whether today sits on the steep or the flat part.</LI>
            <LI><strong>Robusta</strong> — do not use it that way right now. The historical cloud describes
              a regime the market left in early 2024.</LI>
            <LI><strong>The two markets, side by side, only in %.</strong> Both boards have peaked at almost
              exactly the same backwardation in percentage terms over this sample — about 7% of the front
              price — at absolute numbers that look nothing alike (roughly 24 c/lb on KC late in the sample,
              roughly 205 $/t on RC in mid-2023) and in different years. Today they are at opposite ends of
              that same scale: arabica is at its own five-year percentage high while robusta sits near flat.
              Neither statement can be made from the c/lb and $/t axes.</LI>
            <LI><strong>Neither</strong> is a forecast. This is a contemporaneous relationship between two
              things measured in the same month; nothing here says stocks lead the spread.</LI>
            <LI><strong>Five years, not forty.</strong> The archive starts 2021-08. A longer sample would
              cover more regimes, and the split-half result above is a warning that regimes matter here.</LI>
          </UL>

          <P className="text-[10px] text-slate-500">
            Spread from <Code>data/contract_prices_archive.json</Code> (per-contract daily boards) via the{" "}
            <Code>front_spread</Code> exporter; stocks from the ICE certified-stock series. Every figure on
            this page is computed by the exporter and read here — the split-half check runs on each refresh
            rather than being a number typed once into prose.
          </P>
        </>
      )}
    </Paper>
  );
}
