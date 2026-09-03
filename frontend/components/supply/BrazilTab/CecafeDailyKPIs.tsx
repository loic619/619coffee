"use client";
// Daily Cecafé KPI strip — sits above the export charts and reads the same
// /data/cecafe_daily.json the DailyRegistration panel does, so the numbers
// match by construction.
//
// Each pair (Embarques / Certificados) shows:
//   1. month-to-date cumulative bags at the latest day reported, and
//   2. delta vs the SAME calendar day of the prior month — apples-to-apples
//      on calendar progression. If the prior month doesn't carry that exact
//      day, we fall back to the closest preceding day available (so "day 5"
//      vs "day 4 of last month" beats showing nothing).
//
// "Total" sums arabica + conillon + soluvel because both Cecafé tables emit
// the three streams in parallel and the user asked for one combined figure.
import { useEffect, useState } from "react";
import FeedUnavailable from "@/components/FeedUnavailable";
import { MONTH_ABBR } from "@/lib/formatters";
import StatCard from "./StatCard";
import { bagsToKT, normalizeSources, shiftMonth } from "./helpers";
import { daysInMonth, fmtPct, fmtPerDay, monthFinal, pctChange } from "./pace";
import type { CecafeSourceBucket, DailyData } from "./types";

interface SourceLatest {
  ym:      string;     // "YYYY-MM" of the latest reported month
  day:     number;     // latest day-of-month any of arabica/conillon/soluvel reached
  total:   number;     // bags at that day, summed across the three streams
}

function _latestMonthAndDay(bucket: CecafeSourceBucket): SourceLatest | null {
  const ymSet = new Set<string>();
  for (const t of ["arabica", "conillon", "soluvel"] as const) {
    for (const ym of Object.keys(bucket[t] ?? {})) ymSet.add(ym);
  }
  if (!ymSet.size) return null;
  const ym = Array.from(ymSet).sort().pop()!;

  const lastDay = (md: Record<string, number> | undefined) => {
    const days = Object.keys(md ?? {}).map(Number).sort((a, b) => b - a);
    return days.length ? days[0] : 0;
  };
  const a = lastDay(bucket.arabica?.[ym]);
  const c = lastDay(bucket.conillon?.[ym]);
  const s = lastDay(bucket.soluvel?.[ym]);
  const day = Math.max(a, c, s);
  if (!day) return null;

  const at = (md: Record<string, number> | undefined, d: number) =>
    Number(md?.[String(d)] ?? 0);
  const total = at(bucket.arabica?.[ym], day)
              + at(bucket.conillon?.[ym], day)
              + at(bucket.soluvel?.[ym], day);
  return { ym, day, total };
}

function _atSameDayLastMonth(bucket: CecafeSourceBucket, currentYm: string,
                              targetDay: number): SourceLatest | null {
  const [y, m] = currentYm.split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const lastYm = `${py}-${String(pm).padStart(2, "0")}`;

  // Closest day ≤ targetDay that we actually have data for, per stream.
  const closestAtOrBefore = (md: Record<string, number> | undefined) => {
    const days = Object.keys(md ?? {}).map(Number).sort((a, b) => a - b);
    let best = 0;
    for (const d of days) {
      if (d > targetDay) break;
      best = d;
    }
    return best;
  };
  const a = closestAtOrBefore(bucket.arabica?.[lastYm]);
  const c = closestAtOrBefore(bucket.conillon?.[lastYm]);
  const s = closestAtOrBefore(bucket.soluvel?.[lastYm]);
  if (!a && !c && !s) return null;

  const at = (md: Record<string, number> | undefined, d: number) =>
    d ? Number(md?.[String(d)] ?? 0) : 0;
  const total = at(bucket.arabica?.[lastYm], a)
              + at(bucket.conillon?.[lastYm], c)
              + at(bucket.soluvel?.[lastYm], s);
  return { ym: lastYm, day: Math.max(a, c, s), total };
}

function _delta(cur: SourceLatest | null, prev: SourceLatest | null) {
  if (!cur || !prev || prev.total === 0) return null;
  const abs = cur.total - prev.total;
  const pct = (abs / prev.total) * 100;
  return { abs, pct };
}

