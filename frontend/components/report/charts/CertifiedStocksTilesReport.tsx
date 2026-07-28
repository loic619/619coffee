"use client";
/**
 * Report wrapper: Certified Stocks (exchange-deliverable) summary tiles — the
 * headline KPI block from the Demand panel, WITHOUT the system-flow diagram.
 *
 * Mirrors CertifiedStocksPanel's tile math over a month-to-date window:
 *   Arabica (bags): Total = latest total_bags; Graded = Σ(passed+failed);
 *     Passed = Σ passed; Decertified = Σ max(0, prevTotal + passed − curTotal).
 *   Robusta (lots): Total = latest total_lots_certified; Graded = Σ graded;
 *     Sold = Σ sold; Decertified = Σ max(0, prevTotal − curTotal).
 */
import { useEffect, useState } from "react";
import { fmtNumRounded as fmt, MONTH_ABBR as MONTHS } from "@/lib/formatters";

interface ArabicaSnap { date: string; total_bags: number; passed_today_bags?: number; failed_today_bags?: number }
interface RobustaSnap { date: string; total_lots_certified: number; lots_graded_today?: number; lots_sold_today?: number }
interface ArabicaJson { as_of?: string | null; snapshots?: ArabicaSnap[] }
interface RobustaJson { as_of?: string | null; snapshots?: RobustaSnap[] }

const dayT = (ds: string) => {
  const [y, m, d] = ds.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

function Tile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-mono text-slate-100 mt-0.5">{value} <span className="text-slate-500">{unit}</span></div>
    </div>
  );
}

/** Month-to-date window bounds anchored to the latest snapshot. */
function windowOf(dates: string[]) {
  const last = dates[dates.length - 1];
  if (!last) return null;
  const [y, m] = last.slice(0, 10).split("-").map(Number);
  return { cutT: new Date(y, m - 1, 1).getTime(), endT: dayT(last) + 86_400_000 - 1, label: MONTHS[m - 1] };
}

export default function CertifiedStocksTilesReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [arabica, setArabica] = useState<ArabicaJson | null>(null);
  const [robusta, setRobusta] = useState<RobustaJson | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/certified_stocks_arabica.json").then((r) => (r.ok ? r.json() : null)),
      fetch("/data/certified_stocks_robusta.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, b]) => { setArabica(a); setRobusta(b); })
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-4 text-xs text-slate-500">Certified stocks data unavailable.</div>;
  if (!arabica && !robusta) return <div className="p-4 text-xs text-slate-500">Loading certified stocks…</div>;

  const aSnaps = arabica?.snapshots ?? [];
  const rSnaps = robusta?.snapshots ?? [];
  const aWin = windowOf(aSnaps.map((s) => s.date));
  const rWin = windowOf(rSnaps.map((s) => s.date));

  // Arabica (bags)
  let aGraded = 0, aPassed = 0, aDecert = 0;
  if (aWin) {
    for (let i = 0; i < aSnaps.length; i++) {
      const s = aSnaps[i];
      const t = dayT(s.date);
      if (t < aWin.cutT || t > aWin.endT) continue;
      aGraded += (s.passed_today_bags ?? 0) + (s.failed_today_bags ?? 0);
      aPassed += s.passed_today_bags ?? 0;
      const prev = aSnaps[i - 1];
      if (prev) aDecert += Math.max(0, prev.total_bags + (s.passed_today_bags ?? 0) - s.total_bags);
    }
  }
  const aTotal = aSnaps[aSnaps.length - 1]?.total_bags ?? 0;

  // Robusta (lots)
  let rGraded = 0, rSold = 0, rDecert = 0;
  if (rWin) {
    for (let i = 0; i < rSnaps.length; i++) {
      const s = rSnaps[i];
      const t = dayT(s.date);
      if (t < rWin.cutT || t > rWin.endT) continue;
      rGraded += s.lots_graded_today ?? 0;
      rSold += s.lots_sold_today ?? 0;
      const prev = rSnaps[i - 1];
      if (prev) rDecert += Math.max(0, prev.total_lots_certified - s.total_lots_certified);
    }
  }
  const rTotal = rSnaps[rSnaps.length - 1]?.total_lots_certified ?? 0;

  return (
    <div className="p-3 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Certified Stocks (exchange-deliverable)</h2>
        <p className="text-[11px] text-slate-500">ICE-certified deliverable inventory — month-to-date flows.</p>
      </div>

      {/* Arabica packed 2×2 on the left, Robusta 2×2 on the right. */}
      <div className="grid grid-cols-2 gap-3">
        {aSnaps.length > 0 && (
          <div>
            <div className="text-sm font-semibold text-amber-400 mb-1.5">
              Arabica · ICE US (KC) <span className="text-[10px] font-normal text-slate-500">as of {arabica?.as_of ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Total certified" value={fmt(aTotal)} unit="bags" />
              <Tile label={`Graded since ${aWin?.label ?? ""}`} value={fmt(aGraded)} unit="bags" />
              <Tile label={`Passed since ${aWin?.label ?? ""}`} value={fmt(aPassed)} unit="bags" />
              <Tile label={`Decertified since ${aWin?.label ?? ""}`} value={fmt(aDecert)} unit="bags" />
            </div>
          </div>
        )}

        {rSnaps.length > 0 && (
          <div>
            <div className="text-sm font-semibold text-emerald-400 mb-1.5">
              Robusta · ICE Europe (RC) <span className="text-[10px] font-normal text-slate-500">as of {robusta?.as_of ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Total certified" value={fmt(rTotal)} unit="lots" />
              <Tile label={`Graded since ${rWin?.label ?? ""}`} value={fmt(rGraded)} unit="lots" />
              <Tile label={`Sold since ${rWin?.label ?? ""}`} value={fmt(rSold)} unit="lots" />
              <Tile label={`Decertified since ${rWin?.label ?? ""}`} value={fmt(rDecert)} unit="lots" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
