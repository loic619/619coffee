"use client";
/**
 * Subsurface Heat Alert — Phase 2 of the ENSO command-center.
 *
 * NOAA's Warm Water Volume index (WWV) tracks the volume of equatorial
 * Pacific water above the 20 °C isotherm. It runs AHEAD of Niño 3.4
 * surface SST by 4-6 months — when warm water accumulates at depth in
 * the western Pacific, a downwelling Kelvin wave propagates eastward
 * and surfaces as El Niño one to two quarters later. This is the
 * earliest reliable predictor we ship: the rest of the ENSO tab shows
 * the present state (SST + SOI coupling, ONI rolling mean); this card
 * shows what's coming next.
 *
 * Data: /data/enso_subsurface.json (NOAA PMEL; weekly Tuesday refresh).
 * Falls back silently when the file is missing — the rest of the ENSO
 * tab renders unchanged.
 */
import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, Tooltip } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  ENSO_DEFAULT_RANGE, rangeMonths, type EnsoTimeRange,
} from "@/lib/ensoTimeRange";

interface WwvMonthly { month: string; wwv_anomaly: number; }

interface SubsurfacePayload {
  scraped_at: string;
  wwv: {
    source: string;
    unit: string;
    lead_months: string;
    thresholds: { el_nino_lead: number; la_nina_lead: number };
    latest: {
      month:        string | null;
      wwv_anomaly:  number | null;
      lead_signal:  "el-nino-pending" | "la-nina-pending" | "neutral" | "unknown";
    };
    monthly: WwvMonthly[];
  };
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function monthAbbr(iso: string): string {
  const [yr, mo] = iso.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(mo) - 1]}'${yr.slice(2)}`;
}

const SIGNAL_META = {
  "el-nino-pending": {
    color: "#ef4444",
    label: "EL NIÑO PENDING",
    reading: (m: number) =>
      `Subsurface warm anomaly of +${m.toFixed(2)} × 10¹⁴ m³ — historically precedes a Niño 3.4 surface event by 4–6 months.`,
  },
  "la-nina-pending": {
    color: "#3b82f6",
    label: "LA NIÑA PENDING",
    reading: (m: number) =>
      `Subsurface cold anomaly of ${m.toFixed(2)} × 10¹⁴ m³ — historically precedes a La Niña surface event by 4–6 months.`,
  },
  "neutral": {
    color: "#94a3b8",
    label: "NEUTRAL",
    reading: (m: number) =>
      `WWV anomaly ${m >= 0 ? "+" : ""}${m.toFixed(2)} × 10¹⁴ m³ — below the ±1.0 threshold that historically anchors a forecast.`,
  },
  "unknown": {
    color: "#64748b",
    label: "UNKNOWN",
    reading: () => "No recent WWV reading available — NOAA PMEL endpoint may have lapsed.",
  },
} as const;

interface Props {
  /** Time window for the chart slice. Defaults to 2Y if the parent
      hasn't wired the shared selector yet. */
  range?: EnsoTimeRange;
}

export default function EnsoSubsurfaceCard({ range = ENSO_DEFAULT_RANGE }: Props) {
  const [data, setData] = useState<SubsurfacePayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/data/enso_subsurface.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setMissing(true));
  }, []);

  if (missing) return null;     // Degrade silently — divergence chart + rest of ENSO tab still render.
  if (!data) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 text-xs text-slate-500 animate-pulse">
        Loading subsurface heat alert…
      </div>
    );
  }

  const { wwv } = data;
  // Window the WWV series. null = show the full 1980→now history.
  const months = rangeMonths(range);
  const sliceN = months == null ? wwv.monthly.length : months;
  const recent = wwv.monthly.slice(-sliceN);
  const chartData = recent.map((r) => ({
    month: r.month,
    label: monthAbbr(r.month),
    anomaly: r.wwv_anomaly,
  }));

  const signal = SIGNAL_META[wwv.latest.lead_signal] ?? SIGNAL_META.unknown;
  const latestVal = wwv.latest.wwv_anomaly;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Subsurface Heat Alert · Warm Water Volume
        </div>
        <div className="text-[8px] text-slate-600">
          NOAA PMEL · monthly · refreshed {data.scraped_at.slice(0, 10)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest WWV anomaly</div>
          <div className="text-white font-bold flex items-baseline gap-2">
            <span style={{ color: signal.color }}>
              {latestVal != null
                ? `${latestVal >= 0 ? "+" : ""}${latestVal.toFixed(2)}`
                : "—"}
            </span>
            <span className="text-[9px] text-slate-600">× 10¹⁴ m³</span>
          </div>
          <div className="text-[9px] text-slate-600">
            {wwv.latest.month ?? ""}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Lead signal</div>
          <div className="font-bold text-[11px] uppercase tracking-wider" style={{ color: signal.color }}>
            {signal.label}
          </div>
          <div className="text-[9px] text-slate-600">
            {wwv.lead_months}-month surface lead
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Reading</div>
          <div className="text-white text-[11px] leading-tight">
            {latestVal != null ? signal.reading(latestVal) : signal.reading(0)}
          </div>
        </div>
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="wwvPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="wwvNeg" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label" tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false}
              interval={Math.max(1, Math.floor(sliceN / 6))}
            />
            <YAxis
              tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
              domain={[-3, 3]}
            />
            <ReferenceLine y={0}                                stroke="#475569" strokeDasharray="3 3" />
            <ReferenceLine y={wwv.thresholds.el_nino_lead}      stroke="#7f1d1d" strokeDasharray="1 4" />
            <ReferenceLine y={wwv.thresholds.la_nina_lead}      stroke="#1e3a8a" strokeDasharray="1 4" />
            <Tooltip
              contentStyle={TT_STYLE}
              labelFormatter={(_label, payload) => {
                const p = (payload?.[0]?.payload ?? null) as { month?: string } | null;
                return p?.month ?? "";
              }}
              formatter={(v: unknown) => [
                `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)} × 10¹⁴ m³`,
                "WWV anomaly",
              ]}
            />
            <Area
              type="monotone" dataKey="anomaly"
              stroke={signal.color} strokeWidth={1.5}
              fill={latestVal != null && latestVal >= 0 ? "url(#wwvPos)" : "url(#wwvNeg)"}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-600 leading-snug">
        Warm Water Volume = volume of equatorial Pacific water (5°N-5°S, 120°E-80°W) above the 20 °C
        isotherm, anomalies vs the long-term climatology. Empirically, |WWV| ≥ 1.0 × 10¹⁴ m³
        precedes a Niño 3.4 surface response of the same sign by 4–6 months — the earliest
        reliable ENSO regime-change indicator. Source: NOAA PMEL.
      </div>
    </div>
  );
}
