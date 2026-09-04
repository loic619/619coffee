"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { MONTH_ABBR } from "@/lib/formatters";

/** One bulletin in the accumulated history (vn_dam_levels.py `history`). */
interface HistoryEntry {
  date: string;
  pdf_url?: string | null;
  rivers: { river: string; station: string; actual_mm3?: number | null; tbnn_pct?: number | null; forecast_tbnn_pct?: number | null }[];
}

interface RiverRow {
  river: string;
  river_vn: string;
  provinces: string[];
  station: string;
  actual_mm3?: number | null;
  tbnn_pct?: number | null;
  forecast_tbnn_pct?: number | null;
  signal: "critical" | "low" | "normal" | "high" | "unknown";
}

interface WaterData {
  updated: string;
  bulletin_date: string | null;
  source: string;
  rivers: RiverRow[];
  has_live_data: boolean;
  pdf_url?: string;
  history?: HistoryEntry[];
}

const RIVER_COLORS: Record<string, string> = {
  "Srepok": "#f97316", "Dak Bla": "#38bdf8", "Dong Nai": "#a78bfa",
};
const YEAR_DASH = ["0", "5 3", "2 3"];   // this year solid, then dashed, then dotted

/**
 * Flow vs normal through the year, one line per river per year, aligned on
 * the calendar so this year sits on top of last year's same weeks — the
 * Jan–Apr irrigation window is what the comparison is for. Bulletins are
 * irregular (roughly ten-daily), so points connect across gaps.
 */
// Working band for the irrigation read. Flood weeks run to +650% vs normal
// (Dong Nai, Nov 2025) and on a full-range axis they flatten the deficit side
// — which is the side this panel exists for — into a single line. The default
// view is the band; "Full range" shows every point, and the count of readings
// outside the band is always stated so nothing is silently hidden.
const BAND: [number, number] = [-100, 150];

