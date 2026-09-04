"use client";
// 7-day run record for every GitHub Actions workflow — what actually
// EXECUTED, as opposed to what the YAML declares (that is the sibling
// "Live workflow inventory" panel, built from the files themselves).
//
// Reading the two together is the point. A declared cron proves nothing:
// this project has repeatedly had workflows that were green in every check
// while their data sat still — one pruned out from under its data file, one
// seed builder with no runner at all, one whose commit step only matched
// manual dispatches. Only a run record shows that, so the panel leads with
// the anomalies rather than burying them in a list:
//
//   · silent    — the YAML declares a cron, yet nothing ran all week
//   · failing   — ran, and at least one run did not succeed
//   · cancelled — ran, and at least one run was killed (usually a
//                 concurrency queue bumping a queued run)
//   · degraded  — ran, SUCCEEDED, and skipped part of its own work
//
// That last one is the hardest to see and has cost the most data. A
// conclusion is the wrong instrument for it: a job that meets an HTTP 403 on
// one source and skips it so the other nine can finish is doing the right
// thing, and exits 0 — identical here to a run that collected everything.
// So a workflow that skips work says so in run_degradations.json, and this
// panel reads that beside the conclusions. Green and complete stop being the
// same word.
import { useMemo, useState } from "react";
import { useFetchJson } from "@/lib/useFetchJson";

interface ActivityWorkflow {
  name: string;
  file: string;
  runs: number;
  success: number;
  failure: number;
  cancelled: number;
  by_day: number[];
  events: Record<string, number>;
  avg_seconds: number | null;
  last_run: string | null;
  last_conclusion: string | null;
}
interface ActivityPayload {
  generated_at: string;
  window_days: number;
  since: string;
  repo?: string;
  totals: { runs: number; success: number; failure: number; cancelled: number; other: number };
  days: string[];
  workflows: ActivityWorkflow[];
  /** Workflows whose run list hit the collector's page cap — their counts
   *  are a floor, not a total. Normally empty; if it is not, the panel says
   *  so rather than letting an undercount read as a quiet week. */
  capped_workflows?: string[];
  errored_workflows?: string[];
  /** "old title → current title" for workflows renamed inside the window.
   *  Not cosmetic: `workflow_run` triggers match on the exact display
   *  title, so a rename silently stops waking whatever listened for it. */
  renamed_in_window?: string[];
}
interface InventoryLite {
  workflows: { file: string; name: string; crons: string[] }[];
}
/** One green run that skipped part of its own work. Written by the workflow
 *  itself (backend/scraper/run_degradations.py), not by the Actions API —
 *  which is the point: the API has no field for this. */
interface Degradation {
  at: string;
  date: string;
  workflow: string;
  file: string;
  run_id: string;
  run_url: string | null;
  kind: string;
  detail: string;
  items: string[];
}
interface DegradationPayload {
  generated_at: string;
  keep_days: number;
  runs: Degradation[];
}

type Filter = "all" | "problem" | "silent" | "degraded";

/** Heat step for a day cell. Runs-per-day is heavily skewed (one workflow
 *  runs 96×/day, most run once), so the ramp is banded rather than linear. */
function heat(n: number): string {
  if (n === 0) return "bg-slate-800/60";
  if (n === 1) return "bg-emerald-900/70";
  if (n <= 3)  return "bg-emerald-700/80";
  if (n <= 8)  return "bg-emerald-600";
  return "bg-emerald-400";
}

