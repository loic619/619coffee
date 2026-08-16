"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Bar, Cell, LabelList, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from "recharts";

import { fmtDateLabel } from "@/lib/formatters";

// options_oi.json — daily Barchart boards for the nearest live KC/RM option
// expiries. Newer files carry {contracts: [...]} per market and per-contract
// history arrays; the first snapshots were single-contract objects, so both
// shapes are normalised below.
interface StrikeRow {
  strike: number; call_oi: number; put_oi: number; call_vol: number; put_vol: number;
  call_chg?: number | null; put_chg?: number | null;      // ΔOI vs prior session
  call_iv?: number | null; put_iv?: number | null;        // Black-76 / Barchart IV
  call_delta?: number | null; put_delta?: number | null;
  call_gamma?: number | null; put_gamma?: number | null;
  call_theta?: number | null; put_theta?: number | null;
  call_vega?: number | null; put_vega?: number | null;
}
interface MarketSnap {
  underlying: string;
  future_price: number | null;
  option_expiry?: string | null;
  days_to_expiry?: number | null;
  strikes: StrikeRow[];
  totals: { call_oi: number; put_oi: number; itm_call_oi: number; itm_put_oi: number };
}
interface HistEntry {
  underlying: string; future_price: number | null; days_to_expiry: number | null;
  // null = that session's final OI isn't published yet (arrives next run)
  call_oi: number | null; put_oi: number | null;
  itm_call_oi: number | null; itm_put_oi: number | null;
  fut_oi?: number | null;                                 // the underlying future's OI
  atm_iv?: number | null;                                 // at-the-money IV that day
}
interface HistRow {
  date: string;
  arabica?: HistEntry | HistEntry[];
  robusta?: HistEntry | HistEntry[];
}
type MarketBlock = { contracts?: MarketSnap[] } & Partial<MarketSnap>;
interface OptionsDoc {
  updated?: string;
  markets?: { arabica?: MarketBlock; robusta?: MarketBlock };
  history?: HistRow[];
}
// options_strike_history.json — per-strike OI matrix (published sessions only)
// feeding the date/period selector on the board.
interface StrikeHist {
  dates: string[]; strikes: number[];
  call: (number | null)[][]; put: (number | null)[][];
}
interface StrikeHistDoc {
  markets?: { arabica?: Record<string, StrikeHist>; robusta?: Record<string, StrikeHist> };
}

// KCZ26 → "Z26" — the chip label; the root repeats the market toggle.
const shortSym = (sym: string) => sym.replace(/^[A-Z]{2,3}(?=[FGHJKMNQUVXZ]\d{2}$)/, "");

