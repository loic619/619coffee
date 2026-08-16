"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { IMPACT_COLOR, MONTHS, PHASE_COLOR, TT_STYLE } from "@/components/supply/farmer-economics/farmerEconomicsConstants";

const currentMonth = new Date().getMonth(); // 0-indexed

// Explicit month mapping
const CALENDAR_MAP: Record<number, { label: string; color: string; bg: string }> = {
  0:  { label: "Main Harvest",   color: "text-emerald-400", bg: "bg-emerald-900/60" },  // Jan
  1:  { label: "Main Harvest",   color: "text-emerald-400", bg: "bg-emerald-900/60" },  // Feb
  2:  { label: "Off",            color: "text-slate-600",   bg: "bg-slate-800" },        // Mar
  3:  { label: "Fly Harvest",    color: "text-amber-400",   bg: "bg-amber-900/50" },     // Apr
  4:  { label: "Fly Harvest",    color: "text-amber-400",   bg: "bg-amber-900/50" },     // May
  5:  { label: "Fly Harvest",    color: "text-amber-400",   bg: "bg-amber-900/50" },     // Jun
  6:  { label: "Off",            color: "text-slate-600",   bg: "bg-slate-800" },        // Jul
  7:  { label: "Off",            color: "text-slate-600",   bg: "bg-slate-800" },        // Aug
  8:  { label: "Flowering",      color: "text-purple-400",  bg: "bg-purple-900/40" },    // Sep
  9:  { label: "Main Harvest",   color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Oct
  10: { label: "Main Harvest",   color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Nov
  11: { label: "Main Harvest",   color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Dec
};

interface Region {
  name: string;
  drought: "HIGH" | "MED" | "LOW" | "NONE";
  csi_30d?: number;
  csi_30d_level?: string;
  csi_60d?: number;
  csi_60d_level?: string;
}

interface WeatherData {
  scraped_at: string;
  regions: Region[];
  daily_drought: { region: string; days: ("H"|"M"|"L"|"-")[] }[];
}

interface EnsoData {
  phase: "el-nino" | "la-nina" | "neutral";
  intensity: string;
  oni: number;
  peak_month: string;
  forecast_direction: string;
  oni_history: { month: string; value: number; preliminary?: boolean }[];
  regional_impact: { region: string; type: string; note: string; dots: number }[];
  historical_stat: string;
  last_updated: string;
}

interface ProductionMix {
  robusta_pct: number;
  arabica_pct: number;
  note: string;
  key_regions: { robusta: string[]; arabica: string[] };
}

interface HarvestCal {
  main_crop_harvest: string;
  fly_crop_harvest: string;
  description: string;
}


export default function UgandaFarmerEconomics({
  enso, harvest_cal, production_mix,
}: {
  weather: WeatherData | null;
  enso: EnsoData | null;
  harvest_cal: HarvestCal;
  production_mix: ProductionMix;
}) {
  const oniData = (enso?.oni_history ?? []).slice(-24).map(p => ({
    month: p.month,
    value: p.value,
    preliminary: p.preliminary ?? false,
  }));

  return (
    <div className="space-y-3">
      {/* Production mix */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Production Mix</div>
        <div className="flex rounded overflow-hidden h-5">
          <div
            className="bg-amber-600 flex items-center justify-center"
            style={{ width: `${production_mix.robusta_pct}%` }}
          >
            <span className="text-[9px] font-bold text-white">{production_mix.robusta_pct}% Robusta</span>
          </div>
          <div
            className="bg-emerald-700 flex items-center justify-center"
            style={{ width: `${production_mix.arabica_pct}%` }}
          >
            <span className="text-[9px] font-bold text-white">{production_mix.arabica_pct}% Arabica</span>
          </div>
        </div>
        <div className="text-[9px] text-slate-500">{production_mix.note}</div>
        <div className="grid grid-cols-2 gap-2 text-[9px]">
          <div>
            <span className="text-amber-500 font-semibold">Robusta: </span>
            <span className="text-slate-400">{production_mix.key_regions.robusta.join(", ")}</span>
          </div>
          <div>
            <span className="text-emerald-500 font-semibold">Arabica: </span>
            <span className="text-slate-400">{production_mix.key_regions.arabica.join(", ")}</span>
          </div>
        </div>
      </div>

      {/* Bimodal harvest calendar */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Harvest Calendar</div>
        <div className="grid grid-cols-12 gap-0.5">
          {MONTHS.map((mo, i) => {
            const cell = CALENDAR_MAP[i];
            const isCurrent = i === currentMonth;
            return (
              <div key={mo} className={`rounded p-1 text-center ${cell.bg} ${isCurrent ? "ring-1 ring-white" : ""}`}>
                <div className={`text-[8px] font-medium ${cell.color}`}>{mo}</div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 text-[9px]">
          <span><span className="inline-block w-2 h-2 rounded bg-emerald-800 mr-1" />Main Harvest (Oct-Feb)</span>
          <span><span className="inline-block w-2 h-2 rounded bg-amber-800 mr-1" />Fly Crop (Apr-Jun)</span>
          <span><span className="inline-block w-2 h-2 rounded bg-purple-800 mr-1" />Flowering (Sep)</span>
        </div>
        <div className="text-[9px] text-slate-500">{harvest_cal.description}</div>
      </div>


      {/* ENSO */}
      {enso ? (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">ENSO / ONI</div>
            <div className="text-[8px] text-slate-600">NOAA CPC · {enso.last_updated}</div>
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <div className="text-slate-500 text-[9px]">Phase</div>
              <div className={`font-bold text-sm ${PHASE_COLOR[enso.phase]}`}>
                {enso.phase === "el-nino" ? "El Nino" : enso.phase === "la-nina" ? "La Nina" : "Neutral"}
              </div>
              <div className="text-[9px] text-slate-500">{enso.intensity}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[9px]">ONI</div>
              <div className={`font-bold ${enso.oni >= 0.5 ? "text-orange-400" : enso.oni <= -0.5 ? "text-blue-400" : "text-slate-300"}`}>
                {enso.oni >= 0 ? "+" : ""}{enso.oni.toFixed(2)}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-slate-500 text-[9px]">Forecast</div>
              <div className="text-[9px] text-slate-300">{enso.forecast_direction}</div>
            </div>
          </div>

          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={oniData} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 6, fill: "#64748b" }} axisLine={false} tickLine={false} interval={5} />
                <YAxis tick={{ fontSize: 6, fill: "#64748b" }} axisLine={false} tickLine={false} domain={[-3, 3]} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(2)}`, "ONI"]} />
                <Bar dataKey="value" radius={[1,1,0,0]}>
                  {oniData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 0.5 ? "#f97316" : d.value <= -0.5 ? "#3b82f6" : "#94a3b8"} opacity={d.preliminary ? 0.6 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1">
            {enso.regional_impact.map(r => (
              <div key={r.region} className="flex items-start gap-2 text-[9px]">
                <div className="w-20 text-slate-400 shrink-0">{r.region}</div>
                <span className={`font-bold w-8 shrink-0 ${IMPACT_COLOR[r.type] ?? "text-slate-400"}`}>{r.type}</span>
                <span className="text-slate-500">{r.note}</span>
              </div>
            ))}
          </div>

          <div className="text-[9px] text-amber-400/80 bg-amber-950/30 rounded px-2 py-1.5 border border-amber-900/40">
            {enso.historical_stat}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
          ENSO data pending first scraper run
        </div>
      )}
    </div>
  );
}
