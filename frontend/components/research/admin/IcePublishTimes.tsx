"use client";
import { H, H2, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "../methodology/prose";
import { useFetchJson } from "@/lib/useFetchJson";

interface Payload {
  captures: number;
  first_date: string | null;
  last_date: string | null;
  earliest: string | null;
  latest: string | null;
  median: string | null;
  p90: string | null;
  distinct_seconds: number;
  seconds_seen_more_than_once: number;
  by_minute: { minute: string; count: number; share: number }[];
  cumulative: { through: string; share: number }[];
  sweep: {
    window: string; candidate_seconds: number; interval_s: number;
    tier1_k: number; observed_max_offset_s: number | null; days_inside_window: number;
  };
  misses: {
    business_days: number;
    captured: number;
    missing: { date: string; weekday: string; data_hole: boolean }[];
    by_weekday: Record<string, { missing: number; of: number }>;
  };
  runs: {
    count: number;
    note: string | null;
    outcomes: Record<string, number>;
    billed_minutes_total: number;
    billed_minutes_mean: number;
    with_telemetry: number;
    recent: {
      date: string; event: string | null; outcome: string;
      billed_minutes: number | null; last_step: string | null;
      telemetry: {
        http_429: number | null;
        wait_publicdocs_s: number | null;
        wait_marketdata_s: number | null;
        wait_retry_after_s: number | null;
      } | null;
    }[];
  };
  rate_limits: {
    runs: number; note?: string;
    runs_with_429?: number; total_429?: number; total_retry_after_s?: number;
    worst_retry_after_s?: number; runs_aborted_by_429?: number;
    runs_resumed?: number; median_sweep_gets?: number;
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/60 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-base font-bold text-slate-100 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-px">{sub}</div>}
    </div>
  );
}

export default function IcePublishTimes() {
  const { data, error } = useFetchJson<Payload>("/data/ice_publish_times.json");

  if (error || !data) {
    return (
      <P>
        {error
          ? "ice_publish_times.json could not be loaded."
          : "Loading the publish-time record…"}
      </P>
    );
  }

  const max = Math.max(...data.by_minute.map((m) => m.count), 1);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  // Seconds from the window's 10:30 start to the median publish — the position
  // an ascending sweep has to walk to on a typical day.
  const hms = (t: string) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };
  const medianOffset = data.median ? hms(data.median) - (10 * 3600 + 30 * 60) : 0;

  return (
    <>
      <P>
        The London robusta certified-stock CSV is served under a filename stamped with the exact
        second it was generated — <Code>RobustaStockReport_YYYYMMDD_HHMMSS.csv</Code>. There is no
        index and no <em>latest</em> alias, so the only way to fetch it is to already know that
        second. This page is the record of every second we have found so far, because that
        distribution is what decides how long workflow 1.13 runs — and therefore what it costs.
      </P>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-4">
        <Stat label="captures" value={String(data.captures)}
              sub={`${data.first_date} → ${data.last_date}`} />
        <Stat label="median" value={data.median ?? "—"} sub={`p90 ${data.p90 ?? "—"}`} />
        <Stat label="range" value={`${data.earliest ?? "—"}`} sub={`to ${data.latest ?? "—"}`} />
        <Stat label="distinct seconds" value={String(data.distinct_seconds)}
              sub={`${data.seconds_seen_more_than_once} seen twice`} />
      </div>

      <H2>The distribution</H2>
      <P>
        Each bar is one minute of the publish window; the count is how many business days landed
        in it.
      </P>
      <div className="my-3 space-y-1">
        {data.by_minute.map((m) => (
          <div key={m.minute} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-400 w-12 shrink-0 tabular-nums">
              {m.minute}
            </span>
            <span className="flex-1 h-3 bg-slate-800 rounded-sm overflow-hidden">
              <span className="block h-full bg-amber-500/70 rounded-sm"
                    style={{ width: `${(m.count / max) * 100}%` }} />
            </span>
            <span className="font-mono text-[11px] text-slate-500 w-16 shrink-0 text-right tabular-nums">
              {m.count} · {pct(m.share)}
            </span>
          </div>
        ))}
      </div>

      <H>What the shape means</H>
      <P>
        Publication is heavily front-loaded but has a long right tail. Cumulatively:
      </P>
      <RefTable
        head={["by", "of publishes seen"]}
        rows={data.cumulative
          .filter((_, i) => i < 8 || i === data.cumulative.length - 1)
          .map((c) => [c.through, pct(c.share)])}
      />

      <Highlight>
        The publish <em>minute</em> is highly predictable — {pct(data.cumulative[2]?.share ?? 0)} of
        days are done by 10:32. The publish <em>second</em> is not: {data.distinct_seconds} distinct
        seconds across {data.captures} captures, with only {data.seconds_seen_more_than_once} ever
        repeating. That single fact is the whole cost story.
      </Highlight>

      <H2>Why this costs money</H2>
      <P>
        Because concurrency is impossible here, the scraper guesses sequentially. ICE&rsquo;s
        <Code>/marketdata/</Code> host answers any parallelism with a 429 — two simultaneous GETs
        once drew a <Code>Retry-After: 3600</Code> that wiped an entire run — so requests go out one
        at a time, {data.sweep.interval_s}s apart.
      </P>
      <UL>
        <LI>
          <strong>Tier 1</strong> retries the {data.sweep.tier1_k} most-frequent seconds, each
          widened ±2s. Since the second is near-unique, this catches roughly a third of days.
        </LI>
        <LI>
          <strong>Tier 2</strong> sweeps the window {data.sweep.window} second by second —{" "}
          {data.sweep.candidate_seconds.toLocaleString()} candidates, ascending, stopping the moment
          one returns 200.
        </LI>
      </UL>
      <P>
        The sweep ascends from 10:30, so it exploits the front-loading automatically: a median day
        sits {medianOffset}s into the window, so it is found after about{" "}
        {Math.round((medianOffset * data.sweep.interval_s) / 60)} minutes of GETs. The tail is what
        hurts — the latest day on record is {data.sweep.observed_max_offset_s}s in, roughly{" "}
        {Math.round(((data.sweep.observed_max_offset_s ?? 0) * data.sweep.interval_s) / 60)} minutes
        of billed runner time to reach, every one of them spent waiting politely.
      </P>

      <H>A correction — the sweep cannot cover the real range</H>
      <P>
        An earlier version of this page concluded the search was near-optimal, from a model of
        four strategies against the captured days. That conclusion was wrong, and wrong in an
        instructive way: <strong>it was fitted only to the days the search succeeded on.</strong>{" "}
        The days it failed were, by construction, invisible to it — survivorship bias in its
        purest form.
      </P>
      <P>
        Supplying the three missed days&rsquo; true publish times changed the picture entirely.
        Each failed for a different reason, and none of them is a tuning problem:
      </P>
      <RefTable
        head={["date", "published", "vs the 10:30–11:15 window", "why it was missed"]}
        rows={[
          ["2026-06-10", "10:29:56", "4s BEFORE it opens",
            "the window starts too late — by four seconds"],
          ["2026-08-18", "11:00:55", "inside, 1,855s in",
            "reaching it needs 124 min of sweeping; the job times out at 120"],
          ["2026-06-29", "12:47:15", "92 min AFTER it closes",
            "outside any window a linear sweep could walk"],
        ]}
      />
      <Highlight>
        With those three included the true observed range is <strong>10:29:56 → 12:47:15</strong> —
        8,239 candidate seconds. A linear sweep of that at 4s per request is <strong>9.2
        hours</strong>. The window is not merely mistuned; a second-by-second walk is the wrong
        instrument for this distribution.
      </Highlight>
      <P>
        Widening it does not rescue the approach, because the binding constraint is the timeout,
        not the window. Even a window covering every observed publish only reaches 97% of days
        within 120 minutes — and the tail is savage: p50 is 10 minutes of sweeping, p90 is 56, and
        p100 is 549.
      </P>
      <RefTable
        head={["window @4s", "candidates", "full sweep", "found within 120 min"]}
        rows={[
          ["10:30–11:15 (current)", "2,760", "3.1 h", "56 of 59 · 95%"],
          ["10:25–11:15", "3,060", "3.4 h", "57 of 59 · 97%"],
          ["10:25–12:50", "8,701", "9.7 h", "57 of 59 · 97%"],
          ["10:25–12:50 @1s", "8,701", "2.4 h", "58 of 59 · 98%"],
        ]}
      />

      <H>What actually needs answering</H>
      <P>
        Two assumptions underneath the whole design have never been tested, and each one, if
        false, removes the problem rather than tuning it:
      </P>
      <UL>
        <LI>
          <strong>Is there a directory index?</strong> The guessing exists only because we believe
          there is no listing for <Code>stock_reports/</Code>. If one responds, the sweep can be
          deleted: read the index, take the filename, one GET.
        </LI>
        <LI>
          <strong>Are historical reports retained?</strong> The scraper assumes only the current
          day is served — but that belief rested on a log line (&ldquo;1 of 5 days captured&rdquo;)
          equally explained by tier-1 guessing wrong on the other four. Working URLs for 10 June
          and 29 June, fetched in late August, point the other way. If retention is real, a missed
          day is recoverable and the sweep should resume across runs instead of giving up.
        </LI>
      </UL>
      <P>
        A dispatch-only probe now answers both. Until it has, the scraper keeps probing recent
        days as it always did — a reversal of an earlier change here that cut it to the latest day
        only, on the strength of the same untested assumption.
      </P>

      <H>What did improve</H>
      <P>
        Run <em>count</em>, not run length: the chain off the news scraper was firing this workflow
        about three times a day against a source that publishes once, and 12 of 27 runs in the week
        to 25 August were cancelled in the concurrency queue. A once-a-day guard now short-circuits
        the duplicates. And a sweep killed part-way now records where it stopped, so the next
        attempt resumes instead of re-walking seconds it has already ruled out.
      </P>

      <Highlight>
        The residual is structural. A job whose runtime is dominated by a deliberate
        <Code>sleep</Code> — imposed by someone else&rsquo;s rate limit — is simply the wrong shape
        for per-minute billed compute. It is the strongest single argument for moving this workflow
        to a self-hosted runner, where waiting is free.
      </Highlight>

      <H2>Days we missed</H2>
      <P>
        {data.misses.captured} of {data.misses.business_days} business days in the span were
        captured. The {data.misses.missing.length} misses are spread across weekdays with no
        pattern — so there is no recurring day to schedule around:
      </P>
      <RefTable
        head={["weekday", "missed / business days"]}
        rows={["Mon", "Tue", "Wed", "Thu", "Fri"].map((w) => [
          w,
          `${data.misses.by_weekday[w]?.missing ?? 0} / ${data.misses.by_weekday[w]?.of ?? 0}`,
        ])}
      />
      <P>
        Each miss is checked against the committed stock snapshots to tell a guessing failure from
        a day ICE never published. <strong>data hole</strong> means no snapshot exists from any
        source — the workbook fallback did not cover it either, so the session is genuinely lost.
      </P>
      <RefTable
        head={["date", "weekday", "outcome"]}
        rows={data.misses.missing.map((m) => [
          m.date, m.weekday,
          m.data_hole ? "data hole — session lost" : "filled by the workbook ingest",
        ])}
      />

      <H2>Rate limiting</H2>
      {data.rate_limits.runs === 0 ? (
        <>
          <P>
            <strong>Not measured yet.</strong> {data.rate_limits.note}. Until now nothing counted
            429s, Retry-After waits or throttle bumps — the only record was the run log, which
            GitHub keeps for 90 days and never aggregates. Reading one run by hand showed a{" "}
            <em>404</em> storm rather than a 429 storm, but one run is not a statistic.
          </P>
          <P>
            The scraper now records every run: 429 count, each Retry-After wait, throttle bumps,
            whether the run was aborted by rate limiting, how many sweep GETs it spent and whether
            it resumed from a previous attempt. This section fills in from the next run onward.
          </P>
        </>
      ) : (
        <>
          <RefTable
            head={["metric", "value"]}
            rows={[
              ["runs recorded", String(data.rate_limits.runs)],
              ["runs that hit a 429", `${data.rate_limits.runs_with_429} of ${data.rate_limits.runs}`],
              ["total 429s", String(data.rate_limits.total_429)],
              ["time spent obeying Retry-After", `${data.rate_limits.total_retry_after_s}s`],
              ["worst single Retry-After", `${data.rate_limits.worst_retry_after_s}s`],
              ["runs aborted by rate limiting", String(data.rate_limits.runs_aborted_by_429)],
              ["runs that resumed a previous sweep", String(data.rate_limits.runs_resumed)],
              ["median sweep GETs", String(data.rate_limits.median_sweep_gets)],
            ]}
          />
        </>
      )}

      <H2>Every run</H2>
      {data.runs.count === 0 ? (
        <P>
          <strong>Populating.</strong> {data.runs.note}. GitHub knows every run that ever
          existed — including the ones killed before they could write anything — and the scraper
          knows where its own time went; the table below joins the two on the run date. Neither
          record was being kept until now.
        </P>
      ) : (
        <>
          <P>
            {data.runs.count} runs, {data.runs.billed_minutes_total.toLocaleString()} billed
            minutes ({data.runs.billed_minutes_mean} per run). Outcomes:{" "}
            {Object.entries(data.runs.outcomes)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
              .join(" · ")}.
          </P>
          <UL>
            <LI><strong>timeout</strong> — ran to the 120-minute cap: the sweep never found the
              file, or found it too late.</LI>
            <LI><strong>queue cancelled</strong> — dropped in the concurrency queue before doing
              any work. Costs nothing, produces nothing.</LI>
            <LI><strong>cancelled</strong> — stopped mid-run for another reason.</LI>
          </UL>
          <P>
            The wait columns are the answer to &ldquo;where did the time go&rdquo;: minutes spent
            asleep between requests, split by which host&rsquo;s rate limit imposed the pause, plus
            time spent obeying an explicit <Code>Retry-After</Code>. Blank means the run ended
            before it could record anything.
          </P>
          <RefTable
            head={["date", "trigger", "outcome", "billed", "publicdocs", "marketdata",
                   "retry-after", "429", "stopped at"]}
            rows={data.runs.recent.slice().reverse().map((r) => {
              const t = r.telemetry;
              const m = (s?: number | null) =>
                s == null ? "—" : `${(s / 60).toFixed(1)}m`;
              return [
                r.date, r.event ?? "—", r.outcome.replace(/_/g, " "),
                r.billed_minutes ? `${r.billed_minutes}m` : "—",
                m(t?.wait_publicdocs_s), m(t?.wait_marketdata_s), m(t?.wait_retry_after_s),
                t?.http_429 == null ? "—" : String(t.http_429),
                r.outcome === "success" ? "—" : (r.last_step ?? "—"),
              ];
            })}
          />
          {data.runs.with_telemetry < data.runs.count && (
            <P className="text-slate-500">
              {data.runs.count - data.runs.with_telemetry} of {data.runs.count} runs predate the
              scraper telemetry (added 2026-08-26), so their wait columns are blank. The outcome
              and billed columns come from GitHub and are complete.
            </P>
          )}
        </>
      )}

      <H2>Every capture</H2>
      <P>
        All {data.captures} observed publish times, oldest first. This is the file the guesser
        learns from; it is committed back after every successful run.
      </P>
      {/* DataFiles prefixes /data/ itself — pass the bare filename. */}
      <DataFiles files={["ice_publish_times.json"]}
                 note="Derived from stock_report_hits.json, the scraper's own hit log." />
    </>
  );
}
