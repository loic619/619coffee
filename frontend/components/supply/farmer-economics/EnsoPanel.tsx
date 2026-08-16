"use client";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { FarmerEconomicsData, EnsoPhase, ImpactType } from "./farmerEconomicsData";

interface Props {
  enso: NonNullable<FarmerEconomicsData["enso"]>;
}

const PHASE_STYLE: Record<EnsoPhase, { icon: string; label: string; border: string; text: string; bg: string }> = {
  "el-nino": { icon: "🌡", label: "El Niño",  border: "border-purple-500", text: "text-purple-300", bg: "bg-purple-950" },
  "la-nina": { icon: "🌊", label: "La Niña",  border: "border-blue-400",   text: "text-blue-300",   bg: "bg-blue-950"   },
  "neutral":  { icon: "⚖",  label: "Neutral",  border: "border-slate-500",  text: "text-slate-400",  bg: "bg-slate-900"  },
};

const IMPACT_STYLE: Record<ImpactType, { bg: string; text: string; dotFill: string; dotEmpty: string }> = {
  DRY:  { bg: "bg-amber-900",  text: "text-amber-300",  dotFill: "bg-amber-400",  dotEmpty: "bg-amber-950 border border-amber-800"  },
  WET:  { bg: "bg-cyan-900",   text: "text-cyan-300",   dotFill: "bg-cyan-400",   dotEmpty: "bg-cyan-950 border border-cyan-800"    },
  COLD: { bg: "bg-blue-900",   text: "text-blue-300",   dotFill: "bg-blue-400",   dotEmpty: "bg-blue-950 border border-blue-800"    },
  WARM: { bg: "bg-orange-900", text: "text-orange-300", dotFill: "bg-orange-400", dotEmpty: "bg-orange-950 border border-orange-800" },
};

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

export default function EnsoPanel({ enso }: Props) {
  const phase = PHASE_STYLE[enso.phase];

  const barColor = (value: number, isPreliminary?: boolean) => {
    if (isPreliminary) return value >= 0 ? "#7c5fa8" : "#4a7fa8";
    return value >= 0 ? "#a78bfa" : "#60a5fa";
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">ENSO</div>

      {/* Phase badge */}
      <div className={`rounded-lg px-3 py-2 border ${phase.border} ${phase.bg}`}>
        <div className={`font-bold text-sm ${phase.text}`}>
          {phase.icon} {phase.label} — {enso.intensity} · ONI {enso.oni > 0 ? "+" : ""}{enso.oni}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Peak: {enso.peak_month} · {enso.forecast_direction}
        </div>
      </div>

      {/* ONI bar chart */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">
          ONI index — 18-month history + forecast
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={enso.oni_history} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 7 }} interval={2} />
            <YAxis domain={[-2.5, 2.5]} tick={{ fill: "#475569", fontSize: 8 }} width={28} />
            <ReferenceLine y={0}    stroke="#334155" strokeWidth={1.5} />
            <ReferenceLine y={0.5}  stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="3 3" />
            <ReferenceLine y={-0.5} stroke="#2563eb" strokeWidth={0.5} strokeDasharray="3 3" />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, _: unknown, props: { payload?: { preliminary?: boolean } }) => [
                `ONI ${Number(v) > 0 ? "+" : ""}${v}`,
                props.payload?.preliminary ? "Preliminary" : "Confirmed",
              ]}
            />
            <Bar dataKey="value" maxBarSize={14} radius={[2, 2, 0, 0]}>
              {enso.oni_history.map((entry, i) => (
                <Cell
                  key={i}
                  fill={barColor(entry.value, (entry as { preliminary?: boolean }).preliminary)}
                  fillOpacity={(entry as { preliminary?: boolean }).preliminary ? 0.6 : 0.85}
                  stroke="none"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="text-[9px] text-slate-600 mt-1">
          Solid = confirmed · Faded = preliminary (NOAA ~2-month lag) · Threshold ±0.5
        </div>
      </div>

      {/* Regional impact row */}
      <div>
        <div className="text-[10px] text-slate-500 mb-2">Regional impact</div>
        <div className="grid grid-cols-2 gap-2">
          {enso.regional_impact.map((r) => {
            const style = IMPACT_STYLE[r.type];
            return (
              <div key={r.region} className="bg-slate-900 rounded p-2">
                <div className="text-[9px] text-slate-500 mb-1">{r.region}</div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                    {r.type}
                  </span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 4 }, (_, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full inline-block ${
                          i < r.dots ? style.dotFill : style.dotEmpty
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-[8px] text-slate-500">{r.note}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6-month probability forecast */}
      {enso.oni_forecast && enso.oni_forecast.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 mb-1">
            IRI/CPC phase probability — 9-season outlook
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart
              data={enso.oni_forecast}
              margin={{ top: 2, right: 4, bottom: 0, left: 0 }}
              barSize={14}
            >
              <XAxis dataKey="season" tick={{ fill: "#475569", fontSize: 7 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 8 }} width={24} unit="%" />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [`${v}%`, String(name ?? "")]}
              />
              <Bar dataKey="la_nina" name="La Niña"  stackId="p" fill="#60a5fa" fillOpacity={0.85} radius={[0,0,0,0]} />
              <Bar dataKey="neutral" name="Neutral"   stackId="p" fill="#475569" fillOpacity={0.7}  radius={[0,0,0,0]} />
              <Bar dataKey="el_nino" name="El Niño"  stackId="p" fill="#a78bfa" fillOpacity={0.85} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-1 text-[8px] text-slate-500">
            <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-400 mr-1"/>La Niña</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-500 mr-1"/>Neutral</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-violet-400 mr-1"/>El Niño</span>
            <span className="ml-auto">Source: IRI/CPC · Updated monthly</span>
          </div>
        </div>
      )}

      {/* Historical stat */}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
        {enso.historical_stat}
      </div>
    </div>
  );
}
