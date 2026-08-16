"use client";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { IMPACT_TEXT, PHASE_STYLE, TT_STYLE } from "@/components/supply/farmer-economics/farmerEconomicsConstants";

type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
type DayRisk   = "H" | "M" | "L" | "-";

interface WeatherRegion {
  name: string;
  frost: RiskLevel;
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

interface HarvestCal {
  current_phase: string;
  harvest_window: string;
  flowering_window: string;
  development: string;
  description: string;
}

interface IhcafePrice {
  hnl_per_quintal: number;
  as_of: string;
  source: string;
}

interface WeatherData {
  scraped_at: string;
  regions: WeatherRegion[];
  daily_frost:   { region: string; days: DayRisk[] }[];
  daily_drought: { region: string; days: DayRisk[] }[];
}

interface Props {
  ihcafe_price: IhcafePrice | null;
  weather: WeatherData | null;
  enso: EnsoData | null;
  harvest_cal: HarvestCal;
}

const HARVEST_MONTHS = [
  { label: "Jan", phase: "harvest" },
  { label: "Feb", phase: "harvest" },
  { label: "Mar", phase: "off" },
  { label: "Apr", phase: "flowering" },
  { label: "May", phase: "flowering" },
  { label: "Jun", phase: "flowering" },
  { label: "Jul", phase: "development" },
  { label: "Aug", phase: "development" },
  { label: "Sep", phase: "development" },
  { label: "Oct", phase: "harvest" },
  { label: "Nov", phase: "harvest" },
  { label: "Dec", phase: "harvest" },
];

const PHASE_COLOR: Record<string, string> = {
  harvest:     "bg-emerald-700",
  flowering:   "bg-pink-500/70",
  development: "bg-amber-600/70",
  off:         "bg-slate-800",
};

const PHASE_LABEL: Record<string, string> = {
  harvest:     "Harvest (Oct–Feb)",
  flowering:   "Flowering (Apr–Jun)",
  development: "Fruit development (Jul–Sep)",
  off:         "Off-season",
};

export default function HondurasFarmerEconomics({ ihcafe_price, enso, harvest_cal }: Props) {
  const currentMonth = new Date().getMonth();

  return (
    <div className="space-y-4">

      {/* ── IHCAFE Price ─────────────────────────────────────────────────── */}
      {ihcafe_price ? (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">IHCAFE Precio de Referencia</div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {ihcafe_price.hnl_per_quintal.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">HNL / quintal (46 kg)</div>
            </div>
            <div className="text-[10px] text-slate-400 space-y-0.5">
              <div>≈ <span className="font-mono text-slate-300">
                {(ihcafe_price.hnl_per_quintal / 46).toFixed(0)}
              </span> HNL / kg</div>
              <div className="text-slate-500">IHCAFE reference price · as of {ihcafe_price.as_of}</div>
            </div>
          </div>
          <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">
            The IHCAFE precio de referencia is a benchmark farm-gate price published by the
            Instituto Hondureño del Café. Unlike Colombia&apos;s FNC floor, it is a reference price
            only — actual transactions vary by cooperative, quality, and buyer.
          </p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">IHCAFE Precio de Referencia</div>
          <div className="text-xs text-slate-500">
            IHCAFE price not yet scraped. The IHCAFE website publishes a daily reference price
            at <span className="font-mono text-slate-400">ihcafe.hn</span> — runs on next scraper cycle.
          </div>
          <p className="text-[9px] text-slate-600 mt-2">
            In absence of scraped price: farm-gate estimate = KC front month (¢/lb) × 2.2046
            × USD/HNL conversion, minus a typical Honduras differential of −0 to +5¢.
          </p>
        </div>
      )}

      {/* ── Harvest Calendar ─────────────────────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Harvest Calendar — Single Crop</div>
          <div className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider">
            {harvest_cal.current_phase === "harvest" ? "Harvest active" :
             harvest_cal.current_phase === "flowering" ? "Flowering" :
             harvest_cal.current_phase === "development" ? "Fruit development" : "Off-season"}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-0.5 mb-2">
          {HARVEST_MONTHS.map((m, i) => (
            <div key={m.label} className="text-center">
              <div className={`h-5 rounded-sm ${PHASE_COLOR[m.phase]} ${i === currentMonth ? "ring-1 ring-white/40" : ""}`} />
              <div className={`text-[8px] mt-0.5 ${i === currentMonth ? "text-white font-bold" : "text-slate-600"}`}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-1">
          {Object.entries(PHASE_LABEL).filter(([k]) => k !== "off").map(([k, lbl]) => (
            <div key={k} className="flex items-center gap-1">
              <div className={`w-3 h-2 rounded-sm ${PHASE_COLOR[k]}`} />
              <span className="text-[9px] text-slate-500">{lbl}</span>
            </div>
          ))}
        </div>

        <p className="text-[9px] text-slate-500 mt-2 leading-relaxed">{harvest_cal.description}</p>
      </div>


      {/* ── ENSO ─────────────────────────────────────────────────────────── */}
      {enso ? (() => {
        const phase = PHASE_STYLE[enso.phase];
        return (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">El Niño / La Niña Impact — Honduras</div>

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
                  <span className="text-[10px] text-slate-300 w-28 shrink-0">{r.region}</span>
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
