"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";

import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { fmtDateLabel, chgTone } from "@/lib/formatters";

// tradespread.json — one row per trading session, built from acaphe's traded
// tape (fetch_tradespread.py). Volumes are LOTS; "lifted" = tick-rule
// buyer-initiated (uptick), "hit" = seller-initiated (downtick).
interface TapeContract {
  label: string; market: "arabica" | "robusta";
  n_trades: number; total_volume: number;
  first_tick: { time: string; price: number };
  open15: { time: string; price: number };
  last: { time: string; price: number };
  up_trades: number; down_trades: number;
  up_volume: number; down_volume: number; unclassified_volume: number;
  vwap_up: number | null; vwap_down: number | null;
  pressure: number | null;
}
interface TapeSpread {
  leg_a: string; leg_b: string | null; market: string;
  volume?: number; matched_seconds?: number;
  panel_prints?: number; last_level?: number | null;
  min_level?: number | null; max_level?: number | null;
}
interface TapeRow { date: string; contracts: Record<string, TapeContract>; spreads: TapeSpread[] }
interface TapeDoc { updated?: string; history?: TapeRow[] }

type Mkt = "arabica" | "robusta";
const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const UNIT: Record<Mkt, string> = { arabica: "¢/lb", robusta: "$/MT" };
const fmtLots = (v: number) => v.toLocaleString();

