"use client";
import { useEffect, useState } from "react";
import FeedUnavailable from "@/components/FeedUnavailable";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { chgTone } from "@/lib/formatters";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegionRow {
  label: string;
  code: string;
  current: number;
  prev_month: number;
  avg_5y: number;
}

interface ProgressionRow {
  month: string;
  [col: string]: number | string;
}

interface ChartPoint {
  x: string;
  avg: number | null;
  y2223: number | null;
  y2324: number | null;
  y2425: number | null;
  y2526: number | null;
}

interface SellingData {
  brazil: { current: number; prev_month: number; avg_5y: number; crop_year?: string };
  regions: RegionRow[];
  progression_months: string[];
  progression: ProgressionRow[];
  chart: ChartPoint[];
}

interface HarvestPace {
  current: number;
  crop_year?: string | null;
  survey_label?: string;
  report_date?: string;
  source_article?: string;
}

// Dual-crop block: Safras-echo articles often report the current crop's
// overall commercialization AND the next crop's advance sales side by side.
// Backend emits one entry per crop year; status flags whether the figure is
// inventory tightness (current_crop) or future advance sales (new_crop_advance).
interface CropProgress {
  status: "current_crop" | "new_crop_advance";
  overall_sold_pct: number | null;
  arabica_sold_pct: number | null;
  conilon_sold_pct: number | null;
}

interface CropsMeta {
  updated?: string;
  source?: string;
}

interface FarmerSellingFile {
  source: string;
  report_date: string;
  arabica: SellingData;
  robusta: SellingData;
  harvest?: HarvestPace | null;
  crops?: Record<string, CropProgress>;
  crops_meta?: CropsMeta;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function cellColor(v: number): string {
  if (v >= 90) return "#22c55e";
  if (v >= 75) return "#86efac";
  if (v >= 60) return "#fde68a";
  if (v >= 45) return "#fdba74";
  return "#fca5a5";
}

function gapColor(gap: number): string {
  if (gap >= 5)  return "#22c55e";
  if (gap >= 0)  return "#86efac";
  if (gap >= -5) return "#fde68a";
  if (gap >= -15)return "#fb923c";
  return "#ef4444";
}

// ── Dual-crop strip (current vs new-crop advance) ─────────────────────────────
// Renders one row per crop year present in data.crops. Each row shows the
// overall %, plus arabica/conilon if the echo article broke them out. The
// "Advance" badge separates new-crop forward sales from real inventory.

function CropRow({ year, p }: { year: string; p: CropProgress }) {
  const isAdvance = p.status === "new_crop_advance";
  const overall = p.overall_sold_pct;
  const cellTone = (v: number | null) =>
    v == null ? "text-slate-600" : isAdvance ? "text-sky-300" : "text-amber-300";
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 flex items-center gap-3">
      <div className="w-20 shrink-0">
        <div className="text-[10px] font-mono font-bold text-slate-200">{year}</div>
        <div className={`text-[8px] uppercase tracking-wider ${isAdvance ? "text-sky-400/80" : "text-amber-400/80"}`}>
          {isAdvance ? "advance" : "current"}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-1">
          <span className={`text-xl font-extrabold ${cellTone(overall)}`}>
            {overall ?? "—"}
          </span>
          <span className="text-[8px] text-slate-500">% overall</span>
        </div>
        <div className="w-full max-w-md bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1">
          <div
            className={`h-full rounded-full ${isAdvance ? "bg-sky-500/70" : "bg-amber-500"}`}
            style={{ width: `${Math.min(100, overall ?? 0)}%` }}
          />
        </div>
      </div>
      <div className="flex gap-3 text-[8px]">
        <span className="text-slate-500">
          Arabica <span className={`font-bold ${cellTone(p.arabica_sold_pct)}`}>
            {p.arabica_sold_pct ?? "—"}{p.arabica_sold_pct == null ? "" : "%"}
          </span>
        </span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-500">
          Conilon <span className={`font-bold ${cellTone(p.conilon_sold_pct)}`}>
            {p.conilon_sold_pct ?? "—"}{p.conilon_sold_pct == null ? "" : "%"}
          </span>
        </span>
      </div>
    </div>
  );
}

