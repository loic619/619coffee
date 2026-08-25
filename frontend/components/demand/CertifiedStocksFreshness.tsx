"use client";
/**
 * Data freshness strip for the Certified Stocks panel.
 *
 * One chip per source feed: last available data point, calendar-day age,
 * and a colour cue that scales to each feed's actual publication cadence.
 * A monthly source 25 days old should read "within lifecycle" (no alarm);
 * a daily source 25 days old should read "very stale" (alert). The chip's
 * thresholdDays drives the cascade — see _tone() below.
 *
 * Sits under the panel header so a reader knows at a glance whether the
 * numbers below are today's or a publishing cycle stale.
 */
import { useEffect, useState } from "react";

interface FreshnessSource {
  arabicaAsOf?:        string | null;
  arabicaGeneratedAt?: string | null;
  arabicaAgeingLast?:  string | null;
  robustaAsOf?:        string | null;
  robustaGeneratedAt?: string | null;
  robustaGradingsLast?:        string | null;
  robustaAgeAllowanceLast?:    string | null;
  robustaIssRecvLast?:         string | null;
  robustaTendersLast?:         string | null;
  robustaOverviewLast?:        string | null;
  robustaImpliedOutflowLast?:  string | null;
}

function _ageDays(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null;
  // Month-end strings like "2026-04" get pinned to the 28th so they at
  // least round in the right direction; full ISO dates are parsed as-is.
  const padded = iso.length === 7 ? `${iso}-28` : iso;
  const t = new Date(padded).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((today.getTime() - t) / 86_400_000));
}

// Binary cascade. A feed is "within lifecycle" up to its expected
// publication cadence (e.g. 4 days for daily-M-F-with-weekend-skip,
// 11 days for the weekly COT including the worst-case pre-next-release
// window, 35 days for monthly publications). The moment it falls even
// one day past that window — i.e. the source missed its expected
// publish — the chip pings rose. No buffer / no gradient: overdue
// reads as overdue.
function _tone(days: number | null, threshold: number): string {
  if (days == null) return "text-slate-700 border-slate-800";
  if (days === 0)              return "text-emerald-400 border-emerald-800/60 bg-emerald-950/30"; // fresh
  if (days <= threshold)       return "text-slate-300   border-slate-700                       "; // within lifecycle
  return                              "text-rose-400    border-rose-800/60    bg-rose-950/30";    // OVERDUE — alert
}

function _ageStr(days: number | null): string {
  if (days == null)  return "—";
  if (days === 0)    return "today";
  if (days === 1)    return "1d ago";
  if (days <= 60)    return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function Chip({ label, last, today, thresholdDays }: {
  label: string; last: string | null | undefined; today: Date; thresholdDays: number;
}) {
  const days = _ageDays(last, today);
  const overdue = days != null && days > thresholdDays;
  return (
    <span
      title={last
        ? `${label} · latest = ${last} · ${_ageStr(days)} · cadence threshold ${thresholdDays}d${overdue ? " (OVERDUE)" : ""}`
        : `${label} · no data`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[9.5px] font-mono ${_tone(days, thresholdDays)}`}
    >
      <span className="text-slate-400 uppercase tracking-wider">{label}</span>
      <span>{last ?? "—"}</span>
      <span className="opacity-80">· {_ageStr(days)}</span>
    </span>
  );
}

export default function CertifiedStocksFreshness(props: FreshnessSource) {
  // `today` is captured in client state so SSR and the first client render
  // agree (Next would otherwise complain about Date.now() during hydration).
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);
  if (!today) return null;

  // Cadence thresholds reflect each feed's actual publication rhythm:
  //   ICE daily reports: published Mon-Fri after market close → 4d
  //     tolerates a Fri-eve view that won't see a refresh until Monday +
  //     the weekend-skip we added to the workflow itself.
  //   ICE ageing report (KC monthly): published day-1 of each month → 35d
  //     a 25-day-old file is mid-cycle normal, not stale.
  //   ICE age allowance (RC monthly): same monthly publish → 35d
  //   Cohort outflow: derived from monthly age-allowance file → 35d

  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Data freshness</span>
        <Chip label="KC stock"     last={props.arabicaAsOf}               today={today} thresholdDays={4}  />
        <Chip label="KC ageing"    last={props.arabicaAgeingLast}         today={today} thresholdDays={35} />
        <Chip label="RC stock"     last={props.robustaAsOf}               today={today} thresholdDays={4}  />
        <Chip label="RC gradings"  last={props.robustaGradingsLast}       today={today} thresholdDays={4}  />
        <Chip label="RC age allow" last={props.robustaAgeAllowanceLast}   today={today} thresholdDays={35} />
        {/* Delivery-cycle feeds, NOT daily. ICE publishes tenders and the
            issue/receipt report around the delivery notice period, so the
            series runs in monthly clusters — measured gaps between reports are
            30-37 days. A 4-day threshold painted both permanently OVERDUE
            between cycles, which is a false alarm, not a stale scrape. */}
        <Chip label="RC iss/recv"  last={props.robustaIssRecvLast}        today={today} thresholdDays={40} />
        <Chip label="RC tenders"   last={props.robustaTendersLast}        today={today} thresholdDays={40} />
        <Chip label="RC queue"     last={props.robustaOverviewLast}       today={today} thresholdDays={4}  />
        <Chip label="cohort out"   last={props.robustaImpliedOutflowLast} today={today} thresholdDays={35} />
      </div>
      <div className="text-[8.5px] text-slate-600 mt-1">
        Colour: <span className="text-emerald-400">today</span> · <span className="text-slate-300">within publishing cycle</span> ·
        <span className="text-rose-400"> OVERDUE</span> (alert pings immediately when the source misses its expected publish window).
        Cadence varies per feed — monthly publications (KC ageing, RC age allowance, cohort out) read normal up to ~35 days,
        and the delivery-cycle feeds (RC tenders, RC iss/recv) up to ~40.
      </div>
    </div>
  );
}