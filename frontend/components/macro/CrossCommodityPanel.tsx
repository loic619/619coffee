"use client";
import { useEffect, useMemo, useState } from "react";
import { chgTone } from "@/lib/formatters";

interface CommodityRow {
  symbol:      string;
  sector:      string;
  name:        string;
  close_price: number | null;
}

interface WeeklyRecord {
  date:        string;
  commodities: CommodityRow[];
}

const TARGETS: { symbol: string; label: string; unit: string }[] = [
  { symbol: "arabica",   label: "Coffee Arabica (KC)",   unit: "¢/lb"  },
  { symbol: "robusta",   label: "Coffee Robusta (RM)",   unit: "$/t"   },
  { symbol: "sugar11",   label: "Sugar #11",             unit: "¢/lb"  },
  { symbol: "cocoa_ny",  label: "Cocoa (NY)",            unit: "$/t"   },
  { symbol: "cotton",    label: "Cotton",                unit: "¢/lb"  },
  { symbol: "oj",        label: "Orange Juice",          unit: "¢/lb"  },
  { symbol: "corn",      label: "Corn",                  unit: "¢/bu"  },
  { symbol: "wheat",     label: "Wheat",                 unit: "¢/bu"  },
  { symbol: "soybeans",  label: "Soybeans",              unit: "¢/bu"  },
  { symbol: "wti",       label: "Crude (WTI)",           unit: "$/bbl" },
  { symbol: "gold",      label: "Gold",                  unit: "$/oz"  },
  { symbol: "copper",    label: "Copper",                unit: "$/lb"  },
];

const SECTOR_COLOR: Record<string, string> = {
  softs:  "#a855f7",
  grains: "#f59e0b",
  hard:   "#0ea5e9",
  meats:  "#ef4444",
  micros: "#64748b",
};

type Stat = { latest: number | null; w1: number | null; m1: number | null; ytd: number | null };

function pct(now: number | null, then: number | null): number | null {
  if (now == null || then == null || then === 0) return null;
  return ((now - then) / then) * 100;
}

function findPrice(records: WeeklyRecord[], idx: number, symbol: string): number | null {
  const rec = records[idx];
  if (!rec) return null;
  const c = rec.commodities.find(c => c.symbol === symbol);
  return c?.close_price ?? null;
}

function computeStats(records: WeeklyRecord[], symbol: string): Stat {
  if (records.length === 0) return { latest: null, w1: null, m1: null, ytd: null };
  const last = records.length - 1;
  const latest = findPrice(records, last, symbol);

  // 1 week ago = 1 weekly snapshot back; 1 month ago = ~4 snapshots
  const w1Price = findPrice(records, Math.max(0, last - 1), symbol);
  const m1Price = findPrice(records, Math.max(0, last - 4), symbol);

  // YTD = first snapshot of the current calendar year (or the earliest record)
  const currentYear = records[last]?.date.slice(0, 4);
  const ytdRec = records.find(r => r.date.slice(0, 4) === currentYear);
  const ytdIdx = ytdRec ? records.indexOf(ytdRec) : 0;
  const ytdPrice = findPrice(records, ytdIdx, symbol);

  return {
    latest,
    w1:  pct(latest, w1Price),
    m1:  pct(latest, m1Price),
    ytd: pct(latest, ytdPrice),
  };
}

function fmtChg(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-slate-500" };
  const sign = v >= 0 ? "+" : "";
  const cls  = chgTone(v);
  return { text: `${sign}${v.toFixed(1)}%`, cls };
}

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 10)   return v.toFixed(2);
  return v.toFixed(3);
}

export default function CrossCommodityPanel() {
  const [records, setRecords] = useState<WeeklyRecord[] | null>(null);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    fetch("/data/macro_cot.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setRecords)
      .catch(() => setError(true));
  }, []);

  const rows = useMemo(() => {
    if (!records) return [];
    return TARGETS.map(t => {
      const sector = records[records.length - 1]?.commodities
        .find(c => c.symbol === t.symbol)?.sector ?? "";
      return { ...t, sector, stat: computeStats(records, t.symbol) };
    });
  }, [records]);

  const asOf = records?.[records.length - 1]?.date ?? null;

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Cross-commodity data unavailable — macro_cot.json failed to load.
      </div>
    );
  }
  if (!records) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading cross-commodity data…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Cross-Commodity Performance</h2>
          <p className="text-xs text-slate-400">
            How coffee is moving relative to other commodity complexes.
            When KC diverges from sugar/cocoa, the move is coffee-specific; when it tracks grains or WTI, it&apos;s being carried by macro flow.
            Source: CFTC + ICE COT weekly close prices · as-of {asOf ?? "—"}
          </p>
        </div>
        <a
          href="/cot#macro-cot"
          className="text-[11px] text-sky-400 hover:text-sky-300 whitespace-nowrap"
        >
          View detailed positioning →
        </a>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="text-left  px-3 py-2">Commodity</th>
              <th className="text-right px-3 py-2">Last</th>
              <th className="text-right px-3 py-2">Unit</th>
              <th className="text-right px-3 py-2">1W</th>
              <th className="text-right px-3 py-2">1M</th>
              <th className="text-right px-3 py-2">YTD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {rows.map(r => {
              const w1  = fmtChg(r.stat.w1);
              const m1  = fmtChg(r.stat.m1);
              const ytd = fmtChg(r.stat.ytd);
              return (
                <tr key={r.symbol} className="hover:bg-slate-800/60">
                  <td className="px-3 py-2 text-slate-200">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
                      style={{ background: SECTOR_COLOR[r.sector] ?? "#64748b" }}
                    />
                    {r.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-100">{fmtPrice(r.stat.latest)}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-slate-500">{r.unit}</td>
                  <td className={`px-3 py-2 text-right font-mono ${w1.cls}`}>{w1.text}</td>
                  <td className={`px-3 py-2 text-right font-mono ${m1.cls}`}>{m1.text}</td>
                  <td className={`px-3 py-2 text-right font-mono ${ytd.cls}`}>{ytd.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