function FlowHistoryChart({ history }: { history: HistoryEntry[] }) {
  const [river, setRiver] = useState<string>("all");
  const [fullRange, setFullRange] = useState(false);
  const rivers = useMemo(() => {
    const seen = new Set<string>();
    for (const e of history) for (const r of e.rivers) seen.add(r.river);
    return Array.from(seen).sort();
  }, [history]);
  const years = useMemo(() => Array.from(new Set(history.map(e => e.date.slice(0, 4)))).sort().reverse().slice(0, 3), [history]);

  // Rows keyed on day-of-year; series key `${river}|${year}`.
  const rows = useMemo(() => {
    const byDoy = new Map<number, Record<string, number | string | null>>();
    for (const e of history) {
      const y = e.date.slice(0, 4);
      if (!years.includes(y)) continue;
      const d = new Date(e.date + "T00:00:00Z");
      const doy = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
      const row = byDoy.get(doy) ?? { doy };
      for (const r of e.rivers) {
        if (r.tbnn_pct == null) continue;
        row[`${r.river}|${y}`] = r.tbnn_pct;
      }
      byDoy.set(doy, row);
    }
    return Array.from(byDoy.values()).sort((a, b) => Number(a.doy) - Number(b.doy));
  }, [history, years]);

  if (history.length < 2) return null;
  const shownRivers = river === "all" ? rivers : rivers.filter(r => r === river);
  // Readings the band would cut, over the rivers actually drawn.
  const outside = rows.reduce((n, r) => n + shownRivers.reduce((m, rv) => m + years.reduce((k, y) => {
    const v = r[`${rv}|${y}`];
    return k + (typeof v === "number" && (v < BAND[0] || v > BAND[1]) ? 1 : 0);
  }, 0), 0), 0);
  const monthTick = (doy: number) => {
    const d = new Date(Date.UTC(2026, 0, 1) + (doy - 1) * 86_400_000);
    return d.getUTCDate() <= 10 ? MONTH_ABBR[d.getUTCMonth()] : "";
  };
  const span = `${history[0].date} → ${history[history.length - 1].date}`;

  return (
    <div className="border-t border-slate-700 pt-3 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Flow vs normal · through the year</div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            % vs TBNN per bulletin · {history.length} bulletins · {span}
            {years.length > 1 ? ` · ${years[0]} solid, earlier years dashed` : " · year-on-year appears once the archive backfill spans a second year"}
            {outside > 0 && (
              <> · {fullRange
                ? "full range — flood weeks compress the deficit side"
                : `${outside} flood reading${outside === 1 ? "" : "s"} above +${BAND[1]}% off-scale`}</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {outside > 0 && (
            <div className="flex bg-slate-900 border border-slate-700 rounded overflow-hidden text-[9px]">
              {[["band", "±band"], ["full", "Full range"]].map(([k, label]) => (
                <button key={k} onClick={() => setFullRange(k === "full")}
                  title={k === "band" ? `Axis fixed to ${BAND[0]}%…+${BAND[1]}% — the irrigation-relevant band` : "Every reading, flood weeks included"}
                  className={`px-2 py-0.5 ${(fullRange ? "full" : "band") === k ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex bg-slate-900 border border-slate-700 rounded overflow-hidden text-[9px]">
            {["all", ...rivers].map(r => (
              <button key={r} onClick={() => setRiver(r)}
                className={`px-2 py-0.5 ${river === r ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {r === "all" ? "All" : r}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="doy" type="number" domain={[1, 366]} ticks={[1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]}
              tickFormatter={monthTick} stroke="#64748b" tick={{ fontSize: 8 }} />
            {/* width fits "+150%" — 40 clipped the leading digit and the axis
                read "00%" for 100%. */}
            <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={52}
              domain={fullRange ? ["auto", "auto"] : BAND} allowDataOverflow={!fullRange}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
              labelFormatter={(doy) => { const d = new Date(Date.UTC(2026, 0, 1) + (Number(doy) - 1) * 86_400_000); return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`; }}
              formatter={(v, name) => [typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(0)}% vs TBNN` : "—", String(name).replace("|", " · ")]} />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
            <ReferenceLine y={-20} stroke="#f9731655" strokeDasharray="2 4" />
            <ReferenceLine y={-50} stroke="#ef444455" strokeDasharray="2 4" />
            <Legend wrapperStyle={{ fontSize: 8 }} iconSize={8} formatter={(v: string) => v.replace("|", " · ")} />
            {shownRivers.flatMap(r => years.map((y, yi) => (
              <Line key={`${r}|${y}`} type="monotone" dataKey={`${r}|${y}`} name={`${r}|${y}`}
                stroke={RIVER_COLORS[r] ?? "#94a3b8"} strokeWidth={yi === 0 ? 1.8 : 1.1}
                strokeDasharray={YEAR_DASH[yi]} strokeOpacity={yi === 0 ? 1 : 0.7}
                dot={{ r: 1.5 }} connectNulls />
            )))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const SIGNAL_CONFIG = {
  critical: { label: "Critical",      color: "#ef4444", bg: "#ef444415", barColor: "#ef4444" },
  low:      { label: "Below avg",     color: "#f97316", bg: "#f9731615", barColor: "#f97316" },
  normal:   { label: "Near avg",      color: "#22c55e", bg: "#22c55e15", barColor: "#22c55e" },
  high:     { label: "Above avg",     color: "#3b82f6", bg: "#3b82f615", barColor: "#3b82f6" },
  unknown:  { label: "No data",       color: "#64748b", bg: "#64748b15", barColor: "#64748b" },
};

function GaugeBar({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <div className="h-1.5 bg-slate-700 rounded-full" />;
  // Map -100..+100 to a visual bar. Center = 50% width = TBNN.
  const clamped = Math.max(-100, Math.min(100, pct));
  const isNeg   = clamped < 0;
  const absW    = Math.abs(clamped) / 100 * 50; // max 50% each side
  const color   = pct <= -50 ? "#ef4444" : pct <= -20 ? "#f97316" : pct <= 20 ? "#22c55e" : "#3b82f6";
  return (
    <div className="relative h-1.5 bg-slate-700 rounded-full overflow-hidden">
      {/* Center marker */}
      <div className="absolute top-0 bottom-0 w-px bg-slate-500" style={{ left: "50%" }} />
      {/* Bar */}
      <div
        className="absolute top-0 bottom-0 rounded-full"
        style={{
          background: color,
          width: `${absW}%`,
          left:  isNeg ? `${50 - absW}%` : "50%",
        }}
      />
    </div>
  );
}

function RiverCard({ rv }: { rv: RiverRow }) {
  const cfg = SIGNAL_CONFIG[rv.signal] ?? SIGNAL_CONFIG.unknown;
  const pct = rv.tbnn_pct;
  const pctStr = pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%` : "—";

  return (
    <div className="rounded-lg p-3 border space-y-1.5"
      style={{ borderColor: cfg.color + "44", background: cfg.bg }}>
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-[10px] font-bold text-slate-200">{rv.river}</span>
          <span className="text-[8px] text-slate-500 ml-1">@ {rv.station}</span>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: cfg.color, background: cfg.color + "22" }}>
          {cfg.label}
        </span>
      </div>

      {/* Provinces */}
      <div className="flex flex-wrap gap-1">
        {rv.provinces.map(p => (
          <span key={p} className="text-[7px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
            {p}
          </span>
        ))}
      </div>

      {/* Gauge bar */}
      <GaugeBar pct={pct} />

      {/* Values row */}
      <div className="flex items-center justify-between text-[8px]">
        <div className="text-slate-500">
          vs TBNN:&nbsp;
          <span className="font-bold" style={{ color: cfg.color }}>{pctStr}</span>
        </div>
        {rv.actual_mm3 != null && (
          <div className="text-slate-600 font-mono">
            {rv.actual_mm3.toFixed(2)} M m³/wk
          </div>
        )}
        {rv.forecast_tbnn_pct != null && (
          <div className="text-slate-600 text-[7px]">
            fcst: {rv.forecast_tbnn_pct > 0 ? "+" : ""}{rv.forecast_tbnn_pct.toFixed(0)}%
          </div>
        )}
      </div>
    </div>
  );
}

export default function VnWaterLevels() {
  const [data, setData] = useState<WaterData | null>(null);
  const [err, setErr]   = useState(false);

  useEffect(() => {
    fetch("/data/vn_water_levels.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  if (err || !data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-600 text-xs italic">
        {err ? "Water level data unavailable" : "Loading…"}
      </div>
    );
  }

  const { rivers, bulletin_date, has_live_data, source, pdf_url } = data;

  // Summary signal for header
  const criticalCount = rivers.filter(r => r.signal === "critical").length;
  const lowCount      = rivers.filter(r => r.signal === "low").length;
  const headerSignal  = criticalCount > 0 ? "critical" : lowCount > 0 ? "low" : "normal";
  const headerCfg     = SIGNAL_CONFIG[headerSignal];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
            River Flow · Coffee Regions
            {!has_live_data && (
              <span className="text-[7px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">static seed</span>
            )}
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            % vs TBNN (multi-year historical avg) · bulletin {bulletin_date ?? "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold px-2 py-0.5 rounded"
            style={{ color: headerCfg.color, background: headerCfg.color + "22" }}>
            {criticalCount > 0
              ? `${criticalCount} basin${criticalCount > 1 ? "s" : ""} critical`
              : lowCount > 0
              ? `${lowCount} basin${lowCount > 1 ? "s" : ""} below avg`
              : "All basins normal / above"}
          </div>
          {pdf_url && (
            <a href={pdf_url} target="_blank" rel="noopener noreferrer"
              className="text-[7px] text-slate-600 hover:text-slate-400 transition-colors block mt-0.5">
              PDF source ↗
            </a>
          )}
        </div>
      </div>

      {/* Gauge legend */}
      <div className="flex items-center gap-1 text-[7px] text-slate-600">
        <span className="text-red-400">◀ deficit</span>
        <div className="flex-1 h-px bg-slate-700 relative">
          <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: "50%" }} />
        </div>
        <span className="text-slate-500">TBNN</span>
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-blue-400">surplus ▶</span>
      </div>

      {/* River cards */}
      {rivers.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rivers.map(rv => <RiverCard key={rv.river} rv={rv} />)}
        </div>
      ) : (
        <div className="text-slate-600 text-xs italic">No river data available.</div>
      )}

      {/* Bulletin history — the series the daily overwrite used to discard */}
      {data.history && data.history.length > 0 && <FlowHistoryChart history={data.history} />}

      {/* Coffee relevance note */}
      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Irrigation critical Jan–Apr dry season. Srepok = Đắk Lắk (main Robusta origin).
        Dak Bla = Gia Lai/Kon Tum. TBNN = multi-year normal.
        Source: {source}
      </div>
    </div>
  );
}
