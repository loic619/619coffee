"use client";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { IMPACT_TEXT, PHASE_STYLE, TT_STYLE } from "@/components/supply/farmer-economics/farmerEconomicsConstants";

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
  oni_forecast?: { season: string; la_nina: number | null; neutral: number | null; el_nino: number | null }[];
  regional_impact: { region: string; type: string; note: string; dots: number }[];
  historical_stat: string;
  last_updated: string;
}

interface MitacaData {
  current_phase: string;
  harvest_window: string;
  flowering_window: string;
  main_crop_harvest: string;
  main_crop_flowering: string;
  description: string;
}

interface FncPrice {
  cop_per_carga: number;
  as_of: string;
  source: string;
}

interface WeatherData {
  scraped_at: string;
  regions: WeatherRegion[];
  daily_drought: { region: string; days: DayRisk[] }[];
}

interface Props {
  fnc_price: FncPrice | null;
  weather: WeatherData | null;
  enso: EnsoData | null;
  mitaca: MitacaData;
}

const MITACA_MONTHS = [
  { label: "Jan", crop: "main-harvest" },
  { label: "Feb", crop: "off" },
  { label: "Mar", crop: "main-flower" },
  { label: "Apr", crop: "mitaca-harvest" },
  { label: "May", crop: "mitaca-harvest" },
  { label: "Jun", crop: "mitaca-harvest" },
  { label: "Jul", crop: "off" },
  { label: "Aug", crop: "off" },
  { label: "Sep", crop: "mitaca-flower" },
  { label: "Oct", crop: "mitaca-flower" },
  { label: "Nov", crop: "main-harvest" },
  { label: "Dec", crop: "main-harvest" },
];

const CROP_COLOR: Record<string, string> = {
  "main-harvest":   "bg-emerald-700",
  "main-flower":    "bg-emerald-400/50",
  "mitaca-harvest": "bg-orange-600",
  "mitaca-flower":  "bg-orange-400/50",
  "off":            "bg-slate-800",
};

const CROP_LABEL: Record<string, string> = {
  "main-harvest":   "Main harvest",
  "main-flower":    "Main flowering",
  "mitaca-harvest": "Mitaca harvest",
  "mitaca-flower":  "Mitaca flowering",
  "off":            "Off-season",
};

export default function ColombiaFarmerEconomics({ fnc_price, enso, mitaca }: Props) {
  const currentMonth = new Date().getMonth(); // 0-indexed

  return (
    <div className="space-y-4">

      {/* ── FNC Precio Interno ────────────────────────────────────────────── */}
      {fnc_price ? (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">FNC Precio Interno</div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {fnc_price.cop_per_carga.toLocaleString("es-CO")}
              </div>
              <div className="text-[10px] text-slate-500">COP / carga (125 kg)</div>
            </div>
            <div className="text-[10px] text-slate-400 space-y-0.5">
              <div>≈ <span className="font-mono text-slate-300">
                {(fnc_price.cop_per_carga / 125).toLocaleString("es-CO", { maximumFractionDigits: 0 })}
              </span> COP / kg</div>
              <div className="text-slate-500">FNC internal purchase price · as of {fnc_price.as_of}</div>
            </div>
          </div>
          <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">
            The precio interno is the FNC&apos;s guaranteed floor price paid to registered Colombian growers.
            It is set daily based on the New York KC futures price, the USD/COP rate, and
            differential adjustments. Source: Federación Nacional de Cafeteros.
          </p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-xs text-slate-500">
          FNC precio interno not yet available — scraper runs daily
        </div>
      )}

      {/* ── Mitaca Season Calendar ───────────────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Harvest Calendar — Bimodal Crop</div>
          <div className="text-[9px] text-orange-400 font-semibold uppercase tracking-wider">
            Mitaca: {mitaca.current_phase === "harvest" ? "Harvest active" :
                     mitaca.current_phase === "flowering" ? "Flowering" :
                     mitaca.current_phase === "pre-harvest" ? "Pre-harvest" : "Off-season"}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-0.5 mb-2">
          {MITACA_MONTHS.map((m, i) => (
            <div key={m.label} className="text-center">
              <div
                className={`h-5 rounded-sm ${CROP_COLOR[m.crop]} ${i === currentMonth ? "ring-1 ring-white/40" : ""}`}
              />
              <div className={`text-[8px] mt-0.5 ${i === currentMonth ? "text-white font-bold" : "text-slate-600"}`}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-1">
          {Object.entries(CROP_LABEL).filter(([k]) => k !== "off").map(([k, lbl]) => (
            <div key={k} className="flex items-center gap-1">
              <div className={`w-3 h-2 rounded-sm ${CROP_COLOR[k]}`} />
              <span className="text-[9px] text-slate-500">{lbl}</span>
            </div>
          ))}
        </div>

        <p className="text-[9px] text-slate-500 mt-2 leading-relaxed">{mitaca.description}</p>
      </div>


      {/* ── ENSO Impact (Colombia) ───────────────────────────────────────── */}
      {enso ? (() => {
        const phase = PHASE_STYLE[enso.phase];
        return (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">El Niño / La Niña Impact — Colombia</div>

            <div className={`rounded-lg px-3 py-2 border ${phase.border} ${phase.bg}`}>
              <div className={`font-bold text-sm ${phase.text}`}>
                {phase.label} — {enso.intensity} · ONI {enso.oni > 0 ? "+" : ""}{enso.oni}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Peak: {enso.peak_month} · {enso.forecast_direction}
              </div>
            </div>

            {/* ONI chart */}
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

            {/* Regional impact grid */}
            <div className="space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Regional Impact</div>
              {enso.regional_impact.map(r => (
                <div key={r.region} className="flex items-center gap-2 py-1 border-b border-slate-700/50 last:border-0">
                  <span className="text-[10px] text-slate-300 w-24 shrink-0">{r.region}</span>
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

            <div className="bg-slate-900 rounded p-2 text-[9px] text-slate-400 leading-relaxed">
              <span className="text-amber-400 font-bold">Key difference vs Brazil: </span>
              Colombia has OPPOSITE ENSO sensitivity. El Niño = drier Colombia = bad for yields.
              La Niña = wetter Colombia = yield risk from excess rain and fungal disease.
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