/** Month-to-date pace of the three streams combined (bags per calendar day),
 *  against last month's full-month average on the same basis. Same
 *  definitions as pace.ts / the PaceStrip under the daily charts. */
function _pace(bucket: CecafeSourceBucket, cur: SourceLatest | null) {
  if (!cur || !cur.day) return null;
  const perDay = cur.total / cur.day;
  const lastYm = shiftMonth(cur.ym, -1);
  const lastTotal = (["arabica", "conillon", "soluvel"] as const)
    .map((t) => monthFinal(bucket[t]?.[lastYm]))
    .reduce<number | null>((s, v) => (v == null ? s : (s ?? 0) + v), null);
  const lastPerDay = lastTotal == null ? null : lastTotal / daysInMonth(lastYm);
  return { perDay, lastYm, lastPerDay, pct: lastPerDay == null ? null : pctChange(perDay, lastPerDay) };
}

const _monthAbbr = (ym: string) => MONTH_ABBR[parseInt(ym.slice(5, 7), 10) - 1] ?? ym.slice(5);
const _kt = (bags: number) => `${bagsToKT(bags).toFixed(1)} kt`;

export default function CecafeDailyKPIs() {
  const [data, setData] = useState<DailyData | null>(null);
  // A failed fetch used to hide the panel, which reads as "nothing to show"
  // when it means "the feed did not load". Distinguish the two.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/data/cecafe_daily.json")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DailyData | null) => (d ? setData(d) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);
  if (!data) return failed ? <FeedUnavailable what="Cecafé daily KPIs" file="cecafe_daily.json" /> : null;
  const sources = normalizeSources(data);

  const embCur  = _latestMonthAndDay(sources.embarques);
  const certCur = _latestMonthAndDay(sources.certificados);
  if (!embCur && !certCur) return null;

  const embPrev  = embCur  ? _atSameDayLastMonth(sources.embarques,    embCur.ym,  embCur.day)  : null;
  const certPrev = certCur ? _atSameDayLastMonth(sources.certificados, certCur.ym, certCur.day) : null;
  const embDelta  = _delta(embCur, embPrev);
  const certDelta = _delta(certCur, certPrev);
  const embPace   = _pace(sources.embarques, embCur);
  const certPace  = _pace(sources.certificados, certCur);
  const _paceSub = (p: ReturnType<typeof _pace>) =>
    p?.lastPerDay != null
      ? `${fmtPct(p.pct)} vs ${_monthAbbr(p.lastYm)} avg ${fmtPerDay(p.lastPerDay)}`
      : "no prior month on file";

  const _deltaValue = (d: { pct: number } | null) =>
    d ? `${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(1)}%` : "—";
  const _deltaSub = (d: { abs: number } | null, prev: SourceLatest | null) =>
    d && prev
      ? `${d.abs >= 0 ? "+" : ""}${_kt(d.abs)} vs ${_monthAbbr(prev.ym)} day ${prev.day}`
      : "no prior-month sample";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard
        label="Total Embarques · MTD"
        value={embCur ? _kt(embCur.total) : "—"}
        sub={embCur ? `${_monthAbbr(embCur.ym)} day ${embCur.day} · ${embCur.total.toLocaleString()} bags` : "no data"}
      />
      <StatCard
        label="Embarques vs same-day last month"
        value={_deltaValue(embDelta)}
        sub={_deltaSub(embDelta, embPrev)}
      />
      <StatCard
        label="Embarques pace · bags/day"
        value={embPace ? fmtPerDay(embPace.perDay).replace("/day", "") : "—"}
        sub={_paceSub(embPace)}
      />
      <StatCard
        label="Total Certificados · MTD"
        value={certCur ? _kt(certCur.total) : "—"}
        sub={certCur ? `${_monthAbbr(certCur.ym)} day ${certCur.day} · ${certCur.total.toLocaleString()} bags` : "no data"}
      />
      <StatCard
        label="Certificados vs same-day last month"
        value={_deltaValue(certDelta)}
        sub={_deltaSub(certDelta, certPrev)}
      />
      <StatCard
        label="Certificados pace · bags/day"
        value={certPace ? fmtPerDay(certPace.perDay).replace("/day", "") : "—"}
        sub={_paceSub(certPace)}
      />
    </div>
  );
}
