"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { useState, useMemo, useEffect } from "react";
import PinToReport from "@/components/report/PinToReport";
import { useFetchJson } from "@/lib/useFetchJson";

const YEAR_COLORS: Record<number, string> = {
  2016: "#64748b", 2017: "#6366f1", 2018: "#8b5cf6",
  2019: "#06b6d4", 2020: "#f59e0b", 2021: "#10b981",
  2022: "#ef4444", 2023: "#f97316", 2024: "#3b82f6",
  2025: "#a3e635", 2026: "#e2e8f0", 2027: "#f472b6",
};

function toMillions(v: number) { return +(v / 1000).toFixed(2); }

const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface DataPoint {
  period: string;
  label: string;
  value: number;
  yoy: number | null;
  ma12: number | null;
  year: number;
}

function buildSeries(raw: Record<string, number>): DataPoint[] {
  const sorted = Object.keys(raw).sort();

  // Pass 1 — trailing 12-CALENDAR-MONTH average (EUR millions) per period.
  //
  // Taking the last 12 *records* is not the same thing when the series has a
  // hole. 2018-02 is missing, so every window from 2018-03 to 2019-01 reached
  // back thirteen calendar months and still divided by twelve — eleven points
  // overstated or understated by up to 2.0%, silently, on a line labelled
  // "12-mo avg". Address the months by name and return null when one is
  // absent: a visible gap is honest, an average over the wrong span is not.
  const ma12By: Record<string, number | null> = {};
  sorted.forEach(period => {
    const [y, m] = period.split("-").map(Number);
    let sum = 0;
    for (let back = 0; back < 12; back++) {
      let mm = m - back, yy = y;
      while (mm < 1) { mm += 12; yy -= 1; }
      const v = raw[`${yy}-${String(mm).padStart(2, "0")}`];
      if (v == null) { sum = NaN; break; }
      sum += v;
    }
    ma12By[period] = Number.isNaN(sum) ? null : +(sum / 12 / 1000).toFixed(2);
  });

  // Pass 2 — YoY is the change in the 12-mo average vs the same month a year
  // ago (e.g. Apr-26 88.06 / Apr-25 82.23 = +7.09%), matched by date so the
  // historical gap doesn't skew it.
  return sorted.map((period) => {
    const [y, m] = period.split("-").map(Number);
    const ma12 = ma12By[period];
    const prevMa = ma12By[`${y - 1}-${String(m).padStart(2, "0")}`];
    const yoy = (ma12 != null && prevMa != null && prevMa !== 0)
      ? +((ma12 / prevMa - 1) * 100).toFixed(2)
      : null;

    return { period, label: `${MONTH_ABB[m]} ${y}`, value: toMillions(raw[period]), yoy, ma12, year: y };
  });
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DataPoint }> }) => {
  if (!active || !payload?.length) return null;
  const d: DataPoint = payload[0]?.payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs">
      <div className="font-semibold text-white mb-1">{d.label}</div>
      <div className="text-amber-300">Kaffeesteuer: <span className="font-bold">€{d.value.toFixed(2)}M</span></div>
      {d.yoy !== null && (
        <div className={d.yoy >= 0 ? "text-emerald-400" : "text-red-400"}>
          12-mo avg YoY: {d.yoy >= 0 ? "+" : ""}{d.yoy}%
        </div>
      )}
      {d.ma12 !== null && (
        <div className="text-sky-400">12-mo avg: €{d.ma12.toFixed(2)}M</div>
      )}
    </div>
  );
};

