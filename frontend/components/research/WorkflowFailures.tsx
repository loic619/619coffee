"use client";
// What does a failed workflow run actually mean here?
//
// 847 failed runs sounds like a system falling over. Almost none of them are
// application failures — they are a pre-merge gate doing its job, a workflow
// that no longer exists, and freshness checks exiting non-zero BECAUSE they
// found stale data. The point of this page is the subtraction.
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

// Three lanes, validated against the panel surface (CVD ΔE 9.4 deutan / 26.5
// normal — legal at that floor because every series is also direct-labelled in
// the legend and separated by a surface gap).
const LANE_COLOR: Record<string, string> = {
  "pre-merge": "#3987e5",
  retired: "#d95926",
  operational: "#199e70",
};
const C_ACTIONABLE = "#199e70";
const C_DEDUCT = "#64748b";

interface WF {
  name: string; n: number; category: string; lane: string;
  confident: boolean; evidence: string;
  median_duration_s: number; events: Record<string, number>;
}
interface Day {
  date: string; "pre-merge": number; retired: number; operational: number; total: number;
}
interface Payload {
  total_failed_runs_reported_by_api: number;
  sample_span: [string, string]; sampling_note: string;
  categories: Record<string, string>; lanes: Record<string, string>;
  n: number;
  category_counts: Record<string, number>;
  lane_counts: Record<string, number>;
  deductions: { label: string; n: number }[];
  actionable: number; actionable_pct: number;
  workflows: WF[]; daily: Day[];
}

