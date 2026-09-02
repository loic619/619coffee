"use client";
import { useEffect, useState } from "react";

interface IcoReference {
  marketing_year:       string;
  world_consumption_mt: number;
  source:               string;
  source_url:           string;
  note:                 string;
}

// `tracked_*` is the season ICO also reports, so the coverage ratio has the
// same year on both sides. `latest_*` is USDA's newest year — a forecast, two
// to three seasons ahead — carried separately so it can be shown without
// being silently compared to the ICO actual.
interface WorldConsumption {
  tracked_consumption_mt: number;
  tracked_countries:      number;
  tracked_year:           string | null;
  tracked_marketing_year: string | null;
  tracked_latest_year:    string | null;
  latest_consumption_mt?: number | null;
  latest_marketing_year?: string | null;
  latest_is_forecast?:    boolean;
  ico_reference:          IcoReference;
  tracked_vs_ico_pct:     number | null;
}

interface DemandStocks {
  world_consumption?: WorldConsumption | null;
}

function fmtMt(mt: number): string {
  if (mt >= 1_000_000) return `${(mt / 1_000_000).toFixed(2)} Mt`;
  if (mt >= 1_000)     return `${Math.round(mt / 1000)} kt`;
  return `${Math.round(mt)} t`;
}

export default function WorldConsumptionWidget() {
  const [wc, setWc] = useState<WorldConsumption | null>(null);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: DemandStocks) => setWc(d.world_consumption ?? null))
      .catch(() => {});
  }, []);

  if (!wc) return null;

  const ico = wc.ico_reference;
  const delta = wc.tracked_consumption_mt - ico.world_consumption_mt;
  const season = wc.tracked_marketing_year ?? wc.tracked_year ?? "—";
  // Under-coverage is the honest reading, so the sign convention is inverted
  // from the usual: a shortfall is amber (demand we do not see), not red, and
  // exceeding ICO is not a win — it would mean the two disagree.
  const short = Math.max(0, -delta);

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            USDA PSD — Tracked Consumption
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-1">
            {fmtMt(wc.tracked_consumption_mt)}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            {wc.tracked_countries} countries · marketing year {season}
          </div>
          {wc.latest_consumption_mt != null && wc.latest_marketing_year !== season && (
            <div className="text-[9px] text-slate-500 mt-1 pt-1 border-t border-slate-700/70">
              Latest USDA {wc.latest_marketing_year ?? wc.tracked_latest_year}:{" "}
              <span className="text-slate-300 font-mono">{fmtMt(wc.latest_consumption_mt)}</span>
              {wc.latest_is_forecast ? " (forecast)" : ""}
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            ICO — World Consumption Reference
          </div>
          <div className="text-2xl font-bold text-amber-300 font-mono mt-1">
            {fmtMt(ico.world_consumption_mt)}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Marketing year {ico.marketing_year} ·{" "}
            <a href={ico.source_url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300 underline">
              {ico.source}
            </a>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Coverage — {season}
          </div>
          <div className={`text-2xl font-bold font-mono mt-1 ${
            wc.tracked_vs_ico_pct == null ? "text-slate-400" : "text-amber-300"}`}>
            {wc.tracked_vs_ico_pct == null ? "—" : `${wc.tracked_vs_ico_pct.toFixed(1)}%`}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            {wc.tracked_vs_ico_pct == null
              ? "No PSD year overlaps the ICO reference season."
              : <>{short > 0
                    ? <>{fmtMt(short)} of world demand sits outside the tracked set</>
                    : <>tracked total exceeds ICO by {fmtMt(Math.abs(delta))} — the two disagree</>}
                  {" · both sides "}{season}</>}
          </div>
        </div>
      </div>
    </div>
  );
}
