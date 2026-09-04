"use client";
import { Suspense, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Mermaid from "@/components/Mermaid";
import DataDownloads from "@/components/data-map/DataDownloads";
import WorkflowActivity from "@/components/data-map/WorkflowActivity";
import { useFetchJson, type FetchState } from "@/lib/useFetchJson";
import { useUrlState } from "@/lib/useUrlState";
import { ARCHITECTURE, TAB_DIAGRAMS } from "./diagrams";
import { ROWS, type FlowMetadata, type TriggerType } from "./flows";

// ── Operational metadata card view ──────────────────────────────────────────
// Replaces the flat 4-column table with an expandable per-flow card.
// Always-visible header line carries wf · output · component · visual.
// Click toggles a detail panel that surfaces the five ops blocks:
// cadence · transport · storage · resiliency · runtime. Empty sub-fields
// render "TBD" rather than disappearing — the audit gap stays visible.

// Three-letter chip per trigger type — uniform width, instantly scannable.
const TRIGGER_BADGE: Record<TriggerType, { tag: string; cls: string }> = {
  cron:      { tag: "CRON", cls: "text-sky-300 border-sky-700/60 bg-sky-950/40" },
  manual:    { tag: "MAN",  cls: "text-amber-300 border-amber-700/60 bg-amber-950/40" },
  edge:      { tag: "EDGE", cls: "text-emerald-300 border-emerald-700/60 bg-emerald-950/40" },
  composite: { tag: "COMP", cls: "text-violet-300 border-violet-700/60 bg-violet-950/40" },
  tbd:       { tag: "TBD",  cls: "text-slate-500 border-slate-700 bg-slate-900" },
};

function _fieldsFilledRatio(meta: FlowMetadata): { filled: number; total: number } {
  // Walks the five ops blocks and counts populated sub-fields. Helper
  // for the header progress dot — "5/14 ops fields filled".
  const groups: Array<Record<string, string | TriggerType | undefined> | undefined> = [
    meta.cadence, meta.transport, meta.storage, meta.resiliency, meta.runtime,
  ];
  // 14 = 3+3+3+3+2 sub-fields across the five blocks.
  let filled = 0;
  for (const g of groups) {
    if (!g) continue;
    for (const v of Object.values(g)) {
      if (typeof v === "string" && v.trim().length > 0) filled++;
      else if (v && v !== "tbd") filled++;   // TriggerType passthrough
    }
  }
  return { filled, total: 14 };
}

function DimensionRow({ label, value }: { label: string; value: string | undefined }) {
  const populated = value && value.trim().length > 0;
  return (
    <div className="flex gap-2 text-[10.5px] leading-snug">
      <span className="text-slate-500 w-28 shrink-0">{label}</span>
      <span className={populated ? "text-slate-300" : "text-slate-700 italic"}>
        {populated ? value : "TBD"}
      </span>
    </div>
  );
}

function DimensionBlock({ title, accent, children }: {
  title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className={`text-[9px] uppercase tracking-widest font-bold ${accent}`}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function FlowCard({ meta }: { meta: FlowMetadata }) {
  const [open, setOpen] = useState(false);
  const trig = meta.cadence?.trigger ?? "tbd";
  const badge = TRIGGER_BADGE[trig];
  const ratio = _fieldsFilledRatio(meta);
  const ratioPct = (ratio.filled / ratio.total) * 100;
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-950/60 hover:border-slate-700 transition-colors">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-start gap-3 px-3 py-2 text-left"
      >
        <span className={`shrink-0 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${badge.cls}`}>
          {badge.tag}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-amber-300 font-semibold truncate">{meta.wf}</div>
          <div className="text-[10.5px] text-slate-300 leading-snug mt-0.5">{meta.visual}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
            <span className="font-mono text-slate-400">→ {meta.output}</span>
            <span className="font-mono text-slate-500">{meta.component}</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span
            title={`Ops detail: ${ratio.filled}/${ratio.total} fields filled`}
            className="text-[9px] font-mono text-slate-500 whitespace-nowrap"
          >
            {ratio.filled}/{ratio.total} ops
          </span>
          <div className="w-10 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full ${ratioPct >= 75 ? "bg-emerald-500" : ratioPct >= 40 ? "bg-amber-500" : "bg-slate-600"}`}
              style={{ width: `${Math.max(4, ratioPct)}%` }}
            />
          </div>
          <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <DimensionBlock title="Cadence · when" accent="text-sky-300">
            <DimensionRow label="recurrence" value={meta.cadence?.recurrence} />
            <DimensionRow label="window"     value={meta.cadence?.window} />
            <DimensionRow label="trigger"    value={meta.cadence?.trigger} />
          </DimensionBlock>
          <DimensionBlock title="Transport · where & how" accent="text-violet-300">
            <DimensionRow label="provider" value={meta.transport?.provider} />
            <DimensionRow label="method"   value={meta.transport?.method} />
            <DimensionRow label="bypass"   value={meta.transport?.bypass} />
          </DimensionBlock>
          <DimensionBlock title="Storage · destination" accent="text-emerald-300">
            <DimensionRow label="target"    value={meta.storage?.target} />
            <DimensionRow label="footprint" value={meta.storage?.footprint} />
            <DimensionRow label="units"     value={meta.storage?.units} />
          </DimensionBlock>
          <DimensionBlock title="Resiliency · safety net" accent="text-amber-300">
            <DimensionRow label="onMissing"     value={meta.resiliency?.onMissing} />
            <DimensionRow label="debounce"      value={meta.resiliency?.debounce} />
            <DimensionRow label="parserFallback" value={meta.resiliency?.parserFallback} />
          </DimensionBlock>
          <DimensionBlock title="Runtime · budget" accent="text-rose-300">
            <DimensionRow label="duration" value={meta.runtime?.duration} />
            <DimensionRow label="cost"     value={meta.runtime?.cost} />
          </DimensionBlock>
        </div>
      )}
    </div>
  );
}

