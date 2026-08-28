"use client";
// Does Vietnam's mid-month customs bulletin represent half a month?
//
// The trade reads the "kỳ 1" (days 1-15) export figure as soon as it lands and
// doubles it. This measures whether that works rather than repeating it, and
// leads on DISPERSION — a mean of 0.50 built from 0.33 and 0.66 looks perfect
// in a headline and is useless in a position.
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line,
  ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

// Two marks, validated as a categorical pair against the panel surface
// (CVD ΔE 27.4 protan, 30.7 normal). RED is a STATUS, not a third series: it
// marks a month excluded from the statistics, and never encodes identity.
const C_DATA = "#3987e5";
const C_REF = "#c98500";
const C_EXCLUDED = "#e5484d";

interface Point {
  month: string; ratio: number | null; pct: number | null;
  k1_tonnes: number | null; full_tonnes: number | null;
  valid: boolean; defect: string | null; url: string | null;
}
interface YearRow { year: string; n: number; mean: number; median: number; min: number; max: number }
interface Bin { lo: number; hi: number; mid: number; count: number }
interface Stats {
  n?: number; mean?: number; median?: number; stdev?: number;
  min?: number; max?: number; spread?: number;
  tolerance?: number; within_tolerance?: number; within_tolerance_pct?: number;
  verdict?: string; excluded_n?: number;
  excluded?: { month: string; ratio: number | null; defect: string }[];
}
interface Payload {
  months_paired: number; months_missing_k1: string[];
  stats: Stats; points: Point[]; by_year: YearRow[]; histogram: Bin[]; bin_width: number;
}

type Axis = "month" | "year";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** Normal density scaled to expected counts per bin — a REFERENCE curve, not a
 *  fit. Drawn so the reader can see how far the 24 observations depart from the
 *  bell that "the mid-month share is about half, give or take" implies. */
function bellCurve(bins: Bin[], mean: number, sd: number, n: number, binW: number) {
  if (!sd) return bins.map(b => ({ ...b, expected: 0 }));
  return bins.map(b => {
    const z = (b.mid - mean) / sd;
    const density = Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
    return { ...b, expected: Number((density * n * binW).toFixed(3)) };
  });
}

