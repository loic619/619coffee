"use client";
// The options book CFTC sees and this tab's cohort tables do not.
//
// Everything else on this page comes from the CFTC's FUTURES-ONLY
// disaggregated report. CFTC publishes a second file on the same schedule
// with the same cohort definitions — futures AND options, delta-adjusted by
// the exchange. The difference, per cohort, is the options position each
// group holds. Data: cot_options_book.json (sources/cftc_options_book.py →
// exporters/cot_options_book.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import SectionHeader from "./SectionHeader";
import { chgTone } from "@/lib/formatters";

interface Cohort {
  key: string; label: string;
  fut_net: number; com_net: number; opt_net: number;
  opt_long: number; opt_short: number;
  share_of_fut_pct: number | null; avg_abs_share_52w_pct: number | null;
  min_52w: number | null; max_52w: number | null;
}
interface Doc {
  generated_at: string; available: boolean; reason?: string;
  source?: string; note?: string;
  weeks?: number; span?: [string, string];
  latest?: { date: string; oi_fut: number; oi_com: number; oi_options: number; oi_options_pct: number | null } | null;
  cohorts: Cohort[];
  series: ({ date: string } & Record<string, number>)[];
}

const COLORS: Record<string, string> = {
  mm: "#0284c7", pmpu: "#059669", swap: "#8b5cf6", other: "#d97706", nonrept: "#64748b",
};
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const lots = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString()}`);

export default function Step9OptionsBook() {
  const [d, setD] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({ mm: true, pmpu: true, swap: true, other: false, nonrept: false });

  useEffect(() => {
    fetch("/data/cot_options_book.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j ? setD(j) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  const labels = useMemo(
    () => Object.fromEntries((d?.cohorts ?? []).map(c => [c.key, c.label])),
    [d]);

  if (failed) return null;
  if (!d) return <div className="bg-slate-900 rounded-lg h-40 animate-pulse" />;

  const mm = d.cohorts.find(c => c.key === "mm");

  return (
    <div id="cot-section-9">
      <SectionHeader icon="Scale" title="The options book"
        subtitle="Every cohort table above is futures-only. CFTC also publishes the same cohorts with options included, delta-adjusted — the difference is the options position each group holds." />

      {!d.available ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-[11px] text-slate-400">
          <div className="mb-1 font-semibold text-slate-300">Awaiting first fetch</div>
          {d.reason ?? "The combined-report fetch has not run yet."} Once it runs, this section fills in
          automatically — the cohort split, the trend, and how much of each group&rsquo;s position the
          futures-only tables miss.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Options OI not in the tables above</div>
              <div className="font-mono text-xl font-bold text-amber-400">{lots(d.latest?.oi_options)}</div>
              <div className="text-[10px] text-slate-500">
                {d.latest?.oi_options_pct}% of futures OI · week of {d.latest?.date}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Managed money — options net</div>
              <div className={`font-mono text-xl font-bold ${chgTone((mm?.opt_net ?? 0))}`}>
                {lots(mm?.opt_net)}
              </div>
              <div className="text-[10px] text-slate-500">
                {mm?.share_of_fut_pct != null ? `${mm.share_of_fut_pct}% of its futures net` : "—"} · vs
                {" "}{lots(mm?.fut_net)} futures
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Published history</div>
              <div className="font-mono text-xl font-bold text-slate-200">{d.weeks} wks</div>
              <div className="text-[10px] text-slate-500">{d.span?.[0]} → {d.span?.[1]}</div>
            </div>
          </div>

          <div className="mb-4 overflow-x-auto rounded-lg border border-slate-700 bg-slate-900 p-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-700 text-left text-[9px] uppercase tracking-wider text-slate-500">
                  <th className="py-1 pr-2">Cohort</th>
                  <th className="py-1 pr-2 text-right">Futures net</th>
                  <th className="py-1 pr-2 text-right">Combined net</th>
                  <th className="py-1 pr-2 text-right">Options net</th>
                  <th className="py-1 pr-2 text-right">Opt long / short</th>
                  <th className="py-1 pr-2 text-right">% of futures net</th>
                  <th className="py-1 pr-2 text-right">52w range</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {d.cohorts.map(c => (
                  <tr key={c.key}>
                    <td className="py-1 pr-2 font-sans font-semibold text-slate-200">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                            style={{ background: COLORS[c.key] ?? "#64748b" }} aria-hidden />
                      {c.label}
                    </td>
                    <td className="py-1 pr-2 text-right text-slate-300">{lots(c.fut_net)}</td>
                    <td className="py-1 pr-2 text-right text-slate-300">{lots(c.com_net)}</td>
                    <td className={`py-1 pr-2 text-right font-bold ${chgTone(c.opt_net)}`}>
                      {lots(c.opt_net)}
                    </td>
                    <td className="py-1 pr-2 text-right text-slate-500">{lots(c.opt_long)} / {lots(c.opt_short)}</td>
                    <td className="py-1 pr-2 text-right text-slate-300">
                      {c.share_of_fut_pct != null ? `${c.share_of_fut_pct}%` : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right text-slate-500">{lots(c.min_52w)} … {lots(c.max_52w)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-slate-500">
              Options net = combined − futures-only, in delta-equivalent lots, as CFTC attributes them. A positive
              number means that cohort is <em>more</em> long once its options are counted than the tables above show.
            </p>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
              Options net by cohort, weekly
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {d.cohorts.map(c => (
                <button key={c.key} onClick={() => setOn(o => ({ ...o, [c.key]: !o[c.key] }))}
                  className={`rounded border px-2 py-0.5 text-[10px] ${on[c.key]
                    ? "border-slate-600 bg-slate-800 text-slate-200"
                    : "border-transparent text-slate-500 hover:text-slate-300"}`}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                        style={{ background: on[c.key] ? (COLORS[c.key] ?? "#64748b") : "#334155" }} aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.series} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={56} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={56}
                    tickFormatter={(v: number) => v.toLocaleString()} />
                  <Tooltip contentStyle={tipStyle}
                    formatter={(v, n) => [lots(Number(v)), labels[String(n)] ?? String(n)]} />
                  <ReferenceLine y={0} stroke="#475569" />
                  {Object.keys(COLORS).filter(k => on[k]).map(k => (
                    <Line key={k} dataKey={k} stroke={COLORS[k]} dot={false} strokeWidth={1.6} name={k} connectNulls />
                  ))}
                  <Legend verticalAlign="bottom" height={22} iconSize={8}
                    formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{labels[n] ?? n}</span>} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[10px] italic text-slate-500">
              Read alongside the optionization study on the Research tab: it sized this book from our own strike
              archive at roughly a third of the managed-money net. This is the same quantity, attributed to cohorts
              by CFTC rather than left as one lump — and it is the part of positioning every futures-only table on
              this page is blind to.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
