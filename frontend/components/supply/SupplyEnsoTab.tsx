"use client";
/**
 * ENSO intelligence as a /supply subtab.
 *
 * Mirrors the standalone /enso page (PhaseSummary → forecast plume → analog
 * chart → risk map + table) so the user gets the same content without
 * leaving the supply context. Wraps the dynamic Leaflet risk map in an SSR
 * boundary (window-only library). Data source is unchanged: /data/enso.json.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import EnsoForecastPlume from "@/components/enso/EnsoForecastPlume";
import EnsoAnalogChart from "@/components/enso/EnsoAnalogChart";
import EnsoDivergenceChart from "@/components/enso/EnsoDivergenceChart";
import EnsoSubsurfaceCard from "@/components/enso/EnsoSubsurfaceCard";
import EnsoThermoclineCard from "@/components/enso/EnsoThermoclineCard";
import EnsoTimeRangeSelector from "@/components/enso/EnsoTimeRangeSelector";
import EnsoRiskTable from "@/components/enso/EnsoRiskTable";
import { PHASE_META, phaseLabel, type EnsoData } from "@/lib/enso";
import { ENSO_DEFAULT_RANGE, type EnsoTimeRange } from "@/lib/ensoTimeRange";

const EnsoRiskMap = dynamic(() => import("@/components/enso/EnsoRiskMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 text-xs text-slate-500" style={{ height: 360 }}>
      Loading risk map…
    </div>
  ),
});

function PhaseSummary({ data }: { data: EnsoData }) {
  const meta = PHASE_META[data.phase] ?? PHASE_META.neutral;
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-block w-3.5 h-3.5 rounded-full" style={{ background: meta.color }} />
          <div>
            <div className="text-lg font-bold text-white flex items-center gap-2 flex-wrap">
              {phaseLabel(data.phase)} <span className="text-slate-400 font-normal">· {data.intensity}</span>
              {data.phase_status === "emerging" && (
                // NOAA confirms an event four to five months after onset —
                // longer than a flowering window. The map reads the observed
                // state and says plainly that it is running ahead of the
                // official call, rather than reporting "neutral" at +1.39.
                <span
                  title={data.phase_basis ?? undefined}
                  className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-600/60 bg-amber-950/40 text-amber-300"
                >
                  Developing · not yet NOAA-confirmed
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              Current ONI <span className="font-mono text-slate-200">{data.oni ?? "—"}</span>
              {data.peak_month ? ` · peak ${data.peak_month}` : ""}
              {data.nino34?.sst_anomaly != null && (
                <>
                  {" · Niño 3.4 "}
                  <span className="font-mono text-slate-200">
                    {data.nino34.sst_anomaly > 0 ? "+" : ""}{data.nino34.sst_anomaly.toFixed(1)}°C
                  </span>
                  {data.nino34.week_ending ? (
                    <span className="text-slate-500"> (wk {data.nino34.week_ending})</span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-400 max-w-md">
          {data.forecast_direction && <div className="text-slate-300">{data.forecast_direction}</div>}
          {data.historical_stat && <div className="mt-0.5">{data.historical_stat}</div>}
          {data.last_updated && <div className="mt-0.5 text-[10px] text-slate-500">Updated {data.last_updated}</div>}
        </div>
      </div>
    </div>
  );
}

export default function SupplyEnsoTab() {
  const [data, setData] = useState<EnsoData | null>(null);
  const [error, setError] = useState(false);
  // Shared time window for the Niño 3.4 + SOI divergence chart and
  // the WWV subsurface card. The thermocline card has no historical
  // series yet (live ~75-day window only) so it isn't driven by the
  // selector — when the climatology backfill ships, it'll join.
  const [range, setRange] = useState<EnsoTimeRange>(ENSO_DEFAULT_RANGE);

  useEffect(() => {
    fetch("/data/enso.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-slate-500">
          ENSO data unavailable — enso.json failed to load. Populates after the next export-and-publish run.
        </div>
      )}
      {!data && !error && (
        <div className="text-xs text-slate-500 animate-pulse">Loading ENSO intelligence…</div>
      )}
      {data && (
        <>
          <PhaseSummary data={data} />
          <div className="flex justify-end">
            <EnsoTimeRangeSelector value={range} onChange={setRange} />
          </div>
          <EnsoDivergenceChart range={range} />
          <EnsoSubsurfaceCard range={range} />
          <EnsoThermoclineCard />
          <EnsoForecastPlume forecast={data.oni_forecast} />
          <EnsoAnalogChart current={data.current_window} analogs={data.analogs} />
          <EnsoRiskMap pins={data.risk.pins} />
          <EnsoRiskTable pins={data.risk.pins} />
        </>
      )}
    </div>
  );
}
