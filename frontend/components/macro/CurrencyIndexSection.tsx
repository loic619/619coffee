"use client";
import { useEffect, useState } from "react";
import { chgTone } from "@/lib/formatters";

interface CurrencyDetail {
  ticker: string;
  name: string;
  type: "export" | "import";
  weight: number;
  daily_chg: number | null;
  contribution: number | null;
}

interface HistoryPoint {
  date: string;
  value: number;
}

interface CurrencyIndexData {
  scraped_at: string;
  index_value: number | null;
  daily_delta_i: number | null;
  daily_delta_pct: number | null;
  zscore: number | null;
  zscore_mean: number | null;
  zscore_std: number | null;
  currencies: CurrencyDetail[];
  history: HistoryPoint[];
}

function fmt2(v: number | null, suffix = ""): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
}
function fmt4(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(4)}`;
}

export default function CurrencyIndexSection() {
  const [data, setData] = useState<CurrencyIndexData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(j => setData(j.currency_index ?? null))
      .catch(() => setError(true));
  }, []);

  if (error) return (
    <section className="px-6 py-5">
      <div className="text-xs text-red-400">Failed to load currency index data.</div>
    </section>
  );
  if (!data) return (
    <section className="px-6 py-5">
      <div className="text-xs text-slate-500 animate-pulse">Loading currency index…</div>
    </section>
  );

  const exporters = data.currencies.filter(c => c.type === "export");
  const importers = data.currencies.filter(c => c.type === "import");

  const history = data.history ?? [];
  const minVal = Math.min(...history.map(h => h.value)) - 0.5;
  const maxVal = Math.max(...history.map(h => h.value)) + 0.5;

  const totalDeltaI = data.daily_delta_i ?? 0;

  return (
    <section className="px-6 py-5 space-y-4">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">Section 3</span>
          <h2 className="text-base font-bold text-white">Coffee Currency Index</h2>
          <span className="text-[10px] text-slate-500">DXY-replication · USDA 2023/24 export &amp; import weights</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Weighted composite of producing/consuming currency pairs.{" "}
          <span className="font-mono text-slate-200">ΔI = Σ w_Ex,i · s_Ex,i − Σ w_Im,j · s_Im,j</span>{" "}
          (s = strength vs USD; producer + bullish, consumer − bearish).
          Base = 100. Z-score over trailing {252}-day window. Updated daily after US close.
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          As of {data.scraped_at.slice(0, 10)}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Currency table */}
        <div className="xl:col-span-2 bg-slate-900 rounded-lg overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700 bg-slate-800/60">
                <th className="text-left px-3 py-2">Pair</th>
                <th className="text-left px-3 py-2">Currency</th>
                <th className="text-center px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">Weight</th>
                <th className="text-right px-3 py-2">Daily Chg%</th>
                <th className="text-right px-3 py-2">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {/* Exporters */}
              <tr className="bg-emerald-950/30">
                <td colSpan={6} className="px-3 py-1 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                  Exporting Nations (USDA 2023/24)
                </td>
              </tr>
              {exporters.map((c, i) => (
                <tr key={c.ticker} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/40" : ""} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 font-mono font-semibold text-slate-200">{c.ticker}</td>
                  <td className="px-3 py-1.5 text-slate-400">{c.name}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded border text-emerald-400 bg-emerald-950/50 border-emerald-800">Export</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">{(c.weight * 100).toFixed(1)}%</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.daily_chg == null ? "text-slate-500" : chgTone(c.daily_chg)}`}>
                    {c.daily_chg == null ? "—" : `${c.daily_chg >= 0 ? "+" : ""}${c.daily_chg.toFixed(2)}%`}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${c.contribution == null ? "text-slate-500" : chgTone(c.contribution)}`}>
                    {fmt4(c.contribution)}
                  </td>
                </tr>
              ))}

              {/* Importers */}
              <tr className="bg-blue-950/30">
                <td colSpan={6} className="px-3 py-1 text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                  Importing Nations (USDA 2023/24)
                </td>
              </tr>
              {importers.map((c, i) => (
                <tr key={c.ticker} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/40" : ""} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 font-mono font-semibold text-slate-200">{c.ticker}</td>
                  <td className="px-3 py-1.5 text-slate-400">{c.name}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded border text-blue-400 bg-blue-950/50 border-blue-800">Import</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">{(c.weight * 100).toFixed(1)}%</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.daily_chg == null ? "text-slate-500" : chgTone(c.daily_chg)}`}>
                    {c.daily_chg == null ? "—" : `${c.daily_chg >= 0 ? "+" : ""}${c.daily_chg.toFixed(2)}%`}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${c.contribution == null ? "text-slate-500" : chgTone(c.contribution)}`}>
                    {fmt4(c.contribution)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800/60 border-t border-slate-600">
                <td colSpan={5} className="px-3 py-2 text-[11px] font-bold text-white">ΔI (Total Daily Index Move)</td>
                <td className={`px-3 py-2 text-right font-mono font-bold text-base ${chgTone(totalDeltaI)}`}>
                  {fmt4(totalDeltaI)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right panel */}
        <div className="space-y-3">
          {/* Index KPIs */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Index Level</div>
            <div className={`text-3xl font-bold font-mono ${data.index_value == null ? "text-slate-500" : "text-white"}`}>
              {data.index_value?.toFixed(2) ?? "—"}
            </div>
            <div className={`text-sm font-mono font-semibold ${chgTone((data.daily_delta_pct ?? 0))}`}>
              {fmt2(data.daily_delta_pct, "% today")}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div>
                <div className="text-[9px] text-slate-500">Z-Score</div>
                <div className={`font-mono font-bold text-sm ${(data.zscore ?? 0) >= 0 ? "text-amber-400" : "text-blue-400"}`}>
                  {fmt2(data.zscore)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500">Mean μ</div>
                <div className="font-mono text-sm text-slate-300">{data.zscore_mean?.toFixed(1) ?? "—"}</div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500">Std σ</div>
                <div className="font-mono text-sm text-slate-300">{data.zscore_std?.toFixed(2) ?? "—"}</div>
              </div>
            </div>
            {data.index_value != null && data.zscore_mean != null && data.zscore_std != null && (
              <div className="text-[10px] text-slate-500 font-mono">
                Z = ({data.index_value.toFixed(1)} − {data.zscore_mean.toFixed(1)}) / {data.zscore_std.toFixed(2)} = {fmt2(data.zscore)}
              </div>
            )}
          </div>

          {/* Sparkline */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              {history.length}-Day Index History
            </div>
            <div className="flex items-end gap-px h-16">
              {history.map((h, i) => {
                const heightPct = maxVal === minVal ? 50 : ((h.value - minVal) / (maxVal - minVal)) * 100;
                const isLatest  = i === history.length - 1;
                return (
                  <div key={h.date} className="flex flex-col items-center flex-1 gap-0.5" title={`${h.date}: ${h.value.toFixed(2)}`}>
                    <div className="w-full flex items-end" style={{ height: "48px" }}>
                      <div
                        className={`w-full rounded-sm ${isLatest ? "bg-amber-400" : "bg-slate-600"}`}
                        style={{ height: `${Math.max(4, heightPct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-500">{history[0]?.date ?? ""}</span>
              <span className="text-[9px] text-slate-500">{history[history.length - 1]?.date ?? ""}</span>
            </div>
          </div>

          {/* Weight legend */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Weights (USDA 2023/24)</div>
            <div className="space-y-1.5">
              {data.currencies.map(c => (
                <div key={c.ticker} className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.type === "export" ? "bg-emerald-500" : "bg-blue-500"}`} />
                  <span className="text-[10px] font-mono text-slate-300 w-20 shrink-0">{c.ticker}</span>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full">
                    <div
                      className={`h-1.5 rounded-full ${c.type === "export" ? "bg-emerald-600" : "bg-blue-600"}`}
                      style={{ width: `${c.weight * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{(c.weight * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