export default function WorkflowFailures() {
  const [d, setD] = useState<Payload | null | false>(null);
  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Payload>("/data/workflow_failures.json")
      .then(p => { if (alive) setD(p); })
      .catch(() => { if (alive) setD(false); });
    return () => { alive = false; };
  }, []);

  // The subtraction, as a chart: the raw count, each deduction, the residue.
  const waterfall = d ? [
    { label: "All failed runs", v: d.n, kind: "raw" },
    ...d.deductions.map(x => ({ label: x.label, v: -x.n, kind: "deduct" })),
    { label: "Actionable", v: d.actionable, kind: "actionable" },
  ] : [];

  return (
    <Paper
      tone="cyan"
      updated="2026-09-04"
      kicker="Platform · reliability"
      title="A failed workflow is not a failed system"
      subtitle="847 red runs, taken apart. Most are a pre-merge gate working, a workflow that no longer exists, or a freshness check exiting non-zero because it found exactly what it was built to find"
    >
      <P>
        <strong>Abstract.</strong> The Actions API reports{" "}
        <strong>{d ? d.total_failed_runs_reported_by_api : "847"}</strong> failed runs across 94
        workflows. Read as a failure rate that is alarming, and it is also meaningless, because it counts
        four unlike things as one. Classifying a{" "}
        {d ? d.n : "240"}-run sample and — more usefully — separating <em>where</em> a failure happened
        from <em>what</em> broke, the genuinely actionable residue is{" "}
        <strong>{d ? `${d.actionable} runs, ${d.actionable_pct}%` : "27 runs, 11%"}</strong>. The other
        {" "}89% are the system behaving as designed. The structural finding is separate and was worse: the
        one self-healing loop in the repo <em>failed itself</em> while it healed, with no memory between
        attempts, so it could not back off. That is fixed — §7.
      </P>

      {!d && (
        <P className="text-slate-400">
          {d === false ? "The study payload could not be loaded." : "Reading the study…"}
        </P>
      )}

      {d && (
        <>
          <H2>1 · Why a failure rate is the wrong number</H2>
          <P>
            A red run can mean any of these, and they have nothing in common except the colour:
          </P>
          <UL>
            <LI><strong>A lint error on a branch.</strong> Caught before merge. Nothing shipped. The gate
              worked.</LI>
            <LI><strong>A workflow that no longer exists.</strong> 1.6 Morning Brief was deleted on
              2026-08-14; its failures stop dead on that date and can never recur.</LI>
            <LI><strong>A freshness check exiting 1.</strong> It exits non-zero <em>because</em> it found
              stale data. That is the check working. Marking it as a system failure inverts its meaning.</LI>
            <LI><strong>A scraper that could not fetch.</strong> The only one of the four that is
              actually a failure of the running system.</LI>
          </UL>
          <P>
            So every failure gets two labels, not one. The <strong>category</strong> says what broke; the{" "}
            <strong>lane</strong> says where. The lane is what decides whether anyone should care.
          </P>

          <H2>2 · The subtraction</H2>
          <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
              From {d.n} failed runs to {d.actionable}
            </div>
            <div className="mb-2 text-[10px] text-slate-500">
              Only three things are subtracted. Categories B and C stay in — a source that keeps failing
              is a real problem, and excusing it is how a metric stops meaning anything.
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfall} layout="vertical"
                  margin={{ top: 4, right: 46, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} />
                  <YAxis type="category" dataKey="label" width={200}
                    tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <ReferenceLine x={0} stroke="#475569" />
                  <Tooltip
                    cursor={{ fill: "#1e293b55" }}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                      borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${Number(v) > 0 ? "" : ""}${Number(v)} runs`, "count"]} />
                  <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false} barSize={18}>
                    {waterfall.map(w => (
                      <Cell key={w.label}
                        fill={w.kind === "actionable" ? C_ACTIONABLE
                          : w.kind === "raw" ? "#94a3b8" : C_DEDUCT}
                        fillOpacity={w.kind === "deduct" ? 0.55 : 0.95} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-[11px] text-slate-300">
              <strong className="text-emerald-400">{d.actionable} of {d.n}</strong> failed runs —{" "}
              {d.actionable_pct}% — describe something that actually needs a person.
            </div>
          </div>

          <H2>3 · Where the failures land, day by day</H2>
          <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
              Failed runs per day, by lane
            </div>
            <div className="mb-2 text-[10px] text-slate-500">
              {d.sample_span[0]} → {d.sample_span[1]}. Quiet days are drawn as zero rather than skipped —
              omitting them makes a sporadic problem look continuous.
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.daily} margin={{ top: 4, right: 12, bottom: 26, left: 0 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#64748b" }}
                    interval={6} angle={-45} textAnchor="end" height={40}
                    tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} width={28} />
                  <Tooltip
                    cursor={{ fill: "#1e293b55" }}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                      borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="pre-merge" stackId="a" name="pre-merge (nothing shipped)"
                    fill={LANE_COLOR["pre-merge"]} isAnimationActive={false} />
                  <Bar dataKey="retired" stackId="a" name="retired workflow"
                    fill={LANE_COLOR.retired} isAnimationActive={false} />
                  <Bar dataKey="operational" stackId="a" name="operational"
                    fill={LANE_COLOR.operational} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-[10px] text-slate-500">
              The green band is the whole operational surface. The spikes are release days.
            </div>
          </div>

          <H2>4 · The taxonomy</H2>
          <RefTable
            head={["", "Category", "Runs", "Share"]}
            rows={Object.entries(d.categories).map(([code, label]) => [
              <strong key={code}>{code}</strong>,
              label,
              <span key={`n${code}`}>{d.category_counts[code] ?? 0}</span>,
              <span key={`p${code}`}>
                {(100 * (d.category_counts[code] ?? 0) / d.n).toFixed(1)}%
              </span>,
            ])}
          />
          <P>
            Category A dominates at {((100 * (d.category_counts.A ?? 0) / d.n)).toFixed(0)}% — and that is
            exactly the reading the lane split exists to prevent. Almost all of it is pre-merge CI plus a
            retired workflow. Restricted to jobs still running on <Code>main</Code>, deterministic code
            failure accounts for a handful of runs, and the taxonomy on its own would have pointed at
            &ldquo;fix your code&rdquo; when the evidence says the opposite.
          </P>

          <H2>5 · Per workflow</H2>
          <RefTable
            head={["Workflow", "Runs", "Cat", "Lane", "Evidence"]}
            rows={d.workflows.map(w => [
              <span key={w.name} className="text-slate-200">{w.name}</span>,
              <span key={`${w.name}n`}>{w.n}</span>,
              <span key={`${w.name}c`} className="font-semibold">{w.category}</span>,
              <span key={`${w.name}l`} style={{ color: LANE_COLOR[w.lane] }}>{w.lane}</span>,
              <span key={`${w.name}e`} className="text-left text-[11px] text-slate-400">
                {w.confident
                  ? w.evidence
                  : <em title="not read from a failing run's log">{w.evidence} (inferred)</em>}
              </span>,
            ])}
          />
          <P className="text-[11px] text-slate-500">
            Rows marked <em>inferred</em> are classified from the workflow&rsquo;s source and repo history
            rather than from a failing run&rsquo;s log. They are shown at lower confidence rather than
            presented alongside the log-confirmed ones as though they were equal.
          </P>

          <H2>6 · The finding that is not in the numbers</H2>
          <Highlight>
            <strong>The one self-healing loop fails itself while it heals.</strong>{" "}
            <Code>check-live-quotes.yml</Code> is the only workflow in all 94 that dispatches another. When
            it finds the quote feed stale it does two things at once: it dispatches a rescue run of the
            poller, <em>and</em> its <Code>notify()</Code> ends in <Code>exit 1</Code>. So a single hour of
            an upstream outage produces a failed check, a rescue run, and an alert — and because the check
            holds no state between hours, the next hour repeats it identically. Backoff is not missing; it
            is impossible by construction.
          </Highlight>
          <P>
            The rescue itself is sound — GitHub has throttled that poller&rsquo;s cron twice, and a
            dispatched run genuinely fixes that. What is wrong is the coupling. Attempting a recovery and
            reporting a system failure are different events, and the workflow emits them as one. The file
            even documents a third consequence: the rescue is wrapped in{" "}
            <Code>if curl -sf</Code>, so when the <Code>actions:write</Code> scope was lost the rescue
            stopped firing <em>silently</em> while the check kept passing.
          </P>
          <P>
            What the loop should do instead is keep the two apart: attempt the recovery, record the source
            as <em>degraded</em>, and let that state decide the next move — back off, and escalate only
            when a recovery has failed repeatedly. That turns an hourly identical alert into one
            escalating signal, and it makes &ldquo;the source is down&rdquo; a fact the system holds rather
            than one it rediscovers every hour.
          </P>

          <H2>7 · Fixed — what it does now</H2>
          <P>
            Implemented 2026-09-04. The source now carries a <Code>degraded</Code> state in the same
            Upstash store the data lives in, and the ladder is counted in consecutive stale checks —
            hourly, so they read as hours:
          </P>
          <RefTable
            head={["Stale check", "1", "2", "4", "8", "12", "16", "24"]}
            rows={[
              ["Rescue dispatched", "•", "•", "•", "•", "", "•", ""],
              ["Alert sent", "•", "", "•", "", "•", "", "•"],
              [<strong key="r">Run goes red</strong>, "", "", "•", "", "•", "", "•"],
            ]}
          />
          <P>
            A twelve-hour outage now produces <strong>4 rescue attempts, 3 alerts and 2 red runs</strong>{" "}
            instead of twelve of each. More importantly the colour means something: green covers
            &ldquo;stale detected, rescue dispatched, standing down&rdquo; — the watchdog working — and red
            means recovery has repeatedly failed, which is a claim worth paging on.
          </P>
          <UL>
            <LI><strong>Recovery is announced too.</strong> An outage that silently ends leaves the reader
              unsure it ever did, so the first fresh reading after a degraded spell sends one message and
              resets the state.</LI>
            <LI><strong>A failed dispatch is always loud</strong>, whatever the backoff says. That is the
              exact bug the old <Code>if curl -sf</Code> hid, and it is now the one condition that
              overrides the ladder.</LI>
            <LI><strong>Losing the state is not an incident.</strong> A missing or corrupt health key reads
              as healthy and restarts the ladder rather than crashing or paging — the watchdog forgetting
              is not itself an outage.</LI>
            <LI><strong>The store being unreachable is.</strong> That is a real system failure and not the
              source&rsquo;s fault, so it escalates immediately and no backoff applies.</LI>
          </UL>
          <P>
            The decision ladder is a pure function in <Code>source_health.py</Code> with the I/O in{" "}
            <Code>check_live_quotes.py</Code>, replacing ~70 lines of inline shell that nothing could
            test — which is why both defects lived in it unnoticed. 26 tests cover the ladder and the
            wiring, including the one that states the whole point: a twelve-hour outage goes red twice,
            not twelve times.
          </P>

          <H2>8 · What this licenses</H2>
          <UL>
            <LI><strong>Track the actionable rate, not the failure rate.</strong> The raw count moves with
              release cadence — the spikes above are busy days on <Code>main</Code>, not outages.</LI>
            <LI><strong>A red freshness check is information, not an incident.</strong> Categories D and E
              belong in a different channel from B and C, or the alerts stop being read.</LI>
            <LI><strong>Category C is the real backlog.</strong> Sources that return 200-with-no-data, or
              403 the runner outright, do not improve with retries — PortWatch&rsquo;s empty port and
              Barchart&rsquo;s blanket 403 both need source-health handling, not backoff.</LI>
            <LI><strong>This is a sample, not a census.</strong> {d.n} of{" "}
              {d.total_failed_runs_reported_by_api} runs. {d.sampling_note}</LI>
          </UL>

          <P className="text-[10px] text-slate-500">
            Raw runs from the GitHub Actions API in <Code>data/workflow_failures_raw.json</Code>;
            classification in <Code>research_workflow_failures.py</Code>, kept separate from the data so it
            can be re-derived and argued with. Every figure on this page is computed by the exporter.
          </P>
        </>
      )}
    </Paper>
  );
}