function WorkflowTable() {
  const totalFilled = ROWS.reduce((acc, r) => acc + _fieldsFilledRatio(r).filled, 0);
  const totalSlots  = ROWS.length * 14;
  const auditPct    = Math.round((totalFilled / totalSlots) * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 text-[11px]">
        <div className="text-slate-400">
          <span className="font-semibold text-slate-200">{ROWS.length}</span> flows ·
          click any to expand the operational metadata (cadence · transport · storage · resiliency · runtime).
        </div>
        <div className="font-mono text-slate-500">
          Audit fill: <span className="text-slate-300">{totalFilled}/{totalSlots}</span> · {auditPct}%
        </div>
      </div>
      <div className="space-y-1.5">
        {ROWS.map((meta, i) => (
          <FlowCard key={i} meta={meta} />
        ))}
      </div>
    </div>
  );
}

// ── Live Workflow Inventory ─────────────────────────────────────────────────
// Auto-generated from .github/workflows/*.yml by build_workflow_inventory.py
// (run on every push that touches a workflow file). Renders structural
// metadata only — name, triggers, cron, workflow_run chains, concurrency,
// timeout — so the page reflects the actual YAML without manual editing.

interface InventoryWorkflow {
  file:              string;
  name:              string;
  triggers:          string[];
  crons:             string[];
  workflow_run_deps: string[];
  concurrency_group: string | null;
  timeout_minutes:   number | null;
}
interface DriftReport {
  uncovered_workflows:       { file: string; name: string; version: string }[];
  stale_curation:            string[];
  non_workflow_entries:      string[];
  uncovered_workflows_count: number;
  stale_curation_count:      number;
}
interface InventoryPayload {
  generated_at: string;
  count:        number;
  workflows:    InventoryWorkflow[];
  drift?:       DriftReport;
}

const TRIGGER_COLORS: Record<string, string> = {
  schedule:           "bg-sky-900/60 border-sky-700 text-sky-200",
  workflow_run:       "bg-indigo-900/60 border-indigo-700 text-indigo-200",
  workflow_dispatch:  "bg-slate-800 border-slate-700 text-slate-300",
  push:               "bg-amber-900/60 border-amber-700 text-amber-200",
  pull_request:       "bg-amber-900/40 border-amber-700/60 text-amber-200/80",
};

