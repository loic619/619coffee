"use client";
/**
 * Monthly exports: what the mid-month print implied, against what the month
 * turned out to be. Data: export_expectations.json (exporters/export_expectations.py).
 *
 *   Brazil  — Cecafé daily embarques through day 15, scaled to the month.
 *   Vietnam — Customs first-half (k1) tonnes ÷ the median k1 share measured
 *             on the Research tab (it is not ½).
 *
 * The open month carries an expectation and no actual yet; closed months
 * carry both and the error the extrapolation made. Positive error = the
 * mid-month overstated the month.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import FeedUnavailable from "@/components/FeedUnavailable";
import { MONTH_ABBR } from "@/lib/formatters";

interface Row { month: string; expected: number | null; actual: number | null; error_pct: number | null; defect: string | null; k1?: number; cum_at_basis?: number; share_used?: number | null; share_actual?: number | null; method?: "share" | "calendar" }
interface OriginBlock { unit: "bags" | "tonnes"; method: string; rows: Row[]; ratio?: number | null; ratio_n?: number; basis_day?: number }
interface Doc { generated_at: string; brazil: OriginBlock; vietnam: OriginBlock }

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };
const C_EXPECTED = "#94a3b8";
const C_ACTUAL: Record<"brazil" | "vietnam", string> = { brazil: "#ef4444", vietnam: "#0ea5e9" };

const toKt = (v: number | null, unit: OriginBlock["unit"]) =>
  v == null ? null : Math.round((unit === "bags" ? v * 60 / 1e6 : v / 1000) * 10) / 10;
const label = (ym: string) => `${MONTH_ABBR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(2, 4)}`;
const pct = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
const tone = (p: number | null) => (p == null ? "text-slate-500" : Math.abs(p) <= 5 ? "text-emerald-300" : Math.abs(p) <= 15 ? "text-amber-300" : "text-rose-300");

export default function ExpectedVsActual({ origin, isReportMode = false }: { origin: "brazil" | "vietnam"; isReportMode?: boolean }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/data/export_expectations.json")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDoc)
      .catch(() => setFailed(true));
  }, []);

  const block = doc?.[origin];
  const rows = useMemo(() => (block?.rows ?? []).slice(-12).map(r => ({
    ...r,
    label: label(r.month),
    expectedKt: toKt(r.expected, block!.unit),
    actualKt: toKt(r.actual, block!.unit),
  })), [block]);

  // Track record over the closed, non-defective months shown.
  const scored = rows.filter(r => r.error_pct != null);
  const mae = scored.length ? scored.reduce((s, r) => s + Math.abs(r.error_pct!), 0) / scored.length : null;
  const bias = scored.length ? scored.reduce((s, r) => s + r.error_pct!, 0) / scored.length : null;
  const open = rows.filter(r => r.actual == null);

  if (failed) return <FeedUnavailable what="Mid-month expectations" file="export_expectations.json" />;
  if (!block) return null;
  if (!rows.length) return null;

  const title = origin === "brazil" ? "Brazil — Monthly exports · expected at mid-month vs actual"
                                    : "Vietnam — Monthly exports · expected at mid-month vs actual";
  const basis = origin === "brazil"
    ? `Cecafé embarques through day ${block.basis_day ?? 15} ÷ ${block.ratio != null ? block.ratio.toFixed(3) : "—"} (median day-15 share over ${block.ratio_n ?? 0} closed months; loadings are back-loaded, so ×2 understates)`
    : `Customs first-half (k1) ÷ ${block.ratio != null ? block.ratio.toFixed(3) : "median"} (median k1 share over ${block.ratio_n ?? "—"} months)`;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          <div className="text-[10px] text-slate-500">{basis} · kt ({origin === "brazil" ? "60-kg bags × 60 / 1000" : "tonnes / 1000"})</div>
        </div>
        {mae != null && (
          <div className="text-[10px] font-mono text-slate-400">
            {scored.length} months scored · mean |error| <span className="text-slate-200">{mae.toFixed(1)}%</span>
            {" · "}bias <span className={tone(bias)}>{pct(bias)}</span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%" barGap={2}>
          <defs>
            <pattern id={`eva-hatch-${origin}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={C_EXPECTED} opacity={0.25} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={C_EXPECTED} strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} width={40} tickFormatter={(v: number) => `${v}`} />
          <Tooltip contentStyle={TT}
            labelFormatter={(l, payload) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!r) return String(l);
              const share = r.share_actual != null ? ` · first half was ${(r.share_actual * 100).toFixed(0)}% of the month` : "";
              const how = r.method === "calendar" ? " · calendar scale (no share on file yet)" : "";
              return `${l} · error ${pct(r.error_pct)}${share}${how}${r.defect ? " · " + r.defect : ""}`;
            }}
            formatter={(v, name) => [v == null ? "—" : `${Number(v).toFixed(1)} kt`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} formatter={(v) => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <ReferenceLine y={0} stroke="#64748b" />
          <Bar dataKey="expectedKt" name="Expected at mid-month" fill={`url(#eva-hatch-${origin})`} stroke={C_EXPECTED} strokeWidth={1} radius={[2, 2, 0, 0]} maxBarSize={26}>
            {rows.map(r => <Cell key={r.month} fillOpacity={r.defect ? 0.35 : 1} />)}
          </Bar>
          <Bar dataKey="actualKt" name="Actual" fill={C_ACTUAL[origin]} radius={[2, 2, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
      {/* Error strip: one cell per month, so the record reads without hovering. */}
      <div className={`grid gap-1 mt-2 ${isReportMode ? "grid-cols-6" : "grid-cols-4 sm:grid-cols-6 lg:grid-cols-12"}`}>
        {rows.map(r => (
          <div key={r.month} className="rounded border border-slate-800 bg-slate-950/40 px-1.5 py-1 text-center" title={r.defect ?? undefined}>
            <div className="text-[9px] text-slate-500">{r.label}</div>
            <div className={`text-[10px] font-mono ${r.actual == null ? "text-slate-400" : tone(r.error_pct)}`}>
              {r.actual == null ? "open" : r.defect ? "n/a" : pct(r.error_pct)}
            </div>
          </div>
        ))}
      </div>
      {open.length > 0 && (
        <div className="text-[10px] text-slate-500 mt-2">
          Open: {open.map(r => `${r.label} expected ${r.expectedKt?.toFixed(1)} kt`).join(" · ")} — scored when the month&apos;s figure lands.
        </div>
      )}
    </div>
  );
}