// Mon–Fri sessions between two ISO dates (trading-day countdown, like the
// OI-to-FND chart's day axis).
const busDaysTo = (from: string, to: string): number => {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (!(a < b)) return 0;
  let n = 0;
  for (const t = new Date(a); t < b; t.setUTCDate(t.getUTCDate() + 1)) {
    const w = t.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
};

const COUNTDOWN_WINDOW = 45;   // sessions before expiry shown on the countdown

// Report section header — the page reads as a story: positioning → greeks
// pressure → volatility → expiry.
function Section({ t, c }: { t: string; c: string }) {
  return (
    <div className="lg:col-span-2 mt-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">{t}</h3>
      <p className="text-[10px] text-slate-500 max-w-3xl">{c}</p>
    </div>
  );
}

type Mkt = "arabica" | "robusta";
const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const UNIT: Record<Mkt, string> = { arabica: "¢/lb", robusta: "$/MT" };

export default function OptionsOIPanel() {
  const [doc, setDoc] = useState<OptionsDoc | null>(null);
  const [shist, setShist] = useState<StrikeHistDoc | null>(null);
  const [mkt, setMkt] = useState<Mkt>("arabica");
  const [sel, setSel] = useState<string | null>(null);   // selected underlying
  const [boardMode, setBoardMode] = useState<"oi" | "chg" | "iv">("oi");
  // Board date selection: null/null = latest session vs previous (default).
  // dateTo picks a session; dateFrom makes it an explicit period start.
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/options_oi.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setDoc(d); })
      .catch(() => { /* renders the accumulating note */ });
    fetch("/data/options_strike_history.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setShist(d); })
      .catch(() => { /* selector simply stays hidden */ });
  }, []);

  // Nearest-first list of live option boards for the active market.
  const contracts = useMemo<MarketSnap[]>(() => {
    const block = doc?.markets?.[mkt];
    if (!block) return [];
    if (Array.isArray(block.contracts)) return block.contracts;
    return block.underlying && block.strikes ? [block as MarketSnap] : [];
  }, [doc, mkt]);

  // Default to the FRONT (nearest expiry); an explicit pick sticks while it
  // exists, and falls back to the front when the market/file changes.
  const snap = useMemo(
    () => contracts.find(c => c.underlying === sel) ?? contracts[0] ?? null,
    [contracts, sel]
  );

  // Per-strike OI history matrix for the selected contract (published
  // sessions only) — powers the date/period selector.
  const hist = useMemo<StrikeHist | null>(
    () => (snap ? shist?.markets?.[mkt]?.[snap.underlying] ?? null : null),
    [shist, mkt, snap]
  );
  const idxTo = hist ? (dateTo ? hist.dates.indexOf(dateTo) : hist.dates.length - 1) : -1;
  const idxFrom = hist && idxTo >= 0
    ? (dateFrom ? hist.dates.indexOf(dateFrom) : idxTo - 1) : -1;
  const isPeriod = dateFrom != null && idxFrom >= 0;
  // custom = the user moved off the default (latest vs previous) view
  const custom = (dateTo != null || dateFrom != null) && idxTo >= 0;
  const dateToEff = hist && idxTo >= 0 ? hist.dates[idxTo] : null;
  const dateFromEff = hist && idxFrom >= 0 ? hist.dates[idxFrom] : null;

  // Per-strike board, trimmed to strikes near the money (±35% of the future)
  // so tails don't squash the structure. Three views over the same strikes:
  //   oi  — open interest, calls up / puts down (mirrored); with a period
  //         selected, faded bars show the period-start session
  //   chg — ΔOI: latest vs previous session by default, or across the
  //         selected date/period
  //   iv  — implied vol per strike (the smile), calls and puts as lines
  type BoardRow = { strike: number; calls?: number; puts?: number;
                    callsFrom?: number; putsFrom?: number;
                    callIv?: number | null; putIv?: number | null };
  const board = useMemo<BoardRow[]>(() => {
    if (!snap?.strikes?.length) return [];
    const px = snap.future_price ?? undefined;
    const nearK = (k: number) => !px || (k > px * 0.65 && k < px * 1.35);
    if (custom && hist && boardMode !== "iv") {
      const rows: BoardRow[] = [];
      hist.strikes.forEach((k, i) => {
        if (!nearK(k)) return;
        const cTo = hist.call[idxTo]?.[i] ?? 0, pTo = hist.put[idxTo]?.[i] ?? 0;
        const cFrom = idxFrom >= 0 ? hist.call[idxFrom]?.[i] ?? 0 : 0;
        const pFrom = idxFrom >= 0 ? hist.put[idxFrom]?.[i] ?? 0 : 0;
        if (boardMode === "chg") {
          if (idxFrom < 0) return;
          if (cTo - cFrom || pTo - pFrom) {
            rows.push({ strike: k, calls: cTo - cFrom, puts: -(pTo - pFrom) });
          }
        } else if (cTo + pTo > 0 || (isPeriod && cFrom + pFrom > 0)) {
          rows.push({ strike: k, calls: cTo, puts: -pTo,
                      ...(isPeriod ? { callsFrom: cFrom, putsFrom: -pFrom } : {}) });
        }
      });
      return rows;
    }
    const near = snap.strikes.filter(s => nearK(s.strike));
    if (boardMode === "chg") {
      return near
        .filter(s => s.call_chg != null || s.put_chg != null)
        .map(s => ({ strike: s.strike, calls: s.call_chg ?? 0, puts: -(s.put_chg ?? 0) }));
    }
    if (boardMode === "iv") {
      return near
        .filter(s => s.call_iv != null || s.put_iv != null)
        .map(s => ({ strike: s.strike,
                     callIv: s.call_iv != null ? s.call_iv * 100 : null,
                     putIv: s.put_iv != null ? s.put_iv * 100 : null }));
    }
    return near
      .filter(s => (s.call_oi || 0) + (s.put_oi || 0) > 0)
      .map(s => ({ strike: s.strike, calls: s.call_oi, puts: -s.put_oi }));
  }, [snap, boardMode, custom, hist, idxTo, idxFrom, isPeriod]);

  // Expiry countdown for the SELECTED contract: one row per session, ITM vs
  // total OI. Legacy rows carried a single object; normalise to an array.
  const countdown = useMemo(() => {
    const want = snap?.underlying;
    if (!want) return [];
    return (doc?.history ?? [])
      .map(r => {
        const raw = r[mkt];
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const m = arr.find(e => e.underlying === want);
        if (!m) return null;
        const oiKnown = m.call_oi != null || m.put_oi != null;
        const expiry = snap?.option_expiry?.slice(0, 10);
        return {
          date: r.date, label: fmtDateLabel(r.date),
          // trading sessions to option expiry, as a negative countdown
          // (numeric + unique per session, so tooltips can't collide the way
          // repeated MM/DD category labels across years did)
          day: expiry ? -busDaysTo(r.date, expiry) : null,
          total: oiKnown ? (m.call_oi || 0) + (m.put_oi || 0) : null,
          itm: oiKnown ? (m.itm_call_oi || 0) + (m.itm_put_oi || 0) : null,
          itmCall: oiKnown ? m.itm_call_oi || 0 : null,
          itmPut: oiKnown ? m.itm_put_oi || 0 : null,
          futOi: m.fut_oi ?? null,
          pcRatio: oiKnown && (m.call_oi || 0) > 0
            ? Math.round(((m.put_oi || 0) / (m.call_oi || 1)) * 100) / 100 : null,
          dte: m.days_to_expiry,
          underlying: m.underlying,
          atmIv: m.atm_iv != null ? m.atm_iv * 100 : null,
          px: m.future_price,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [doc, mkt, snap]);

  // Countdown card shows only the final approach: [-45, 0] sessions to expiry.
  const countdownWindow = useMemo(
    () => countdown.filter(p => p.day != null && p.day >= -COUNTDOWN_WINDOW),
    [countdown]
  );

  const last = countdown.length ? countdown[countdown.length - 1] : null;
  // ITM share from the live board (the latest published OI), not the history
  // tail — whose newest session may not have its final OI yet.
  const itmShare = useMemo(() => {
    const t = snap ? snap.totals.call_oi + snap.totals.put_oi : 0;
    return t > 0 && snap ? ((snap.totals.itm_call_oi + snap.totals.itm_put_oi) / t) * 100 : null;
  }, [snap]);

  // Report analytics off the live board: P/C ratio, max pain, net delta of
  // the open book (long-holder convention), 25Δ risk reversal.
  const report = useMemo(() => {
    if (!snap?.strikes?.length) return null;
    const st = snap.strikes;
    const pc = snap.totals.call_oi > 0 ? snap.totals.put_oi / snap.totals.call_oi : null;
    // max pain: the settlement that minimises the total intrinsic payout
    let maxPain: number | null = null;
    let best = Infinity;
    for (const k of st) {
      let pay = 0;
      for (const s of st) {
        pay += (s.call_oi || 0) * Math.max(k.strike - s.strike, 0)
             + (s.put_oi || 0) * Math.max(s.strike - k.strike, 0);
      }
      if (pay < best) { best = pay; maxPain = k.strike; }
    }
    let netDelta = 0;
    let haveDelta = false;
    for (const s of st) {
      if (s.call_delta != null && s.call_oi) { netDelta += s.call_delta * s.call_oi; haveDelta = true; }
      if (s.put_delta != null && s.put_oi) { netDelta += s.put_delta * s.put_oi; haveDelta = true; }
    }
    const c25 = st.filter(s => s.call_delta != null && s.call_iv != null && (s.call_oi || s.call_delta! > 0.02))
      .sort((a, b) => Math.abs(a.call_delta! - 0.25) - Math.abs(b.call_delta! - 0.25))[0];
    const p25 = st.filter(s => s.put_delta != null && s.put_iv != null)
      .sort((a, b) => Math.abs(a.put_delta! + 0.25) - Math.abs(b.put_delta! + 0.25))[0];
    const rr = c25 && p25 ? (p25.put_iv! - c25.call_iv!) * 100 : null;
    return { pc, maxPain, netDelta: haveDelta ? netDelta : null, rr,
             c25K: c25?.strike, p25K: p25?.strike };
  }, [snap]);

  // Per-strike greeks maps (near the money): gamma exposure Γ·OI with the
  // naive calls-positive / puts-negative dealer convention, and net delta·OI.
  const greekProfiles = useMemo(() => {
    if (!snap?.strikes?.length) return { gex: [], dex: [] };
    const px = snap.future_price ?? undefined;
    const near = snap.strikes.filter(s => !px || (s.strike > px * 0.65 && s.strike < px * 1.35));
    const gex = near
      .map(s => ({ strike: s.strike,
                   gex: (s.call_gamma ?? 0) * (s.call_oi || 0)
                      - (s.put_gamma ?? 0) * (s.put_oi || 0) }))
      .filter(r => r.gex !== 0)
      .map(r => ({ ...r, gex: Math.round(r.gex) }));
    const dex = near
      .map(s => ({ strike: s.strike,
                   dex: (s.call_delta ?? 0) * (s.call_oi || 0)
                      + (s.put_delta ?? 0) * (s.put_oi || 0) }))
      .filter(r => r.dex !== 0)
      .map(r => ({ ...r, dex: Math.round(r.dex) }));
    return { gex, dex };
  }, [snap]);

  // Biggest per-strike ΔOI moves of the last published session.
  const movers = useMemo(() => {
    if (!snap?.strikes?.length) return [];
    const rows: { strike: number; side: "C" | "P"; chg: number }[] = [];
    for (const s of snap.strikes) {
      if (s.call_chg) rows.push({ strike: s.strike, side: "C", chg: s.call_chg });
      if (s.put_chg) rows.push({ strike: s.strike, side: "P", chg: s.put_chg });
    }
    return rows.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 8);
  }, [snap]);

  // ATM IV per listed contract → the term structure.
  const term = useMemo(() =>
    contracts.map(c => {
      const px = c.future_price;
      const s = px
        ? [...c.strikes]
            .filter(x => x.call_iv != null || x.put_iv != null)
            .sort((a, b) => Math.abs(a.strike - px) - Math.abs(b.strike - px))[0]
        : undefined;
      const ivs = s ? [s.call_iv, s.put_iv].filter((v): v is number => v != null) : [];
      return { sym: shortSym(c.underlying), dte: c.days_to_expiry ?? 0,
               iv: ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null };
    }).filter(t => t.iv != null && t.dte >= 0),
  [contracts]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Options Open Interest</h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Options boards of the nearest {mkt === "arabica" ? "NY arabica (KC)" : "London robusta (RM)"} futures
            — per-strike call/put open interest around the money, and the in-the-money share of that OI as
            option expiry approaches (delta-hedging / pin-risk pressure). Delayed Barchart data, one snapshot
            per session{doc?.updated ? ` · last ${doc.updated.slice(0, 10)}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["arabica", "robusta"] as Mkt[]).map(m => (
              <button key={m}
                onClick={() => { setMkt(m); setSel(null); setDateTo(null); setDateFrom(null); }}
                className={`px-2.5 py-1.5 transition ${mkt === m ? "bg-amber-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {m === "arabica" ? "Arabica" : "Robusta"}
              </button>
            ))}
          </div>
          {contracts.length > 1 && (
            <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
              {contracts.map(c => {
                const active = snap?.underlying === c.underlying;
                return (
                  <button key={c.underlying}
                    onClick={() => { setSel(c.underlying); setDateTo(null); setDateFrom(null); }}
                    title={`${c.underlying} — options expire ${c.option_expiry?.slice(0, 10) ?? "?"}`}
                    className={`px-2.5 py-1.5 transition font-mono ${active ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                    {shortSym(c.underlying)}
                    {c.days_to_expiry != null && (
                      <span className={active ? "text-sky-200" : "text-slate-500"}> {Math.round(c.days_to_expiry)}d</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {!snap ? (
        <div className="text-[11px] text-slate-500 italic">
          No options data yet — the board starts accumulating with the next daily OI snapshot.
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Underlying</div>
              <div className="text-base font-bold font-mono text-slate-100">{snap.underlying}</div>
              <div className="text-[10px] text-slate-400 font-mono">
                {snap.future_price != null ? `${snap.future_price.toLocaleString()} ${UNIT[mkt]}` : "—"}
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Option expiry</div>
              <div className="text-base font-bold font-mono text-amber-400">
                {snap.days_to_expiry != null ? `${Math.round(snap.days_to_expiry)}d` : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">{snap.option_expiry?.slice(0, 10) ?? ""}</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Total option OI</div>
              <div className="text-base font-bold font-mono text-slate-100">
                {(snap.totals.call_oi + snap.totals.put_oi).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                C {snap.totals.call_oi.toLocaleString()} · P {snap.totals.put_oi.toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">In the money</div>
              <div className={`text-base font-bold font-mono ${itmShare != null && itmShare > 50 ? "text-red-400" : "text-emerald-400"}`}>
                {itmShare != null ? `${itmShare.toFixed(1)}%` : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {(snap.totals.itm_call_oi + snap.totals.itm_put_oi).toLocaleString()} lots ITM
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Put / Call OI</div>
              <div className={`text-base font-bold font-mono ${report?.pc != null && report.pc > 1 ? "text-red-400" : "text-emerald-400"}`}>
                {report?.pc != null ? report.pc.toFixed(2) : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {report?.pc != null ? (report.pc > 1 ? "put-heavy book" : "call-heavy book") : ""}
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Max pain</div>
              <div className="text-base font-bold font-mono text-slate-100">
                {report?.maxPain != null ? report.maxPain.toLocaleString() : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {report?.maxPain != null && snap.future_price
                  ? `${(((report.maxPain - snap.future_price) / snap.future_price) * 100).toFixed(1)}% vs future`
                  : "min. intrinsic payout"}
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Net Δ of open book</div>
              <div className={`text-base font-bold font-mono ${report?.netDelta != null && report.netDelta < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {report?.netDelta != null
                  ? `${report.netDelta > 0 ? "+" : ""}${Math.round(report.netDelta).toLocaleString()}`
                  : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">futures-equiv lots (holder side)</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">25Δ risk reversal</div>
              <div className={`text-base font-bold font-mono ${report?.rr != null && report.rr > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {report?.rr != null ? `${report.rr > 0 ? "+" : ""}${report.rr.toFixed(1)} pts` : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {report?.rr != null
                  ? `${report.rr > 0 ? "puts over calls" : "calls over puts"}${report.p25K && report.c25K ? ` · ${report.p25K}P/${report.c25K}C` : ""}`
                  : "needs live IV + delta"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section t="1 · Positioning" c={
              "Where the open interest sits, how it moved last session, and how the " +
              "put/call balance has trended. Strike walls act as magnets and barriers into expiry."} />
            {/* Per-strike board */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                  {boardMode === "oi"
                    ? (isPeriod && custom
                        ? `OI per strike · ${fmtDateLabel(dateFromEff!)} (faded) vs ${fmtDateLabel(dateToEff!)}`
                        : custom ? `OI per strike · ${fmtDateLabel(dateToEff!)}`
                        : "OI per strike · calls up, puts down")
                    : boardMode === "chg"
                      ? (custom && dateFromEff && dateToEff
                          ? `ΔOI per strike · ${fmtDateLabel(dateFromEff)} → ${fmtDateLabel(dateToEff)}`
                          : "ΔOI per strike vs prior session")
                      : "Implied vol per strike (Black-76 from last premium)"}
                  {" · line = future"}
                </div>
                <div className="flex bg-slate-900 border border-slate-700 rounded overflow-hidden text-[9px]">
                  {([["oi", "OI"], ["chg", "Δ OI"], ["iv", "IV"]] as const).map(([m, label]) => (
                    <button key={m} onClick={() => setBoardMode(m)}
                      className={`px-2 py-1 transition ${boardMode === m ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Session / period selector — matrix-backed; hidden for the IV
                  smile, which only exists for the live board. */}
              {hist && hist.dates.length > 1 && boardMode !== "iv" && (
                <div className="flex items-center gap-1.5 mb-2 text-[9px] text-slate-500">
                  <span>from</span>
                  <select
                    value={dateFrom ?? "auto"}
                    onChange={e => setDateFrom(e.target.value === "auto" ? null : e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-300">
                    <option value="auto">prev session</option>
                    {hist.dates.filter(d => !dateToEff || d < dateToEff).slice().reverse().map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span>to</span>
                  <select
                    value={dateTo ?? "latest"}
                    onChange={e => {
                      const v = e.target.value === "latest" ? null : e.target.value;
                      setDateTo(v);
                      if (dateFrom && v && dateFrom >= v) setDateFrom(null);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-300">
                    <option value="latest">latest session</option>
                    {hist.dates.slice().reverse().map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {(dateTo != null || dateFrom != null) && (
                    <button onClick={() => { setDateTo(null); setDateFrom(null); }}
                      className="text-slate-400 hover:text-white border border-slate-700 rounded px-1.5 py-0.5">
                      reset
                    </button>
                  )}
                </div>
              )}
              <div className="h-64">
                {board.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    {boardMode === "chg"
                      ? "ΔOI needs a prior archived session — available from the next daily snapshot."
                      : boardMode === "iv"
                        ? "No arbitrage-consistent premiums to imply vol from on this board yet."
                        : "No open interest on this board."}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={board} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="strike" stroke="#64748b" tick={{ fontSize: 8 }}
                        type="number" domain={["dataMin", "dataMax"]} tickCount={9} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                        tickFormatter={(v: number) => boardMode === "iv"
                          ? `${v.toFixed(0)}%` : Math.abs(v).toLocaleString()} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        labelFormatter={(v) => `strike ${v} ${UNIT[mkt]}`}
                        formatter={(v) => typeof v === "number"
                          ? (boardMode === "iv" ? `${v.toFixed(1)}%`
                             : boardMode === "chg" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString()} lots`
                             : `${Math.abs(v).toLocaleString()} lots`)
                          : "—"} />
                      <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                      {boardMode !== "iv" && <ReferenceLine y={0} stroke="#475569" />}
                      {snap.future_price != null && (
                        <ReferenceLine x={snap.future_price} stroke="#e2e8f0" strokeDasharray="4 3"
                          label={{ value: "fut", fill: "#e2e8f0", fontSize: 9, position: "top" }} />
                      )}
                      {boardMode === "iv" ? (
                        <>
                          <Line type="monotone" dataKey="callIv" name="Call IV" stroke="#34d399"
                            strokeWidth={1.5} dot={{ r: 1.5 }} connectNulls />
                          <Line type="monotone" dataKey="putIv" name="Put IV" stroke="#f87171"
                            strokeWidth={1.5} dot={{ r: 1.5 }} connectNulls />
                        </>
                      ) : (
                        <>
                          {boardMode === "oi" && isPeriod && custom && (
                            <>
                              <Bar dataKey="callsFrom" name={`Calls ${fmtDateLabel(dateFromEff!)}`}
                                fill="#34d399" fillOpacity={0.3} />
                              <Bar dataKey="putsFrom" name={`Puts ${fmtDateLabel(dateFromEff!)}`}
                                fill="#f87171" fillOpacity={0.3} />
                            </>
                          )}
                          <Bar dataKey="calls" name={boardMode === "chg" ? "Δ Calls" : "Calls"}
                            fill="#34d399" fillOpacity={0.8} />
                          <Bar dataKey="puts" name={boardMode === "chg" ? "Δ Puts" : "Puts"}
                            fill="#f87171" fillOpacity={0.8} />
                        </>
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Session ΔOI movers — the flows behind the board */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                Biggest ΔOI moves · last published session
              </div>
              {movers.length === 0 ? (
                <div className="text-[11px] text-slate-500 italic pt-6 text-center">
                  No open-interest changes vs the prior session.
                </div>
              ) : (
                <div className="space-y-1">
                  {movers.map((m, i) => (
                    <div key={`${m.strike}-${m.side}`}
                      className="flex items-center justify-between text-[11px] font-mono border-b border-slate-700/50 pb-1">
                      <span className="text-slate-400">#{i + 1}</span>
                      <span className={m.side === "C" ? "text-emerald-400" : "text-red-400"}>
                        {m.strike.toLocaleString()} {m.side === "C" ? "Call" : "Put"}
                      </span>
                      <span className={m.chg > 0 ? "text-emerald-300" : "text-red-300"}>
                        {m.chg > 0 ? "+" : "−"}{Math.abs(m.chg).toLocaleString()} lots
                        <span className="text-slate-500"> {m.chg > 0 ? "build" : "unwind"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* P/C OI ratio through time */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                Put / Call OI ratio · {snap.underlying} — daily
              </div>
              <div className="h-56">
                {countdown.filter(c => c.pcRatio != null).length < 2 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    Accumulating — one point per archived session.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={countdown} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 8 }} minTickGap={26}
                        tickFormatter={(v: string) => fmtDateLabel(v)} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={36}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => v.toFixed(1)} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        formatter={(v) => typeof v === "number" ? v.toFixed(2) : "—"} />
                      <ReferenceLine y={1} stroke="#475569" strokeDasharray="4 3"
                        label={{ value: "1.0", fill: "#64748b", fontSize: 8, position: "left" }} />
                      <Line type="monotone" dataKey="pcRatio" name="P/C OI ratio"
                        stroke="#38bdf8" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <Section t="2 · Greeks pressure" c={
              "Gamma exposure (Γ·OI, calls positive / puts negative — the naive dealer book) maps " +
              "where hedging flows amplify or dampen moves; the net delta profile shows where " +
              "directional exposure concentrates."} />

            {/* Gamma exposure profile */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                Gamma exposure by strike · Δ-lots per 1pt move · line = future
              </div>
              <div className="h-56">
                {greekProfiles.gex.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    Needs live board greeks (delta/gamma from Barchart or Black-76).
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={greekProfiles.gex} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="strike" stroke="#64748b" tick={{ fontSize: 8 }}
                        type="number" domain={["dataMin", "dataMax"]} tickCount={9} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                        tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        labelFormatter={(v) => `strike ${v} ${UNIT[mkt]}`}
                        formatter={(v) => typeof v === "number"
                          ? `${v > 0 ? "+" : ""}${v.toLocaleString()} Δ-lots/pt` : "—"} />
                      <ReferenceLine y={0} stroke="#475569" />
                      {snap.future_price != null && (
                        <ReferenceLine x={snap.future_price} stroke="#e2e8f0" strokeDasharray="4 3"
                          label={{ value: "fut", fill: "#e2e8f0", fontSize: 9, position: "top" }} />
                      )}
                      <Bar dataKey="gex" name="Γ · OI">
                        {greekProfiles.gex.map(r => (
                          <Cell key={r.strike} fill={r.gex >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Net delta profile */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                Net delta by strike · futures-equiv lots (holder side) · line = future
              </div>
              <div className="h-56">
                {greekProfiles.dex.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    Needs live board greeks (delta from Barchart or Black-76).
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={greekProfiles.dex} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="strike" stroke="#64748b" tick={{ fontSize: 8 }}
                        type="number" domain={["dataMin", "dataMax"]} tickCount={9} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                        tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        labelFormatter={(v) => `strike ${v} ${UNIT[mkt]}`}
                        formatter={(v) => typeof v === "number"
                          ? `${v > 0 ? "+" : ""}${v.toLocaleString()} lots` : "—"} />
                      <ReferenceLine y={0} stroke="#475569" />
                      {snap.future_price != null && (
                        <ReferenceLine x={snap.future_price} stroke="#e2e8f0" strokeDasharray="4 3"
                          label={{ value: "fut", fill: "#e2e8f0", fontSize: 9, position: "top" }} />
                      )}
                      <Bar dataKey="dex" name="Δ · OI">
                        {greekProfiles.dex.map(r => (
                          <Cell key={r.strike} fill={r.dex >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <Section t="3 · Expiry & pin risk" c={
              "How much of the option book is in the money versus the futures interest it would " +
              "exercise into, over the final approach to expiry."} />

            {/* ITM countdown — last 45 sessions into option expiry, same day
                axis as the OI-to-FND chart. */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                ITM OI vs {snap.underlying} future OI · last {COUNTDOWN_WINDOW} sessions to expiry
                {last?.dte != null ? ` · ${Math.round(last.dte)}d left` : ""}
              </div>
              <div className="h-64">
                {countdownWindow.length < 2 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    {last?.day != null && last.day < -COUNTDOWN_WINDOW
                      ? `Countdown begins ${COUNTDOWN_WINDOW} sessions before expiry — ` +
                        `${snap.underlying} is still ${Math.abs(last.day)} sessions out.`
                      : "Accumulating — one point per session from the daily snapshot."}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={countdownWindow} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="day" type="number" domain={[-COUNTDOWN_WINDOW, 0]}
                        stroke="#64748b" tick={{ fontSize: 8 }} tickCount={10}
                        tickFormatter={(v: number) => `${v}`} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                        tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        labelFormatter={(l, payload) => {
                          const d = payload?.[0]?.payload?.date;
                          return `Day ${l} to expiry${d ? ` · ${d}` : ""}`;
                        }}
                        formatter={(v) => typeof v === "number" ? `${v.toLocaleString()} lots` : "—"} />
                      <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                      {/* stacked ITM split: calls + puts sum to total ITM OI */}
                      <Area type="monotone" dataKey="itmCall" name="ITM calls" stackId="itm"
                        stroke="#34d399" fill="#34d399" fillOpacity={0.45} strokeWidth={1} />
                      <Area type="monotone" dataKey="itmPut" name="ITM puts" stackId="itm"
                        stroke="#f87171" fill="#f87171" fillOpacity={0.45} strokeWidth={1} />
                      <Line type="monotone" dataKey="futOi" name={`${snap.underlying} future OI`}
                        stroke="#e2e8f0" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <Section t="4 · Volatility" c={
              "The level (ATM IV through time), the smile (per-strike IV on the board above), " +
              "the skew (25Δ risk reversal in the header), and the term structure across expiries."} />

            {/* ATM implied vol history — the day-by-day at-the-money IV of the
                selected board (Black-76 from the archived last premiums), with
                the underlying future for context. */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 lg:col-span-2">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                ATM implied vol · {snap.underlying} — daily, from the boards archive
              </div>
              <div className="h-56">
                {countdown.filter(c => c.atmIv != null).length < 2 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    Accumulating — ATM IV is recorded with each archived session.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={countdown} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      {/* keyed by full ISO date: MM/DD labels repeat across
                          years and made tooltips hit the wrong year's point */}
                      <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 8 }} minTickGap={26}
                        tickFormatter={(v: string) => fmtDateLabel(v)} />
                      <YAxis yAxisId="iv" stroke="#a78bfa" tick={{ fontSize: 8 }} width={40}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                      <YAxis yAxisId="px" orientation="right" stroke="#64748b" tick={{ fontSize: 8 }}
                        width={44} domain={["auto", "auto"]}
                        tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        formatter={(v, name) => typeof v === "number"
                          ? (name === "ATM IV" ? `${v.toFixed(1)}%` : `${v.toLocaleString()} ${UNIT[mkt]}`)
                          : "—"} />
                      <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                      <Line yAxisId="px" type="monotone" dataKey="px" name="Future"
                        stroke="#475569" strokeWidth={1} dot={false} connectNulls />
                      <Line yAxisId="iv" type="monotone" dataKey="atmIv" name="ATM IV"
                        stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* IV term structure — ATM IV across the listed expiries */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
                IV term structure · ATM vol per expiry
              </div>
              <div className="h-56">
                {term.length < 2 ? (
                  <div className="text-[11px] text-slate-500 italic pt-8 text-center">
                    Needs ATM IV on at least two listed expiries.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={term} margin={{ top: 14, right: 16, left: -6, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis dataKey="dte" type="number" domain={[0, "dataMax"]}
                        stroke="#64748b" tick={{ fontSize: 8 }}
                        tickFormatter={(v: number) => `${v}d`} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={40}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                      <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                        labelFormatter={(v, payload) =>
                          `${payload?.[0]?.payload?.sym ?? ""} · ${v}d to expiry`}
                        formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"} />
                      <Line type="monotone" dataKey="iv" name="ATM IV"
                        stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 3 }}>
                        <LabelList dataKey="sym" position="top"
                          style={{ fill: "#94a3b8", fontSize: 9 }} />
                      </Line>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
