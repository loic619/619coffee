"use client";
// Theoretical yield vs rainfall — literature-calibrated response curves
// overlaid with 29 harvests of reality and the live crop year.
// Data: yield_rainfall_model.json (backend/scraper/exporters/yield_rainfall.py).
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Scatter, XAxis, YAxis, Tooltip,
  ReferenceLine, ReferenceArea, CartesianGrid, LabelList,
} from "recharts";
import { cachedFetchStatic } from "@/lib/api";

interface CurvePt { rain_mm: number; yield_potential_pct: number; stress: string }
interface ScatterPt { year: number; rain_mm: number; realized_pct: number; label?: string }
interface LivePt {
  year: number; rain_mm_to_date: number; months_observed: number;
  projected_end: number; projected_potential_pct: number; in_optimal_band: boolean;
}
interface Model {
  label: string; window: string; optimal_band: [number, number];
  theoretical_curve: CurvePt[]; historical_scatter: ScatterPt[];
  theory_fit_corr: number | null; theory_fit_corr_biennial_adj?: number | null;
  current_year_live: LivePt;
}
interface YRData { generated_at: string; meta: { sources: string; note: string }; models: Record<string, Model> }

const fmt = (v: number) => v.toLocaleString("en-US");

function stressAt(curve: CurvePt[], rain: number): string {
  let best = curve[0];
  for (const c of curve) if (Math.abs(c.rain_mm - rain) < Math.abs(best.rain_mm - rain)) best = c;
  return best.stress;
}