/** One market column: flow split per contract, aggression premium, spreads. */
function MarketTape({ mkt, row, history }: { mkt: Mkt; row: TapeRow; history: TapeRow[] }) {
  const contracts = useMemo(
    () => Object.values(row.contracts).filter(c => c.market === mkt),
    [row, mkt]
  );
  // Front contract = the one whose tape starts first and trades most; acaphe
  // lists them nearest-first, so the first entry is the front.
  const front = contracts[0];

  // diverging bars: lifted up, hit down (mirrored), per contract
  const flow = useMemo(
    () => contracts.map(c => ({
      name: c.label.replace(/^(Robusta|Arabica)\s*/, ""),
      lifted: c.up_volume, hit: -c.down_volume,
      trades: `${c.up_trades}/${c.down_trades}`,
    })),
    [contracts]
  );

  // pressure through time for the front contract (matched by label)
  const trend = useMemo(() => history.map(h => {
    const c = front ? h.contracts[front.label] : undefined;
    return {
      date: h.date,
      pressure: c?.pressure ?? null,
      premium: c && c.vwap_up != null && c.vwap_down != null
        ? Number((c.vwap_up - c.vwap_down).toFixed(4)) : null,
    };
  }), [history, front]);

  const spreads = row.spreads.filter(s => s.market === mkt && s.leg_b);

  if (!contracts.length) {
    return (
      <div className="space-y-2 min-w-0">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-amber-400 border-b border-slate-700 pb-1.5">
          {mkt === "arabica" ? "Arabica · NY (KC)" : "Robusta · London (RM)"}
        </h3>
        <div className="text-[11px] text-slate-500 italic py-4">No tape for this session.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-amber-400 border-b border-slate-700 pb-1.5 h-7 truncate">
        {mkt === "arabica" ? "Arabica · NY (KC)" : "Robusta · London (RM)"}
      </h3>

      {/* Per-contract session facts */}
      <div className="space-y-1.5">
        {contracts.map(c => {
          const prem = c.vwap_up != null && c.vwap_down != null ? c.vwap_up - c.vwap_down : null;
          const pct = c.total_volume
            ? (c.up_volume / (c.up_volume + c.down_volume || 1)) * 100 : 50;
          return (
            <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-2.5">
              <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono whitespace-nowrap">
                <span className="text-slate-200 font-bold truncate">{c.label}</span>
                <span className="text-slate-400">
                  {c.n_trades} trades · {fmtLots(c.total_volume)} lots
                </span>
              </div>
              {/* lifted / hit split bar */}
              <div className="mt-1.5 h-2 w-full rounded overflow-hidden flex bg-slate-900">
                <div className="bg-emerald-500/80 h-full" style={{ width: `${pct}%` }} />
                <div className="bg-red-500/80 h-full" style={{ width: `${100 - pct}%` }} />
              </div>
              <div className="flex items-center justify-between gap-1 mt-1 text-[9px] font-mono whitespace-nowrap">
                <span className="text-emerald-400">↑ {fmtLots(c.up_volume)} lifted</span>
                <span className={`${chgTone((c.pressure ?? 0))}`}>
                  {c.pressure != null ? `${c.pressure > 0 ? "+" : ""}${(c.pressure * 100).toFixed(0)}%` : "—"}
                </span>
                <span className="text-red-400">{fmtLots(c.down_volume)} hit ↓</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px] font-mono text-slate-500">
                <span>open {c.first_tick.price} <span className="text-slate-600">{c.first_tick.time}</span></span>
                <span className="text-right">+15m {c.open15.price}</span>
                <span>VWAP↑ {c.vwap_up ?? "—"}</span>
                <span className="text-right">VWAP↓ {c.vwap_down ?? "—"}</span>
                <span className={`col-span-2 ${prem != null && chgTone(prem)}`}>
                  aggression premium {prem != null
                    ? `${prem > 0 ? "+" : ""}${prem.toFixed(2)} ${UNIT[mkt]}`
                    : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lifted vs hit, per contract */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Lots lifted vs hit · by contract
        </div>
        <div className="h-44">
          <ResponsiveContainer focusTitle={`${mkt} · lots lifted vs hit`} width="100%" height="100%">
            <ComposedChart data={flow} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                tickFormatter={(v: number) => Math.abs(v).toLocaleString()} />
              <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v) => typeof v === "number" ? `${Math.abs(v).toLocaleString()} lots` : "—"} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="lifted" name="Lifted (buyer)" fill="#34d399" fillOpacity={0.85} />
              <Bar dataKey="hit" name="Hit (seller)" fill="#f87171" fillOpacity={0.85} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pressure history */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Buy pressure · {front?.label ?? "front"} — daily
        </div>
        <div className="h-44">
          {trend.filter(t => t.pressure != null).length < 2 ? (
            <div className="text-[11px] text-slate-500 italic pt-8 text-center">
              Accumulating — one point per session from the daily tape.
            </div>
          ) : (
            <ResponsiveContainer focusTitle={`${front?.label ?? mkt} · daily buy pressure`} width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 8 }} minTickGap={26}
                  tickFormatter={(v: string) => fmtDateLabel(v)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 8 }} width={44}
                  domain={[-1, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                  formatter={(v) => typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—"} />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 3" />
                <Bar dataKey="pressure" name="Buy pressure">
                  {trend.map((t, i) => (
                    <Cell key={i} fill={(t.pressure ?? 0) >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="pressure" name="" stroke="#94a3b8"
                  strokeWidth={1} dot={false} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Spread volume, inferred from same-second prints on both legs */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Calendar-spread volume · same-second matched legs
        </div>
        {spreads.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic py-2 text-center">
            No matched spread prints this session.
          </div>
        ) : (
          <div className="space-y-1">
            {spreads.map(s => (
              <div key={`${s.leg_a}-${s.leg_b}`}
                className="flex items-center justify-between gap-2 text-[10px] font-mono whitespace-nowrap border-b border-slate-700/50 pb-1">
                <span className="text-slate-300 truncate">
                  {s.leg_a.replace(/^(Robusta|Arabica)\s*/, "")} / {s.leg_b?.replace(/^(Robusta|Arabica)\s*/, "")}
                </span>
                <span className="text-sky-300">
                  {fmtLots(s.volume ?? 0)} lots
                  <span className="text-slate-500"> · {s.matched_seconds}s</span>
                </span>
              </div>
            ))}
            {row.spreads.filter(s => s.market === mkt && !s.leg_b).map(s => (
              <div key={s.leg_a}
                className="flex items-center justify-between gap-2 text-[10px] font-mono whitespace-nowrap text-slate-500">
                <span className="truncate">{s.leg_a}</span>
                <span>last {s.last_level} · [{s.min_level}, {s.max_level}]</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TradedTapePanel() {
  const [doc, setDoc] = useState<TapeDoc | null>(null);

  useEffect(() => {
    fetch("/data/tradespread.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setDoc(d); })
      .catch(() => { /* renders the accumulating note */ });
  }, []);

  const history = doc?.history ?? [];
  const latest = history.length ? history[history.length - 1] : null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-white">Traded Tape · order flow</h2>
        <p className="text-xs text-slate-400 max-w-4xl">
          Every print of the session from acaphe&apos;s traded tape: the opening tick and the price
          15 minutes in, how many lots were <span className="text-emerald-400">lifted</span> (bought
          on an uptick) versus <span className="text-red-400">hit</span> (sold on a downtick), the
          volume-weighted price of each side, and calendar-spread size inferred from legs printing
          in the same second. One capture per session, 30 min after the arabica close
          {latest ? ` · last ${latest.date}` : ""}.
        </p>
      </div>

      {!latest ? (
        <div className="text-[11px] text-slate-500 italic">
          No tape yet — the first capture lands after the next session close.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 lg:gap-4 items-start">
          <MarketTape mkt="arabica" row={latest} history={history} />
          <MarketTape mkt="robusta" row={latest} history={history} />
        </div>
      )}
    </div>
  );
}