function DualCropStrip({ crops, meta }: { crops: Record<string, CropProgress>; meta?: CropsMeta }) {
  // Current crop first, then new-crop advance; within each group, ascending year.
  const ordered = Object.entries(crops).sort(([a, pa], [b, pb]) => {
    if (pa.status !== pb.status) return pa.status === "current_crop" ? -1 : 1;
    return a.localeCompare(b);
  });
  if (ordered.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[8px] text-slate-500 uppercase tracking-wide">
          Dual-crop commitment · Safras echo
        </div>
        {meta?.updated && (
          <div className="text-[7px] text-slate-600">upd {meta.updated}</div>
        )}
      </div>
      <div className="space-y-1.5">
        {ordered.map(([year, p]) => <CropRow key={year} year={year} p={p} />)}
      </div>
    </div>
  );
}

// ── Regional cards ────────────────────────────────────────────────────────────

function RegionCard({ r }: { r: RegionRow }) {
  const momDelta = r.current - r.prev_month;
  const avgGap   = r.current - r.avg_5y;
  const gc       = gapColor(avgGap);
  return (
    <div className="bg-slate-900 border border-slate-700/60 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-bold text-slate-300 uppercase tracking-wide">{r.label}</span>
        <span className="text-[8px] font-mono text-slate-600">{r.code}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-extrabold" style={{ color: cellColor(r.current) }}>
          {r.current}
        </span>
        <span className="text-[8px] text-slate-500">%</span>
      </div>
      <div className="flex gap-2 text-[7px]">
        <span className="text-slate-500">
          MoM <span className={momDelta >= 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
            {momDelta > 0 ? "+" : ""}{momDelta}pp
          </span>
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">
          vs avg <span className="font-bold" style={{ color: gc }}>
            {avgGap > 0 ? "+" : ""}{avgGap}pp
          </span>
        </span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${r.current}%`, background: cellColor(r.current) }} />
      </div>
      <div className="text-[6px] text-slate-700">5yr avg: {r.avg_5y}%</div>
    </div>
  );
}

// ── Seasonal line chart ────────────────────────────────────────────────────────

function SeasonChart({ chart, cropYear }: { chart: ChartPoint[]; cropYear?: string }) {
  // Filter out boundary-marker rows (e.g. "Apr*") where the current year has no data yet
  const filteredChart = chart.filter(pt => !pt.x.endsWith("*") || pt.y2526 != null);
  const isCropComplete = chart.length > 0 && chart[chart.length - 1].y2526 == null;
  return (
    <div>
    {isCropComplete && (
      <div className="text-[7px] text-amber-500/70 mb-1 text-right">
        {cropYear ?? "25/26"} crop year complete · 26/27 monitoring begins Apr 2026
      </div>
    )}
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filteredChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v}%`} />
          <ReferenceLine y={100} stroke="#334155" strokeDasharray="2 4" />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => {
              const n = String(name);
              const labels: Record<string, string> = { avg: "5yr avg", y2223: "22/23", y2324: "23/24", y2425: "24/25", y2526: "25/26" };
              return [`${v}%`, labels[n] ?? n];
            }}
          />
          <Line type="monotone" dataKey="y2223" stroke="#475569" strokeWidth={1} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="y2324" stroke="#64748b" strokeWidth={1} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="y2425" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeOpacity={0.8} />
          <Line type="monotone" dataKey="avg"   stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          <Line type="monotone" dataKey="y2526" stroke="#f59e0b" strokeWidth={2.5}
            dot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

// ── Progression heatmap table ─────────────────────────────────────────────────

function ProgressionTable({ data }: { data: SellingData }) {
  // Filter out corrupted rows where month doesn't match expected MMM-YY format
  const validRows = data.progression.filter(r => /^[A-Za-z]{3}-\d{2}$/.test(String(r.month)));
  const columns = Object.keys(data.progression[0]).filter(k => k !== "month");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[8px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-600 font-bold pb-1.5 pr-2 sticky left-0 bg-slate-800">Month</th>
            {columns.map(col => (
              <th key={col} className="text-center text-slate-500 font-bold pb-1.5 px-1 min-w-[36px]">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {validRows.map((row) => {
            const isLatest = row === validRows[validRows.length - 1];
            return (
              <tr key={row.month}
                className={`border-t border-slate-700/40 ${isLatest ? "border-t-2 border-t-amber-500/40" : ""}`}>
                <td className={`py-1 pr-2 font-bold sticky left-0 bg-slate-800 ${isLatest ? "text-amber-400" : "text-slate-500"}`}>
                  {row.month}
                </td>
                {columns.map(col => {
                  const v = Number(row[col]);
                  return (
                    <td key={col} className="text-center py-1 px-0.5">
                      <span className="px-1 py-0.5 rounded text-[7px] font-bold"
                        style={{ color: cellColor(v), background: cellColor(v) + "22" }}>
                        {v}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FarmerSellingPanel() {
  const [data, setData] = useState<FarmerSellingFile | null>(null);
  const [variety, setVariety] = useState<"arabica" | "robusta">("arabica");

  // The failure used to go to the console only; the reader saw a gap.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/data/farmer_selling_brazil.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((err) => { console.error("[FarmerSellingPanel] fetch failed:", err); setFailed(true); });
  }, []);

  if (!data) return failed ? <FeedUnavailable what="Farmer selling behaviour" file="farmer_selling_brazil.json" /> : null;

  const vd = data[variety];
  const brazil = vd.brazil;
  const momDelta = brazil.current - brazil.prev_month;
  const avgGap   = brazil.current - brazil.avg_5y;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            Farmer Selling Pace · Brazil
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            % of total crop committed to market · as of {data.report_date}
          </div>
        </div>
        {/* Variety tabs */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(["arabica", "robusta"] as const).map(v => (
            <button key={v} onClick={() => setVariety(v)}
              className={`px-3 py-1 rounded text-[10px] font-semibold transition-colors ${
                variety === v ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Dual-crop commitment (current crop + new-crop advance sales) */}
      {data.crops && Object.keys(data.crops).length > 0 && (
        <DualCropStrip crops={data.crops} meta={data.crops_meta} />
      )}

      {/* Harvest pace (crop-wide; Safras) */}
      {data.harvest && typeof data.harvest.current === "number" && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-4">
          <div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-1">
              Harvest pace · Brazil{data.harvest.crop_year ? ` · ${data.harvest.crop_year}` : ""}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-extrabold text-amber-400">{data.harvest.current}</span>
              <span className="text-sm text-slate-500">% reaped</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="w-full max-w-xs bg-slate-800 rounded-full h-2 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, data.harvest.current)}%` }} />
            </div>
          </div>
          <div className="text-right text-[7px] text-slate-600">
            {data.harvest.report_date ? `upd ${data.harvest.report_date}` : ""}
          </div>
        </div>
      )}

      {/* Brazil headline */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-6">
        <div>
          <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-1">Brazil · {vd.brazil.crop_year ?? "25/26"}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold" style={{ color: cellColor(brazil.current) }}>
              {brazil.current}
            </span>
            <span className="text-sm text-slate-500">%</span>
          </div>
        </div>
        <div className="space-y-1.5 text-[9px]">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-24">vs prev month</span>
            <span className={`font-bold ${chgTone(momDelta)}`}>
              {momDelta > 0 ? "+" : ""}{momDelta} pp
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-24">vs 5yr avg ({brazil.avg_5y}%)</span>
            <span className="font-bold" style={{ color: gapColor(avgGap) }}>
              {avgGap > 0 ? "+" : ""}{avgGap} pp
            </span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[7px] text-slate-600 mb-1">Selling progress</div>
          <div className="w-32 bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${brazil.current}%`, background: cellColor(brazil.current) }} />
          </div>
          <div className="text-[7px] text-slate-700 mt-0.5">
            5yr avg: <span className="text-slate-500">{brazil.avg_5y}%</span>
          </div>
        </div>
      </div>

      {/* Regional cards */}
      <div>
        <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-2">By region</div>
        <div className={`grid gap-2 ${variety === "arabica" ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4"}`}>
          {vd.regions.map(r => <RegionCard key={r.code} r={r} />)}
        </div>
      </div>

      {/* Chart + progression side by side on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4">
        {/* Seasonal chart */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[8px] text-slate-500 uppercase tracking-wide">Seasonal progression</div>
            <div className="flex gap-3 text-[7px] text-slate-600">
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-slate-600 inline-block" />22/23–24/25</span>
              <span className="flex items-center gap-1 text-indigo-400"><span className="w-3 h-px bg-indigo-400 inline-block" />avg</span>
              <span className="flex items-center gap-1 text-amber-400"><span className="w-3 h-px bg-amber-400 inline-block" />25/26</span>
            </div>
          </div>
          <SeasonChart chart={vd.chart} cropYear={vd.brazil.crop_year} />
        </div>

        {/* Progression table */}
        <div>
          <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-2">Monthly detail · 25/26</div>
          <ProgressionTable data={vd} />
        </div>
      </div>

      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Source: {data.source}. Historical chart lines estimated from chart visual — exact data from progression table.
        Avg = 5-year average. Gap vs avg indicates pace relative to historical norm.
      </div>
    </div>
  );
}
