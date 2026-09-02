"use client";
import { useEffect, useMemo, useState } from "react";
import ModelledBadge from "@/components/ModelledBadge";

// ── Prediction-vs-reality track record (open_direction_history.json) ────────
// Every 03:00 UTC prediction is appended BEFORE the open and graded after it;
// this calendar renders that append-only record. Status colors validated on
// the dark surface (CVD separation 24 ΔE, contrast ≥3:1); hit/miss is the
// classic red/green CVD pair, so every state also carries a GLYPH (✓ ✗ · –)
// plus legend, tooltip and a table view — never color alone.

interface HistRow {
  date: string;                 // YYYY-MM-DD (the predicted session)
  prob_up: number;
  direction: "Bullish" | "Bearish" | "Abstain";
  actual_gap_pct: number | null;
  actual_dir: "Up" | "Down" | null;
  hit: boolean | null;
  status: "pending" | "resolved" | "void";
  source: "live" | "backtest";
}

const STATE = {
  hit:     { bg: "#10b981", glyph: "✓", label: "Correct" },
  miss:    { bg: "#ef4444", glyph: "✗", label: "Wrong" },
  abstain: { bg: "#64748b", glyph: "·", label: "Undefined" },
  void:    { bg: "#1e293b", glyph: "–", label: "Void (roll/holiday)" },
  pending: { bg: "transparent", glyph: "?", label: "Pending (awaiting open)" },
} as const;
type StateKey = keyof typeof STATE;

function cellState(r: HistRow): StateKey {
  if (r.status === "pending") return "pending";
  if (r.status === "void") return "void";
  if (r.direction === "Abstain") return "abstain";
  return r.hit ? "hit" : "miss";
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mon–Fri week rows for a YYYY-MM month. Each cell = ISO date or null pad. */
function monthGrid(ym: string): (string | null)[][] {
  const [y, m] = ym.split("-").map(Number);
  const rows: (string | null)[][] = [];
  let week: (string | null)[] = [];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    const dt = new Date(Date.UTC(y, m - 1, day));
    const dow = dt.getUTCDay();            // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue;
    if (dow === 1 && week.length) { rows.push(week); week = []; }
    if (week.length === 0 && dow > 1) week = Array(dow - 1).fill(null);
    week.push(dt.toISOString().slice(0, 10));
  }
  if (week.length) rows.push(week.concat(Array(5 - week.length).fill(null)));
  return rows;
}

