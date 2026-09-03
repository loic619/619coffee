"use client";
/**
 * Report wrapper: Daily Quotes (Barchart) — the ICE futures chain table shown on
 * the Futures tab, sourced from /data/futures_chain.json. Renders both markets
 * (NY Arabica · London Robusta). This mirrors the Futures-page ChainTable so the
 * report uses the Barchart feed (not the ACAPHE live widget).
 */
import { useEffect, useState } from "react";
import { fmtNum as fmt, chgTone } from "@/lib/formatters";

interface Contract {
  contract: string; expiry: string; last: number; chg: number; oi: number; volume: number; symbol: string;
}
interface ChainData { pub_date: string; contracts: Contract[] }

const LETTER_TO_MONTH: Record<string, number> = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };

function firstBusinessDay(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
function subtractBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) remaining--; }
  return d;
}
function firstNoticeDay(symbol: string): string {
  const m = symbol.match(/^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return "—";
  const [, product, letter, yr] = m;
  const monthNum = LETTER_TO_MONTH[letter.toUpperCase()];
  if (!monthNum) return "—";
  const days = product.toUpperCase() === "KC" ? 7 : 4;
  const fnd = subtractBusinessDays(firstBusinessDay(2000 + parseInt(yr), monthNum), days);
  return `${fnd.getDate()}/${fnd.getMonth() + 1}`;
}
function ChainTable({ market, data }: { market: "arabica" | "robusta"; data: ChainData }) {
  if (!data?.contracts?.length) return null;
  const isArabica = market === "arabica";
  const unit = isArabica ? "¢/lb" : "$/t";
  const sublabel = isArabica ? "NY · Arabica (KC)" : "London · Robusta (RC)";
  const accent = isArabica ? "text-amber-400" : "text-emerald-400";
  const dec = isArabica ? 2 : 0;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-2 py-1 bg-slate-800 border-b border-slate-700 flex items-center justify-between gap-1">
        <div className="leading-tight">
          <span className="font-semibold text-[10px] text-white">Daily Quotes</span>
          <span className={`text-[9px] ml-1 ${accent}`}>{sublabel}</span>
        </div>
        <span className="text-[8px] text-slate-500 whitespace-nowrap">Barchart · {data.pub_date ?? ""}</span>
      </div>
      <table className="w-full text-[9px] font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="text-left px-1 py-0.5">Ct.</th>
            <th className="text-center px-1 py-0.5">FND</th>
            <th className="text-right px-1 py-0.5">Last ({unit})</th>
            <th className="text-right px-1 py-0.5">Chg</th>
            <th className="text-right px-1 py-0.5">Sprd</th>
            <th className="text-right px-1 py-0.5">Sprd Chg</th>
            <th className="text-right px-1 py-0.5">OI</th>
          </tr>
        </thead>
        <tbody>
          {data.contracts.map((c, i) => {
            const chgColor = chgTone((c.chg ?? 0));
            const next = data.contracts[i + 1];
            const spread = c.last != null && next?.last != null ? c.last - next.last : null;
            const spreadChg = c.chg != null && next?.chg != null ? c.chg - next.chg : null;
            const shortSym = c.symbol.slice(0, 5);
            return (
              <tr key={c.symbol} className={`border-t border-slate-700 ${i === 0 ? "text-white bg-slate-800/60" : "text-slate-300"}`}>
                <td className="px-1 py-0.5 font-bold">{shortSym}</td>
                <td className="px-1 py-0.5 text-center text-amber-400/80">{firstNoticeDay(c.symbol)}</td>
                <td className={`px-1 py-0.5 text-right font-bold ${i === 0 ? accent : ""}`}>{c.last?.toFixed(dec)}</td>
                <td className={`px-1 py-0.5 text-right ${chgColor}`}>{c.chg == null ? "—" : (c.chg >= 0 ? "+" : "") + c.chg.toFixed(dec)}</td>
                <td className={`px-1 py-0.5 text-right ${spread === null ? "text-slate-600" : spread >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spread !== null ? (spread >= 0 ? "+" : "") + spread.toFixed(dec) : "—"}
                </td>
                <td className={`px-1 py-0.5 text-right ${spreadChg === null ? "text-slate-600" : spreadChg >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spreadChg !== null ? (spreadChg >= 0 ? "+" : "") + spreadChg.toFixed(dec) : "—"}
                </td>
                <td className="px-1 py-0.5 text-right">{fmt(c.oi)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DailyQuotesReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [chain, setChain] = useState<{ arabica: ChainData | null; robusta: ChainData | null } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/futures_chain.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { arabica: ChainData | null; robusta: ChainData | null } | null) => (j ? setChain(j) : setErr(true)))
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-4 text-xs text-slate-500">Daily quotes unavailable.</div>;
  if (!chain) return <div className="p-4 text-xs text-slate-500">Loading daily quotes…</div>;
  return (
    <div className="p-2 grid grid-cols-2 gap-2">
      {chain.arabica && <ChainTable market="arabica" data={chain.arabica} />}
      {chain.robusta && <ChainTable market="robusta" data={chain.robusta} />}
    </div>
  );
}
