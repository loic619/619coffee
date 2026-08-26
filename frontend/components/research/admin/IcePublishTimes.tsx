"use client";
import { useState } from "react";
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
  days: { date: string; time: string }[];
  by_weekday: {
    days: { weekday: string; n: number; median: string; max: string; late: number }[];
    late_threshold: string;
    mon_wed: { n: number; late: number; rate: number };
    thu_fri: { n: number; late: number; rate: number };
    permutation_p: number;
  };
  misses: {
    business_days: number;
    captured: number;
    missing: { date: string; weekday: string; data_hole: boolean; recoverable: boolean }[];
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

/**
 * One pending miss, with the field that closes it.
 *
 * The narrow window makes a late publish an ANNOUNCED outcome rather than a
 * silent hole — Telegram says so at the time, and the day lands here. The only
 * thing that recovers it is a human reading the second off the ICE filename,
 * because there is no index to read it from. Entering it appends the
 * observation to the hit log and re-runs the scraper, whose tier 0 then fetches
 * the session in a single GET at any age (retention, probe 0.18).
 */
function BackfillRow({ date, weekday }: { date: string; weekday: string }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string }>({
    kind: "idle",
  });

  async function submit() {
    const hhmmss = value.replace(/\D/g, "");
    if (!/^\d{6}$/.test(hhmmss)) {
      setState({ kind: "err", msg: "six digits, as in the filename — e.g. 112351" });
      return;
    }
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/admin/ice-publish-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, hhmmss }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({ kind: "ok", msg: "queued — the backfill run takes a few minutes" });
      } else {
        setState({ kind: "err", msg: body.hint ?? body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setState({ kind: "err", msg: e instanceof Error ? e.message : "network error" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 border-b border-slate-800/70 last:border-0">
      <span className="font-mono text-xs text-slate-300 w-24">{date}</span>
      <span className="text-[11px] text-slate-500 w-8">{weekday}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        placeholder="HHMMSS"
        inputMode="numeric"
        maxLength={8}
        disabled={state.kind === "busy" || state.kind === "ok"}
        className="w-24 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono
                   text-xs text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
      />
      <button
        onClick={() => void submit()}
        disabled={state.kind === "busy" || state.kind === "ok"}
        className="px-2.5 py-1 rounded border border-slate-600 text-[11px] text-slate-300
                   hover:bg-slate-800 disabled:opacity-40"
      >
        {state.kind === "busy" ? "sending…" : "backfill"}
      </button>
      {state.msg && (
        <span className={`text-[11px] ${state.kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
          {state.msg}
        </span>
      )}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

/** Severity band for a publish time — the sweep cost, not an arbitrary scale. */
function band(secs: number): { cls: string; label: string } {
  if (secs <= 10 * 3600 + 33 * 60) return { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "by 10:33" };
  if (secs <= 10 * 3600 + 40 * 60) return { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "10:33–10:40" };
  if (secs <= 11 * 3600) return { cls: "bg-orange-500/20 text-orange-300 border-orange-500/40", label: "10:40–11:00" };
  return { cls: "bg-rose-500/20 text-rose-300 border-rose-500/40", label: "after 11:00" };
}

/**
 * Calendar of publish times, Mon–Fri only (ICE does not publish at weekends).
 *
 * Laid out with the weekdays as COLUMNS on purpose: the interesting structure
 * in this data is the weekday tail, so putting Monday under Monday makes the
 * clustering visible as a vertical pattern rather than something you have to
 * take on trust from a p-value.
 */
function PublishCalendar({ days, missing }: {
  days: { date: string; time: string }[];
  missing: { date: string; recoverable: boolean }[];
}) {
  const byDate = new Map(days.map((d) => [d.date, d.time]));
  const miss = new Map(missing.map((m) => [m.date, m.recoverable]));
  const toSecs = (t: string) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };

  // Month span covering every observation.
  const all = [...days.map((d) => d.date), ...missing.map((m) => m.date)].sort();
  if (!all.length) return null;
  const [y0, m0] = all[0].split("-").map(Number);
  const [y1, m1] = all[all.length - 1].split("-").map(Number);

  const months: { year: number; month: number }[] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (m = 1, y++) : m++) {
    months.push({ year: y, month: m });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4">
      {months.map(({ year, month }) => {
        // Mon..Fri cells for this month, with leading blanks in week one.
        const cells: (string | null)[] = [];
        const first = new Date(Date.UTC(year, month - 1, 1));
        const lead = (first.getUTCDay() + 6) % 7;             // 0 = Monday
        for (let i = 0; i < Math.min(lead, 5); i++) cells.push(null);
        const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
        for (let d = 1; d <= dim; d++) {
          const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
          if (wd < 5) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
        }
        return (
          <div key={`${year}-${month}`}
               className="border border-slate-700/60 rounded-lg p-2.5 bg-slate-900/40">
            <div className="text-xs font-bold text-slate-200 mb-2">
              {MONTHS[month - 1]} {year}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-[9px] uppercase tracking-wider text-slate-500 text-center pb-0.5">
                  {w}
                </div>
              ))}
              {cells.map((iso, i) => {
                if (!iso) return <div key={`b${i}`} />;
                const dnum = Number(iso.slice(8));
                const time = byDate.get(iso);
                if (!time) {
                  const known = miss.get(iso);
                  const isMiss = miss.has(iso);
                  return (
                    <div key={iso}
                         title={isMiss ? (known ? "missed — publish time known, recoverable" : "missed — time unknown") : "outside the record"}
                         className={`rounded border px-1 py-1 text-center ${
                           isMiss ? "border-dashed border-slate-500/70 bg-slate-800/40"
                                  : "border-slate-800 bg-slate-900/30"}`}>
                      <div className="text-[10px] text-slate-500 tabular-nums">{dnum}</div>
                      <div className="text-[9px] text-slate-600 font-mono">
                        {isMiss ? "miss" : "—"}
                      </div>
                    </div>
                  );
                }
                // A known time and a stored snapshot are different things. Once
                // an operator supplies the publish second for a lost session we
                // know exactly WHEN it published while still not holding the
                // data — so the cell shows the time and stays dashed until the
                // snapshot actually lands.
                const noData = miss.has(iso);
                const b = band(toSecs(time));
                return (
                  <div key={iso}
                       title={`${iso} — published ${time}${noData ? " · snapshot still missing" : ""}`}
                       className={`rounded border px-1 py-1 text-center ${b.cls}${
                         noData ? " border-dashed !border-slate-400/80" : ""}`}>
                    <div className="text-[10px] opacity-70 tabular-nums">
                      {dnum}{noData ? "•" : ""}
                    </div>
                    <div className="text-[9px] font-mono tabular-nums">{time.slice(0, 5)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
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
  // Derived from the payload's window rather than a literal, because the window
  // has moved twice now and every hardcoded copy of it went stale silently.
  const windowStart = hms(`${data.sweep.window.split(/[–-]/)[0].trim()}:00`);
  const medianOffset = data.median ? Math.max(hms(data.median) - windowStart, 0) : 0;
  // A pending miss is a business day with no snapshot AND no known publish
  // second: the sweep cannot reach it and nothing automatic will. It needs the
  // one input a machine cannot produce.
  const pending = data.misses.missing.filter((m) => !m.recoverable);

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
        The sweep ascends from the window&rsquo;s start, so it exploits the front-loading
        automatically: a median day sits {medianOffset}s in and is found after about{" "}
        {Math.round((medianOffset * data.sweep.interval_s) / 60)} minutes of GETs. The tail is what
        hurts. The latest session on record sits {data.sweep.observed_max_offset_s}s past the
        window&rsquo;s start — {Math.round(((data.sweep.observed_max_offset_s ?? 0) * data.sweep.interval_s) / 60)}{" "}
        minutes of billed waiting if you insisted on walking to it, which is precisely why the
        window stops before it and hands that day to the backfill loop instead.
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
        head={["window", "candidates", "full sweep", "days covered"]}
        rows={[
          ["10:30–11:15 @4s (old)", "2,760", "3.1 h", "56 of 59 · 95%"],
          ["10:25–11:15 @4s", "3,060", "3.4 h", "57 of 59 · 97%"],
          ["10:25–12:50 @4s", "8,701", "9.7 h", "58 of 59 · 98%"],
          ["10:29–11:00 @3s (chosen)", "1,920", "1.6 h", "58 of 60 · 97%"],
        ]}
      />

      <H>The probe, and what it settled</H>
      <P>
        Two assumptions underneath the whole design had never been tested. Workflow 0.18 tested
        them on 26 August, in about a dozen requests:
      </P>
      <RefTable
        head={["question", "result", "consequence"]}
        rows={[
          ["Is there a directory index?", "No — all candidates 404",
            "the guessing cannot be deleted; it stays necessary"],
          ["Are historical reports retained?", "Yes — 3 of 3, months later",
            "a missed day is RECOVERABLE, and an unfinished sweep is a pause, not a loss"],
          ["Is HEAD honoured?", "Yes — 200, zero bytes",
            "probing can be byte-cheap; the cost is time, not bandwidth"],
        ]}
      />
      <Highlight>
        Retention is the finding that matters. It converts the 120-minute timeout from a
        data-loss event into an interruption: the cursor records where the walk stopped, the next
        run picks it up, and the file is still there when it arrives. Everything the old design
        gave up on — the wide window, the long tail, the day that needed 124 minutes — becomes
        affordable, because it no longer has to fit in one run.
      </Highlight>
      <P>
        Three changes follow directly. A <strong>tier 0</strong> now tries the second already
        recorded for that exact date before any searching — one GET for any day whose time is
        known, from any source including by hand, which is what makes the three lost sessions
        recoverable. A sweep killed part-way records its cursor, so the next run resumes rather
        than re-walking seconds it has already ruled out. And the earlier &ldquo;probe only the
        latest day&rdquo; change is reverted, since older days are exactly the ones worth
        re-probing now.
      </P>

      <H>Choosing the window: narrow on purpose</H>
      <P>
        The first response to the correction was to widen the window to cover every observed
        publish — 10:25–12:50, 8,701 candidates. That is the wrong instinct, and the table above
        says why: widening buys the 98th percentile at a cost of nine hours of walking, against a
        source that publishes once a day and a job that is billed by the minute. Coverage is not
        free and the last two percent are the expensive ones.
      </P>
      <P>
        The window is now <strong>{data.sweep.window}</strong> at{" "}
        <strong>{data.sweep.interval_s}s per request</strong> — {data.sweep.days_inside_window} of
        the {data.captures} sessions on record, {" "}
        {pct(data.sweep.days_inside_window / Math.max(data.captures, 1))}, in a full walk of{" "}
        {Math.round((data.sweep.candidate_seconds * data.sweep.interval_s) / 60)} minutes. That
        number is the point of the design, not a side effect: it fits inside the 120-minute
        timeout, so a run that finds nothing has genuinely <em>looked everywhere</em> and can say
        so. Under the wide window a fruitless run and an unfinished run were indistinguishable.
      </P>
      <Highlight>
        The interval step from 4s to 3s is what buys that. At 4s the same walk is{" "}
        {Math.round((data.sweep.candidate_seconds * 4) / 60)} minutes — past the timeout, so the
        run could never conclude anything.
      </Highlight>
      <P>
        The step follows the rule this page set earlier: drop one notch only after a run at the
        current value drew no 429s. That rule is satisfied by inference, which is not the same as
        evidence, so workflow <strong>0.20</strong> measured it on 26 August — 200 sequential GETs
        at 3s against seconds where no file can exist, with a known-good retained report fetched
        before, at every fiftieth request, and after. The control is the real test: a 404 only
        tells you the URL is wrong, and only the control tells you whether you are still welcome.
      </P>
      <RefTable
        head={["measure", "result"]}
        rows={[
          ["requests at 3s", "200 in 10.5 min (3.14s/req actual)"],
          ["statuses", "404 × 200 — no other code seen"],
          ["HTTP 429s", "0"],
          ["transport failures", "0"],
          ["control fetches (before · ×4 during · after)", "200 every time — never kicked out"],
          ["latency", "median 0.13s, max 0.35s — flat throughout"],
        ]}
      />
      <P>
        Flat latency is worth as much as the zero: throttling usually announces itself by slowing
        down before it starts refusing, and there was no sign of it. The result does not fully
        generalise, though — a worst-case sweep issues 1,920 requests, not 200, so this rules out
        a short-window limit rather than a daily one. The scraper still carries its defences for
        that case: <Code>Retry-After</Code> obeyed, the throttle self-bumping ×1.3 on a 429, an
        abort after four consecutive ones, and the cursor so an aborted run resumes instead of
        restarting. The step-down rule would now permit trying 2s. There is no reason to: 96
        minutes already fits, so a further step buys nothing and spends risk. <strong>3s stands,
        with 4s the fallback</strong> if a long sweep ever draws 429s the run telemetry can show.
      </P>
      <P>
        What makes deliberate under-coverage acceptable is that the residual is no longer silent.
        A sweep that exhausts the window without a hit posts <em>missed, late release</em> to
        Telegram and lists the day as pending below, where one entered second recovers it. A known
        3% of sessions needing one manual field beats nine hours of runner time spent buying
        them automatically.
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

      <H2>The calendar</H2>
      <P>
        Every session on record, weekdays only. Colour is the sweep cost, not an arbitrary
        scale — green is found in the first few minutes, red is the tail that eats an hour.
        A dashed cell marked • is a session whose publish time we know but whose snapshot we do
        not hold: recoverable, not recovered.
      </P>
      <div className="flex flex-wrap gap-3 my-2 text-[10px]">
        {[
          ["bg-emerald-500/15 border-emerald-500/30 text-emerald-300", "by 10:33"],
          ["bg-amber-500/15 border-amber-500/30 text-amber-300", "10:33–10:40"],
          ["bg-orange-500/20 border-orange-500/40 text-orange-300", "10:40–11:00"],
          ["bg-rose-500/20 border-rose-500/40 text-rose-300", "after 11:00"],
          ["border-dashed border-slate-400/80 bg-slate-800/40 text-slate-400", "no snapshot (dashed • )"],
        ].map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block w-4 h-3 rounded border ${cls}`} />
            <span className="text-slate-400">{label}</span>
          </span>
        ))}
      </div>
      <PublishCalendar days={data.days} missing={data.misses.missing} />
      <P>
        Read down the columns rather than across the rows: Monday sits under Monday. The late
        cells — orange and red — sit almost entirely in the left three, which is the weekday
        effect below, seen directly rather than inferred.
      </P>

      <H2>Is there a weekday pattern?</H2>
      <P>
        Worth asking, because the median barely moves across the week but the{" "}
        <em>tail</em> does — and the tail is the only part that costs anything. A 10:32 publish is
        found in ten minutes of sweeping; a 10:51 one takes eighty-five.
      </P>
      <RefTable
        head={["day", "n", "median", "latest", `after ${data.by_weekday.late_threshold.slice(0, 5)}`]}
        rows={data.by_weekday.days.map((d) => [
          d.weekday, String(d.n), d.median, d.max, `${d.late} / ${d.n}`,
        ])}
      />
      <Highlight>
        Late publishes cluster in the <strong>first half</strong> of the week, not the second:{" "}
        {Math.round(data.by_weekday.mon_wed.rate * 100)}% of Mon–Wed sessions publish after{" "}
        {data.by_weekday.late_threshold.slice(0, 5)} against{" "}
        {Math.round(data.by_weekday.thu_fri.rate * 100)}% of Thu–Fri
        ({data.by_weekday.mon_wed.late}/{data.by_weekday.mon_wed.n} vs{" "}
        {data.by_weekday.thu_fri.late}/{data.by_weekday.thu_fri.n}, permutation
        p&nbsp;=&nbsp;{data.by_weekday.permutation_p.toFixed(3)}). Every one of the five latest
        publishes on record is a Monday, Tuesday or Wednesday — the exact opposite of a
        Friday-afternoon story.
      </Highlight>
      <P>
        Treat it as suggestive, not established. There are about twelve observations per weekday,
        the &ldquo;late&rdquo; threshold was chosen after looking at the data, and this is one of
        several cuts tried — testing enough slices of 59 points will eventually produce a p below
        0.05. The medians alone show nothing: Mon–Wed 10:32:47 against Thu–Fri 10:31:37, a
        seventy-second gap with p&nbsp;=&nbsp;0.157. Position in the month shows nothing either.
      </P>
      <P>
        If it survives more data it is directly actionable, since it says where to spend the
        budget rather than merely describing the source: a Monday run should expect to sweep and
        be given room, a Thursday run that has not found the file by 10:40 is probably looking at
        something other than a late publish. What would settle it is another two months of
        captures against this threshold, fixed in advance.
      </P>

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
        A miss is a business day with no snapshot — the data we actually wanted. Keying it on the
        hit log instead would mark a day &ldquo;found&rdquo; the moment its publish second was
        written down, which is the opposite of true: knowing the time makes a day
        <em>recoverable</em>, not recovered. With retention confirmed, every row below whose time
        is known is a single GET away on the next run.
      </P>
      <RefTable
        head={["date", "weekday", "outcome"]}
        rows={data.misses.missing.map((m) => [
          m.date, m.weekday,
          m.recoverable ? "publish time known — one GET away" : "time unknown — pending an entry",
        ])}
      />

      <H>Pending misses — enter the second, and it backfills</H>
      <P>
        The window is deliberately narrower than the observed range, so some sessions will fall
        outside it. That is a priced decision, not an oversight: {data.sweep.window} covers{" "}
        {data.sweep.days_inside_window} of the {data.captures} sessions on record, and reaching
        the last two would mean a nine-hour walk to buy two days a quarter. What changes is that a
        miss is now <em>announced</em> — the run posts &ldquo;missed, late release&rdquo; to
        Telegram the moment its sweep exhausts the window without a hit, and the day appears here.
      </P>
      <P>
        There is no index to read the publish second from, so the only thing that closes one of
        these is a person opening the ICE stock-reports page and copying the six digits out of the
        filename. Enter them below and workflow 0.19 appends the observation and re-runs the
        scraper; tier 0 then fetches that session in a single GET, however old it is.
      </P>
      {pending.length === 0 ? (
        <P className="text-emerald-400">
          Nothing pending — every business day on record either has its snapshot or has its
          publish time known and queued for the next run.
        </P>
      ) : (
        <div className="my-3 p-3 rounded border border-slate-700/70 bg-slate-900/40">
          <div className="text-[11px] text-slate-500 mb-2">
            Filename format: <Code>Stock_Report_RC_YYYYMMDD_HHMMSS.csv</Code> — enter the{" "}
            <Code>HHMMSS</Code> part only.
          </div>
          {pending.map((m) => (
            <BackfillRow key={m.date} date={m.date} weekday={m.weekday} />
          ))}
        </div>
      )}

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