function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export default function OpenDirectionCalendar() {
  const [rows, setRows] = useState<HistRow[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/open_direction_history.json")
      .then(r => (r.ok ? r.json() : null))
      .then((j: HistRow[] | null) => {
        if (Array.isArray(j) && j.length) {
          setRows(j);
          setMonth(j[j.length - 1].date.slice(0, 7));
        } else setRows([]);
      })
      .catch(() => setRows([]));
  }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, HistRow>();
    for (const r of rows ?? []) m.set(r.date, r);
    return m;
  }, [rows]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const graded = (src: string) =>
      all.filter(r => r.source === src && r.status === "resolved" && r.hit !== null);
    const live = graded("live");
    const bt = graded("backtest");
    const resolved = all.filter(r => r.status === "resolved");
    const acted = resolved.filter(r => r.direction !== "Abstain");
    return {
      live,
      liveHit: live.length ? live.filter(r => r.hit).length / live.length : null,
      btHit: bt.length ? bt.filter(r => r.hit).length / bt.length : null,
      btN: bt.length,
      coverage: resolved.length ? acted.length / resolved.length : null,
      pending: all.filter(r => r.status === "pending").length,
    };
  }, [rows]);

  const bounds = useMemo(() => {
    const all = rows ?? [];
    return all.length
      ? { min: all[0].date.slice(0, 7), max: all[all.length - 1].date.slice(0, 7) }
      : null;
  }, [rows]);

  if (rows === null) {
    return <section className="px-6 py-5"><div className="bg-slate-900 rounded-lg h-40 animate-pulse" /></section>;
  }
  if (!rows.length || !month || !bounds) {
    return (
      <section className="px-6 py-5">
        <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
          Track record not yet available — populated by the 03:00 UTC prediction job.
        </div>
      </section>
    );
  }

  const grid = monthGrid(month);
  const recent = rows.filter(r => r.status === "resolved").slice(-8).reverse();

  return (
    <section className="px-6 pb-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">Track record</span>
        <h3 className="text-sm font-bold text-white">Prediction vs Realized Open</h3>
        <ModelledBadge
          method="ML classifier"
          hitRate={stats.liveHit != null ? { value: stats.liveHit, n: stats.live.length, label: "live calls" } : null}
        />

        <span className="text-[10px] text-slate-500">
          logged pre-open · graded after the open · append-only
        </span>
      </div>

      {/* Stat tiles — live record is the number that proves the model. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Live hit-rate</div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {stats.liveHit != null ? pct(stats.liveHit) : "—"}
            <span className="text-[10px] text-slate-500 font-normal ml-1.5">n={stats.live.length}</span>
          </div>
          <div className="text-[9px] text-slate-500">forward, out-of-sample</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Backtest hit-rate</div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {stats.btHit != null ? pct(stats.btHit) : "—"}
            <span className="text-[10px] text-slate-500 font-normal ml-1.5">n={stats.btN}</span>
          </div>
          <div className="text-[9px] text-slate-500">walk-forward seed</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Coverage</div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {stats.coverage != null ? pct(stats.coverage) : "—"}
          </div>
          <div className="text-[9px] text-slate-500">calls made (rest Undefined)</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Pending</div>
          <div className="text-xl font-bold font-mono text-amber-400">{stats.pending}</div>
          <div className="text-[9px] text-slate-500">awaiting the open</div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ── Calendar ── */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 lg:w-[340px] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setMonth(addMonths(month, -1))}
              disabled={month <= bounds.min}
              className="px-2 py-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-default text-sm"
              aria-label="Previous month"
            >‹</button>
            <div className="text-xs font-semibold text-slate-200">{monthLabel(month)}</div>
            <button
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={month >= bounds.max}
              className="px-2 py-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-default text-sm"
              aria-label="Next month"
            >›</button>
          </div>

          <div className="grid grid-cols-5 gap-[2px] text-center text-[9px] text-slate-500 mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => <div key={d}>{d}</div>)}
          </div>
          {grid.map((week, wi) => (
            <div key={wi} className="grid grid-cols-5 gap-[2px] mb-[2px]">
              {week.map((iso, di) => {
                if (!iso) return <div key={di} className="h-9" />;
                const r = byDate.get(iso);
                if (!r) {
                  return (
                    <div key={di} className="h-9 rounded bg-slate-800/40 flex items-center justify-center text-[9px] text-slate-600">
                      {Number(iso.slice(8, 10))}
                    </div>
                  );
                }
                const st = cellState(r);
                const s = STATE[st];
                const isPending = st === "pending";
                return (
                  <div key={di} className="relative group">
                    <div
                      className={`h-9 rounded flex flex-col items-center justify-center cursor-default
                        ${isPending ? "border border-dashed border-amber-400/70" : ""}
                        ${r.source === "live" && !isPending ? "ring-1 ring-indigo-400/50" : ""}`}
                      style={{ background: s.bg }}
                    >
                      <span className={`text-[8px] leading-none ${st === "hit" || st === "miss" ? "text-white/80" : "text-slate-400"}`}>
                        {Number(iso.slice(8, 10))}
                      </span>
                      <span className={`text-[11px] leading-none font-bold ${
                        st === "hit" || st === "miss" ? "text-white" : isPending ? "text-amber-400" : "text-slate-300"}`}>
                        {s.glyph}
                      </span>
                    </div>
                    {/* hover tooltip */}
                    <div className="hidden group-hover:block absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1 w-max max-w-[220px]
                                    bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[10px] text-slate-200 shadow-lg whitespace-nowrap">
                      <div className="font-semibold">{iso} · {r.source}</div>
                      <div>Call: {r.direction === "Abstain" ? "Undefined" : r.direction} ({pct(r.prob_up, 1)} up)</div>
                      {r.status === "resolved" && r.actual_gap_pct != null && (
                        <div>Open: {r.actual_dir} {r.actual_gap_pct > 0 ? "+" : ""}{r.actual_gap_pct.toFixed(2)}%
                          {r.hit != null && <span className={r.hit ? " text-emerald-400" : " text-red-400"}> · {r.hit ? "correct" : "wrong"}</span>}
                        </div>
                      )}
                      {r.status === "pending" && <div className="text-amber-400">awaiting the open</div>}
                      {r.status === "void" && <div className="text-slate-400">not gradable (roll/holiday)</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* legend — glyph + label, identity never color-alone */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[9px] text-slate-400">
            {(Object.keys(STATE) as StateKey[]).map(k => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[8px] font-bold
                    ${k === "pending" ? "border border-dashed border-amber-400/70 text-amber-400" : "text-white"}`}
                  style={{ background: STATE[k].bg }}
                >{STATE[k].glyph}</span>
                {STATE[k].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3.5 h-3.5 rounded ring-1 ring-indigo-400/60 bg-slate-800" />
              live (vs backtest seed)
            </span>
          </div>
        </div>

        {/* ── Recent outcomes table (accessible view of the same record) ── */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex-1 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Last graded sessions</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-700">
                <th className="text-left py-1 pr-2">Session</th>
                <th className="text-left py-1 pr-2">Call</th>
                <th className="text-right py-1 pr-2">P(up)</th>
                <th className="text-right py-1 pr-2">Open gap</th>
                <th className="text-right py-1">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {recent.map(r => (
                <tr key={r.date}>
                  <td className="py-1.5 pr-2 font-mono text-slate-300">{r.date}</td>
                  <td className={`py-1.5 pr-2 font-semibold ${
                    r.direction === "Bullish" ? "text-emerald-400"
                    : r.direction === "Bearish" ? "text-red-400" : "text-slate-400"}`}>
                    {r.direction === "Abstain" ? "Undefined" : r.direction}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-slate-300">{pct(r.prob_up, 1)}</td>
                  <td className={`py-1.5 pr-2 text-right font-mono ${
                    (r.actual_gap_pct ?? 0) < 0 ? "text-red-300" : "text-emerald-300"}`}>
                    {r.actual_gap_pct != null ? `${r.actual_gap_pct > 0 ? "+" : ""}${r.actual_gap_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.direction === "Abstain"
                      ? <span className="text-slate-500">·</span>
                      : r.hit
                        ? <span className="text-emerald-400 font-bold">✓</span>
                        : <span className="text-red-400 font-bold">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[9px] text-slate-500 italic mt-2">
            The live hit-rate is the number that proves (or kills) the model — forward
            predictions logged before the open, never edited. Backtest rows seed history
            with the identical model for context.
          </p>
        </div>
      </div>
    </section>
  );
}