export default function VnMidMonth() {
  const [d, setD] = useState<Payload | null | false>(null);
  const [axis, setAxis] = useState<Axis>("month");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Payload>("/data/vn_midmonth.json")
      .then(p => { if (alive) setD(p); })
      .catch(() => { if (alive) setD(false); });
    return () => { alive = false; };
  }, []);

  const s: Stats = d ? d.stats : {};
  const meanPct = s.mean != null ? s.mean * 100 : null;

  const monthRows = useMemo(
    () => (d ? d.points.map(p => ({ ...p, label: p.month })) : []), [d]);

  // A year is drawn as its RANGE with the mean marked, never as a lone dot.
  // Averaging twelve months into one point is exactly the move that makes a
  // variable series look settled — the thing this study exists to disprove.
  const yearRows = useMemo(
    () => (d ? d.by_year.map(y => ({
      label: y.year, n: y.n,
      meanPct: Number((y.mean * 100).toFixed(2)),
      minPct: Number((y.min * 100).toFixed(2)),
      maxPct: Number((y.max * 100).toFixed(2)),
      err: [Number(((y.mean - y.min) * 100).toFixed(2)),
            Number(((y.max - y.mean) * 100).toFixed(2))] as [number, number],
    })) : []), [d]);

  const hist = useMemo(
    () => (d && s.mean != null && s.stdev != null && s.n
      ? bellCurve(d.histogram, s.mean, s.stdev, s.n, d.bin_width)
      : []), [d, s.mean, s.stdev, s.n]);

  const excluded = s.excluded ?? [];

  return (
    <Paper
      tone="amber"
      updated="2026-08-28"
      kicker="Vietnam · Customs bulletins"
      title="Is the mid-month customs number half a month?"
      subtitle="Vietnam publishes a first-half export bulletin two weeks before the month closes. The trade doubles it. Twenty-four paired months say what that actually costs you"
    >
      <P>
        <strong>Abstract.</strong> Vietnam Customs publishes a &ldquo;kỳ 1&rdquo; bulletin covering days
        1&ndash;15, roughly a fortnight before the full month lands. The standing assumption is that you
        double it. Pairing every first-half coffee figure we could retrieve against the full month that
        followed, the first half averages <strong>{meanPct != null ? `${meanPct.toFixed(1)}%` : "—"}</strong> of
        the month &mdash; not half, and reliably <em>below</em> half. But the average is not the useful part:
        the share ranges {pct(s.min != null ? s.min * 100 : null)}&ndash;{pct(s.max != null ? s.max * 100 : null)},
        and doubling would have landed within {s.tolerance ? `${(s.tolerance * 100).toFixed(0)}%` : "10%"} of
        the eventual month in only <strong>{s.within_tolerance_pct ?? "—"}%</strong> of months.
      </P>

      {!d && (
        <P className="text-slate-400">
          {d === false ? "The study payload could not be loaded." : "Reading the study…"}
        </P>
      )}

      {d && (
        <>
          <H2>1 · Method</H2>
          <UL>
            <LI><strong>First half</strong> — the coffee row, in tonnes, from each month&rsquo;s
              <Code>1X</Code> fortnight export bulletin on <Code>files.customs.gov.vn</Code>. Note the report
              type: <Code>1X</Code> is <em>biểu 1</em>, the fortnight table. <Code>2x</Code> is the monthly
              by-commodity table and a different document entirely.</LI>
            <LI><strong>Full month</strong> — the figure the app already scrapes, untouched by this study.</LI>
            <LI><strong>Ratio</strong> — first half ÷ full month, per data month. A uniform flow would sit
              at 50%.</LI>
            <LI><strong>Nothing is hidden.</strong> Every month the crawl paired appears on the chart below,
              including one that is arithmetically impossible. It is drawn, marked, and excluded from every
              statistic — see §4.</LI>
          </UL>

          <H2>2 · The first-half share, month by month</H2>
          <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                First half as a share of the full month
              </div>
              <div className="flex items-center gap-1">
                {(["month", "year"] as Axis[]).map(a => (
                  <button key={a} type="button" onClick={() => setAxis(a)}
                    aria-pressed={axis === a}
                    className={`rounded border px-2 py-0.5 text-[10px] transition ${
                      axis === a
                        ? "border-sky-500 bg-sky-600 font-semibold text-slate-950"
                        : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
                    {a === "month" ? "by month" : "by year"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-2 text-[10px] text-slate-500">
              {axis === "month"
                ? `${d.months_paired} paired months. The dashed line is the 50% the "double it" rule assumes.`
                : "Each bar is a year's mean; the whisker is its full observed range. A year is not one number."}
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                {axis === "month" ? (
                  <BarChart data={monthRows} margin={{ top: 8, right: 38, bottom: 34, left: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }}
                      angle={-60} textAnchor="end" height={46} interval={0} />
                    <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: "share of full month", angle: -90, position: "insideLeft",
                        fill: "#64748b", fontSize: 10 }} />
                    <ReferenceLine y={50} stroke="#64748b" strokeDasharray="4 3"
                      label={{ value: "50%", fill: "#94a3b8", fontSize: 9, position: "right" }} />
                    {/* No inline label: the mean sits within 3 points of the 50%
                        line, so two labels there collide and clip each other.
                        The value rides on the legend swatch instead. */}
                    {meanPct != null && (
                      <ReferenceLine y={meanPct} stroke={C_REF} strokeDasharray="2 2" />
                    )}
                    <Tooltip
                      cursor={{ fill: "#1e293b55" }}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                        borderRadius: 8, fontSize: 11 }}
                      formatter={(v, _n, item) => {
                        const p = item?.payload as Point;
                        return [`${Number(v).toFixed(1)}%  (${(p.k1_tonnes ?? 0).toLocaleString()} of ${(p.full_tonnes ?? 0).toLocaleString()} t)${p.valid ? "" : " — EXCLUDED"}`,
                          "first half"];
                      }} />
                    <Bar dataKey="pct" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {monthRows.map(r => (
                        <Cell key={r.month} fill={r.valid ? C_DATA : C_EXCLUDED}
                          fillOpacity={r.valid ? 0.9 : 0.35}
                          stroke={r.valid ? "none" : C_EXCLUDED} strokeWidth={1.5}
                          strokeDasharray={r.valid ? undefined : "3 2"} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={yearRows} margin={{ top: 8, right: 38, bottom: 18, left: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44} domain={[0, 70]}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: "share of full month", angle: -90, position: "insideLeft",
                        fill: "#64748b", fontSize: 10 }} />
                    <ReferenceLine y={50} stroke="#64748b" strokeDasharray="4 3"
                      label={{ value: "50%", fill: "#94a3b8", fontSize: 9, position: "right" }} />
                    <Tooltip
                      cursor={{ fill: "#1e293b55" }}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                        borderRadius: 8, fontSize: 11 }}
                      formatter={(v, _n, item) => {
                        const y = item?.payload as typeof yearRows[number];
                        return [`mean ${Number(v).toFixed(1)}%  ·  range ${y.minPct.toFixed(1)}–${y.maxPct.toFixed(1)}%  ·  n=${y.n}`,
                          "year"];
                      }} />
                    <Bar dataKey="meanPct" fill={C_DATA} fillOpacity={0.9}
                      radius={[4, 4, 0, 0]} maxBarSize={90} isAnimationActive={false}>
                      <ErrorBar dataKey="err" width={7} strokeWidth={2} stroke={C_REF} />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: C_DATA }} />
                {axis === "month" ? "paired month" : "year mean"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: C_REF }} />
                {axis === "month"
                  ? `mean of valid months${meanPct != null ? ` (${meanPct.toFixed(1)}%)` : ""}`
                  : "observed range"}
              </span>
              {axis === "month" && excluded.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm border border-dashed"
                    style={{ borderColor: C_EXCLUDED, background: `${C_EXCLUDED}59` }} />
                  excluded — impossible value
                </span>
              )}
            </div>
          </div>

          <H2>3 · The distribution</H2>
          <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
              How the {s.n ?? 0} valid months fall — against the bell they would make if normal
            </div>
            <div className="mb-2 text-[10px] text-slate-500">
              Bars are observed counts in {((d.bin_width ?? 0.05) * 100).toFixed(0)}-point bins. The line is a
              normal curve on the sample&rsquo;s own mean and standard deviation — a <em>reference</em>, not a
              fit. With {s.n ?? 0} observations, this shows where the months sit; it does not establish that
              they are normally distributed.
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hist} margin={{ top: 20, right: 16, bottom: 22, left: 0 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="mid" type="number" domain={[0.25, 0.75]}
                    ticks={[0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75]}
                    tick={{ fontSize: 9, fill: "#64748b" }}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    label={{ value: "first half as a share of the month", position: "insideBottom",
                      offset: -12, fill: "#64748b", fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} width={30}
                    label={{ value: "months", angle: -90, position: "insideLeft",
                      fill: "#64748b", fontSize: 10 }} />
                  <ReferenceLine x={0.5} stroke="#64748b" strokeDasharray="4 3"
                    label={{ value: "50%", fill: "#94a3b8", fontSize: 9, position: "top" }} />
                  <Tooltip
                    cursor={{ fill: "#1e293b55" }}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                      borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v) => {
                      const b = hist.find(x => x.mid === v);
                      return b ? `${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}%` : "";
                    }}
                    formatter={(v, n) => [Number(v).toFixed(n === "observed" ? 0 : 2), String(n)]} />
                  <Bar dataKey="count" name="observed" fill={C_DATA} fillOpacity={0.9}
                    radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Line dataKey="expected" name="normal reference" stroke={C_REF} strokeWidth={2}
                    dot={{ r: 3, fill: C_REF }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: C_DATA }} />observed months
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-0.5 rounded-sm" style={{ background: C_REF, height: 2, width: 12 }} />
                normal reference (same mean and σ)
              </span>
            </div>
          </div>

          <RefTable
            head={["First-half share", "Value", "What it means"]}
            rows={[
              ["Mean", pct(meanPct),
                "Below half, not at it — the second half of the month carries more."],
              ["Median", pct(s.median != null ? s.median * 100 : null), "Close to the mean; no strong skew."],
              ["Std deviation", pct(s.stdev != null ? s.stdev * 100 : null),
                "The number that decides whether doubling is usable."],
              ["Range", `${pct(s.min != null ? s.min * 100 : null)} – ${pct(s.max != null ? s.max * 100 : null)}`,
                "A near-two-to-one spread between the thinnest and fullest first halves."],
              ["Doubling within ±10%", `${s.within_tolerance ?? "—"} of ${s.n ?? "—"} months`,
                `Right about ${s.within_tolerance_pct ?? "—"}% of the time — roughly a coin toss.`],
            ]}
          />

          <Highlight>
            <strong>Doubling the mid-month number is not a forecast.</strong> The first half runs{" "}
            {meanPct != null ? `${meanPct.toFixed(1)}%` : "—"} of the month on average, so doubling is
            biased high before any variance enters. Then the variance: the share has run as low as{" "}
            {pct(s.min != null ? s.min * 100 : null)} and as high as {pct(s.max != null ? s.max * 100 : null)},
            and doubling landed within ±10% of the eventual month in {s.within_tolerance_pct ?? "—"}% of cases.
            The bulletin is genuinely early information about <em>direction and rough scale</em>. It is not a
            month.
          </Highlight>

          <H2>4 · The month we excluded, and why</H2>
          {excluded.length === 0 ? (
            <P>No month failed the structural check on this run.</P>
          ) : (
            <>
              <P>
                Days 1&ndash;15 are a subset of the month, so a first-half tonnage cannot exceed the full
                month&rsquo;s. That is arithmetic, not a plausibility band — and one month breaks it:
              </P>
              <RefTable
                head={["Month", "Implied share", "Why it cannot be right"]}
                rows={excluded.map(e => [
                  e.month,
                  <span key={e.month} className="font-semibold text-rose-400">
                    {e.ratio != null ? `${(e.ratio * 100).toFixed(1)}%` : "—"}
                  </span>,
                  e.defect,
                ])}
              />
              <P>
                It is left on the chart in §2, outlined and marked, rather than deleted. It matters more than
                one bad point normally would: including it moved the mean from{" "}
                <Code>{meanPct != null ? `${meanPct.toFixed(1)}%` : "—"}</Code> to <Code>50.0%</Code> —
                landing on precisely the &ldquo;half a month&rdquo; answer the study set out to test, which is
                the most quotable and most wrong result it could have produced — while inflating the standard
                deviation from <Code>{pct(s.stdev != null ? s.stdev * 100 : null)}</Code> to{" "}
                <Code>15.7%</Code> and so concealing how consistent the real series is. One impossible value
                faked the headline and hid the finding at the same time.
              </P>
              <P>
                The source file is the correct one for its month, so this is a parsing failure on that
                bulletin rather than the wrong document, and it is not yet diagnosed. Until it is, the month
                stays excluded and visible.
              </P>
            </>
          )}

          <H2>5 · What this does and does not license</H2>
          <UL>
            <LI><strong>Usable</strong> — as an early read on whether a month is running heavy or light
              against the same month last year, where both sides are first halves and the bias cancels.</LI>
            <LI><strong>Not usable</strong> — as a month. Doubling is biased high and right about half the
              time, which is not a basis for a position.</LI>
            <LI><strong>Sample</strong> — {s.n ?? 0} valid paired months
              {d.months_missing_k1.length > 0 && <>; {d.months_missing_k1.join(", ")} had no retrievable
                first-half bulletin</>}. The limit is the full-month series, not the bulletins: the portal
              lists them back years, and pairing needs both sides.</LI>
            <LI><strong>Not seasonality.</strong> {s.n ?? 0} months is one to two observations per calendar
              month — nowhere near enough to claim a month-of-year pattern, however tempting the chart looks.</LI>
          </UL>

          <P className="text-[10px] text-slate-500">
            First-half figures from the <Code>1X</Code> fortnight export bulletins on files.customs.gov.vn via{" "}
            <Code>research_vn_midmonth</Code>; full-month figures from the existing Vietnam export scraper,
            unmodified. Every statistic on this page is computed by the exporter and read here.
          </P>
        </>
      )}
    </Paper>
  );
}
