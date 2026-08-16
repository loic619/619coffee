"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { IMPACT_COLOR, MONTHS, PHASE_COLOR, TT_STYLE } from "@/components/supply/farmer-economics/farmerEconomicsConstants";

const currentMonth = new Date().getMonth();

// Ethiopia harvest calendar
const CALENDAR_MAP: Record<number, { label: string; color: string; bg: string }> = {
  0:  { label: "Main Harvest",  color: "text-emerald-400", bg: "bg-emerald-900/60" },  // Jan
  1:  { label: "Flowering",     color: "text-purple-400",  bg: "bg-purple-900/40" },   // Feb
  2:  { label: "Flowering",     color: "text-purple-400",  bg: "bg-purple-900/40" },   // Mar
  3:  { label: "2nd Harvest",   color: "text-blue-400",    bg: "bg-blue-900/40" },     // Apr
  4:  { label: "2nd Harvest",   color: "text-blue-400",    bg: "bg-blue-900/40" },     // May
  5:  { label: "Off",           color: "text-slate-600",   bg: "bg-slate-800" },        // Jun
  6:  { label: "Off",           color: "text-slate-600",   bg: "bg-slate-800" },        // Jul
  7:  { label: "Off",           color: "text-slate-600",   bg: "bg-slate-800" },        // Aug
  8:  { label: "Off",           color: "text-slate-600",   bg: "bg-slate-800" },        // Sep
  9:  { label: "Main Harvest",  color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Oct
  10: { label: "Main Harvest",  color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Nov
  11: { label: "Main Harvest",  color: "text-emerald-400", bg: "bg-emerald-900/60" },   // Dec
};

interface Region {
  name: string;
  drought: "HIGH" | "MED" | "LOW" | "NONE";
  csi_30d?: number;
  csi_30d_level?: string;
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

interface HarvestCal {
  main_crop_harvest: string;
  main_crop_flowering: string;
  description: string;
}

interface GradeStructure {
  grades: { grade: string; quality: string; defects: string; regions: string }[];
  processing: { natural_pct: number; washed_pct: number; note: string };
}


export default function EthiopiaFarmerEconomics({
  enso, harvest_cal, grade_structure,
}: {
  weather: WeatherData | null;
  enso: EnsoData | null;
  harvest_cal: HarvestCal;
  grade_structure: GradeStructure;
}) {
  const oniData = (enso?.oni_history ?? []).slice(-24).map(p => ({
    month: p.month,
    value: p.value,
    preliminary: p.preliminary ?? false,
  }));

  return (
    <div className="space-y-3">
      {/* Grade structure */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Grade Structure & Processing</div>
        <div className="flex rounded overflow-hidden h-5 mb-2">
          <div
            className="bg-amber-700 flex items-center justify-center"
            style={{ width: `${grade_structure.processing.natural_pct}%` }}
          >
            <span className="text-[9px] font-bold text-white">{grade_structure.processing.natural_pct}% Natural</span>
          </div>
          <div
            className="bg-blue-700 flex items-center justify-center"
            style={{ width: `${grade_structure.processing.washed_pct}%` }}
          >
            <span className="text-[9px] font-bold text-white">{grade_structure.processing.washed_pct}% Washed</span>
          </div>
        </div>
        <div className="text-[9px] text-slate-500 mb-2">{grade_structure.processing.note}</div>
        <div className="space-y-1">
          {grade_structure.grades.map(g => (
            <div key={g.grade} className="flex items-center gap-2 text-[9px]">
              <span className="text-emerald-400 font-semibold w-14 shrink-0">{g.grade}</span>
              <span className="text-slate-300 w-16 shrink-0">{g.quality}</span>
              <span className="text-slate-500 w-16 shrink-0">&lt;{g.defects} def.</span>
              <span className="text-slate-400">{g.regions}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Harvest calendar */}
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
          <span><span className="inline-block w-2 h-2 rounded bg-emerald-800 mr-1" />Main Harvest (Oct-Jan)</span>
          <span><span className="inline-block w-2 h-2 rounded bg-blue-800 mr-1" />2nd Crop (Apr-May)</span>
          <span><span className="inline-block w-2 h-2 rounded bg-purple-800 mr-1" />Flowering (Feb-Mar)</span>
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
                <div className="w-28 text-slate-400 shrink-0">{r.region}</div>
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
