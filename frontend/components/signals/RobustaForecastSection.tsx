"use client";
import { useEffect, useState } from "react";
import { fmtAgo, chgTone } from "@/lib/formatters";
import ModelledBadge from "@/components/ModelledBadge";

interface FactorRow {
  label: string;
  category: "Macro" | "Momentum" | "Positioning" | "Fundamentals" | "Seasonality";
  quantile: number;
  percentile: number;
  value_z: number | null;
  beta: number;
  contribution: number;
  available: boolean;
}

interface ModelMeta {
  r_squared: number;
  n_obs: number;
  training_period: string;
  residual_std: number;
}

interface Prediction {
  delta_p: number;
  direction: "Bullish" | "Bearish";
  confidence: number;
}

interface RobustaData {
  available: boolean;
  reason?: string;
  scraped_at?: string;
  as_of?: string;
  model?: ModelMeta;
  prediction?: Prediction;
  intercept?: number;
  factors?: FactorRow[];
}

const CAT_COLOR: Record<string, string> = {
  Macro:       "text-blue-400 bg-blue-950/50 border-blue-800",
  Momentum:    "text-amber-400 bg-amber-950/50 border-amber-800",
  Positioning: "text-purple-400 bg-purple-950/50 border-purple-800",
  Fundamentals:"text-emerald-400 bg-emerald-950/50 border-emerald-800",
  Seasonality: "text-sky-400 bg-sky-950/50 border-sky-800",
};

function QuantileBar({ value }: { value: number }) {
  const pct   = ((value + 5) / 10) * 100;
  const color = value > 0 ? "bg-emerald-500" : value < 0 ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-1 w-32">
      <span className="text-[9px] text-slate-600 w-3 text-right">-5</span>
      <div className="flex-1 h-2 bg-slate-700 rounded-full relative">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-500" />
        <div
          className={`absolute top-0.5 h-1 w-1.5 rounded-full ${color}`}
          style={{ left: `${Math.min(95, Math.max(2, pct))}%` }}
        />
      </div>
      <span className="text-[9px] text-slate-600 w-3">+5</span>
    </div>
  );
}


