"use client";
import { fmtNum as fmt, chgTone, fmtAsOf } from "@/lib/formatters";
import { fmtFirstNoticeDay } from "@/lib/fnd";
import type { ChainData } from "./types";
import { usePriceUnit } from "@/lib/usePriceUnit";
import { useContract } from "@/lib/useContract";
import { UNIT_LABEL, unitDecimals, unitFactor, type PriceUnit } from "@/lib/units";

// First Notice Day comes from lib/fnd.ts — the single, holiday-aware source
// shared with the events calendar. Do not reintroduce a local copy.
const firstNoticeDay = fmtFirstNoticeDay;

// ─── Futures Chain Table ──────────────────────────────────────────────────────


export default function ChainTable({ market, data, showAll }: { market: "arabica" | "robusta"; data: ChainData; showAll?: boolean }) {
  // Hooks first — the early return below must not change their order.
  const [display] = usePriceUnit();
  const [selected, setSelected] = useContract();
  if (!data?.contracts?.length) return null;

  const isArabica = market === "arabica";
  // One display unit for the whole screen (UnitToggle in the header). KC is
  // quoted in ¢/lb, RC in USD/MT; whichever the reader chose, both tables
  // convert to it — so the two settle columns can be read against each other.
  const native: PriceUnit = isArabica ? "cents_lb" : "usd_mt";
  const k    = unitFactor(native, display);
  const unit = UNIT_LABEL[display];
  // The contract the reader picked travels to the FND chart, COT and Signals.
  const sublabel = isArabica ? "ICE NY · Arabica (KC)" : "ICE London · Robusta (RC)";
  const accent = isArabica ? "text-amber-400" : "text-emerald-400";
  // "Show all" (phone) reveals the columns otherwise hidden below `bp`; at lg+
  // everything is visible regardless.
  const hideAt = (bp: "sm" | "md" | "lg") => (showAll ? "" : `hidden ${bp}:table-cell`);

  function fmtExpiry(raw: string): string {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return `${d.getDate()}/${d.getMonth() + 1}`;
    return raw;
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-x-auto">
      <div className="px-2 sm:px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between min-h-[40px]">
        <div className="truncate">
          <span className="font-semibold text-sm text-white hidden sm:inline">Daily Quotes</span>
          {/* Phone: short market name; wider: the full ICE sublabel. */}
          <span className={`text-xs sm:ml-2 font-semibold ${accent}`}>
            <span className="sm:hidden">{isArabica ? "Arabica" : "Robusta"}</span>
            <span className="hidden sm:inline font-normal">{sublabel}</span>
          </span>
        </div>
        {/* The settle belongs to an exchange session, and the two tables settle
            in different cities — say which. */}
        <span className="text-xs text-slate-500 whitespace-nowrap ml-2 hidden sm:inline">
          Barchart · {fmtAsOf(data.pub_date, isArabica ? "NY" : "LDN")}
        </span>
      </div>
      {/* In "show all" the table takes its natural (max-content) width so the
          revealed OI/Vol columns overflow and the wrapper scrolls; w-full would
          instead cap it at the viewport and squeeze them out of view. */}
      <table className={`text-[10px] sm:text-[11px] font-mono ${showAll ? "w-max lg:w-full" : "w-full"}`}>
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            {/* Phone keeps Ct · Last · Chg so the 3-up view fits; the rest
                reappear as the viewport widens. */}
            <th className="text-left  px-1 sm:px-1.5 py-1 w-10 whitespace-nowrap">Ct.</th>
            <th className={`text-center px-1 sm:px-1.5 py-1 w-14 whitespace-nowrap ${hideAt("md")}`}>FND</th>
            <th className={`text-center px-1 sm:px-1.5 py-1 w-11 whitespace-nowrap ${hideAt("lg")}`}>Exp.</th>
            <th className="text-right px-1 sm:px-1.5 py-1 whitespace-nowrap">Last<span className={showAll ? "" : "hidden sm:inline"}> ({unit})</span></th>
            <th className="text-right px-1 sm:px-1.5 py-1 whitespace-nowrap">Chg</th>
            <th className={`text-right px-1.5 py-1 whitespace-nowrap ${hideAt("sm")}`}>Sprd</th>
            <th className={`text-right px-1.5 py-1 whitespace-nowrap ${hideAt("lg")}`}>Sprd Chg</th>
            <th className={`text-right px-1.5 py-1 whitespace-nowrap ${hideAt("lg")}`}>OI</th>
            <th className={`text-right px-1.5 py-1 whitespace-nowrap ${hideAt("lg")}`}>Vol</th>
          </tr>
        </thead>
        <tbody>
          {data!.contracts.map((c, i) => {
            const chgColor  = chgTone((c.chg ?? 0));
            const next      = data!.contracts[i + 1];
            const spread    = c.last != null && next?.last != null ? c.last - next.last : null;
            const spreadChg = c.chg != null && next?.chg != null ? c.chg - next.chg : null;
            const shortSym  = c.symbol.replace(/^(KC|RC|RM)/, "$1").slice(0, 5);
            const dec       = unitDecimals(display);
            const isSel     = selected === c.symbol.toUpperCase();
            return (
              <tr key={c.symbol}
                  onClick={() => setSelected(isSel ? null : c.symbol)}
                  title={isSel ? "Selected — click to clear" : "Click to follow this contract across tabs"}
                  className={`border-t border-slate-700 cursor-pointer ${i === 0 ? "text-white bg-slate-800/60" : "text-slate-300"} ${isSel ? "outline outline-1 outline-amber-500/70 bg-amber-950/30" : ""}`}>
                <td className="px-1 sm:px-1.5 py-1.5 font-bold whitespace-nowrap">{shortSym}</td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-center text-amber-400/80 whitespace-nowrap ${hideAt("md")}`}>{firstNoticeDay(c.symbol)}</td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-center text-slate-500 whitespace-nowrap ${hideAt("lg")}`}>{fmtExpiry(c.expiry)}</td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-right font-bold ${i === 0 ? accent : ""}`}>{c.last == null ? "—" : (c.last * k).toFixed(dec)}</td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-right ${chgColor}`}>{c.chg == null ? "—" : (c.chg >= 0 ? "+" : "") + (c.chg * k).toFixed(dec)}</td>
                <td className={`px-1.5 py-1.5 text-right ${hideAt("sm")} ${spread === null ? "text-slate-600" : spread >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spread !== null ? (spread >= 0 ? "+" : "") + (spread * k).toFixed(dec) : "—"}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${hideAt("lg")} ${spreadChg === null ? "text-slate-600" : spreadChg >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spreadChg !== null ? (spreadChg >= 0 ? "+" : "") + (spreadChg * k).toFixed(dec) : "—"}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${hideAt("lg")}`}>{fmt(c.oi)}</td>
                <td className={`px-1.5 py-1.5 text-right text-slate-400 ${hideAt("lg")}`}>{fmt(c.volume)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

