"use client";
// Pace views for the Cecafé daily accumulator.
//
//   PaceStrip      — sits under each daily-registration chart: the selected
//                    month's average pace (bags/day) and how it compares to
//                    last month and the same month last year, on the same
//                    day-count basis, plus the month end that pace implies.
//   PaceByMonth    — one bar per month per stream (arabica / conilon /
//                    soluble): closed months at their full-month average, the
//                    open month at its month-to-date pace, flagged as such.
//
// Definitions live in pace.ts; nothing here does arithmetic of its own.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { DAILY_COLORS, TT_STYLE, TYPE_SERIES } from "./constants";
import { fmtBags, shiftMonth, shortMonthLabel } from "./helpers";
import {
  fmtPct, fmtPerDay, isComplete, monthFinal, paceFull, paceMTD, paceThrough,
  pctChange, projectMonthEnd, type MonthDays, type Pace,
} from "./pace";
import type { CecafeSourceBucket } from "./types";

type MonthsData = Record<string, MonthDays>;

const tone = (p: number | null) =>
  p === null ? "text-slate-500" : p > 0.5 ? "text-sky-300" : p < -0.5 ? "text-amber-300" : "text-slate-300";

/** One comparison line: the other month's pace, and the selected month's
 *  pace relative to it ("+8%" = the selected month is running 8% faster). */
function Row({ label, other, cur }: { label: string; other: Pace | null; cur: Pace }) {
  const pct = other ? pctChange(cur.perDay, other.perDay) : null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px] leading-4">
      <span className="text-slate-500 truncate">vs {label}</span>
      <span className="font-mono text-slate-300 whitespace-nowrap">
        {other ? fmtPerDay(other.perDay) : "—"}
        {other ? <span className={`ml-1.5 ${tone(pct)}`}>{fmtPct(pct)}</span> : null}
      </span>
    </div>
  );
}

export function PaceStrip({ monthsData, currentMonth, latestMonth }: {
  monthsData: MonthsData; currentMonth: string; latestMonth: string;
}) {
  const priorMonth = shiftMonth(currentMonth, -1);
  const lyMonth    = shiftMonth(currentMonth, -12);
  const complete   = isComplete(currentMonth, latestMonth);

  const cur = complete ? paceFull(monthsData[currentMonth], currentMonth)
                       : paceMTD(monthsData[currentMonth], currentMonth);
  if (!cur) return null;

  // Same day-count basis on every comparison: a closed month against the
  // others' full months; an open month against their pace through the same
  // day, and separately against last month's full-month average.
  const priorSameDay = paceThrough(monthsData[priorMonth], priorMonth, cur.day);
  const lySameDay    = paceThrough(monthsData[lyMonth], lyMonth, cur.day);
  const priorFull    = paceFull(monthsData[priorMonth], priorMonth);
  const lyFull       = paceFull(monthsData[lyMonth], lyMonth);
  const priorFinal   = monthFinal(monthsData[priorMonth]);
  const implied      = complete ? null : projectMonthEnd(cur, currentMonth);
  const impliedPct   = implied !== null && priorFinal ? pctChange(implied, priorFinal) : null;

  return (
    <div className="mt-2 pt-2 border-t border-slate-800 space-y-0.5">
      <div className="flex items-baseline justify-between gap-2 text-[10px] leading-4">
        <span className="text-slate-400">
          Average pace · {shortMonthLabel(currentMonth)}
          <span className="text-slate-600"> · {complete ? `full month, ${cur.day} days` : `MTD, through day ${cur.day}`}</span>
        </span>
        <span className="font-mono font-semibold text-slate-100 whitespace-nowrap">{fmtPerDay(cur.perDay)}</span>
      </div>
      {complete ? (
        <>
          <Row label={`${shortMonthLabel(priorMonth)} full month`} other={priorFull} cur={cur} />
          {lyFull && <Row label={`${shortMonthLabel(lyMonth)} full month`} other={lyFull} cur={cur} />}
        </>
      ) : (
        <>
          <Row label={`${shortMonthLabel(priorMonth)} through day ${cur.day}`} other={priorSameDay} cur={cur} />
          <Row label={`${shortMonthLabel(priorMonth)} full month`} other={priorFull} cur={cur} />
          {lySameDay && <Row label={`${shortMonthLabel(lyMonth)} through day ${cur.day}`} other={lySameDay} cur={cur} />}
          {implied !== null && (
            <div className="flex items-baseline justify-between gap-2 text-[10px] leading-4">
              <span className="text-slate-500 truncate">Implied month end at this pace</span>
              <span className="font-mono text-slate-300 whitespace-nowrap">
                {fmtBags(Math.round(implied))}
                {priorFinal ? <span className={`ml-1.5 ${tone(impliedPct)}`}>{fmtPct(impliedPct)} vs {fmtBags(priorFinal)}</span> : null}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const STREAMS = TYPE_SERIES.filter((t) => t.key !== "torrado") as
  { key: "arabica" | "conillon" | "soluvel"; label: string; color: string }[];

export function PaceByMonth({ bucket, latestMonth, sourceTitle }: {
  bucket: CecafeSourceBucket; latestMonth: string; sourceTitle: string;
}) {
  const months = Array.from(new Set(STREAMS.flatMap((s) => Object.keys(bucket[s.key] ?? {})))).sort();
  if (months.length < 2) return null;

  const rows = months.map((ym) => {
    const complete = isComplete(ym, latestMonth);
    const row: Record<string, number | string | boolean | null> = {
      ym, label: complete ? shortMonthLabel(ym) : `${shortMonthLabel(ym)} MTD`, complete,
    };
    let day = 0;
    for (const s of STREAMS) {
      const p = complete ? paceFull(bucket[s.key]?.[ym], ym) : paceMTD(bucket[s.key]?.[ym], ym);
      row[s.label] = p ? Math.round(p.perDay) : null;
      if (p) day = Math.max(day, p.day);
    }
    row.day = day;
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-sm font-semibold text-slate-200 mb-0.5">Pace by month · {sourceTitle}</div>
      <div className="text-[10px] text-slate-500 mb-2">
        Average bags per calendar day — closed months over their full length, the open month over the days reported so far (hatched)
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%" barGap={2}>
          <defs>
            {STREAMS.map((s) => (
              <pattern key={s.key} id={`pace-hatch-${s.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={s.color} opacity={0.35} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={s.color} strokeWidth="2.5" />
              </pattern>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis tickFormatter={(v) => fmtBags(Number(v))} tick={{ fill: "#94a3b8", fontSize: 9 }} width={46} />
          <Tooltip
            contentStyle={TT_STYLE}
            labelFormatter={(l, payload) => {
              const r = payload?.[0]?.payload as { complete?: boolean; day?: number } | undefined;
              return r ? `${l} · ${r.complete ? `${r.day} days` : `through day ${r.day}`}` : String(l);
            }}
            formatter={((v, name) => [v != null ? fmtPerDay(Number(v)) : "—", name as NameType]) satisfies Formatter<ValueType, NameType>}
          />
          <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} formatter={(v) => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {STREAMS.map((s) => (
            <Bar key={s.key} dataKey={s.label} fill={s.color} radius={[2, 2, 0, 0]} maxBarSize={22}>
              {rows.map((r) => (
                <Cell key={String(r.ym)} fill={r.complete ? s.color : `url(#pace-hatch-${s.key})`} stroke={r.complete ? undefined : DAILY_COLORS.current} strokeWidth={r.complete ? 0 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
