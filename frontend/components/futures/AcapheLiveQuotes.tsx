"use client";
import React, { useEffect, useState } from "react";
import { chgTone, fmtStampUTC } from "@/lib/formatters";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AcapheContract {
  month: string;
  change: number;
  change_pct: number | null;
  last: number;
  vol: number;
  oi: number | null;
  oi_chg: number | null;
}

interface VietnamPrices {
  local_time: string | null;
  bmt_bid: string | null;
  bmt_offer: string | null;
  hcm_bid: string | null;
  hcm_offer: string | null;
  r2_fob_bid: string | null;
  r2_fob_offer: string | null;
  pepper_faq: string | null;
  usd_vnd: number | null;
}

interface AcapheLiveData {
  fetched_at: string;
  now_time: string;
  robusta: AcapheContract[];
  arabica: AcapheContract[];
  vietnam?: VietnamPrices;
  spreads?: { robusta: string; arabica: string };
  arb_ratio?: string;
  equities?: string;
}

// ── Date helpers (same rules as Daily Quotes) ─────────────────────────────────

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12,
};

function firstBusinessDay(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function subtractBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  let rem = n;
  while (rem > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) rem--;
  }
  return d;
}

function fmtDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// "RK 05/26" → "RCK26", "AK 05/26" → "KCK26"
function acapheToSymbol(month: string, isArabica: boolean): string {
  const letter = month[1];
  const yr     = month.slice(-2);
  return isArabica ? `KC${letter}${yr}` : `RC${letter}${yr}`;
}

// First Notice Day: KC = 7 biz days before 1st biz day of delivery month; RC = 4 biz days
function calcFndDate(symbol: string): Date | null {
  const m = symbol.match(/^(KC|RC|RM)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return null;
  const [, product, letter, yr] = m;
  const monthNum = LETTER_TO_MONTH[letter.toUpperCase()];
  if (!monthNum) return null;
  const year = 2000 + parseInt(yr);
  const days = product.toUpperCase() === "KC" ? 7 : 4;
  return subtractBusinessDays(firstBusinessDay(year, monthNum), days);
}

function calcFnd(symbol: string): string {
  const d = calcFndDate(symbol);
  return d ? fmtDate(d) : "—";
}

// Options LTD = FND − 8 biz days (verified against acaphe front-month data for both RC and KC)
function calcOptLtd(symbol: string): string {
  const fnd = calcFndDate(symbol);
  if (!fnd) return "—";
  return fmtDate(subtractBusinessDays(fnd, 8));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function secsAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 1000);
}

// ── KC/RC ratio column (one row per arabica contract, mapped KC→RC with Z→F next year) ─

const KC_TO_RC_LETTER: Record<string, string> = { H:"H", K:"K", N:"N", U:"U", Z:"F" };

