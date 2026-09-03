"use client";
import ModelledBadge from "@/components/ModelledBadge";
import { chgTone } from "@/lib/formatters";

interface Factor {
  label: string;
  category: "Macro" | "Momentum" | "Positioning" | "Fundamentals" | "Seasonality";
  quantile: number;
  beta: number;
  contribution: number;
}

const BASE = 12.1906;

const FACTORS: Factor[] = [
  { label: "VN Stocks to Use",      category: "Fundamentals", quantile:  5, beta:  7.5563, contribution:  37.7813 },
  { label: "VN Diff Seasonality",   category: "Seasonality",  quantile:  5, beta:  3.9353, contribution:  19.6763 },
  { label: "RC Futures Level",       category: "Macro",        quantile:  3, beta:  4.1200, contribution:  12.3600 },
  { label: "VN Export Vol MoM",      category: "Fundamentals", quantile:  2, beta:  3.2500, contribution:   6.5000 },
  { label: "Managed Money RC Net",   category: "Positioning",  quantile: -1, beta: -2.4800, contribution:   2.4800 },
  { label: "BCOM Index",             category: "Macro",        quantile:  1, beta:  2.1000, contribution:   2.1000 },
  { label: "ROC RC 5d",              category: "Momentum",     quantile: -3, beta: -1.8700, contribution:  -5.6100 },
  { label: "USD/VND momentum",       category: "Momentum",     quantile: -2, beta: -2.0600, contribution:  -4.1200 },
  { label: "VN Domestic Stocks",     category: "Fundamentals", quantile: -2, beta: -1.5000, contribution:  -3.0000 },
];

const FINAL = 79.9109;

const CAT_COLOR: Record<string, string> = {
  Macro:          "text-blue-400 bg-blue-950/50 border-blue-800",
  Momentum:       "text-amber-400 bg-amber-950/50 border-amber-800",
  Positioning:    "text-purple-400 bg-purple-950/50 border-purple-800",
  Fundamentals:   "text-emerald-400 bg-emerald-950/50 border-emerald-800",
  Seasonality:    "text-sky-400 bg-sky-950/50 border-sky-800",
};

function QuantileBar({ value }: { value: number }) {
  const pct = ((value + 5) / 10) * 100;
  const color = value > 0 ? "bg-emerald-500" : value < 0 ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-1 w-28">
      <div className="flex-1 h-2 bg-slate-700 rounded-full relative">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-500" />
        <div
          className={`absolute top-0.5 h-1 w-1.5 rounded-full ${color}`}
          style={{ left: `${Math.min(95, Math.max(2, pct))}%` }}
        />
      </div>
    </div>
  );
}

export default function VietnamDiffSection() {
  // SHAP waterfall order — largest magnitude first
  const shapFactors = [...FACTORS].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded">Section 4</span>
          <h2 className="text-base font-bold text-white">Vietnam Differential Forecast</h2>
          <ModelledBadge method="multi-factor" hitRate={null} note="mock inputs" />
          <span className="text-[10px] text-slate-500">MFA · Q-Range [−5, +5] · High-variance regime</span>
        </div>
        <div className="flex items-center gap-2 mt-1 px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500 w-fit">
          <span className="text-amber-400 font-bold">MOCK DATA</span>
          <span>VN stocks-to-use pipeline not yet wired. Figures below are illustrative only.</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Same Multi-Factor Architecture as Robusta Futures but targeting the Vietnam differential.{" "}
          Baseline <span className="font-mono text-slate-200">E[f(x)] = {BASE.toFixed(4)}</span>, massive upward
          divergence from VN Stocks-to-Use and Seasonality drives output to{" "}
          <span className="font-mono text-emerald-300 font-bold">{FINAL.toFixed(4)}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Factor table */}
        <div className="xl:col-span-2 bg-slate-900 rounded-lg overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
                <th className="text-left px-3 py-2">Factor</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-center px-3 py-2">Q</th>
                <th className="px-3 py-2">Range</th>
                <th className="text-right px-3 py-2">β</th>
                <th className="text-right px-3 py-2">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {FACTORS.map((f, i) => (
                <tr key={f.label} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/40" : ""} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 text-slate-200 whitespace-nowrap">{f.label}</td>
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
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{f.beta.toFixed(4)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${chgTone(f.contribution)}`}>
                    {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-600">
                <td colSpan={4} className="px-3 py-2 text-[11px] text-slate-400">Intercept E[f(x)]</td>
                <td />
                <td className="px-3 py-2 text-right font-mono text-slate-300">{BASE.toFixed(4)}</td>
              </tr>
              <tr className="bg-slate-800/60">
                <td colSpan={4} className="px-3 py-2 text-[11px] font-bold text-white">VN Differential Forecast f(x)</td>
                <td />
                <td className="px-3 py-2 text-right font-mono font-bold text-lg text-emerald-300">
                  +{FINAL.toFixed(4)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right: SHAP waterfall + KPIs */}
        <div className="space-y-3">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">Baseline</div>
              <div className="text-base font-bold font-mono text-slate-300 mt-1">{BASE.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">Output</div>
              <div className="text-base font-bold font-mono text-emerald-300 mt-1">{FINAL.toFixed(2)}</div>
            </div>
          </div>

          {/* SHAP waterfall mini */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">SHAP Waterfall</div>
            {/* Baseline */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-slate-500 w-28 shrink-0 truncate">E[f(x)]</span>
              <div className="flex-1 h-3 bg-slate-700 rounded relative">
                <div className="h-3 rounded bg-slate-600" style={{ width: `${(BASE / FINAL) * 100}%` }} />
                <span className="absolute right-1 top-0 text-[9px] font-mono text-slate-400 leading-3">{BASE.toFixed(2)}</span>
              </div>
            </div>
            {shapFactors.map((f) => {
              const barPct = (Math.abs(f.contribution) / FINAL) * 100;
              return (
                <div key={f.label} className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-slate-500 w-28 shrink-0 truncate">{f.label}</span>
                  <div className="flex-1 h-3 bg-slate-700 rounded relative overflow-hidden">
                    <div
                      className={`h-3 rounded ${f.contribution >= 0 ? "bg-emerald-700/70" : "bg-red-700/70"}`}
                      style={{ width: `${Math.min(100, barPct)}%` }}
                    />
                    <span className="absolute right-1 top-0 text-[9px] font-mono leading-3 text-slate-400">
                      {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="border-t border-slate-700 mt-2 pt-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-white w-28 shrink-0">f(x)</span>
              <div className="flex-1 h-4 bg-emerald-900/40 rounded relative">
                <span className="absolute right-1 top-0 text-[10px] font-mono font-bold text-emerald-300 leading-4">{FINAL.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Variance note */}
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1">High Variance Regime</div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              VN Differential exhibits significantly larger SHAP dispersion than Robusta Futures.
              VN Stocks-to-Use (+{shapFactors[0].contribution.toFixed(2)}) alone drives{" "}
              {((shapFactors[0].contribution / FINAL) * 100).toFixed(0)}% of the final prediction.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