export default function RobustaForecastSection() {
  const [data, setData] = useState<RobustaData | null>(null);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then(r => r.ok ? r.json() : null)
      .then(j => setData(j?.robusta_factors ?? { available: false, reason: "No data" }))
      .catch(() => setData({ available: false, reason: "Fetch failed" }));
  }, []);

  const loading    = data === null;
  const unavailable = data !== null && !data.available;

  const factors   = data?.factors ?? [];
  const intercept = data?.intercept ?? 0;
  const pred      = data?.prediction;
  const model     = data?.model;

  const totalContrib   = factors.reduce((s, f) => s + f.contribution, 0);
  const prediction     = intercept + totalContrib;
  const maxContrib     = Math.max(1, ...factors.map(f => Math.abs(f.contribution)));

  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded">Section 2</span>
          <h2 className="text-base font-bold text-white">Robusta Futures Forecast</h2>
          {/* R² is in-sample fit, not a hit rate — no forward predictions have
              been graded for this model yet, and the badge says so. */}
          <ModelledBadge
            method="OLS regression"
            hitRate={null}
            note={model ? `in-sample R² ${model.r_squared.toFixed(2)}` : undefined}
          />
          <span className="text-[10px] text-slate-500">Multi-Factor OLS · Weekly COT + DXY</span>
          {model && (
            <span className="text-[10px] text-slate-600 font-mono">R²={model.r_squared.toFixed(3)} n={model.n_obs}</span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Linear scoring model using z-scored COT positioning, DXY, and price momentum.
          Output = <span className="font-mono text-slate-200">Intercept + Σ(Z_i × β_i)</span> in USD/MT over 4-week horizon.
          {data?.as_of && (
            <span className="text-slate-600 ml-2">COT as of {data.as_of}</span>
          )}
          {data?.scraped_at && (
            <span className="text-slate-600 ml-2">· {fmtAgo(data.scraped_at)}</span>
          )}
        </p>
      </div>

      {loading && (
        <div className="text-xs text-slate-500 animate-pulse py-8 text-center">Loading factor model…</div>
      )}

      {unavailable && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center space-y-2">
          <div className="text-sm text-slate-400">Robusta factor model not yet available</div>
          <div className="text-[10px] text-slate-600">{data?.reason}</div>
          <div className="text-[10px] text-slate-600">Requires at least 30 weeks of COT history in the database.</div>
        </div>
      )}

      {!loading && !unavailable && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Factor table */}
          <div className="xl:col-span-2 bg-slate-900 rounded-lg overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
                  <th className="text-left px-3 py-2">Factor</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-center px-3 py-2">Q-Score</th>
                  <th className="px-3 py-2">Range</th>
                  <th className="text-right px-3 py-2">β</th>
                  <th className="text-right px-3 py-2">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {factors.map((f, i) => (
                  <tr key={f.label} className={`border-b border-slate-800 ${i % 2 === 0 ? "" : "bg-slate-900/60"} hover:bg-slate-800/40 ${!f.available ? "opacity-40" : ""}`}>
                    <td className="px-3 py-1.5 text-slate-200 whitespace-nowrap">
                      {f.label}
                      {!f.available && <span className="ml-1 text-[8px] text-slate-600">n/a</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${CAT_COLOR[f.category]}`}>{f.category}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`font-mono font-bold ${f.quantile > 0 ? "text-emerald-400" : f.quantile < 0 ? "text-red-400" : "text-slate-500"}`}>
                        {f.quantile > 0 ? "+" : ""}{f.quantile}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <QuantileBar value={f.quantile} />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-400">{f.beta.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${chgTone(f.contribution)}`}>
                      {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-600">
                  <td colSpan={4} className="px-3 py-2 text-[11px] text-slate-400">Intercept</td>
                  <td />
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${chgTone(intercept)}`}>
                    {intercept >= 0 ? "+" : ""}{intercept.toFixed(1)}
                  </td>
                </tr>
                <tr className="bg-slate-800/60">
                  <td colSpan={4} className="px-3 py-2 text-[11px] font-bold text-white">Model Output ΔP (4-week, USD/MT)</td>
                  <td />
                  <td className={`px-3 py-2 text-right font-mono font-bold text-lg ${chgTone(prediction)}`}>
                    {prediction >= 0 ? "+" : ""}{prediction.toFixed(1)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Right panel */}
          <div className="space-y-3">
            {/* Prediction summary */}
            {pred && (
              <div className="bg-slate-900 rounded-lg p-4 text-center space-y-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">4-Week Signal</div>
                <div className={`text-2xl font-bold ${pred.direction === "Bullish" ? "text-emerald-400" : "text-red-400"}`}>
                  {pred.direction}
                </div>
                <div className={`text-3xl font-mono font-bold ${chgTone(pred.delta_p)}`}>
                  {pred.delta_p >= 0 ? "+" : ""}{pred.delta_p.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-500">USD/MT expected change</div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full ${pred.direction === "Bullish" ? "bg-emerald-600" : "bg-red-600"}`}
                    style={{ width: `${pred.confidence * 100}%` }}
                  />
                </div>
                <div className="text-[9px] text-slate-600">Model confidence: {(pred.confidence * 100).toFixed(0)}%</div>
              </div>
            )}

            {/* Model stats */}
            {model && (
              <div className="bg-slate-900 rounded-lg p-4 space-y-2">
                <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Model Stats</div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">R²</span>
                    <span className="font-mono text-slate-300">{model.r_squared.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Observations</span>
                    <span className="font-mono text-slate-300">{model.n_obs} weeks</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Residual σ</span>
                    <span className="font-mono text-slate-300">{model.residual_std.toFixed(1)} USD/MT</span>
                  </div>
                  <div className="text-[9px] text-slate-600 pt-1">{model.training_period}</div>
                </div>
              </div>
            )}

            {/* Factor contribution waterfall */}
            <div className="bg-slate-900 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Factor Contributions</div>
              <div className="space-y-1.5">
                {[...factors]
                  .filter(f => f.available)
                  .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
                  .map(f => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-28 shrink-0 truncate">{f.label}</span>
                      <div className="flex-1 h-2.5 bg-slate-700 rounded-full">
                        <div
                          className={`h-2.5 rounded-full ${f.contribution >= 0 ? "bg-emerald-600/70" : "bg-red-600/70"}`}
                          style={{ width: `${(Math.abs(f.contribution) / maxContrib) * 100}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-mono w-10 text-right ${chgTone(f.contribution)}`}>
                        {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(0)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