function RatioColumn({ arabica, robusta }: { arabica: AcapheContract[]; robusta: AcapheContract[] }) {
  // Key: letter+2-digit-year e.g. "K26", "F27"
  const rcByKey = new Map<string, number>();
  robusta.forEach(c => {
    const key = c.month[1] + c.month.slice(-2);
    if (!rcByKey.has(key)) rcByKey.set(key, c.last);
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-x-auto self-start">
      <div className="px-1.5 sm:px-3 py-2 bg-slate-800 border-b border-slate-700 text-center min-h-[40px] flex items-center justify-center">
        <span className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider sm:tracking-widest whitespace-nowrap">
          <span className="sm:hidden">Arb</span>
          <span className="hidden sm:inline">Arbitrage</span>
        </span>
      </div>
      <table className="text-[11px] font-mono w-full">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="px-1.5 py-1 text-left whitespace-nowrap">Pair</th>
            <th className="px-1.5 py-1 text-right whitespace-nowrap">
              <span className="sm:hidden">×</span>
              <span className="hidden sm:inline">¢/lb (×)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {arabica.map((c, i) => {
            const kcLetter = c.month[1];
            const kcYr     = c.month.slice(-2);
            const rcLetter = KC_TO_RC_LETTER[kcLetter] ?? kcLetter;
            const rcYr     = kcLetter === "Z" ? String(parseInt(kcYr) + 1).slice(-2) : kcYr;
            const rc       = rcByKey.get(rcLetter + rcYr);
            // Guard a 0/absent RC leg (far months print 0) — else ratio=Infinity.
            const hasRc    = rc != null && rc > 0;
            const spread   = hasRc ? c.last - rc / 22.046 : null;
            const ratio    = hasRc ? (c.last * 22.046 / rc).toFixed(2) : null;
            const sym      = acapheToSymbol(c.month, true);
            const rcSym    = `RC${rcLetter}${rcYr}`;
            const isFront  = i === 0;
            return (
              <tr key={c.month} className={`border-t border-slate-700 ${isFront ? "bg-slate-800/60" : ""}`}>
                <td className={`px-1.5 py-1.5 whitespace-nowrap ${isFront ? "text-slate-200" : "text-slate-500"}`}>
                  {/* Phone: compact key (e.g. "K26"); wider: full "KCK26-RCK26". */}
                  <span className="sm:hidden">{kcLetter}{kcYr}</span>
                  <span className="hidden sm:inline">{sym}-{rcSym}</span>
                </td>
                <td className={`px-1.5 py-1.5 text-right whitespace-nowrap ${isFront ? "text-sky-300" : "text-slate-500"}`}>
                  {/* Phone: ratio only (×N); wider: spread + ratio. */}
                  {ratio != null && spread != null ? (
                    <>
                      <span className="sm:hidden">×{ratio}</span>
                      <span className="hidden sm:inline">{spread.toFixed(1)} (×{ratio})</span>
                    </>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Merged phone view: one row per contract month ─────────────────────────────
// Phones can't fit the three desktop panels side-by-side, so below `lg` we
// collapse Arabica · Arbitrage · Robusta into ONE month-keyed table. The shared
// month code (e.g. "U26") is printed once; the arbitrage is a single value
// (KC¢ ÷ RC$). A "More"/"Less" toggle reveals the secondary columns (FND,
// expiry, OI, volume). Months that trade in only one market leave the other
// side blank; the arbitrage still pairs the nearest cross-market leg
// (RC Nov ↔ KC Dec, KC Dec ↔ RC Jan of the next year).

interface Leg {
  last: number; change: number; spread: number | null; spreadChg: number | null;
  oi: number | null; vol: number; fnd: string; exp: string;
}

function buildLegs(contracts: AcapheContract[], isArabica: boolean): Map<string, Leg> {
  const m = new Map<string, Leg>();
  contracts.forEach((c, i) => {
    const next = contracts[i + 1];
    const sym  = acapheToSymbol(c.month, isArabica);
    m.set(c.month[1] + c.month.slice(-2), {
      last: c.last, change: c.change,
      spread:    next ? c.last - next.last : null,
      spreadChg: next ? c.change - next.change : null,
      oi: c.oi, vol: c.vol, fnd: calcFnd(sym), exp: calcOptLtd(sym),
    });
  });
  return m;
}

const _monthOrder = (key: string) =>
  (2000 + parseInt(key.slice(1))) * 12 + (LETTER_TO_MONTH[key[0]] ?? 0);

function MergedPhoneQuotes({ arabica, robusta }: { arabica: AcapheContract[]; robusta: AcapheContract[] }) {
  const [showMore, setShowMore] = useState(false);
  const kc = buildLegs(arabica, true);
  const rc = buildLegs(robusta, false);
  const keys = Array.from(new Set(Array.from(kc.keys()).concat(Array.from(rc.keys()))))
    .sort((a, b) => _monthOrder(a) - _monthOrder(b));

  // Arbitrage in ¢/lb (KC¢ − RC converted to ¢/lb) for a row, pairing the
  // nearest cross leg when the month trades in only one market.
  function arbSpread(key: string): number | null {
    const yr = key.slice(1);
    let k: Leg | undefined, r: Leg | undefined;
    if (key[0] === "X") {            // RC Nov ↔ KC Dec (same year)
      r = rc.get(key); k = kc.get("Z" + yr);
    } else if (key[0] === "Z") {     // KC Dec ↔ RC Jan (next year)
      k = kc.get(key); r = rc.get("F" + String(parseInt(yr) + 1).padStart(2, "0"));
    } else {                         // shared month
      k = kc.get(key); r = rc.get(key);
    }
    if (!k || !r || r.last <= 0) return null;
    return k.last - r.last / 22.046;   // both legs in ¢/lb
  }

  const sprdColor = (n: number | null | undefined) =>
    n == null ? "text-slate-600" : n >= 0 ? "text-sky-400" : "text-orange-400";
  const chgColor = (n: number | null | undefined) =>
    n == null ? "text-slate-600" : chgTone(n);
  const signed = (n: number | null | undefined, dec: number) =>
    n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(dec);

  // Column fields for one market, ordered CENTER → OUTER. The row is perfectly
  // symmetric around the single central ¢/lb arbitrage column: the RC (right)
  // side renders these in order, the KC (left) side in reverse. The contract
  // code is each side's innermost field, so the two codes flank the arbitrage
  // (arabica just left, robusta just right). Compact stops at SpΔ; the extras
  // (FND, Exp, OI, Vol) appear only when expanded.
  const fields: Array<{
    head: string; extra?: boolean; center?: boolean;
    cell: (leg: Leg | undefined, dec: number, isFront: boolean, accent: string, key: string) => React.ReactNode;
  }> = [
    { head: "Ct", center: true, cell: (l, _d, _f, _a, key) => <td className="px-0.5 py-1 text-center font-bold whitespace-nowrap">{l ? key : ""}</td> },
    { head: "FND", extra: true, center: true, cell: (l) => <td className="px-0.5 py-1 text-center text-amber-400/70 whitespace-nowrap">{l ? l.fnd : ""}</td> },
    { head: "Exp", extra: true, center: true, cell: (l) => <td className="px-0.5 py-1 text-center text-slate-500 whitespace-nowrap">{l ? l.exp : ""}</td> },
    { head: "Last", cell: (l, dec, isFront, accent) => <td className={`px-0.5 py-1 text-right font-bold whitespace-nowrap ${isFront ? accent : ""}`}>{l ? fmt(l.last, dec) : ""}</td> },
    { head: "Δ",   cell: (l, dec) => <td className={`px-0.5 py-1 text-right whitespace-nowrap ${chgColor(l?.change)}`}>{l ? signed(l.change, dec) : ""}</td> },
    { head: "Sp",  cell: (l, dec) => <td className={`px-0.5 py-1 text-right whitespace-nowrap ${sprdColor(l?.spread)}`}>{l ? signed(l.spread, dec) : ""}</td> },
    { head: "SpΔ", cell: (l, dec) => <td className={`px-0.5 py-1 text-right whitespace-nowrap ${sprdColor(l?.spreadChg)}`}>{l ? signed(l.spreadChg, dec) : ""}</td> },
    { head: "OI",  extra: true, cell: (l) => <td className="px-0.5 py-1 text-right whitespace-nowrap text-slate-400">{l ? fmt(l.oi) : ""}</td> },
    { head: "Vol", extra: true, cell: (l) => <td className="px-0.5 py-1 text-right whitespace-nowrap text-slate-400">{l ? fmt(l.vol) : ""}</td> },
  ];
  const active   = fields.filter(f => showMore || !f.extra);   // RC (right), center→outer
  const kcFields = active.slice().reverse();                    // KC (left) mirrors RC

  const headCell = (f: { head: string; center?: boolean }, side: string, i: number) => (
    <th key={`${side}-${i}`} className={`px-0.5 py-1 font-normal ${f.center ? "text-center" : "text-right"}`}>
      {/* The code column is labelled by exchange: NY (arabica) / LD (robusta). */}
      {f.head === "Ct" ? (side === "kc" ? "NY" : "LD") : f.head}
    </th>
  );

  return (
    <div className="lg:hidden bg-slate-900 border border-slate-700 rounded-lg overflow-x-auto">
      <div className="px-2 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white whitespace-nowrap">
          Live Quotes · <span className="text-amber-400">KC</span> <span className="text-slate-500">/</span> <span className="text-emerald-400">RC</span>
        </span>
        <button
          onClick={() => setShowMore(v => !v)}
          className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1 border border-slate-600 rounded px-1.5 py-0.5"
          aria-expanded={showMore}
        >
          {showMore ? "Less" : "More"}<span className="text-[8px]">{showMore ? "◀" : "▶"}</span>
        </button>
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            {kcFields.map((f, i) => headCell(f, "kc", i))}
            <th className="px-0.5 py-1 text-center text-sky-300 font-normal">¢/lb</th>
            {active.map((f, i) => headCell(f, "rc", i))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key, idx) => {
            const k = kc.get(key), r = rc.get(key);
            const arb = arbSpread(key);
            const isFront = idx === 0;
            return (
              <tr key={key} className={`border-t border-slate-700 ${isFront ? "text-white bg-slate-800/60" : "text-slate-300"}`}>
                {kcFields.map((f, i) => <React.Fragment key={`kc-${i}`}>{f.cell(k, 2, isFront, "text-amber-400", key)}</React.Fragment>)}
                <td className={`px-0.5 py-1 text-center font-semibold whitespace-nowrap ${isFront ? "text-sky-300" : "text-sky-400/70"}`}>
                  {arb != null ? arb.toFixed(1) : "—"}
                </td>
                {active.map((f, i) => <React.Fragment key={`rc-${i}`}>{f.cell(r, 0, isFront, "text-amber-400", key)}</React.Fragment>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Chain table (matches Daily Quotes columns exactly) ────────────────────────

function ChainTable({
  title, contracts, unit, accent, isArabica,
}: {
  title: string;
  contracts: AcapheContract[];
  unit: string;
  accent: string;
  isArabica: boolean;
}) {
  if (!contracts.length) return null;
  const dec = isArabica ? 2 : 0;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-2 sm:px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between min-h-[40px]">
        <div className="truncate">
          <span className="font-semibold text-sm text-white hidden sm:inline">Live Quotes</span>
          {/* Phone: just the short market name; wider: the full ICE sublabel. */}
          <span className={`text-xs sm:ml-2 font-semibold ${accent}`}>
            <span className="sm:hidden">{isArabica ? "Arabica" : "Robusta"}</span>
            <span className="hidden sm:inline font-normal">{title}</span>
          </span>
        </div>
      </div>

      <table className="w-full text-[10px] sm:text-[11px] font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            {/* On phones the three panels sit side-by-side (like desktop), so
                only the essentials stay: Ct · Last · Chg. Secondary columns
                progressively reappear as the viewport widens. */}
            <th className="text-left   px-1 sm:px-1.5 py-1 w-10  whitespace-nowrap">Ct.</th>
            <th className="text-center px-1 sm:px-1.5 py-1 w-14  whitespace-nowrap hidden md:table-cell">FND</th>
            <th className="text-center px-1 sm:px-1.5 py-1 w-11  whitespace-nowrap hidden lg:table-cell">Exp.</th>
            <th className="text-right  px-1 sm:px-1.5 py-1        whitespace-nowrap">Last<span className="hidden sm:inline"> ({unit})</span></th>
            <th className="text-right  px-1 sm:px-1.5 py-1 whitespace-nowrap">Chg</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap hidden sm:table-cell">Sprd</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap hidden lg:table-cell">Sprd Chg</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap hidden lg:table-cell">OI</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap hidden lg:table-cell">Vol</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c, i) => {
            const sym      = acapheToSymbol(c.month, isArabica);
            const fnd      = calcFnd(sym);
            const expiry   = calcOptLtd(sym);
            const chgColor = chgTone((c.change ?? 0));

            const next      = contracts[i + 1];
            const spread    = c.last != null && next?.last != null ? c.last - next.last : null;
            const spreadChg = c.change != null && next?.change != null ? c.change - next.change : null;
            const sprdColor = (n: number | null) =>
              n == null ? "text-slate-600" : n >= 0 ? "text-sky-400" : "text-orange-400";

            const isFront = i === 0;

            return (
              <tr
                key={c.month}
                className={`border-t border-slate-700 ${isFront ? "text-white bg-slate-800/60" : "text-slate-300"}`}
              >
                <td className="px-1 sm:px-1.5 py-1.5 font-bold whitespace-nowrap">{sym}</td>
                <td className="px-1 sm:px-1.5 py-1.5 text-center text-amber-400/80 whitespace-nowrap hidden md:table-cell">{fnd}</td>
                <td className="px-1 sm:px-1.5 py-1.5 text-center text-slate-500 whitespace-nowrap hidden lg:table-cell">{expiry}</td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-right font-bold ${isFront ? accent : ""}`}>
                  {fmt(c.last, dec)}
                </td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-right ${chgColor}`}>
                  {(c.change >= 0 ? "+" : "")}{c.change.toFixed(dec)}
                </td>
                <td className={`px-1.5 py-1.5 text-right hidden sm:table-cell ${sprdColor(spread)}`}>
                  {spread != null ? (spread >= 0 ? "+" : "") + spread.toFixed(dec) : "—"}
                </td>
                <td className={`px-1.5 py-1.5 text-right hidden lg:table-cell ${sprdColor(spreadChg)}`}>
                  {spreadChg != null ? (spreadChg >= 0 ? "+" : "") + spreadChg.toFixed(dec) : "—"}
                </td>
                <td className="px-1.5 py-1.5 text-right hidden lg:table-cell">{fmt(c.oi)}</td>
                <td className="px-1.5 py-1.5 text-right text-slate-400 hidden lg:table-cell">{fmt(c.vol)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Vietnam local prices ───────────────────────────────────────────────────────

interface VietnamPricesWithMeta extends VietnamPrices {
  saved_at?: string;
}

function VietnamPanel({ data }: { data: VietnamPrices }) {
  const [last, setLast] = React.useState<VietnamPricesWithMeta | null>(null);

  const isLive = !!(data.bmt_bid || data.hcm_bid);

  React.useEffect(() => {
    if (!isLive) {
      fetch("/api/vietnam-last")
        .then(r => r.ok ? r.json() : null)
        .then(d => d && !d.error && setLast(d))
        .catch(() => {
          // Redis unavailable — fall back to static snapshot
          fetch("/data/vietnam_last.json")
            .then(r => r.ok ? r.json() : null)
            .then(d => d && setLast(d))
            .catch(() => {});
        });
    }
  }, [isLive]);

  const display: VietnamPricesWithMeta = isLive ? data : (last ?? data);
  const isStale = !isLive && !!last;

  const items = [
    { label: "BMT Bid",      val: display.bmt_bid,                          unit: "VND/kg",     color: "text-white"       },
    { label: "BMT Offer",    val: display.bmt_offer,                        unit: "VND/kg",     color: "text-amber-400"   },
    { label: "HCM Bid",      val: display.hcm_bid,                          unit: "VND/kg",     color: "text-white"       },
    { label: "HCM Offer",    val: display.hcm_offer,                        unit: "VND/kg",     color: "text-amber-400"   },
    { label: "R2 FOB Bid",   val: display.r2_fob_bid,                       unit: "vs ICE LDN", color: "text-emerald-400" },
    { label: "R2 FOB Offer", val: display.r2_fob_offer,                     unit: "vs ICE LDN", color: "text-emerald-400" },
    { label: "USD/VND",      val: display.usd_vnd?.toLocaleString() ?? null, unit: "VCB rate",  color: "text-sky-400"     },
    ...(display.pepper_faq ? [{ label: "Pepper FAQ", val: display.pepper_faq, unit: "VND/kg", color: "text-slate-300" }] : []),
  ];

  // Rendered in UTC with the zone in the text. The bare toLocaleString this
  // replaced printed the visitor's browser zone with no label — "19:23" meant
  // three different instants to readers in Santos, London and Saigon.
  const savedAt = last?.saved_at ? fmtStampUTC(last.saved_at) : null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
        Vietnam Local Prices
        {display.local_time && <span className="text-slate-600 normal-case font-normal">{display.local_time}</span>}
        {isStale && savedAt && (
          <span className="text-amber-600 normal-case font-normal">· last seen {savedAt}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-4 gap-y-3 text-xs font-mono">
        {items.map(({ label, val, unit, color }) => (
          <div key={label}>
            <div className="text-slate-500 mb-0.5">{label}</div>
            <div className={`font-bold ${isStale ? "opacity-60" : ""} ${color}`}>{val ?? "—"}</div>
            <div className="text-[10px] text-slate-600">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export default function AcapheLiveQuotes() {
  const [data,        setData]        = useState<AcapheLiveData | null>(null);
  const [ago,         setAgo]         = useState<number | null>(null);
  const [error,       setError]       = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  // null = no message; "ok" / "stale" / "fail" drive a small toast under the
  // status bar. Auto-clears after 10s so it never lingers.
  const [refreshMsg,  setRefreshMsg]  = useState<null | "triggered" | "noop" | "fail">(null);

  const load = () => {
    // Try live Redis-backed endpoint first; fall back to static snapshot
    fetch("/api/live")
      .then((r) => { if (!r.ok) throw new Error("live"); return r.json(); })
      .then((d: AcapheLiveData & { error?: string }) => {
        if (d.error) throw new Error("live");
        setData(d); setAgo(secsAgo(d.fetched_at)); setError(false);
      })
      .catch(() =>
        fetch(`/data/acaphe_live.json?_=${Date.now()}`)
          .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
          .then((d: AcapheLiveData) => { setData(d); setAgo(secsAgo(d.fetched_at)); setError(false); })
          .catch(() => setError(true))
      );
  };

  // Manually trigger the GH Actions Acaphe poller, then poll /api/live a few
  // times over the next ~90s to pick up the fresh snapshot the workflow
  // writes to Redis. The button stays disabled while refreshing so a user
  // can't queue up duplicate dispatches.
  const triggerRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    let triggered = false;
    try {
      const r = await fetch("/api/refresh-acaphe", { method: "POST" });
      triggered = r.ok;
      setRefreshMsg(r.ok ? "triggered" : (r.status === 503 ? "noop" : "fail"));
    } catch {
      setRefreshMsg("fail");
    }
    // Always re-fetch immediately so the button has visible effect even if
    // the dispatch failed (e.g. token not configured → still pick up the
    // latest Redis snapshot in case the cron just landed).
    load();
    // If we actually kicked off a poll, sample for fresh data while it runs.
    // Spaced to cover the ~60–90s end-to-end runtime without spamming Redis.
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (triggered) {
      [25_000, 45_000, 70_000, 95_000].forEach(ms => {
        timers.push(setTimeout(load, ms));
      });
    }
    timers.push(setTimeout(() => setRefreshing(false), triggered ? 95_000 : 1_500));
    timers.push(setTimeout(() => setRefreshMsg(null), 10_000));
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setAgo((p) => (p != null ? p + 10 : p)), 10_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  if (error && !data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center">
        <p className="text-slate-400 text-sm mb-2">Live quotes not available.</p>
        <p className="text-slate-600 text-xs font-mono">python backend/scraper/acaphe_poller.py</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-800 rounded w-72" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-44 bg-slate-800 rounded-lg" />
          <div className="h-44 bg-slate-800 rounded-lg" />
        </div>
        <div className="h-24 bg-slate-800 rounded-lg" />
      </div>
    );
  }

  const isStale = ago != null && ago > 120;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className={`font-bold ${isStale ? "text-yellow-500" : "text-emerald-400"}`}>●</span>
          <span className="text-slate-400">acaphe.com</span>
          <span className="text-slate-600">{data.now_time}</span>
        </div>
        <div className="flex items-center gap-3 text-slate-600">
          {ago != null && (
            <span className={isStale ? "text-yellow-500" : ""}>
              {ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`}
            </span>
          )}
          <button
            type="button"
            onClick={triggerRefresh}
            disabled={refreshing}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 transition-colors ${
              refreshing
                ? "text-slate-500 cursor-not-allowed"
                : "text-slate-300 hover:bg-slate-800 hover:border-slate-600 cursor-pointer"
            }`}
            title="Trigger a manual Acaphe poll (takes ~60–90s)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {refreshMsg && (
        <div
          className={`text-[10px] font-mono px-2 py-1 rounded border ${
            refreshMsg === "triggered"
              ? "text-emerald-400 border-emerald-700/50 bg-emerald-900/20"
              : refreshMsg === "noop"
                ? "text-amber-400 border-amber-700/50 bg-amber-900/20"
                : "text-red-400 border-red-700/50 bg-red-900/20"
          }`}
        >
          {refreshMsg === "triggered"
            ? "Poller triggered. Fresh quotes in ~60–90s."
            : refreshMsg === "noop"
              ? "Refresh endpoint not configured (set GH_DISPATCH_TOKEN on Vercel). Re-fetched cached data instead."
              : "Refresh failed. Check Vercel function logs."}
        </div>
      )}

      {/* Phone: one merged month-keyed table (Arabica · Arb · Robusta) with a
          More/Less toggle for the secondary columns. */}
      <MergedPhoneQuotes arabica={data.arabica} robusta={data.robusta} />

      {/* Desktop (lg+): the three panels side-by-side. */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <ChainTable title="ICE NY · Arabica (KC)"     contracts={data.arabica} unit="¢/lb" accent="text-amber-400"   isArabica={true}  />
        <RatioColumn arabica={data.arabica} robusta={data.robusta} />
        <ChainTable title="ICE London · Robusta (RC)" contracts={data.robusta} unit="$/t"  accent="text-emerald-400" isArabica={false} />
      </div>

      {/* Vietnam local prices */}
      {data.vietnam && <VietnamPanel data={data.vietnam} />}
    </div>
  );
}
