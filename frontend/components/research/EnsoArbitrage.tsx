"use client";
// ENSO and the coffee arbitrage — the research-tab rendering of the study in
// backend/research/enso_arbitrage. The paper (REPORT.md) is the reference;
// this page draws the same tables and figures from the exporter's payload and
// adds no number of its own.
//
// Colour: El Niño is always warm red, La Niña always cool blue, neutral grey —
// the diverging pair, used for STATE and never for a series identity. Series
// (the premium, its futures/B3 twin) use the yellow and aqua categorical slots
// so a red line can never be mistaken for an El Niño mark.
import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, ReferenceLine,
  Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { useFetchJson } from "@/lib/useFetchJson";
import { Paper, H2, H, P, UL, LI, Code, Highlight, RefTable, DataFiles } from "./methodology/prose";

const NINO = "#e66767";
const NINA = "#3987e5";
const NEUTRAL = "#64748b";
const C_PREM = "#c98500";     // the premium — categorical slot 4 (dark step)
const C_TWIN = "#199e70";     // its companion series (futures twin / B3) — slot 3
const C_SIG = "#d95926";      // "survives the test" mark — slot 2, used once, as status
const GRID = "#1e293b";
const TT = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };
const TICK = { fontSize: 9, fill: "#64748b" };
const PAPER_URL = "https://github.com/loic619/619coffee/blob/main/backend/research/enso_arbitrage/REPORT.md";

// ── payload ──────────────────────────────────────────────────────────────────

interface LagRow {
  event: string; arbitrage: string; n_events: number | null; direction: string | null;
  peak_lag_months: number | null; mean_change_log: number | null; ci_lo: number | null; ci_hi: number | null;
  consistency: number | null; p_placebo_at_peak: number | null; p_placebo_family: number | null;
  pct_change_in_premium_ratio: number | null; usd_t_at_sample_median_price: number | null;
  ccf_best_lag: number | null; ccf_r: number | null; ccf_p_bartlett: number | null; ccf_q_bh: number | null;
  ccf_p_max_surrogate: number | null; ccf_n_eff: number | null;
}
interface SeriesRow { m: string; oni: number | null; ind: number | null; fut: number | null; b1: number | null; b3: number | null; regime: string | null }
interface CcfPt { lag: number; r: number | null; rho: number | null; n: number | null; n_eff: number | null; band: number | null; p_bartlett: number | null; p_surrogate: number | null; q_bh: number | null }
interface EvRow { h: number; n: number; mean: number | null; median: number | null; q25: number | null; q75: number | null; min: number | null; max: number | null; consistency: number | null; ci_lo: number | null; ci_hi: number | null; placebo_q025: number | null; placebo_q975: number | null; p_placebo: number | null }
interface EvPath { onset: string; values: (number | null)[] }
interface EvBlock { summary: EvRow[]; paths?: EvPath[] }
interface Payload {
  generated_at: string;
  summary: {
    tier1: { first: string; last: string; n: number }; tier2: { months: number; first: string; last: string };
    n_tests_ccf: number; n_families: number; episodes_all: number; episodes_collapsed: number;
    episodes_in_tier1: { el_nino: number; la_nina: number }; episodes_in_tier2: { el_nino: number; la_nina: number };
    event_placebo_family_p: { el_nino: number; la_nina: number };
    oos: Record<string, { best_lag_discovery: number; r_discovery: number; p_discovery: number; n_discovery: number; r_validation?: number; p_validation?: number; n_validation?: number; same_sign?: boolean }>;
    weather_regression: { n: number; enso_coef_without: number; enso_p_without: number; enso_coef_with: number; enso_p_with: number; r2_without: number; r2_with: number };
    price_levels_usd_t: { other_milds_median_1980_on: number; other_milds_latest: number };
    arb_volatility: { tier1_sd_diff3_log: number; tier1_sd_level_log: number; tier2_sd_diff3_log: number };
    tier1_families: number; tier1_families_pmax_lt_05: number; tier1_families_q_lt_10: number; tier1_min_pmax: number;
    tier1_lag_tests: number; tier1_lag_tests_p05: number; tier1_lag_tests_q10: number;
    discovery_end: string;
    notes?: { oni_provenance?: string; vietnam_provenance?: string };
  };
  lag_response: LagRow[];
  series: SeriesRow[];
  episodes: { phase: string; onset: string; end: string; n_months: number; peak: number; peak_month: string }[];
  ccf: Record<"tier1_diff3" | "tier1_level" | "tier1_pos_diff3" | "tier1_neg_diff3" | "tier2_diff3" | "tier2_level", CcfPt[]>;
  events: { tier1: Record<"el_nino" | "la_nina", EvBlock>; tier1_unmerged: Record<"el_nino" | "la_nina", EvBlock>; tier2: Record<"el_nino" | "la_nina", EvBlock> };
  episode_table: { onset: string; phase: string; peak_oni: number | null; peak_month: string; duration_m: number | null; merged_episodes: number | null; pre_level: number | null; chg_3m: number | null; chg_6m: number | null; chg_9m: number | null; chg_12m: number | null; chg_18m: number | null; chg_24m: number | null }[];
  regime_grid: { regime: string; lag: number; n: number | null; r: number | null; p_bartlett: number | null }[];
  robustness: { transform: string; index: string; best_lag: number | null; r: number | null; n_eff: number | null; p_bartlett: number | null; q_bh: number | null; p_max_surrogate: number | null; ci_block_lo: number | null; ci_block_hi: number | null }[];
  mechanism: { from: string; to: string; lag: number | null; r: number | null; n_eff: number | null; p_bartlett: number | null; p_max_surrogate: number | null }[];
  regressions: { lag: number; spec: string; var: string; coef: number | null; se_hac: number | null; t: number | null; p: number | null; n: number | null }[];
  predictive: { phase: string; signal: string; sample: string; h: number; n_signals: number | null; mean: number | null; median: number | null; hit_rate: number | null; ci_lo: number | null; ci_hi: number | null; neutral_mean: number | null; p_vs_neutral: number | null }[];
  signals: { total: number; confirmed: number; by_phase: Record<"el_nino" | "la_nina", { n: number; confirmed: number }> };
}

