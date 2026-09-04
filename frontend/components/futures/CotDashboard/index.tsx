"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchMacroCot, type MacroCotWeek, type CotWeekly } from "@/lib/api";
import { transformApiData } from "@/lib/cot/transformApiData";

import { generateData } from "./generateData";

import Overview from "./Overview";
import CotGauges from "./Gauges";
import CotHeatmap from "./Heatmap";
import Step1GlobalFlow from "./Step1GlobalFlow";
import Step4IndustryPulse from "./Step4IndustryPulse";
import Step5DryPowder from "./Step5DryPowder";
import Step6CycleLocation from "./Step6CycleLocation";
import Step7Report from "./Step7Report";
import Step8Analysis from "./Step8Analysis";
import Step9OptionsBook from "./Step9OptionsBook";
import OIHistoryTable from "@/components/futures/OIHistoryTable";
import PinToReport from "@/components/report/PinToReport";
import { evaluateSignals, evaluateHistoricalSignals } from "@/lib/cot/signalEngine";

export default function CotDashboard() {
  const [cotRows, setCotRows] = useState<CotWeekly[] | null>(null);
  const [cotError, setCotError] = useState(false);
  const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
  const [macroError, setMacroError] = useState(false);

  useEffect(() => {
    // Single source: the static cot.json published by the daily export
    // (export_static_json → workflow 1.4). COT is a WEEKLY series, so the
    // static snapshot is as fresh as a live /api/cot fetch would be — and
    // it's a CDN-cached file, so we skip the redundant 3 MB live re-fetch
    // (and the backend dependency) entirely. Full history stays in the DB /
    // /api/cot for anyone who needs it; the published file is trimmed to the
    // window the dashboard actually renders (see export_cot).
    fetch("/data/cot.json")
      .then(r => (r.ok ? r.json() : null))
      .then((rows: CotWeekly[] | null) => {
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          setCotError(true);   // no static data → fall back to mock + banner
          return;
        }
        setCotRows(rows as CotWeekly[]);
      })
      .catch(() => setCotError(true));

    fetchMacroCot().then(setMacroData).catch(() => setMacroError(true));
  }, []);

  const data = useMemo(
    () => (cotRows?.length ? transformApiData(cotRows as unknown as import("@/lib/cot/types").CotRawRow[]) : generateData()),
    [cotRows]
  );
  const latest    = data[data.length - 1];
  const recent52  = data.slice(-52);
  const signals            = useMemo(() => evaluateSignals(data), [data]);
  const historicalSignals  = useMemo(() => evaluateHistoricalSignals(data), [data]);

  return (
    <div className="space-y-4" style={{ position: "relative" }}>
      {/* Mock-data warning only when the static cot.json failed to load. */}
      {cotError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs font-medium">
          Data unavailable — showing illustrative data only (prices random, data ends ~Nov 2025).
        </div>
      )}
      {/* Loading bar only while the static snapshot hasn't resolved yet. */}
      {cotRows === null && !cotError && (
        <div className="mb-3 h-2 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-slate-600 animate-pulse w-full" />
        </div>
      )}

      {cotRows !== null && !cotError && (
        <div className="text-[10px] text-slate-500 font-mono px-1">
          COT data as of <span className="text-slate-400">{latest.date}</span>
        </div>
      )}

      <div id="cot-section-10" className="relative">
        <div className="absolute right-0 -top-1 z-10"><PinToReport id="cot_overview" /></div>
        <Overview data={data} />
      </div>

      {/* NY & London OI — 14-Day Tracking. Moved from /futures Exchange
          tab so positioning context sits next to the COT signal output. */}
      {/* id 11: 9 belongs to Step9OptionsBook — this block carried the same id
          and stole every #cot-section-9 anchor and scroll. */}
      <div id="cot-section-11" className="space-y-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold px-1">
          NY & London OI — 14-Day Tracking
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              NY OI
            </h3>
            <OIHistoryTable market="arabica" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              LDN OI
            </h3>
            <OIHistoryTable market="robusta" />
          </div>
        </div>
        {/* OIFndChart (OI Evolution to FND) moved to /futures Exchange tab
            (bottom) — the buildup-into-FND view is operational roll context,
            not COT positioning context. */}
      </div>

      <div id="cot-section-2"><CotHeatmap data={data} /></div>
      <div id="cot-section-3"><CotGauges data={data} /></div>

      {/* Steps 1, 4–9 carry their own cot-section-N id on their root, so the
          wrappers here stay id-less — a second element with the same id made
          every anchor resolve to the wrapper and the DOM invalid. */}
      <Step1GlobalFlow macroData={macroData} macroError={macroError} />

      <Step4IndustryPulse  data={data} />
      <Step5DryPowder      data={data} />
      <Step6CycleLocation  recent52={recent52} />
      <Step7Report         data={data} recent52={recent52} />

      {/* Everything above is futures-only; this is what options adds. */}
      <Step9OptionsBook />

      {/* Signals moved to the end of the report. */}
      <Step8Analysis signals={signals} historicalSignals={historicalSignals} />
    </div>
  );
}
