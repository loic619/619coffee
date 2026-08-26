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

interface Point { month: string; stocks_k_bags: number; spread: number }
interface Analysis {
  n: number; spearman?: number | null;
  first_half?: { span: [string, string] | null; spearman: number | null };
  second_half?: { span: [string, string] | null; spearman: number | null };
  holds_in_both_halves?: boolean | null;
}
interface Mkt {
  label: string; unit: string; points: Point[]; analysis: Analysis;
  latest: { date: string; spread: number; front: string; second: string } | null;
}
interface Payload { sign_convention: string; markets: Record<string, Mkt> }

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

function Chart({ m, unit }: { m: Mkt; unit: string }) {
  const n = m.points.length;
  const rows = m.points.map((p, i) => ({ ...p, age: n - 1 - i }));
  const a = m.analysis;
  return (
    <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
        {m.label} — 1st/2nd spread vs certified stocks
      </div>
      <div className="mb-2 text-[10px] text-slate-500">
        Monthly average spread ({unit}, positive = backwardation) against end-month exchange stocks.
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
            <YAxis type="number" dataKey="spread" name="1/2 spread"
              tick={{ fontSize: 9, fill: "#64748b" }} width={52}
              label={{ value: `1/2 spread (${unit})`, angle: -90, position: "insideLeft",
                fill: "#64748b", fontSize: 10 }} />
            <ZAxis type="number" dataKey="z" range={[40, 300]} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "#475569" }}
              contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                borderRadius: 8, fontSize: 11 }}
              formatter={(v, name) => [
                name === "Certified stocks" ? fmtK(Number(v)) : Number(v).toFixed(1),
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
            {m.latest.spread >= 0 ? "+" : ""}{m.latest.spread} {unit}
          </span>{" "}
          — {m.latest.spread >= 0 ? "backwardation" : "contango"}.
        </div>
      )}
    </div>
  );
}

function Verdict({ a, label }: { a: Analysis; label: string }) {
  if (a.spearman == null) return null;
  const ok = a.holds_in_both_halves;
  return (
    <RefTable
      head={[label, "Sample", "Rank correlation"]}
      rows={[
        ["Whole sample", `${a.n} months`,
          <span key="f" className="font-semibold text-slate-200">{a.spearman.toFixed(3)}</span>],
        ["First half", a.first_half?.span?.join(" → ") ?? "—",
          <span key="1">{a.first_half?.spearman?.toFixed(3) ?? "—"}</span>],
        ["Second half", a.second_half?.span?.join(" → ") ?? "—",
          <span key="2" className={ok ? "" : "font-semibold text-amber-400"}>
            {a.second_half?.spearman?.toFixed(3) ?? "—"}
          </span>],
        [<strong key="v">Holds throughout?</strong>, "",
          <span key="vv" className={ok ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
            {ok ? "yes" : "no — see below"}
          </span>],
      ]}
    />
  );
}

export default function CertStocksSpread() {
  const [d, setD] = useState<Payload | null | false>(null);
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
        sample</strong> — since early 2024 the sign has flipped. A fitted curve through the pooled cloud
        would have hidden that completely.
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
            <LI><strong>Rank correlation, no fitted curve</strong> — the relationship is curved, so a rank
              measure is the honest one. Fitting a decay line is a claim about functional form that this
              sample cannot support, and it is exactly what makes a broker scatter read as more settled
              than it is.</LI>
          </UL>

          <H2>2 · Arabica — the textbook holds</H2>
          <Chart m={ara} unit={ara.unit} />
          <Verdict a={ara.analysis} label="KC · Arabica" />
          <P>
            Strongly negative across the whole sample, and <em>stronger</em> in the recent half than the
            early one. The shape is the expected one: the spread is flat and slightly negative wherever
            stocks are ample, and lifts sharply once stocks fall below roughly a million bags. The recent
            points sit at the steep end of that curve, which is the useful read — this is not a market
            sitting on the comfortable part of the relationship.
          </P>

          <H2>3 · Robusta — the relationship stopped</H2>
          <Chart m={rob} unit={rob.unit} />
          <Verdict a={rob.analysis} label="RC · Robusta" />
          <Highlight>
            <strong>Read the halves, not the pooled number.</strong> Robusta&rsquo;s whole-sample
            correlation of <Code>{rob.analysis.spearman?.toFixed(3)}</Code> is the kind of figure that gets
            quoted as a weak-but-real relationship. It is not. It is{" "}
            <Code>{rob.analysis.first_half?.spearman?.toFixed(3)}</Code> in{" "}
            {rob.analysis.first_half?.span?.join("–")} and{" "}
            <Code>{rob.analysis.second_half?.spearman?.toFixed(3)}</Code> in{" "}
            {rob.analysis.second_half?.span?.join("–")} — the sign flips. London stopped pricing its curve
            off exchange stocks, which is what the recency colouring on the chart above shows directly:
            the recent points do not sit on the historical cloud.
          </Highlight>
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