type Phase = "el_nino" | "la_nina";
const PHASE_LABEL: Record<Phase, string> = { el_nino: "El Niño", la_nina: "La Niña" };
const f3 = (v: number | null | undefined, nd = 3) => (v == null ? "—" : v.toFixed(nd));
const fp = (v: number | null | undefined) => (v == null ? "—" : v < 0.001 ? "<0.001" : v.toFixed(3));
const sgn = (v: number | null | undefined, nd = 3) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(nd)}`);
const pct = (v: number | null | undefined, nd = 0) => (v == null ? "—" : `${Math.round(v * 100 * Math.pow(10, nd)) / Math.pow(10, nd)}%`);

/** Diverging fill for a correlation: cool for negative, warm for positive, grey at zero. */
function divColor(r: number | null, vmax: number): string {
  if (r == null) return "transparent";
  const t = Math.min(Math.abs(r) / vmax, 1);
  const a = 0.12 + 0.75 * t;
  return r < 0 ? `rgba(57,135,229,${a.toFixed(2)})` : `rgba(230,103,103,${a.toFixed(2)})`;
}

// ── charts ───────────────────────────────────────────────────────────────────

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          className={`rounded border px-2 py-0.5 text-[10px] transition ${
            value === v ? "border-sky-500 bg-sky-600 font-semibold text-slate-950"
                        : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, note, children, right }: { title: string; note?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{title}</div>
        {right}
      </div>
      {note && <div className="mb-2 text-[10px] text-slate-500">{note}</div>}
      {children}
    </div>
  );
}

/** ONI bars over a premium line, as two stacked single-axis panels sharing x. */
function LongRun({ rows, keyA, labelA, keyB, labelB, title, note }: {
  rows: SeriesRow[]; keyA: "ind" | "b1"; labelA: string; keyB: "fut" | "b3"; labelB: string; title: string; note: string;
}) {
  const yearTicks = useMemo(() => rows.filter(r => r.m.slice(5) === "01" && (keyA === "b1" || Number(r.m.slice(0, 4)) % 5 === 0)).map(r => r.m), [rows, keyA]);
  const fmtM = (m: string) => (keyA === "b1" ? m : m.slice(0, 4));
  return (
    <Panel title={title} note={note}>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={0}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="m" ticks={yearTicks} tickFormatter={fmtM} tick={TICK} interval={0} />
            <YAxis tick={TICK} width={40} domain={[-2.5, 3]} label={{ value: "ONI °C", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
            <ReferenceLine y={0.5} stroke={NINO} strokeDasharray="3 3" />
            <ReferenceLine y={-0.5} stroke={NINA} strokeDasharray="3 3" />
            <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(2), "ONI"]} labelFormatter={(l) => String(l)} />
            <Bar dataKey="oni" isAnimationActive={false}>
              {rows.map(r => (
                <Cell key={r.m} fill={r.oni == null ? "transparent" : r.oni >= 0.5 ? NINO : r.oni <= -0.5 ? NINA : NEUTRAL} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="m" ticks={yearTicks} tickFormatter={fmtM} tick={TICK} interval={0} />
            <YAxis tick={TICK} width={40} label={{ value: "log premium", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#475569" />
            <Tooltip contentStyle={TT} formatter={(v, n) => [Number(v).toFixed(3), n === keyA ? labelA : labelB]} labelFormatter={(l) => String(l)} />
            <Line type="monotone" dataKey={keyA} name={keyA} stroke={C_PREM} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey={keyB} name={keyB} stroke={C_TWIN} dot={false} strokeWidth={1.3} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px] text-slate-400">
        <span><span className="inline-block h-2 w-4 align-middle" style={{ background: C_PREM }} /> {labelA}</span>
        <span><span className="inline-block h-2 w-4 align-middle" style={{ background: C_TWIN }} /> {labelB}</span>
        <span><span className="inline-block h-2 w-2 align-middle" style={{ background: NINO }} /> ONI ≥ +0.5 El Niño</span>
        <span><span className="inline-block h-2 w-2 align-middle" style={{ background: NINA }} /> ONI ≤ −0.5 La Niña</span>
      </div>
    </Panel>
  );
}

function CcfChart({ pts, title, note }: { pts: CcfPt[]; title: string; note: string }) {
  const rows = useMemo(() => pts.map(p => ({
    ...p,
    band: p.band == null ? null : [-p.band, p.band] as [number, number],
    sig: p.q_bh != null && p.q_bh < 0.10 ? p.r : null,
    sur: p.p_surrogate != null && p.p_surrogate < 0.05 ? p.r : null,
  })), [pts]);
  const has = rows.some(r => r.r != null);
  // The band would otherwise set the axis and fill the plot edge to edge — the
  // reader must see the band's edges to read "r never leaves it".
  const ymax = useMemo(() => {
    const vals = pts.reduce((acc: number[], p) => acc.concat([Math.abs(p.r ?? 0), Math.abs(p.rho ?? 0), p.band ?? 0]), []);
    const m = Math.max.apply(null, vals.concat([0.05]));
    return Math.ceil(m * 1.45 * 20) / 20;
  }, [pts]);
  return (
    <Panel title={title} note={note}>
      <div style={{ height: 240 }}>
        {has ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis dataKey="lag" type="number" domain={[-24, 24]} ticks={[-24, -18, -12, -6, 0, 6, 12, 18, 24]} tick={TICK}
                label={{ value: "lag k (months) — k > 0: ENSO leads the arbitrage; k < 0: the arbitrage leads ENSO", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 9 }} />
              <YAxis tick={TICK} width={40} domain={[-ymax, ymax]} allowDataOverflow />
              <ReferenceLine y={0} stroke="#475569" />
              <ReferenceLine x={0} stroke="#475569" />
              <Tooltip contentStyle={TT} labelFormatter={(l) => `lag ${l}`}
                formatter={(v, n, item) => {
                  if (n === "band") { const b = item?.payload?.band as [number, number] | null; return [b ? `±${b[1].toFixed(3)}` : "—", "surrogate 95% band"]; }
                  const p = item?.payload as CcfPt;
                  if (n === "r") return [`${Number(v).toFixed(3)}  (n_eff ${p.n_eff ?? "—"}, Bartlett p ${fp(p.p_bartlett)}, surrogate p ${fp(p.p_surrogate)}, BH q ${fp(p.q_bh)})`, "Pearson r"];
                  if (n === "rho") return [Number(v).toFixed(3), "Spearman ρ"];
                  return [Number(v).toFixed(3), String(n)];
                }} />
              <Area dataKey="band" stroke="none" fill="#94a3b8" fillOpacity={0.18} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="r" stroke={C_PREM} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="rho" stroke={C_PREM} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
              <Scatter dataKey="sig" fill={C_SIG} isAnimationActive={false} />
              <Scatter dataKey="sur" fill="none" stroke="#e2e8f0" strokeWidth={1.5} shape="circle" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <P className="text-slate-500">insufficient overlap</P>}
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px] text-slate-400">
        <span><span className="inline-block h-0.5 w-4 align-middle" style={{ background: C_PREM }} /> Pearson r (dashed: Spearman)</span>
        <span><span className="inline-block h-2 w-4 align-middle bg-slate-400/30" /> surrogate 95 % band — no relationship, same persistence</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: C_SIG }} /> BH q &lt; 0.10</span>
        <span><span className="inline-block h-2 w-2 rounded-full border border-slate-200 align-middle" /> surrogate p &lt; 0.05</span>
      </div>
    </Panel>
  );
}

function EventChart({ block, phase, title, note }: { block: EvBlock; phase: Phase; title: string; note: string }) {
  const col = phase === "el_nino" ? NINO : NINA;
  const paths = useMemo(() => block.paths ?? [], [block]);
  const rows = useMemo(() => block.summary.map(s => {
    const row: Record<string, number | null | [number, number]> = {
      h: s.h, mean: s.mean, median: s.median,
      iqr: s.q25 != null && s.q75 != null ? [s.q25, s.q75] : null,
      placebo: s.placebo_q025 != null && s.placebo_q975 != null ? [s.placebo_q025, s.placebo_q975] : null,
    };
    paths.forEach((p, i) => { row[`p${i}`] = p.values[s.h] ?? null; });
    return row;
  }), [block, paths]);
  const n = block.summary.length ? Math.max.apply(null, block.summary.map(s => s.n)) : 0;
  if (!n) {
    return <Panel title={title} note={note}><P className="text-slate-500">No onset of this phase inside the series.</P></Panel>;
  }
  return (
    <Panel title={title} note={note}>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis dataKey="h" type="number" domain={[0, 24]} ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]} tick={TICK}
              label={{ value: "months after onset", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 9 }} />
            <YAxis tick={TICK} width={44} label={{ value: "Δ log premium", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#475569" />
            <Tooltip contentStyle={TT} labelFormatter={(l) => `+${l} months`}
              formatter={(v, name) => {
                const s = String(name);
                if (s === "placebo" || s === "iqr") { const b = v as unknown as [number, number]; return [`${b[0].toFixed(3)} … ${b[1].toFixed(3)}`, s === "iqr" ? "inter-quartile range" : "placebo 95% band"]; }
                if (s.charAt(0) === "p" && s !== "placebo") return [Number(v).toFixed(3), paths[Number(s.slice(1))]?.onset ?? s];
                return [Number(v).toFixed(3), s];
              }} />
            <Area dataKey="placebo" stroke="none" fill="#94a3b8" fillOpacity={0.18} isAnimationActive={false} connectNulls />
            <Area dataKey="iqr" stroke="none" fill={col} fillOpacity={0.2} isAnimationActive={false} connectNulls />
            {paths.map((_, i) => (
              <Line key={i} type="monotone" dataKey={`p${i}`} stroke="#94a3b8" strokeOpacity={0.55} strokeWidth={0.8} dot={false} isAnimationActive={false} connectNulls />
            ))}
            <Line type="monotone" dataKey="mean" stroke={col} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="median" stroke={col} strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px] text-slate-400">
        <span><span className="inline-block h-0.5 w-4 align-middle" style={{ background: col }} /> mean of n = {n} episodes (dashed: median)</span>
        <span><span className="inline-block h-2 w-4 align-middle" style={{ background: col, opacity: 0.25 }} /> inter-quartile range</span>
        <span><span className="inline-block h-2 w-4 align-middle bg-slate-400/30" /> placebo 95 % band (same n of random neutral onsets)</span>
        <span><span className="inline-block h-0.5 w-4 align-middle bg-slate-400/60" /> each episode</span>
      </div>
    </Panel>
  );
}

