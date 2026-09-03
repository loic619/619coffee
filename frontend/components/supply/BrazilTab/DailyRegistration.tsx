"use client";
import { useEffect, useState } from "react";
import FeedUnavailable from "@/components/FeedUnavailable";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { DAILY_COLORS, TT_STYLE } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";

type LabelFmt = NonNullable<TooltipContentProps<ValueType, NameType>["labelFormatter"]>;
import { fmtBags, normalizeSources, shiftMonth, shortMonthLabel } from "./helpers";
import { PaceByMonth, PaceStrip } from "./PaceComparison";
import type { CecafeSourceKey, DailyData } from "./types";

const SOURCE_LABEL: Record<CecafeSourceKey, { title: string; sub: string }> = {
  embarques:    { title: "Embarques",    sub: "physical port loadings" },
  certificados: { title: "Certificados", sub: "paperwork issued" },
};

function DailyRegChart({
  title, monthsData, currentMonth, latestMonth, soluvelData,
}: {
  title: string;
  monthsData: Record<string, Record<string, number>>;
  currentMonth: string; // "YYYY-MM"
  latestMonth: string;  // the file's reference month — months before it have closed
  soluvelData?: Record<string, Record<string, number>>;
}) {
  const priorMonth = shiftMonth(currentMonth, -1);
  const lyMonth    = shiftMonth(currentMonth, -12);

  const calMo = currentMonth.slice(5); // "MM"
  // Historical: same calendar month, excluding current and LY (prior month is different calMo, auto-excluded)
  const historicalMonths = Object.keys(monthsData)
    .filter(ym => ym.slice(5) === calMo && ym !== currentMonth && ym !== lyMonth)
    .sort();

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const get = (ym: string, day: number) => monthsData[ym]?.[String(day)] ?? null;
  const getSolv = (ym: string, day: number) => soluvelData?.[ym]?.[String(day)] ?? null;

  const chartData = days.map(d => ({
    day: d,
    current:  get(currentMonth, d),
    prior:    get(priorMonth, d),
    ly:       get(lyMonth, d),
    solv_cur: getSolv(currentMonth, d),
    solv_pri: getSolv(priorMonth, d),
    ...Object.fromEntries(historicalMonths.map(ym => [ym, get(ym, d)])),
  }));

  const lastCurrentDay = [...chartData].reverse().find(r => r.current !== null)?.day ?? 0;

  const hasPrior = Object.keys(monthsData[priorMonth] ?? {}).length > 0;
  const hasLy    = Object.keys(monthsData[lyMonth]    ?? {}).length > 0;

  const { priorFinal, lastPriorDay } = (() => {
    const pd = monthsData[priorMonth] ?? {};
    const keys = Object.keys(pd).map(Number).sort((a, b) => b - a);
    if (keys.length === 0) return { priorFinal: null, lastPriorDay: 0 };
    return { priorFinal: pd[String(keys[0])] ?? null, lastPriorDay: keys[0] };
  })();

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-sm font-semibold text-slate-200 mb-0.5">{title}</div>
      <div className="text-[10px] text-slate-500 mb-2">Daily cumulative registrations (bags)</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 9 }} interval={1} />
          <YAxis tickFormatter={fmtBags} tick={{ fill: "#94a3b8", fontSize: 9 }} width={46} />
          <Tooltip
            contentStyle={TT_STYLE}
            formatter={((v, name) => [v != null ? fmtBags(Number(v)) : "—", name as NameType]) satisfies Formatter<ValueType, NameType>}
            labelFormatter={((l) => `Day ${l}`) satisfies LabelFmt}
          />
          <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {historicalMonths.map(ym => (
            <Line key={ym} type="monotone" dataKey={ym} name={shortMonthLabel(ym)}
              stroke={DAILY_COLORS.hist} strokeWidth={1} dot={false} connectNulls opacity={0.5} />
          ))}
          {hasLy && (
            <Line type="monotone" dataKey="ly" name={shortMonthLabel(lyMonth)}
              stroke={DAILY_COLORS.ly} strokeWidth={1.5} dot={false} connectNulls />
          )}
          {hasPrior && (
            <Line type="monotone" dataKey="prior"
              name={`Last month${priorFinal != null ? ` · ${fmtBags(priorFinal)}` : ""}`}
              stroke={DAILY_COLORS.prior} strokeWidth={1.5} strokeOpacity={0.7} connectNulls
              dot={(props) => {
                const p = props.payload as { day?: number; prior?: number | null } | undefined;
                if (p?.day !== lastPriorDay || p.prior == null) return <g key={props.key as string} />;
                return (
                  <g key={props.key as string}>
                    <circle cx={props.cx} cy={props.cy} r={3} fill={DAILY_COLORS.prior} />
                    <text x={(props.cx ?? 0) + 5} y={(props.cy ?? 0) - 4} fill="#fb923c" fontSize={9} fontFamily="monospace">
                      {fmtBags(p.prior)}
                    </text>
                  </g>
                );
              }} />
          )}
          <Line type="monotone" dataKey="current" name={shortMonthLabel(currentMonth)}
            stroke={DAILY_COLORS.current} strokeWidth={2.5}
            dot={(props) => {
              const p = props.payload as { day?: number; current?: number | null } | undefined;
              if (p?.day !== lastCurrentDay || p.current == null) return <g key={props.key as string} />;
              return (
                <g key={props.key as string}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill={DAILY_COLORS.current} />
                  <text x={(props.cx ?? 0) + 5} y={(props.cy ?? 0) - 4} fill="#f87171" fontSize={9} fontFamily="monospace">
                    {fmtBags(p.current)}
                  </text>
                </g>
              );
            }}
            connectNulls />
          {soluvelData && (
            <Line type="monotone" dataKey="solv_cur"
              name="Soluble"
              stroke={DAILY_COLORS.solv_cur} strokeWidth={1.5} strokeDasharray="4 2"
              dot={false} connectNulls />
          )}
          {soluvelData && (
            <Line type="monotone" dataKey="solv_pri"
              name="Soluble last month"
              stroke={DAILY_COLORS.solv_pri} strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.7}
              dot={false} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
      <PaceStrip monthsData={monthsData} currentMonth={currentMonth} latestMonth={latestMonth} />
    </div>
  );
}