const fmtDur = (s: number | null) =>
  s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)}m`;

const dayLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
};

export default function WorkflowActivity() {
  const { data, error } = useFetchJson<ActivityPayload>("/data/workflow_activity.json");
  const { data: inv } = useFetchJson<InventoryLite>("/data/workflows_inventory.json");
  const { data: degraded } = useFetchJson<DegradationPayload>("/data/run_degradations.json");
  const [filter, setFilter] = useState<Filter>("all");

  // Workflows the YAML schedules but which produced no run in the window.
  // This is the class of failure the Actions tab cannot show you — there is
  // nothing to look at, which is exactly the problem.
  //
  // Joined on FILE, not on name. A workflow's title is mutable and the
  // Actions API caches it per run, so matching on it reported eight healthy
  // daily jobs as silent after a renumbering pass — a false alarm on the one
  // panel whose whole job is to be trusted when it cries wolf.
  const silent = useMemo(() => {
    if (!data || !inv) return [];
    const ran = new Set(data.workflows.map(w => w.file).filter(Boolean));
    return inv.workflows
      .filter(w => (w.crons?.length ?? 0) > 0 && !ran.has(w.file))
      .map(w => ({ name: w.name, file: w.file, crons: w.crons }));
  }, [data, inv]);

  // Degradations inside the SAME window the run table covers, so a row here
  // always has a run above it to belong to. The file keeps a month; the panel
  // shows a week, and a stale row would read as a live incident.
  const skips = useMemo(() => {
    if (!data || !degraded) return [];
    const since = data.since.slice(0, 10);
    return degraded.runs.filter(r => (r.date ?? "") >= since)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [data, degraded]);

  // Joined on file, for the same reason `silent` is: a display title is
  // mutable and the Actions API caches it per run.
  const skippedFiles = useMemo(
    () => new Set(skips.map(r => r.file).filter(Boolean)), [skips]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "problem") return data.workflows.filter(w => w.failure > 0 || w.cancelled > 0);
    if (filter === "degraded") return data.workflows.filter(w => skippedFiles.has(w.file));
    return data.workflows;
  }, [data, filter, skippedFiles]);

  if (error) {
    return (
      <p className="text-[11px] text-slate-500">
        Activity record unavailable — workflow_activity.json has not been generated yet
        (workflow <span className="font-mono">0.17</span> writes it daily).
      </p>
    );
  }
  if (!data) return <p className="text-[11px] text-slate-500 animate-pulse">Loading run record…</p>;

  const t = data.totals;
  const failRate = t.runs ? (t.failure / t.runs) * 100 : 0;
  const capped = data.capped_workflows ?? [];
  const errored = data.errored_workflows ?? [];
  const renamed = data.renamed_in_window ?? [];

  return (
    <div className="space-y-3">
      {renamed.length > 0 && (
        <div className="text-[10px] text-sky-300 border border-sky-900/60 bg-sky-950/30 rounded px-2 py-1 space-y-0.5">
          <div>
            Renamed inside the window — <span className="text-sky-200">workflow_run</span> triggers
            match on the exact display title, so anything that listened for the old name has stopped
            waking. Worth re-checking {renamed.length === 1 ? "this one" : "these"}:
          </div>
          {renamed.map(r => (
            <div key={r} className="font-mono text-[9px] text-sky-400/80 pl-2">{r}</div>
          ))}
        </div>
      )}

      {errored.length > 0 && (
        <div className="text-[10px] text-amber-400 border border-amber-900/60 bg-amber-950/30 rounded px-2 py-1">
          Incomplete sweep: the GitHub API never answered for {errored.join(", ")}, so{" "}
          {errored.length === 1 ? "its runs are" : "their runs are"} missing from this record
          entirely — the totals below are a floor. The rest of the sweep is unaffected.
        </div>
      )}

      {capped.length > 0 && (
        <div className="text-[10px] text-amber-400 border border-amber-900/60 bg-amber-950/30 rounded px-2 py-1">
          Undercount: {capped.join(", ")} exceeded the collector&apos;s page cap, so the counts
          below are a floor for {capped.length === 1 ? "it" : "them"}, not a total.
        </div>
      )}

      {/* Totals + filters */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex gap-4 flex-wrap text-[11px]">
          <Stat label="runs" value={t.runs} tone="text-slate-200" />
          <Stat label="succeeded" value={t.success} tone="text-emerald-400" />
          <Stat label="failed" value={t.failure} tone={t.failure ? "text-red-400" : "text-slate-500"} />
          <Stat label="cancelled" value={t.cancelled} tone={t.cancelled ? "text-amber-400" : "text-slate-500"} />
          <Stat label="fail rate" value={`${failRate.toFixed(1)}%`}
            tone={failRate > 5 ? "text-red-400" : "text-slate-400"} />
          <Stat label="degraded" value={skips.length}
            tone={skips.length ? "text-orange-400" : "text-slate-500"} />
        </div>
        <div className="inline-flex rounded border border-slate-700 overflow-hidden">
          {([
            { k: "all" as const, l: `All ${data.workflows.length}` },
            { k: "problem" as const, l: "Failed / cancelled" },
            { k: "silent" as const, l: `Silent ${silent.length}` },
            { k: "degraded" as const, l: `Degraded ${skips.length}` },
          ]).map(o => (
            <button key={o.k} onClick={() => setFilter(o.k)}
              className={`text-[10px] px-2 py-0.5 transition-colors ${
                filter === o.k ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {filter === "silent" ? (
        <SilentList silent={silent} />
      ) : filter === "degraded" ? (
        <DegradedList skips={skips} days={data.window_days} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1 pr-2 font-medium">Workflow</th>
                {data.days.map(d => (
                  <th key={d} className="px-0.5 py-1 font-medium text-center" title={d}>
                    {dayLabel(d)}
                  </th>
                ))}
                <th className="text-right py-1 px-2 font-medium">Runs</th>
                <th className="text-right py-1 px-2 font-medium">Fail</th>
                <th className="text-right py-1 px-2 font-medium">Avg</th>
                <th className="text-left py-1 pl-2 font-medium">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.name} className="border-t border-slate-800/70">
                  <td className="py-1 pr-2 text-slate-300 whitespace-nowrap max-w-[280px] truncate"
                    title={`${w.name}\n${w.file}`}>
                    {w.name}
                  </td>
                  {w.by_day.map((n, i) => (
                    <td key={i} className="px-0.5 py-1">
                      <span
                        title={`${data.days[i]}: ${n} run${n === 1 ? "" : "s"}`}
                        className={`block w-full h-4 rounded-sm ${heat(n)}`} />
                    </td>
                  ))}
                  <td className="py-1 px-2 text-right text-slate-300">{w.runs}</td>
                  {/* Conclusion and degradation are separate facts and a row
                      that has both must show both — an amber "0+8c" hid the
                      skip entirely when one workflow was cancelled AND came
                      home incomplete. */}
                  <td className="py-1 px-2 text-right whitespace-nowrap">
                    <span className={
                      w.failure ? "text-red-400" : w.cancelled ? "text-amber-400" : "text-slate-600"}>
                      {w.failure || w.cancelled
                        ? `${w.failure}${w.cancelled ? `+${w.cancelled}c` : ""}`
                        : "–"}
                    </span>
                    {skippedFiles.has(w.file) && (
                      <span className="text-orange-400 ml-1"
                        title="Succeeded, but skipped part of its own work — see Degraded">
                        skip
                      </span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right text-slate-500">{fmtDur(w.avg_seconds)}</td>
                  <td className="py-1 pl-2 text-slate-500 whitespace-nowrap">
                    {Object.keys(w.events).join(" · ")}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={data.days.length + 5} className="py-3 text-center text-emerald-400">
                  Nothing failed or was cancelled in the window.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[9px] text-slate-600 leading-relaxed">
        Window: {data.since.slice(0, 10)} → {data.generated_at.slice(0, 10)} (UTC), refreshed daily
        by workflow <span className="font-mono">0.17</span>. Each cell is one day; darker means more
        runs. <span className="text-amber-400">Cancelled</span> usually means a concurrency queue
        bumped a run that was already waiting — the failure mode that silently cost a month of
        Uganda data. <span className="text-slate-400">Silent</span> lists workflows whose YAML
        declares a cron but which produced no run at all this week; that is the one thing the
        Actions tab cannot show, because there is nothing there to see.{" "}
        <span className="text-orange-400">Degraded</span> is the other one: runs that SUCCEEDED
        having skipped part of their own work, which no conclusion can express.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-mono text-sm font-bold ${tone}`}>{value}</span>
      <span className="text-slate-500 uppercase tracking-wider text-[9px]">{label}</span>
    </span>
  );
}

/** Green runs that skipped work — the state a conclusion cannot express.
 *
 *  Deliberately rendered as incidents rather than a table row: each one is a
 *  specific hole in a specific day's data, and the run link is the only way to
 *  see how big. Reported by the workflow itself; nothing in the Actions API
 *  would ever produce this list. */
function DegradedList({ skips, days }: { skips: Degradation[]; days: number }) {
  if (skips.length === 0) {
    return (
      <p className="text-[11px] text-emerald-400 py-2">
        No run reported skipping any of its own work in the last {days} days. Note this only
        covers workflows that report it &mdash; a job that skips work silently still cannot be
        seen from here.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {skips.map(r => (
        <div key={`${r.run_id}-${r.at}`}
          className="bg-slate-950/50 border border-orange-900/50 rounded px-3 py-2 space-y-1">
          <div className="flex items-start gap-3">
            <span className="text-[9px] font-mono uppercase tracking-wider text-orange-400 mt-0.5 shrink-0">
              {r.kind.replace(/_/g, " ")}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-300">{r.workflow}</div>
              <div className="text-[9px] font-mono text-slate-500">
                {r.at.replace("T", " ").slice(0, 16)} UTC · {r.file}
                {r.run_url && (
                  <>
                    {" · "}
                    <a href={r.run_url} target="_blank" rel="noreferrer"
                      className="text-sky-400 hover:text-sky-300 underline">run</a>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 leading-relaxed">{r.detail}</div>
          {r.items.length > 0 && (
            <ul className="text-[9px] font-mono text-orange-300/80 space-y-0.5 pl-2">
              {r.items.map((it, i) => <li key={i}>· {it}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function SilentList({ silent }: { silent: { name: string; file: string; crons: string[] }[] }) {
  if (silent.length === 0) {
    return (
      <p className="text-[11px] text-emerald-400 py-2">
        Every scheduled workflow fired at least once this week.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {silent.map(w => (
        <div key={w.file}
          className="flex items-start gap-3 bg-slate-950/50 border border-amber-900/50 rounded px-3 py-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400 mt-0.5">
            no runs
          </span>
          <div className="min-w-0">
            <div className="text-[11px] text-slate-300">{w.name}</div>
            <div className="text-[9px] font-mono text-slate-500">
              {w.file} · declares {w.crons.map(c => `"${c}"`).join(", ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