function RegimeGrid({ grid }: { grid: Payload["regime_grid"] }) {
  const regimes: [string, string][] = [["el_nino", "El Niño"], ["neutral", "neutral"], ["la_nina", "La Niña"]];
  const lags = Array.from({ length: 25 }, (_, k) => k);
  const byKey = useMemo(() => {
    const m: Record<string, { r: number | null; p: number | null }> = {};
    grid.forEach(g => { m[`${g.regime}|${g.lag}`] = { r: g.r, p: g.p_bartlett }; });
    return m;
  }, [grid]);
  const vmax = useMemo(() => Math.max(0.05, Math.max.apply(null, grid.map(g => Math.abs(g.r ?? 0)))), [grid]);
  return (
    <div className="my-3 overflow-x-auto">
      <div className="grid gap-px text-[9px]" style={{ gridTemplateColumns: `64px repeat(25, minmax(26px, 1fr))` }}>
        <div />
        {lags.map(k => <div key={k} className="text-center text-slate-500">{k}</div>)}
        {regimes.map(([id, label]) => (
          [<div key={`${id}-l`} className="pr-1 text-right text-slate-400">{label}</div>].concat(
            lags.map(k => {
              const c = byKey[`${id}|${k}`];
              const sig = c && c.p != null && c.p < 0.05;
              return (
                <div key={`${id}-${k}`} title={c ? `${label}, lag ${k}: r = ${f3(c.r)}, Bartlett p = ${fp(c.p)}` : ""}
                  className="flex h-6 items-center justify-center rounded-sm font-mono text-slate-200"
                  style={{ background: divColor(c?.r ?? null, vmax) }}>
                  {c?.r == null ? "" : `${c.r > 0 ? "+" : ""}${c.r.toFixed(2)}${sig ? "•" : ""}`}
                </div>
              );
            }))
        ))}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">rows: ENSO state at t−k · columns: lag k (months, ENSO leads) · cell: r between ONI(t−k) and the 3-month change of the premium at t · • Bartlett p &lt; 0.05, uncorrected</div>
    </div>
  );
}

