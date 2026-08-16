"use client";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { IMPACT_TEXT, MONTHS as MONTH_NAMES, PHASE_STYLE, TT_STYLE } from "@/components/supply/farmer-economics/farmerEconomicsConstants";

type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
type DayRisk   = "H" | "M" | "L" | "-";

interface WeatherRegion {
  name: string;
  drought: RiskLevel;
  csi_30d?: number;
  csi_30d_level?: string;
  csi_60d?: number;
  csi_60d_level?: string;
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

interface HarvestWindow {
  island: string;
  harvest: string;
  flowering: string;
  crop: "robusta" | "arabica" | "mixed";
}

interface ProductionMix {
  robusta_pct: number;
  arabica_pct: number;
  note: string;
  key_regions: { robusta: string[]; arabica: string[] };
}

interface WeatherData {
  scraped_at: string;
  regions: WeatherRegion[];
  daily_drought: { region: string; days: DayRisk[] }[];
}

interface Props {
  weather: WeatherData | null;
  enso: EnsoData | null;
  harvest_windows: HarvestWindow[];
  production_mix: ProductionMix;
}

const CROP_COLOR: Record<string, string> = {
  robusta: "bg-violet-700",
  arabica: "bg-emerald-700",
  mixed:   "bg-teal-700",
};

// Build month-level harvest bar for a given island window string like "Mar–Aug"

function parseMonthRange(range: string): Set<number> {
  const [start, end] = range.split("–").map(s => MONTH_NAMES.indexOf(s.trim()));
  if (start === -1 || end === -1) return new Set();
  const result = new Set<number>();
  if (start <= end) {
    for (let i = start; i <= end; i++) result.add(i);
  } else {
    // Wraps year e.g. Oct–Mar
    for (let i = start; i < 12; i++) result.add(i);
    for (let i = 0; i <= end; i++) result.add(i);
  }
  return result;
}

export default function IndonesiaFarmerEconomics({ enso, harvest_windows, production_mix }: Props) {
  const currentMonth = new Date().getMonth();

  return (
    <div className="space-y-4">

      {/* ── Production Mix ─────────────────────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Production Mix</div>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1">
            <div className="flex h-5 rounded-full overflow-hidden">
              <div className="bg-violet-700 flex items-center justify-center text-[9px] font-bold text-white"
                   style={{ width: `${production_mix.robusta_pct}%` }}>
                {production_mix.robusta_pct}%
              </div>
              <div className="bg-emerald-700 flex items-center justify-center text-[9px] font-bold text-white"
                   style={{ width: `${production_mix.arabica_pct}%` }}>
                {production_mix.arabica_pct}%
              </div>
            </div>
            <div className="flex gap-4 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-violet-700" />
                <span className="text-[9px] text-slate-400">Robusta</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-emerald-700" />
                <span className="text-[9px] text-slate-400">Arabica</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[9px]">
          <div>
            <div className="text-violet-400 font-semibold mb-0.5">Robusta regions</div>
            {production_mix.key_regions.robusta.map(r => (
              <div key={r} className="text-slate-500">· {r}</div>
            ))}
          </div>
          <div>
            <div className="text-emerald-400 font-semibold mb-0.5">Arabica regions</div>
            {production_mix.key_regions.arabica.map(r => (
              <div key={r} className="text-slate-500">· {r}</div>
            ))}
          </div>
        </div>
        <p className="text-[9px] text-slate-500 mt-2 leading-relaxed">{production_mix.note}</p>
        <p className="text-[9px] text-slate-600 mt-1">
          No national price floor. RC (robusta) futures serve as the benchmark for ~75% of output.
          Farm-gate price ≈ RC front month × 0.06 USD/kg × USD/IDR rate, minus processing/export costs.
        </p>
      </div>

      {/* ── Multi-Island Harvest Calendar ────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Harvest Calendar — By Island</div>
        <div className="space-y-2">
          {harvest_windows.map(w => {
            const harvestMonths  = parseMonthRange(w.harvest);
            const flowerMonths   = parseMonthRange(w.flowering);
            return (
              <div key={w.island}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] text-slate-300 w-40 shrink-0">{w.island}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${
                    w.crop === "robusta" ? "bg-violet-900 text-violet-300"
                    : w.crop === "arabica" ? "bg-emerald-900 text-emerald-300"
                    : "bg-teal-900 text-teal-300"
                  }`}>{w.crop}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-40 shrink-0" />
                  <div className="flex-1 grid grid-cols-12 gap-px">
                    {MONTH_NAMES.map((m, i) => {
                      const isHarvest  = harvestMonths.has(i);
                      const isFlower   = flowerMonths.has(i);
                      const isCurrent  = i === currentMonth;
                      return (
                        <div
                          key={m}
                          className={`h-3 rounded-sm ${
                            isHarvest ? CROP_COLOR[w.crop]
                            : isFlower ? "bg-pink-700/60"
                            : "bg-slate-800"
                          } ${isCurrent ? "ring-1 ring-white/50" : ""}`}
                          title={`${m}: ${isHarvest ? "harvest" : isFlower ? "flowering" : "off"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          {/* Month axis */}
          <div className="flex items-center gap-1">
            <div className="w-40 shrink-0" />
            <div className="flex-1 grid grid-cols-12 gap-px">
              {MONTH_NAMES.map((m, i) => (
                <div key={m} className={`text-[7px] text-center ${i === currentMonth ? "text-white font-bold" : "text-slate-700"}`}>{m.slice(0,1)}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-4 mt-2">
          {[["harvest (robusta)", "bg-violet-700"],["harvest (arabica)", "bg-emerald-700"],["harvest (mixed)", "bg-teal-700"],["flowering", "bg-pink-700/60"]].map(([lbl, cls]) => (
            <div key={lbl} className="flex items-center gap-1">
              <div className={`w-3 h-2 rounded-sm ${cls}`} />
              <span className="text-[8px] text-slate-500">{lbl}</span>
            </div>
          ))}
        </div>
      </div>


      {/* ── ENSO ─────────────────────────────────────────────────────── */}
      {enso ? (() => {
        const phase = PHASE_STYLE[enso.phase];
        return (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">El Niño / La Niña Impact — Indonesia</div>

            <div className={`rounded-lg px-3 py-2 border ${phase.border} ${phase.bg}`}>
              <div className={`font-bold text-sm ${phase.text}`}>
                {phase.label} — {enso.intensity} · ONI {enso.oni > 0 ? "+" : ""}{enso.oni}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Peak: {enso.peak_month} · {enso.forecast_direction}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-slate-500 mb-1">ONI index — 18-month history</div>
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={enso.oni_history} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 7 }} interval={2} />
                  <YAxis domain={[-2.5, 2.5]} tick={{ fill: "#475569", fontSize: 8 }} width={28} />
                  <ReferenceLine y={0}    stroke="#334155" strokeWidth={1.5} />
                  <ReferenceLine y={0.5}  stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="3 3" />
                  <ReferenceLine y={-0.5} stroke="#2563eb" strokeWidth={0.5} strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v: unknown, _: unknown, props: { payload?: { preliminary?: boolean } }) => [
                      `${Number(v).toFixed(2)}${props.payload?.preliminary ? " (prel.)" : ""}`,
                      "ONI anomaly",
                    ]}
                  />
                  <Bar dataKey="value" radius={[1, 1, 0, 0]}>
                    {enso.oni_history.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.preliminary
                          ? (entry.value >= 0 ? "#7c5fa8" : "#4a7fa8")
                          : (entry.value >= 0 ? "#a78bfa" : "#60a5fa")}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Regional Impact</div>
              {enso.regional_impact.map(r => (
                <div key={r.region} className="flex items-center gap-2 py-1 border-b border-slate-700/50 last:border-0">
                  <span className="text-[10px] text-slate-300 w-20 shrink-0">{r.region}</span>
                  <span className={`text-[9px] font-bold w-10 ${IMPACT_TEXT[r.type] ?? "text-slate-400"}`}>{r.type}</span>
                  <span className="text-[9px] text-slate-500 flex-1">{r.note}</span>
                  <div className="flex gap-0.5 shrink-0">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < r.dots ? (IMPACT_TEXT[r.type] ?? "text-slate-400").replace("text-", "bg-") : "bg-slate-700"}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-red-950/30 border border-red-800/40 rounded p-2">
              <div className="text-[9px] font-bold text-red-400 mb-0.5">Extreme El Niño risk</div>
              <p className="text-[9px] text-slate-400 leading-relaxed">
                Indonesia is among the most ENSO-sensitive coffee producers globally.
                The 1997–98 El Niño caused &gt;40% crop loss. Strong events (ONI &gt;1.5) warrant
                significant supply haircut assumptions for Indonesian robusta.
              </p>
            </div>

            <div className="text-[9px] text-slate-500 italic">{enso.historical_stat}</div>
          </div>
        );
      })() : (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-xs text-slate-500">
          ENSO data not yet available
        </div>
      )}
    </div>
  );
}