function TriggerChip({ kind }: { kind: string }) {
  const cls = TRIGGER_COLORS[kind] ?? "bg-slate-800 border-slate-700 text-slate-400";
  return (
    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded border font-mono ${cls}`}>
      {kind}
    </span>
  );
}

// Drift warning — surfaces workflows that exist in the YAML but have no
// curated row in the "Per-workflow → exact dashboard visual" table above.
// The auto inventory now self-detects this gap (see backend/scripts/
// build_workflow_inventory.py::compute_drift) so the page nags us instead
// of silently aging out of sync.
function WorkflowDriftPanel({ drift }: { drift: DriftReport | undefined }) {
  if (!drift) return null;
  const { uncovered_workflows, stale_curation } = drift;
  if (uncovered_workflows.length === 0 && stale_curation.length === 0) {
    return (
      <div className="text-[11px] text-emerald-400/80 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-3 py-2">
        ✓ Curated table is in sync with the workflow YAML — no drift.
      </div>
    );
  }
  return (
    <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-amber-200">
          Curated table drift — needs attention
        </h2>
        <p className="text-[11px] text-amber-300/80 mt-0.5">
          Comparison between <code>.github/workflows/*.yml</code> and the curated{" "}
          <code>ROWS</code> table in <code>app/data-map/page.tsx</code>. Refreshed on every push
          that changes a workflow file (see <code>0.2 Refresh Workflow Inventory</code>).
        </p>
      </div>

      {uncovered_workflows.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber-300/70 mb-1.5">
            {uncovered_workflows.length} workflow{uncovered_workflows.length === 1 ? "" : "s"} without a curated row
          </div>
          <ul className="text-[11px] font-mono space-y-0.5">
            {uncovered_workflows.map((w) => (
              <li key={w.file} className="text-amber-100">
                <span className="text-amber-400 inline-block w-12">{w.version}</span>
                <span className="text-amber-300/80 inline-block w-44">{w.file}</span>
                <span className="text-amber-100/70">{w.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stale_curation.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-rose-300/80 mb-1.5">
            {stale_curation.length} curated row{stale_curation.length === 1 ? "" : "s"} pointing to a workflow that no longer exists
          </div>
          <ul className="text-[11px] font-mono text-rose-200 space-y-0.5">
            {stale_curation.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// Both readers of the inventory take the payload as a prop. The fetch itself
// lives on the page: the drift banner sits above the sub-tab bar while the
// inventory table sits inside one sub-tab, and each fetching for itself would
// mean the same JSON over the wire two or three times.

/** Above the sub-tab bar, and only when something is actually wrong.
 *
 * Drift means the curated table and the workflow YAML disagree, which is a
 * page-wide fact — burying it inside a sub-tab would let a stale row go unseen
 * for as long as nobody happened to open that tab.
 *
 * A count and a link, not the list. The full panel is 38 rows deep at the time
 * of writing, and repeating that above every sub-tab pushes the content the
 * split was meant to surface below the fold on all five of them. The detail
 * lives once, in the Workflows tab, beside the table it is about. The clean
 * "in sync" state is not urgent and stays there too.
 */
function DriftBanner({ drift, onOpen }: { drift: DriftReport | undefined; onOpen: () => void }) {
  if (!drift) return null;
  const uncovered = drift.uncovered_workflows.length;
  const stale     = drift.stale_curation.length;
  if (uncovered === 0 && stale === 0) return null;
  const bits = [
    uncovered > 0 && `${uncovered} workflow${uncovered === 1 ? "" : "s"} without a curated row`,
    stale > 0 && `${stale} curated row${stale === 1 ? "" : "s"} pointing at a workflow that no longer exists`,
  ].filter(Boolean) as string[];
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap text-[11px] bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2">
      <span className="text-amber-200">
        Curated table drift — {bits.join(" · ")}.
      </span>
      <button onClick={onOpen} className="text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap">
        See the detail →
      </button>
    </div>
  );
}

function DriftStatus({ state }: { state: FetchState<InventoryPayload> }) {
  const { data, loading, error } = state;
  if (loading) return <div className="text-[11px] text-slate-500">Checking for drift…</div>;
  if (error)   return <div className="text-[11px] text-red-400">Drift check failed: {error.message}</div>;
  if (!data)   return null;
  return <WorkflowDriftPanel drift={data.drift} />;
}

function LiveWorkflowInventory({ state }: { state: FetchState<InventoryPayload> }) {
  const { data, loading, error } = state;

  if (loading) return <div className="text-[11px] text-slate-500">Loading inventory…</div>;
  if (error)   return <div className="text-[11px] text-red-400">Failed to load: {error.message}</div>;
  if (!data)   return null;

  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        <span className="text-slate-300">{data.count} workflows</span> auto-detected from{" "}
        <code className="text-slate-300">.github/workflows/*.yml</code> · regenerated on push by{" "}
        <code className="text-slate-300">build-workflow-inventory.yml</code> · last refresh{" "}
        <span className="text-slate-300 font-mono">{data.generated_at}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-slate-500 bg-slate-800/40">
              <th className="text-left px-2 py-1.5">File</th>
              <th className="text-left px-2 py-1.5">Name</th>
              <th className="text-left px-2 py-1.5">Triggers</th>
              <th className="text-left px-2 py-1.5">Cron</th>
              <th className="text-left px-2 py-1.5">Chains off</th>
              <th className="text-left px-2 py-1.5">Concurrency</th>
              <th className="text-right px-2 py-1.5">Timeout</th>
            </tr>
          </thead>
          <tbody>
            {data.workflows.map((w) => (
              <tr key={w.file} className="border-t border-slate-800/60 align-top">
                <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{w.file}</td>
                <td className="px-2 py-1.5 text-slate-200">{w.name}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {w.triggers.map((t) => <TriggerChip key={t} kind={t} />)}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.crons.length === 0 ? <span className="text-slate-600">—</span>
                    : w.crons.map((c, i) => <div key={i}>{c}</div>)}
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.workflow_run_deps.length === 0 ? <span className="text-slate-600">—</span>
                    : w.workflow_run_deps.map((d, i) => <div key={i} className="text-indigo-300">{d}</div>)}
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.concurrency_group ?? <span className="text-slate-600">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-300">
                  {w.timeout_minutes != null ? `${w.timeout_minutes}m` : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

// ── Sub-tabs ────────────────────────────────────────────────────────────────
// The page used to be one scroll carrying five unrelated jobs: an
// architecture diagram, nine pipeline diagrams, a curated workflow table, a
// run log and a CSV exporter. Nothing shared a question, so anything below
// the diagrams was effectively unreachable — and the nine Mermaid charts all
// rendered on load whether or not anyone wanted them.
//
// One tab per question, so each answers something you would arrive with.

type SubTab = "overview" | "pipelines" | "workflows" | "activity" | "downloads";

const TABS: { id: SubTab; label: string; hint: string }[] = [
  { id: "overview",  label: "Overview",
    hint: "How the pieces fit — the single price+OI archive and what fans out of it" },
  { id: "pipelines", label: "Pipelines",
    hint: "One diagram per dashboard tab: source · frequency → store → JSON → visual" },
  { id: "workflows", label: "Workflows",
    hint: "What each workflow does, when it runs, and what happens when it breaks" },
  { id: "activity",  label: "Activity",
    hint: "What actually ran over the last 7 days — durations, failures, skips" },
  { id: "downloads", label: "Downloads",
    hint: "Export any dataset behind the dashboard to CSV" },
];
const SUB_TABS = TABS.map((t) => t.id) as SubTab[];
const FLOW_IDS = TAB_DIAGRAMS.map((d) => d.id);

export default function DataMapPage() {
  // useUrlState reads `useSearchParams`, which Next 14 requires to live under
  // a Suspense boundary during static prerender (see /demand, /futures).
  return (
    <Suspense fallback={<div className="h-full bg-slate-950" />}>
      <DataMapPageInner />
    </Suspense>
  );
}

function DataMapPageInner() {
  const [tab, setTab] = useUrlState<SubTab>("tab", "overview", (raw) =>
    (SUB_TABS as string[]).includes(raw) ? (raw as SubTab) : "overview",
  );
  // Second-level state: which pipeline diagram is open. Deep-linkable as
  // `?tab=pipelines&flow=futures`, so "where does the COT chart get its data"
  // is one link rather than a scroll through nine diagrams.
  const [flow, setFlow] = useUrlState<string>("flow", FLOW_IDS[0], (raw) =>
    FLOW_IDS.includes(raw) ? raw : FLOW_IDS[0],
  );

  // Fetched once here and passed down — see DriftBanner / DriftStatus.
  const inventory = useFetchJson<InventoryPayload>("/data/workflows_inventory.json");

  const diagram = TAB_DIAGRAMS.find((d) => d.id === flow) ?? TAB_DIAGRAMS[0];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Data Map"
        subtitle="How every fetch flows through storage to each dashboard visual. Source of truth: docs/DATA_PLATFORM_MAP.md"
      />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 flex-wrap px-4 py-2 border-b border-slate-700 bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.hint}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-slate-800 text-amber-400 border border-slate-700"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {/* Renders on every sub-tab, but only when there IS drift. */}
        <DriftBanner drift={inventory.data?.drift} onOpen={() => setTab("workflows")} />

        {tab === "overview" && (
          <>
            <Card title="Architecture overview — the single-source view">
              <Mermaid chart={ARCHITECTURE} />
              <div className="text-[11px] text-slate-500 leading-relaxed mt-3 px-1">
                <p className="mb-1">
                  <span className="text-amber-400">★ contract_prices_archive.json</span> is the single coffee
                  OI+price source: one daily fetch (1.3) feeds it, and it fans out to the OI table, both
                  OI→FND charts, and the Industry Pulse price (via the max-OI rebuild in 2.3).
                </p>
                <p>Symbol convention — FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).</p>
              </div>
            </Card>

            <Card title="What's on each tab">
              <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
                {TABS.filter((t) => t.id !== "overview").map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setTab(t.id)}
                      className="text-amber-400 hover:text-amber-300 font-medium"
                    >
                      {t.label}
                    </button>
                    <span className="text-slate-500"> — {t.hint}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}

        {tab === "pipelines" && (
          <>
            {/* Only the selected chart mounts. Mermaid parses and lays out on
                render, so the nine-at-once version paid for every diagram to
                answer a question about one. */}
            <div className="flex items-center gap-1 flex-wrap">
              {TAB_DIAGRAMS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setFlow(d.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors border ${
                    flow === d.id
                      ? "bg-slate-800 text-amber-400 border-slate-600"
                      : "text-slate-500 hover:text-slate-300 border-slate-800"
                  }`}
                >
                  {d.title}
                </button>
              ))}
            </div>
            <Card title={diagram.title}>
              <p className="text-[11px] text-slate-500 mb-3 -mt-1">{diagram.blurb}</p>
              <Mermaid chart={diagram.chart} />
              <p className="text-[11px] text-slate-600 mt-3">
                Read left to right — source · frequency → store → JSON → visual.
              </p>
            </Card>
          </>
        )}

        {tab === "workflows" && (
          <>
            <Card title="Per-workflow → exact dashboard visual">
              <WorkflowTable />
            </Card>
            <Card title="Curated table vs the YAML">
              <DriftStatus state={inventory} />
            </Card>
            <Card title="Live workflow inventory — auto-generated from YAML">
              <LiveWorkflowInventory state={inventory} />
            </Card>
          </>
        )}

        {tab === "activity" && (
          <Card title="Workflow activity — what actually ran, last 7 days">
            <WorkflowActivity />
          </Card>
        )}

        {tab === "downloads" && (
          <Card title="Data downloads — export any dataset to CSV">
            <DataDownloads />
          </Card>
        )}
      </div>
    </div>
  );
}