export default function DailyRegistrationSection() {
  const [data, setData] = useState<DailyData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  // Default to Embarques (physical loadings — the trade truth). Falls back
  // to Certificados below when only legacy data is present.
  const [source, setSource] = useState<CecafeSourceKey>("embarques");

  // A failed fetch used to hide the section — indistinguishable from "no
  // registrations yet". Say which it was.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/data/cecafe_daily.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (!data) return failed ? <FeedUnavailable what="Brazil daily export registration" file="cecafe_daily.json" /> : null;
  const sources = normalizeSources(data);

  // Which sources actually have any data? Drives the toggle's availability.
  const sourceHasData: Record<CecafeSourceKey, boolean> = {
    embarques:    Object.keys(sources.embarques.arabica).length    > 0 || Object.keys(sources.embarques.conillon).length    > 0,
    certificados: Object.keys(sources.certificados.arabica).length > 0 || Object.keys(sources.certificados.conillon).length > 0,
  };
  if (!sourceHasData.embarques && !sourceHasData.certificados) return null;

  // If the user-selected source has no data yet (e.g. pre-backfill), auto-pick
  // the one that does. Otherwise honor the toggle.
  const effectiveSource: CecafeSourceKey = sourceHasData[source]
    ? source
    : (sourceHasData.embarques ? "embarques" : "certificados");
  const active = sources[effectiveSource];

  // Months with daily data for the ACTIVE source, newest-first.
  const availableMonths = Array.from(
    new Set([...Object.keys(active.arabica), ...Object.keys(active.conillon)]),
  ).sort().reverse();
  const latestMonth = data.updated.slice(0, 7);
  const currentMonth =
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : (availableMonths[0] ?? latestMonth);

  const idx = availableMonths.indexOf(currentMonth);
  const hasOlder = idx < availableMonths.length - 1;
  const hasNewer = idx > 0;
  const sourceLabel = SOURCE_LABEL[effectiveSource];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-200">Brazil — Daily Export Registration</div>
          <div className="text-[10px] text-slate-500">
            Source: <span className="text-slate-300">{sourceLabel.title}</span> · {sourceLabel.sub}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Source toggle: Embarques vs Certificados.
              A source with no data yet is rendered disabled so the user
              sees both options but can't switch to an empty series. */}
          <div className="flex bg-slate-900 border border-slate-700 rounded overflow-hidden mr-2">
            {(["embarques", "certificados"] as const).map((k) => {
              const enabled = sourceHasData[k];
              const isOn = effectiveSource === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => enabled && setSource(k)}
                  disabled={!enabled}
                  title={enabled ? SOURCE_LABEL[k].sub : `${SOURCE_LABEL[k].title} — no data yet`}
                  className={`px-2.5 py-1 text-[11px] leading-none transition-colors ${
                    isOn
                      ? "bg-slate-700 text-slate-100"
                      : enabled
                        ? "text-slate-400 hover:bg-slate-800"
                        : "text-slate-600 cursor-not-allowed"
                  }`}
                >
                  {SOURCE_LABEL[k].title}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setSelectedMonth(availableMonths[idx + 1])}
            disabled={!hasOlder}
            aria-label="Previous month"
            className="px-2 py-1 rounded border border-slate-700 text-slate-300 text-xs leading-none disabled:opacity-30 enabled:hover:bg-slate-800"
          >‹</button>
          <select
            value={currentMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            aria-label="Select month"
            className="bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs px-2 py-1"
          >
            {availableMonths.map(ym => (
              <option key={ym} value={ym}>
                {shortMonthLabel(ym)}{ym === latestMonth ? " (latest)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSelectedMonth(availableMonths[idx - 1])}
            disabled={!hasNewer}
            aria-label="Next month"
            className="px-2 py-1 rounded border border-slate-700 text-slate-300 text-xs leading-none disabled:opacity-30 enabled:hover:bg-slate-800"
          >›</button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DailyRegChart
          title={`Arabica · ${sourceLabel.title} (Daily, Bags)`}
          monthsData={active.arabica}
          currentMonth={currentMonth}
          latestMonth={latestMonth}
        />
        <DailyRegChart
          title={`Conilon · ${sourceLabel.title} (Daily, Bags)`}
          monthsData={active.conillon}
          currentMonth={currentMonth}
          latestMonth={latestMonth}
          soluvelData={active.soluvel}
        />
      </div>
      <PaceByMonth bucket={active} latestMonth={latestMonth} sourceTitle={sourceLabel.title} />
    </div>
  );
}