export default function KaffeesteuerChart({ isReportMode = false }: { isReportMode?: boolean }) {
  const { data: raw, error } = useFetchJson<Record<string, number>>("/data/kaffeesteuer.json");

  const allSeries = useMemo(() => raw ? buildSeries(raw) : [], [raw]);
  const allYears  = useMemo(() => Array.from(new Set(allSeries.map(d => d.year))).sort(), [allSeries]);

  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [showMA, setShowMA] = useState(true);

  // Initialise year selection once data loads
  useEffect(() => { if (allYears.length) setSelectedYears(allYears); }, [allYears]);

  const data = useMemo(
    () => allSeries.filter(d => selectedYears.includes(d.year)),
    [allSeries, selectedYears]
  );

  const annuals = useMemo(() => {
    if (!raw) return [];
    return allYears
      .filter(y => Object.keys(raw).filter(k => k.startsWith(String(y))).length === 12)
      .map(y => ({
        year: y,
        total: toMillions(Object.entries(raw).filter(([k]) => k.startsWith(String(y))).reduce((s, [, v]) => s + v, 0)),
      }));
  }, [raw, allYears]);

  const grandAvg = useMemo(() => raw
    ? Object.values(raw).reduce((a, b) => a + b, 0) / Object.values(raw).length
    : 0, [raw]);

  function toggleYear(y: number) {
    setSelectedYears(prev =>
      prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort()
    );
  }

  const latestKey  = raw ? Object.keys(raw).sort().at(-1) : null;
  const latestFull = annuals[annuals.length - 1];
  const prevFull   = annuals[annuals.length - 2];

  if (error) return (
    <div className="p-4 text-xs text-red-400">Failed to load Kaffeesteuer data.</div>
  );
  if (!raw) return (
    <div className="p-4 text-xs text-slate-500 animate-pulse">Loading Kaffeesteuer data…</div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-white">German Coffee Tax (Kaffeesteuer)</h2>
            {!isReportMode && <PinToReport id="kaffeesteuer" />}
          </div>
          <p className="text-xs text-slate-400">Monthly revenue — Bundesfinanzministerium · Tsd. EUR → millions</p>
        </div>
        <div className="flex gap-4 text-xs">
          {latestFull && (
            <div className="bg-slate-800 rounded px-3 py-2 text-center">
              <div className="text-slate-400">{latestFull.year} total</div>
              <div className="text-white font-bold text-base">€{latestFull.total.toFixed(0)}M</div>
              {prevFull && (
                <div className={latestFull.total >= prevFull.total ? "text-emerald-400" : "text-red-400"}>
                  {latestFull.total >= prevFull.total ? "+" : ""}
                  {(((latestFull.total / prevFull.total) - 1) * 100).toFixed(1)}% vs {prevFull.year}
                </div>
              )}
            </div>
          )}
          {latestKey && (
            <div className="bg-slate-800 rounded px-3 py-2 text-center">
              <div className="text-slate-400">Latest</div>
              <div className="text-white font-bold text-base">
                €{toMillions(raw[latestKey]).toFixed(2)}M
              </div>
              <div className="text-slate-500">{latestKey}</div>
            </div>
          )}
        </div>
      </div>

      {/* Year filter */}
      {!isReportMode && (
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedYears(allYears)}
          className="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-300 hover:bg-slate-700"
        >
          All
        </button>
        {allYears.map(y => (
          <button
            key={y}
            onClick={() => toggleYear(y)}
            className="px-2 py-0.5 rounded text-xs font-medium border transition-colors"
            style={{
              borderColor: YEAR_COLORS[y] ?? "#64748b",
              backgroundColor: selectedYears.includes(y) ? (YEAR_COLORS[y] ?? "#64748b") + "33" : "transparent",
              color: selectedYears.includes(y) ? (YEAR_COLORS[y] ?? "#e2e8f0") : "#94a3b8",
            }}
          >
            {y}
          </button>
        ))}
        <button
          onClick={() => setShowMA(v => !v)}
          className={`px-2 py-0.5 rounded text-xs border transition-colors ml-2 ${
            showMA ? "border-sky-500 bg-sky-500/20 text-sky-300" : "border-slate-600 text-slate-500"
          }`}
        >
          12-mo avg
        </button>
      </div>
      )}

      {/* Main chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3" style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval={selectedYears.length <= 2 ? 0 : Math.floor(data.length / 18)}
              angle={-35}
              textAnchor="end"
              height={45}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={v => `€${v}M`}
              domain={[50, 130]}
              width={55}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={toMillions(grandAvg)} stroke="#475569" strokeDasharray="4 4" />
            <Bar dataKey="value" name="Kaffeesteuer" radius={[2, 2, 0, 0]} fill="#f59e0b" opacity={0.85} />
            {showMA && (
              <Line dataKey="ma12" name="12-mo avg" dot={false} strokeWidth={2}
                stroke="#38bdf8" connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Annual totals bar */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3" style={{ height: 180 }}>
        <div className="text-xs text-slate-400 mb-2">Annual totals (complete years only) — EUR millions</div>
        <ResponsiveContainer width="100%" height="85%">
          <ComposedChart data={annuals} margin={{ top: 2, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={v => `€${v}M`}
              domain={[800, 1200]} width={58} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", borderColor: "#475569", fontSize: 12 }}
              formatter={(v: unknown) => [`€${Number(v).toFixed(0)}M`, "Annual total"]}
            />
            <Bar dataKey="total" radius={[2, 2, 0, 0]} fill="#6366f1" opacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