export default function YieldRainfall() {
  const [data, setData] = useState<YRData | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkey, setMkey] = useState("arabica_brazil");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<YRData>("/data/yield_rainfall_model.json")
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const m = data?.models[mkey] ?? null;

  const chart = useMemo(() => {
    if (!m) return null;
    const curve = [...m.theoretical_curve].sort((a, b) => a.rain_mm - b.rain_mm);
    const xMin = Math.min(curve[0].rain_mm, ...m.historical_scatter.map(s => s.rain_mm)) - 100;
    const xMax = Math.max(curve[curve.length - 1].rain_mm, ...m.historical_scatter.map(s => s.rain_mm)) + 100;
    const scatter = m.historical_scatter.map(s => ({ ...s, x: s.rain_mm, y: s.realized_pct }));
    return { curve, xMin: Math.max(0, xMin), xMax, scatter };
  }, [m]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      yield_rainfall_model.json not published yet — run the exporter.
    </div>;
  }
  if (!data || !m || !chart) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const live = m.current_year_live;
  const projStress = stressAt(m.theoretical_curve, live.projected_end);

  return (
    <div className="space-y-4">
      {/* §1 the overlay chart */}
      <div className={`bg-slate-900 border rounded-xl p-4 ${live.in_optimal_band ? "border-slate-800" : "border-amber-500/50"}`}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h4 className="text-sm font-bold text-slate-100">1 · Theory vs {m.historical_scatter.length} harvests of reality — {m.label}</h4>
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {Object.entries(data.models).map(([k, mm]) => (
            <button key={k} onClick={() => setMkey(k)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                mkey === k ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}>
              {mm.label}
            </button>
          ))}
        </div>

        {/* live-year alert strip */}
        <div className={`rounded border px-2.5 py-1.5 mb-2 text-[11px] leading-relaxed ${
          live.in_optimal_band
            ? "border-emerald-500/30 bg-emerald-500/5 text-slate-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
          <strong>{live.year} crop year ({m.window})</strong>: {fmt(live.rain_mm_to_date)} mm through{" "}
          {live.months_observed}/12 months → projected <strong>{fmt(live.projected_end)} mm</strong>
          {" "}({live.in_optimal_band ? "inside" : "OUTSIDE"} the {fmt(m.optimal_band[0])}–{fmt(m.optimal_band[1])} mm
          optimal band) · curve reads <strong>{Math.round(live.projected_potential_pct)}% potential — {projStress}</strong>.
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chart.curve} margin={{ top: 14, right: 18, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="rain_mm" type="number" domain={[chart.xMin, chart.xMax]}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false}
              label={{ value: `crop-year rainfall, mm (${m.window}, production-weighted)`, position: "insideBottom", dy: 14, fill: "#475569", fontSize: 10 }} />
            <YAxis type="number" domain={[0, 135]}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={40}
              label={{ value: "% of normal yield", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
            <ReferenceArea x1={m.optimal_band[0]} x2={m.optimal_band[1]} fill="#10b981" fillOpacity={0.06} />
            <Area dataKey="yield_potential_pct" stroke="#22d3ee" strokeWidth={2}
              fill="#22d3ee" fillOpacity={0.10} dot={false} isAnimationActive={false} />
            <Scatter data={chart.scatter} dataKey="y" fill="#e2e8f0" isAnimationActive={false} shape={(p: unknown) => {
              const q = p as { cx?: number; cy?: number; payload?: ScatterPt };
              return <circle cx={q.cx} cy={q.cy} r={3.5} fill={q.payload?.label ? "#fbbf24" : "#94a3b8"}
                stroke="#0f172a" strokeWidth={1} />;
            }}>
              <LabelList dataKey="label" position="top"
                content={(props: unknown) => {
                  const p = props as { x?: number; y?: number; value?: string };
                  return p.value ? (
                    <text x={p.x} y={(p.y ?? 0) - 7} textAnchor="middle" fill="#fbbf24" fontSize={9}>
                      {chart.scatter.find(s => s.label === p.value)?.year}
                    </text>
                  ) : null;
                }} />
            </Scatter>
            <ReferenceLine x={live.rain_mm_to_date} stroke="#f59e0b" strokeDasharray="4 3"
              label={{ value: "to date", fill: "#d97706", fontSize: 9, position: "insideTopLeft" }} />
            <ReferenceLine x={live.projected_end} stroke="#f59e0b" strokeWidth={2}
              label={{ value: `${live.year} projected`, fill: "#fbbf24", fontSize: 10, position: "insideTop" }} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]?.payload as (Partial<ScatterPt> & Partial<CurvePt>) | undefined;
              if (!p) return null;
              return (
                <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11, padding: "6px 10px" }}>
                  {p.year != null ? (
                    <>
                      <div className="text-slate-100 font-semibold">Harvest {p.year}{p.label ? ` — ${p.label}` : ""}</div>
                      <div className="text-slate-300">rain {fmt(p.rain_mm ?? 0)} mm · realized {p.realized_pct}% of trend</div>
                    </>
                  ) : (
                    <>
                      <div className="text-cyan-300 font-semibold">Theory: {p.yield_potential_pct}% potential</div>
                      <div className="text-slate-400">{fmt(p.rain_mm ?? 0)} mm — {p.stress}</div>
                    </>
                  )}
                </div>
              );
            }} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 text-[10px] text-slate-400 mt-1 px-1 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-2 border-cyan-400" /> theoretical yield potential</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-slate-400" /> real harvests (% of trend)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> notable years</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 bg-emerald-500/20 border border-emerald-500/30" /> optimal band</span>
        </div>
      </div>

      {/* §2 does the theory survive the scatter? */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">2 · Does the theory survive contact with the scatter?</h4>
        <div className="overflow-x-auto mb-2">
          <table className="text-[10px] w-full">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left pr-3 pb-1 font-medium">model</th>
                <th className="px-2 pb-1 text-right font-medium">harvests</th>
                <th className="px-2 pb-1 text-right font-medium">corr(theory, realized)</th>
                <th className="px-2 pb-1 text-right font-medium">biennial-adjusted</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.models).map(([k, mm]) => (
                <tr key={k} className="border-b border-slate-800/60">
                  <td className="pr-3 py-1 text-slate-200 font-semibold">{mm.label}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-400">{mm.historical_scatter.length}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-200">{mm.theory_fit_corr ?? "·"}</td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">{mm.theory_fit_corr_biennial_adj ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Brazil arabica is where rain totals genuinely bite</strong>: r ≈ +0.34 raw, <strong>+0.51 once the
            biennial on/off cycle is removed</strong> — unirrigated production tracking its water year. The two labelled
            disasters sit where the curve says they should: harvest 2021 (920 mm drought + frost) at 74% of trend,
            harvest 2014 (860 mm, driest window) below trend on what should have been an on-year.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Vietnam is nearly flat (r ≈ 0.05) — and that is the finding</strong>: Central-Highlands robusta is
            dry-season <em>irrigated</em>, so annual rain totals barely predict yield; what matters is reservoir state
            when the dry season arrives — exactly why the drought model conditions Vietnamese alerts on the water
            bulletin rather than rainfall alone.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Indonesia sits between (r ≈ 0.26)</strong>: rain-fed like Brazil, but its binding constraint is
            often the <em>wet</em> tail — excess rain disrupting flowering and harvest drying — so the response curve
            is asymmetric with a high optimum (2,000–2,800 mm).
          </span></li>
        </ul>
      </div>

      {/* §3 method, sources, limits */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">3 · Method, sources &amp; honest limits</h4>
        <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The curves are literature anchors, not regressions</strong> — calibrated to the WCR/WMO bioclimatic
            envelopes (survival limits ~&lt;800 mm and &gt;3,000 mm), Embrapa&rsquo;s arabica agro-climatic zoning
            (1,200–1,800 mm optimal, unirrigated), Carr (2001) and DaMatta &amp; Ramalho&rsquo;s water-relations
            reviews, and Cenicafé/WCR&rsquo;s higher robusta water demand. Points between anchors are linear
            interpolation; treat the curve as an envelope, not a forecast.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The scatter is our own cross of two archives</strong>: USDA-derived production seeds (1996–2025,
            log-linear detrended so 100 = trend) × the 30-year Open-Meteo regional rainfall seeds,
            production-weighted across each origin&rsquo;s growing regions and summed over the crop-year window
            shown on the axis. Year conventions were verified event-by-event (the Brazil seed keys marketing-year
            <em> end</em> — 2021 frost harvest appears under 2022 — and is re-aligned here).
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The live line comes from the weather pipeline</strong>: rain-to-date is the production-weighted
            cumulative of the running crop year; the projection fills remaining months with seed climatology. When the
            projection leaves the optimal band the widget border and banner flag it — the dev-note&rsquo;s
            &ldquo;red border&rdquo; alert, tiered amber.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Limits</strong>: annual totals ignore <em>distribution</em> (a perfect total with rain in the wrong
            months still fails — that timing risk lives in the drought model&rsquo;s SPI/SPEI and phenology rules);
            national production absorbs area growth, price-driven management and biennial bearing (trend + parity
            adjustment mitigate, imperfectly); Colombia is omitted until a long production seed exists; and 29
            harvests is enough to test a shape, not to fit one — which is why the curve stays literature-anchored.
          </span></li>
        </ul>
      </div>
    </div>
  );
}