function MechanismChart({ rows }: { rows: Payload["mechanism"] }) {
  const data = rows.filter(r => r.r != null).map(r => ({ ...r, name: `${r.from} → ${r.to}` }));
  return (
    <div style={{ height: 34 * data.length + 30 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" domain={[-0.55, 0.3]} tick={TICK} tickFormatter={(v: number) => v.toFixed(1)} />
          <YAxis type="category" dataKey="name" width={290} tick={{ fontSize: 9, fill: "#94a3b8" }} interval={0} />
          <ReferenceLine x={0} stroke="#475569" />
          <Tooltip contentStyle={TT} formatter={(v, _n, item) => {
            const p = item?.payload as Payload["mechanism"][number];
            return [`r ${Number(v).toFixed(3)} at lag ${p.lag ?? "—"}, n_eff ${f3(p.n_eff, 0)}, Bartlett p ${fp(p.p_bartlett)}, max-|r| p ${fp(p.p_max_surrogate)}`, "link"];
          }} />
          <Bar dataKey="r" isAnimationActive={false} radius={[0, 4, 4, 0]}>
            {data.map(r => <Cell key={r.name} fill={r.p_max_surrogate != null && r.p_max_surrogate < 0.05 ? C_SIG : "#64748b"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PredictiveChart({ rows }: { rows: Payload["predictive"] }) {
  const data = useMemo(() => [3, 6, 12].map(h => {
    const pick = (ph: Phase) => rows.find(r => r.phase === ph && r.sample === "all" && r.signal.indexOf("real-time") === 0 && r.h === h);
    const e = pick("el_nino"), l = pick("la_nina");
    return {
      h: `+${h} m`,
      el: e?.mean ?? null, elErr: e && e.mean != null && e.ci_lo != null && e.ci_hi != null ? [e.mean - e.ci_lo, e.ci_hi - e.mean] : [0, 0],
      elHit: e?.hit_rate ?? null, elN: e?.n_signals ?? null,
      la: l?.mean ?? null, laErr: l && l.mean != null && l.ci_lo != null && l.ci_hi != null ? [l.mean - l.ci_lo, l.ci_hi - l.mean] : [0, 0],
      laHit: l?.hit_rate ?? null, laN: l?.n_signals ?? null,
      neutral: e?.neutral_mean ?? null,
    };
  }), [rows]);
  return (
    <div style={{ height: 250 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} barGap={4}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="h" tick={TICK} />
          <YAxis tick={TICK} width={44} label={{ value: "forward Δ log premium", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
          <ReferenceLine y={0} stroke="#475569" />
          <Tooltip contentStyle={TT} formatter={(v, n, item) => {
            const p = item?.payload as (typeof data)[number];
            if (n === "el") return [`${Number(v).toFixed(3)} (hit ${pct(p.elHit)}, n ${p.elN})`, "after an El Niño signal"];
            if (n === "la") return [`${Number(v).toFixed(3)} (hit ${pct(p.laHit)}, n ${p.laN})`, "after a La Niña signal"];
            return [Number(v).toFixed(3), "neutral months"];
          }} />
          <Bar dataKey="el" fill={NINO} isAnimationActive={false} radius={[4, 4, 0, 0]}>
            <ErrorBar dataKey="elErr" width={4} stroke="#e2e8f0" strokeWidth={1} />
          </Bar>
          <Bar dataKey="la" fill={NINA} isAnimationActive={false} radius={[4, 4, 0, 0]}>
            <ErrorBar dataKey="laErr" width={4} stroke="#e2e8f0" strokeWidth={1} />
          </Bar>
          <Bar dataKey="neutral" fill={NEUTRAL} isAnimationActive={false} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── the article ──────────────────────────────────────────────────────────────

export default function EnsoArbitrage() {
  const { data: d, error } = useFetchJson<Payload>("/data/enso_arbitrage.json");
  const [ccfView, setCcfView] = useState<"diff3" | "level">("diff3");
  const [evPhase, setEvPhase] = useState<Phase>("el_nino");

  const t1 = useMemo(() => (d ? d.series.filter(s => s.m >= "1960-01" && s.m <= (d.summary.tier1.last || "2100")) : []), [d]);
  const t2 = useMemo(() => (d ? d.series.filter(s => s.m >= "2022-12" && s.b1 != null || (d && s.m >= "2022-12" && s.oni != null && s.m <= "2026-08")) : []), [d]);
  const lr = useMemo(() => {
    const find = (ev: string, arb: string) => d?.lag_response.find(r => r.event === ev && r.arbitrage.indexOf(arb) === 0);
    return { el1: find("el_nino", "ICO"), la1: find("la_nina", "ICO"), el2: find("el_nino", "VN"), la2: find("la_nina", "VN") };
  }, [d]);
  const asym = useMemo(() => (d ? d.regressions.filter(r => r.spec.indexOf("asymmetry") >= 0) : []), [d]);
  const base = useMemo(() => (d ? d.regressions.filter(r => r.var === "oni" && r.spec.indexOf("oni + lagged") === 0) : []), [d]);
  const s2010 = useMemo(() => (d ? d.regressions.filter(r => r.var === "oni" && r.spec.indexOf("2010-08→ sample") >= 0) : []), [d]);
  const pred = useMemo(() => (d ? d.predictive.filter(r => r.sample === "all") : []), [d]);
  const predRow = (ph: Phase, sig: "real-time" | "official", h: number) => pred.find(r => r.phase === ph && r.signal.indexOf(sig) === 0 && r.h === h);

  const S = d?.summary;
  const el1 = lr.el1, la1 = lr.la1, el2 = lr.el2;
  const elPeak = el1?.mean_change_log ?? null;
  const priceMed = S?.price_levels_usd_t.other_milds_median_1980_on ?? null;
  const priceNow = S?.price_levels_usd_t.other_milds_latest ?? null;
  const usdNow = elPeak != null && priceNow != null ? priceNow * (Math.exp(elPeak) - 1) : null;

  return (
    <Paper tone="sky" updated="2026-09-05" kicker="Weather × arbitrage · lead/lag study"
      title="ENSO and the coffee arbitrage"
      subtitle="Sixty-six years and 29 ENSO episodes against the arabica-over-robusta premium. El Niño narrows it about a year later — suggestively, not robustly. La Niña does nothing measurable">

      <P>
        <strong>Abstract.</strong> Does El Niño or La Niña carry information about the New York–London
        arabica premium, or about its physical counterpart between Vietnamese robusta and Brazilian arabica?
        Tested against the longest series obtainable — the ICO indicator premium from 1960, NOAA&rsquo;s ONI from
        1950 — with the inference a persistent monthly series demands: effective sample sizes, phase-randomised
        surrogates, a max-|r| test for the lag that was searched for, false-discovery control, episode-level
        placebos, and an out-of-sample split. The hypothesis is <strong>not supported</strong> at that standard.
        What remains is narrower and more interesting: an <em>El Niño-only</em> tendency for the premium to{" "}
        <strong>narrow</strong> — robusta outperforming — troughing about twelve months after onset, in
        {el1 ? ` ${Math.round((el1.consistency ?? 0) * (el1.n_events ?? 0))} of ${el1.n_events}` : " most"} episodes,
        with the sign the physical channel predicts and the folk story does not. La Niña shows nothing at any lag.
        The physical arbitrage cannot be evaluated yet: one episode, which began on the first month of the series.
      </P>

      {error && <P className="text-slate-400">enso_arbitrage.json could not be loaded.</P>}
      {!d && !error && <P className="text-slate-400">Reading the study…</P>}

      {d && S && (
        <>
          <H2>Verdict</H2>
          <RefTable head={["", "NY–London arbitrage (Tier 1)", "Vietnam–Brazil physical (Tier 2)"]} rows={[
            [<>El Niño</>,
              <span key="a" className="whitespace-normal font-sans text-slate-300">🟡 <strong>Interesting, not robust.</strong> {el1?.direction === "premium narrows" ? "Premium narrows" : "Premium moves"} — trough at {el1?.peak_lag_months ?? "—"} m, {sgn(elPeak)} log ≈ {f3(el1?.pct_change_in_premium_ratio, 1)} % of the ratio, {Math.round((el1?.consistency ?? 0) * (el1?.n_events ?? 0))} of {el1?.n_events} episodes. Family placebo p {fp(el1?.p_placebo_family)}; no correlation survives correction; absent post-2010 and out of sample.</span>,
              <span key="b" className="whitespace-normal font-sans text-slate-300">⚪ <strong>Cannot be evaluated</strong> — {S.episodes_in_tier2.el_nino} episode, which began in month 1. It moved the same way ({sgn(el2?.mean_change_log)} at {el2?.peak_lag_months ?? "—"} m).</span>],
            [<>La Niña</>,
              <span key="c" className="whitespace-normal font-sans text-slate-300">🔴 <strong>No convincing evidence</strong> at any lag, transformation or index; peak {sgn(la1?.mean_change_log)} at {la1?.peak_lag_months ?? "—"} m with CI [{f3(la1?.ci_lo)}, {f3(la1?.ci_hi)}], family placebo p {fp(la1?.p_placebo_family)}.</span>,
              <span key="d" className="whitespace-normal font-sans text-slate-300">⚪ No La Niña onset inside the series.</span>],
          ]} />
          <UL>
            <LI><strong>Statistical.</strong> {S.n_families} families × 49 lags = {S.n_tests_ccf.toLocaleString()} tests. In the {S.tier1_families} Tier-1 families: <strong>{S.tier1_families_pmax_lt_05}</strong> whose best lag survives the max-|r| surrogate test (smallest p {f3(S.tier1_min_pmax, 2)}); <strong>{S.tier1_lag_tests_q10}</strong> lags with BH q &lt; 0.10; Bartlett p &lt; 0.05 at {S.tier1_lag_tests_p05} of {S.tier1_lag_tests.toLocaleString()} lag tests, where chance gives ≈ {Math.round(S.tier1_lag_tests * 0.05)}.</LI>
            <LI><strong>Economic.</strong> If real, {sgn(elPeak, 2)} log ≈ {f3(el1?.pct_change_in_premium_ratio, 0)} % of the ratio: ≈ ${Math.abs(Math.round(el1?.usd_t_at_sample_median_price ?? 0))}/t at the 1980→ median arabica price (${priceMed?.toLocaleString()}/t), ≈ ${usdNow != null ? Math.abs(Math.round(usdNow)).toLocaleString() : "—"}/t at today&rsquo;s (${priceNow?.toLocaleString()}/t) — about half the premium&rsquo;s own 12-month standard deviation ({f3(S.arb_volatility.tier1_sd_level_log, 2)} log in levels). Costs are not the constraint; reliability is.</LI>
            <LI><strong>Predictive.</strong> From the real-time signal (four Niño 3.4 weeks past +0.5, false alarms included), the 12-month forward change is {sgn(predRow("el_nino", "real-time", 12)?.mean)} with a {pct(predRow("el_nino", "real-time", 12)?.hit_rate)} hit rate (n = {predRow("el_nino", "real-time", 12)?.n_signals}) — half the retrospective figure ({sgn(predRow("el_nino", "official", 12)?.mean)}, {pct(predRow("el_nino", "official", 12)?.hit_rate)}). La Niña: {sgn(predRow("la_nina", "real-time", 12)?.mean)}, {pct(predRow("la_nina", "real-time", 12)?.hit_rate)}.</LI>
          </UL>
          <Highlight>
            The sign is the opposite of &ldquo;El Niño hurts Brazil&rdquo;. It matches the one physically robust link in the
            data: <strong>El Niño dries Vietnam&rsquo;s Central Highlands</strong> (rainfall anomaly r = {f3(d.mechanism.find(m => m.to.indexOf("Vietnam rain") === 0)?.r, 2)} at a
            {" "}{d.mechanism.find(m => m.to.indexOf("Vietnam rain") === 0)?.lag}-month lag, surrogate p {fp(d.mechanism.find(m => m.to.indexOf("Vietnam rain") === 0)?.p_max_surrogate)}) — a robusta-supply threat.
            Its effect on the Brazilian arabica belt&rsquo;s rainfall is nil. Every link from rainfall to price is weak at
            monthly frequency, and adding rainfall to the regression does not absorb the ENSO coefficient.
          </Highlight>

          <H2>1 · The question, the data, the two arbitrages</H2>
          <P>
            Three questions kept apart, because they have three answers: is there a relationship that survives the
            tests a persistent series demands (<em>statistical</em>); is it big enough to matter against the
            premium&rsquo;s noise and trading costs (<em>economic</em>); does a signal observable at the time say
            anything about the next 3–12 months (<em>predictive</em>). The hypotheses on the table, before any result:
            El Niño with a lag of several months; La Niña with a longer one (6–12 months); a difference between the
            exchange and the physical arbitrage. The named windows were treated as hypotheses, not restrictions —
            every lag from −24 to +24 was tested and counted.
          </P>
          <RefTable head={["series", "source", "period", "role"]} rows={[
            ["ICO Other Milds & Robustas indicators", "World Bank Pink Sheet ($/kg → USD/t)", `${S.tier1.first} → ${S.tier1.last}`, "Tier 1 — the NY–London premium"],
            ["KC & RC per-contract settles", "contract_prices_archive.json, rolled by calendar rule", "2021-08 → 2026-09", "cross-check; NOT futures_price_history.json (defective, see #848)"],
            ["Vietnam FAQ G2 · Brazil Tipo 6/7", "giacaphe · noticiasagricolas, on the day's FX", `${S.tier2.first} → ${S.tier2.last} (${S.tier2.months} months)`, "Tier 2 — the physical premium"],
            ["ONI · Niño 3.4 · SOI", S.notes?.oni_provenance ?? "NOAA CPC", "1950 → · 1981 → · 1951 →", "classification and real-time signal"],
            ["rainfall & temperature, 6 regions", "backend/seed/weather_history (Open-Meteo)", "1995 →", "the mechanism"],
          ]} />
          <P>
            <strong>A — NY–London</strong>: the repo&rsquo;s own definition, <Code>kc_usd_t = KC ¢/lb × 22.0462</Code>, <Code>arb_log = ln kc_usd_t − ln RC</Code>;
            no FX, freight or cost enters a spread between two USD contracts. The log-ratio is primary because coffee
            tripled between 2021 and 2025 and a USD/t spread is dominated by the price level. On the 41 months where
            both exist the indicator premium tracks the futures premium at r = 0.99 (levels) / 0.93 (monthly changes).
            <strong> B — Vietnam–Brazil</strong>: <Code>ln(BR arabica USD/t) − ln(VN robusta USD/t)</Code> on the same
            interior basis (B1); with the repo&rsquo;s FOBbing ladders (B2); and <em>net of the exchange premium</em>,
            <Code>B1 − ln(KC/RC)</Code> (B3), which isolates the origin component. Different species, no conversion
            pretended: the level is not interpretable, the changes are.
          </P>
          <P className="text-slate-400">
            ICO&rsquo;s own historical spreadsheets were tried and every link 404s on both of ICO&rsquo;s domains after its site
            migration; ICO publishes no NY/London futures history as a file at all. The Pink Sheet carries the same
            ICO indicator series. Every fetch attempt, successful or not, is in the study&rsquo;s manifest.
          </P>

          <LongRun rows={t1} keyA="ind" labelA="ICO indicator premium ln(Other Milds / Robustas)" keyB="fut"
            labelB="ICE futures premium ln(KC / RC), repo, 2021 →"
            title="Chart 1 · ENSO and the NY–London premium, 1960 → 2026"
            note="Top: the Oceanic Niño Index. Bottom: the arabica premium over robusta. One axis per panel." />

          <H2>2 · Method, briefly</H2>
          <UL>
            <LI><strong>Two ideas of an event.</strong> <em>Official</em>: NOAA&rsquo;s rule, five consecutive seasons past ±0.5 — confirmable four to five months after onset, used for the event study; back-to-back episodes merged ({S.episodes_collapsed} of {S.episodes_all}). <em>Real-time</em>: the repo&rsquo;s own emerging rule with publication delays, false alarms kept, used for the predictive test ({d.signals.total} signals since 1950, {d.signals.confirmed} confirmed; La Niña fires falsely {pct(1 - d.signals.by_phase.la_nina.confirmed / d.signals.by_phase.la_nina.n)} of the time).</LI>
            <LI><strong>Cross-correlations</strong> at every lag −24 … +24 for every (arbitrage × transformation × index), with Bartlett effective n, block-bootstrap CIs, and <strong>phase-randomised surrogates</strong> that keep each series&rsquo; own persistence and go through the identical 49-lag search — the null for &ldquo;does the best lag survive having been searched for&rdquo;. BH-FDR within and across families.</LI>
            <LI><strong>Event study</strong> on official onsets with episode-resampled CIs and a placebo of the same number of random neutral onsets; <strong>HAC regressions</strong> with month dummies, the ONI⁺/ONI⁻ asymmetry, and certified stocks as controls; the <strong>mechanism chain</strong> link by link; ENSO with and without regional rainfall; an <strong>out-of-sample</strong> split at {S.discovery_end}; forward changes after real-time signals.</LI>
          </UL>

          <H2>3 · Lead/lag results</H2>
          <RefTable head={["event", "arbitrage", "n", "direction", "peak lag", "mean Δ (log)", "95 % CI", "consistency", "placebo p (peak / family)", "best +lag r", "Bartlett p", "BH q", "max-|r| p"]}
            rows={d.lag_response.map(r => [
              PHASE_LABEL[r.event as Phase] ?? r.event, r.arbitrage.indexOf("ICO") === 0 ? "NY–London" : "VN–BR B1", String(r.n_events ?? 0),
              r.direction ?? "—", r.peak_lag_months != null ? `${r.peak_lag_months} m` : "—", sgn(r.mean_change_log),
              r.ci_lo != null ? `[${f3(r.ci_lo)}, ${f3(r.ci_hi)}]` : "—", r.consistency != null ? pct(r.consistency) : "—",
              r.p_placebo_at_peak != null ? `${fp(r.p_placebo_at_peak)} / ${fp(r.p_placebo_family)}` : "—",
              r.ccf_r != null ? `${f3(r.ccf_r)} @ ${r.ccf_best_lag}` : "—", fp(r.ccf_p_bartlett), fp(r.ccf_q_bh), fp(r.ccf_p_max_surrogate),
            ])} />
          <P>
            The primary family — ONI against the 3-month change in the premium — has its best lag at
            k = +{d.ccf.tier1_diff3.reduce((b, p) => (p.r != null && (b == null || Math.abs(p.r) > Math.abs(b.r ?? 0)) ? p : b), null as CcfPt | null)?.lag}:
            r = {f3(d.ccf.tier1_diff3.reduce((b, p) => (p.r != null && (b == null || Math.abs(p.r) > Math.abs(b.r ?? 0)) ? p : b), null as CcfPt | null)?.r)},
            negative from lag −3 to +9 and gone by +15 — the shape a level effect that builds over a year leaves in a
            correlation of <em>changes</em>. In the differenced transforms the largest |r| for ONI⁺, Niño 3.4 and −SOI
            sits at lags −17 to −20: the arbitrage &ldquo;leading&rdquo; ENSO by a year and a half. No mechanism does that; it is
            the ENSO cycle&rsquo;s own ~4-year periodicity aliasing through a 49-lag search, and the surrogate test —
            which reproduces that periodicity — prices it correctly.
          </P>
          <CcfChart pts={ccfView === "diff3" ? d.ccf.tier1_diff3 : d.ccf.tier1_level}
            title={`Chart 3 · ONI → NY–London premium, ${ccfView === "diff3" ? "3-month changes (the test that counts)" : "levels (reported, flagged: two persistent series)"}`}
            note="Grey: what correlation between two series with NO link but the same persistence looks like, 95 % band from 2,000 phase-randomised surrogates." />
          <div className="-mt-3 mb-4 flex justify-end"><Toggle value={ccfView} options={[["diff3", "3-month changes"], ["level", "levels"]]} onChange={setCcfView} /></div>

          <H>By ENSO state and lag</H>
          <RegimeGrid grid={d.regime_grid} />
          <P>Within El Niño months the correlation is uniformly small and negative out to lag 16; within La Niña months small and positive at lags 4–10, negative at 13–24. The two phases are not mirror images — but no cell survives correction.</P>

          <H2>4 · Event studies</H2>
          <div className="mb-1 flex justify-end"><Toggle value={evPhase} options={[["el_nino", "El Niño"], ["la_nina", "La Niña"]]} onChange={setEvPhase} /></div>
          <EventChart block={d.events.tier1[evPhase]} phase={evPhase}
            title={`Chart ${evPhase === "el_nino" ? 5 : 6} · ${PHASE_LABEL[evPhase]} onsets → NY–London premium, ${S.tier1.first.slice(0, 4)} →`}
            note="Change in the log premium since the official onset month; each grey line is one episode." />
          {evPhase === "el_nino" ? (
            <P>
              The premium drifts down from month 5, troughs at <strong>{el1?.peak_lag_months} months</strong> ({sgn(elPeak)} log; median {sgn(d.events.tier1.el_nino.summary.find(s => s.h === 12)?.median)}), and mean-reverts by month 18.
              At 12 months {Math.round((el1?.consistency ?? 0) * (el1?.n_events ?? 0))} of {el1?.n_events} episodes are negative; the mean sits outside the placebo band (p {fp(el1?.p_placebo_at_peak)}) —
              but counting the 25 horizons the trough was found in, the family-wise p is <strong>{fp(el1?.p_placebo_family)}</strong>. 1997–98 (−0.63 at 12 m) alone is a third of the effect.
              With back-to-back episodes kept separately (n = {Math.max.apply(null, d.events.tier1_unmerged.el_nino.summary.map(s => s.n))}): {sgn(d.events.tier1_unmerged.el_nino.summary.find(s => s.h === 12)?.mean)} at 12 m.
            </P>
          ) : (
            <P>
              Nothing here is a result: the paths fan out symmetrically, the mean never leaves the placebo band, the CI never
              excludes zero, and the &ldquo;peak&rdquo; at {la1?.peak_lag_months} months has a family-wise p of {fp(la1?.p_placebo_family)}. The hypothesised
              6–12-month window averages {sgn(d.events.tier1.la_nina.summary.find(s => s.h === 12)?.mean)} at 12 months.
            </P>
          )}
          <EventChart block={d.events.tier2.el_nino} phase="el_nino"
            title="El Niño onsets → Vietnam–Brazil physical premium B1 (exploratory)"
            note="One episode, which began on the first month of the series. It is drawn; it is not evidence." />

          <H2>5 · Regression, asymmetry and controls</H2>
          <RefTable head={["lag k", "ONI (full sample)", "p", "ONI⁺ El Niño", "p", "ONI⁻ La Niña", "p", "ONI, 2010→ sample", "p"]}
            rows={[0, 1, 3, 6, 12].map(k => {
              const b = base.find(r => r.lag === k), pos = asym.find(r => r.lag === k && r.var === "oni_pos"), neg = asym.find(r => r.lag === k && r.var === "oni_neg"), s10 = s2010.find(r => r.lag === k);
              return [String(k), sgn(b?.coef, 4), fp(b?.p), sgn(pos?.coef, 4), fp(pos?.p), sgn(neg?.coef, 4), fp(neg?.p), sgn(s10?.coef, 4), fp(s10?.p)];
            })} />
          <P>
            One ONI degree at lags 0–3 is worth about −1.2 % on the premium over the next quarter in the full sample — marginal, and it is the
            <strong> El Niño half</strong> of the index doing it: ONI⁺ carries the coefficient, ONI⁻ is zero. Whatever ENSO does to this premium it does in
            El Niño years; La Niña is not &ldquo;minus El Niño&rdquo;, it is nothing measurable. The controls do not absorb it; the years do — in the 2010→ sample
            the coefficient is zero <em>before</em> any certified-stock control enters.
          </P>
          <H>ENSO effect or coffee-weather effect?</H>
          <RefTable head={["", "ONI(t−1)", "p", "Brazil rain (t−2)", "Vietnam rain (t−3)", "R²"]} rows={[
            ["without weather", sgn(S.weather_regression.enso_coef_without, 4), fp(S.weather_regression.enso_p_without), "", "", f3(S.weather_regression.r2_without)],
            ["with weather", sgn(S.weather_regression.enso_coef_with, 4), fp(S.weather_regression.enso_p_with), "+0.025 (p 0.034)", "+0.006 (p 0.55)", f3(S.weather_regression.r2_with)],
          ]} />
          <P>
            The ENSO coefficient does <strong>not</strong> shrink when the Brazil and Vietnam rainfall anomalies enter at their own best lags
            (n = {S.weather_regression.n}, 1995 →); its p rises only because the standard error does. So ENSO cannot be reduced to &ldquo;an early read
            on the weather&rdquo; — but neither ENSO nor the weather explains the premium robustly at this frequency.
          </P>

          <H2>6 · The mechanism, link by link</H2>
          <MechanismChart rows={d.mechanism} />
          <P>
            ENSO → Vietnamese rainfall is the only link that survives (orange). El Niño&rsquo;s effect on the arabica belt&rsquo;s rainfall is nil —
            south-east Brazil is not the Nordeste — so there is no offsetting arabica leg, and a robusta-supply threat lifts London relative to
            New York: the sign the data show. Rainfall → harvest → exports / stocks → premium are each weak at monthly frequency, which is
            what one expects when prices respond to <em>expectations</em> of a crop with a cycle-long lag; the event study, which lets the effect
            accumulate over a year, sees more than any single-lag correlation can.
          </P>

          <H2>7 · Robustness and out of sample</H2>
          <RefTable head={["test", "result"]} rows={[
            ["transformations", `best-lag r for ONI ranges ${f3(Math.min.apply(null, d.robustness.filter(r => r.index === "ONI").map(r => r.r ?? 0)), 2)} to ${f3(Math.max.apply(null, d.robustness.filter(r => r.index === "ONI").map(r => r.r ?? 0)), 2)} across levels, z, seasonally adjusted, 1- and 3-month changes; no differenced transform's block-bootstrap CI cleanly excludes zero`],
            ["indices", "Niño 3.4 and −SOI agree with ONI in sign at lags 0–3 and disagree nowhere that matters"],
            ["multiple testing", `BH q ≥ ${f3(Math.min.apply(null, d.robustness.map(r => r.q_bh ?? 1)), 2)} everywhere in Tier 1; max-|r| surrogate p ≥ ${f3(S.tier1_min_pmax, 2)}`],
            ["effective sample", `${S.tier1.n} months of levels carry 65–125 independent observations; 3-month changes ≈ 198; the 2021→ futures series ≈ 7`],
            ["out of sample", `Δ3: best lag on ${S.discovery_end.slice(0, 4)} discovery = ${S.oos.diff3?.best_lag_discovery}, r ${f3(S.oos.diff3?.r_discovery)} → validation r ${f3(S.oos.diff3?.r_validation)} (p ${fp(S.oos.diff3?.p_validation)}); levels: r ${f3(S.oos.level?.r_discovery)} → ${sgn(S.oos.level?.r_validation)} (sign ${S.oos.level?.same_sign ? "holds" : "flips"}). Does not hold.`],
            ["outliers", "1997–98 is a third of the El Niño effect; without it the mean at 12 m is −0.069, still 12 of 16 negative"],
            ["Tier 2", `${S.tier2.months} months, one El Niño that began in month 1; correlations of ±0.9 appear with effective n of 5–8 and the surrogate band reaches ±0.9`],
          ]} />
          <CcfChart pts={d.ccf.tier2_diff3} title="Chart 4 · ONI → Vietnam–Brazil premium B1, 3-month changes (exploratory)"
            note="The band itself reaches ±0.7–0.9 at 37 months: any correlation this series can produce, a random one can too." />

          <H2>8 · Could a desk use it?</H2>
          <PredictiveChart rows={d.predictive} />
          <div className="mt-1 mb-3 flex flex-wrap gap-4 text-[10px] text-slate-400">
            <span><span className="inline-block h-2 w-3 align-middle" style={{ background: NINO }} /> after an El Niño signal</span>
            <span><span className="inline-block h-2 w-3 align-middle" style={{ background: NINA }} /> after a La Niña signal</span>
            <span><span className="inline-block h-2 w-3 align-middle" style={{ background: NEUTRAL }} /> neutral months</span>
            <span>whiskers: 95 % CI from resampling signals</span>
          </div>
          <RefTable head={["phase", "signal", "h", "n", "mean Δ", "hit rate", "95 % CI", "neutral mean", "p vs neutral"]}
            rows={(["el_nino", "la_nina"] as Phase[]).reduce((acc: React.ReactNode[][], ph) => acc.concat(
              (["real-time", "official"] as const).reduce((a2: React.ReactNode[][], sig) => a2.concat([3, 6, 12].map(h => {
                const r = predRow(ph, sig, h);
                return [PHASE_LABEL[ph], sig === "real-time" ? "real-time (false alarms in)" : "official onset (retrospective)", `+${h} m`, String(r?.n_signals ?? "—"), sgn(r?.mean), pct(r?.hit_rate), r?.ci_lo != null ? `[${f3(r.ci_lo)}, ${f3(r.ci_hi)}]` : "—", sgn(r?.neutral_mean), fp(r?.p_vs_neutral)];
              })), [])), [])} />
          <P>
            <strong>&ldquo;If an El Niño develops today…&rdquo;</strong> The tendency in the record is a narrowing that builds from month 6 and troughs around
            month 12, in {Math.round((el1?.consistency ?? 0) * (el1?.n_events ?? 0))} of the {el1?.n_events} official episodes since 1960. Three things stop that being a signal: it does
            not survive the multiple-testing correction; it is not visible after 2010 and fails out of sample; and measured from what a desk
            actually sees, the 12-month move is {sgn(predRow("el_nino", "real-time", 12)?.mean)} with a {pct(predRow("el_nino", "real-time", 12)?.hit_rate)} hit rate,
            the first three months after a signal showing a small <em>widening</em>. Practical use, if any: a mild prior towards robusta strength 6–12
            months out, to be confirmed or discarded by the thing ENSO <em>does</em> forecast — the Central Highlands dry season, which this app
            already measures daily — not a standalone spread trade.
          </P>
          <P>
            <strong>&ldquo;If a La Niña develops today…&rdquo;</strong> No. No forward information at 3, 6 or 12 months, and a real-time signal that
            fires falsely {pct(1 - d.signals.by_phase.la_nina.confirmed / d.signals.by_phase.la_nina.n)} of the time. On the physical arbitrage there is no La Niña onset in the data at all.
          </P>

          <H2>9 · Every episode</H2>
          <RefTable head={["onset", "phase", "peak ONI", "months", "pre-level", "+3 m", "+6 m", "+9 m", "+12 m", "+18 m", "+24 m"]}
            rows={d.episode_table.filter(e => e.chg_12m != null).map(e => [
              e.onset, PHASE_LABEL[e.phase as Phase] ?? e.phase, f3(e.peak_oni, 2), String(e.duration_m ?? "—"), f3(e.pre_level, 2),
              sgn(e.chg_3m), sgn(e.chg_6m), sgn(e.chg_9m), sgn(e.chg_12m), sgn(e.chg_18m), sgn(e.chg_24m),
            ])} />

          <H2>10 · Limitations</H2>
          <UL>
            <LI>ENSO is a small-n problem however long the series: 66 years contain {S.episodes_in_tier1.el_nino} usable El Niño and {S.episodes_in_tier1.la_nina} La Niña onsets, and 24-month windows on a ~4-year cycle overlap.</LI>
            <LI>Tier 1 is the ICO <em>indicator</em> premium, not the futures premium — they co-move at r = 0.99 / 0.93, and the indicator embeds destination freight and a differential.</LI>
            <LI>Tier 2 is {S.tier2.months} months with one episode. Drop a longer Vietnam farmgate history at <Code>data/vietnam_local_history.csv</Code> and the study re-runs unchanged.</LI>
            <LI>No ENSO forecast archive exists in the repo, so anticipation can be flagged at negative lags but not measured; onsets are NOAA&rsquo;s and hence retrospective; production series are approximate and annual; weather is rainfall totals, not the drought model&rsquo;s SPI/SPEI.</LI>
            <LI>Episode-level confounding is unaddressed: the 2020–23 La Niña coincides with the 2021 frost and the freight squeeze, the 2023–24 El Niño with the robusta shortage.</LI>
          </UL>

          <LongRun rows={t2} keyA="b1" labelA="B1  ln(BR arabica físico / VN robusta FAQ), USD/t interior" keyB="b3"
            labelB="B3  B1 net of the exchange premium ln(KC/RC)"
            title="Chart 2 · ENSO and the Vietnam–Brazil physical premium, 2023 → (exploratory)"
            note="One El Niño, no La Niña. Both series fell through the 2024 robusta rally and recovered with it." />

          <DataFiles files={["enso_arbitrage.json"]}
            note="The page's payload. The full paper, every result table (12,000+ lag tests, all episodes, all regressions), the raw external files with their manifest and the reproducible pipeline are in the repository:" />
          <P className="text-slate-400">
            <a href={PAPER_URL} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">backend/research/enso_arbitrage/REPORT.md</a> ·
            run <Code>PYTHONPATH=. python -m research.enso_arbitrage.src.study</Code> from <Code>backend/</Code> to reproduce.
          </P>
        </>
      )}
    </Paper>
  );
}
