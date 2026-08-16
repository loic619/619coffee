"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };
const ROASTED_RATE_EUR_KG = 2.19;   // Kaffeesteuer on roasted coffee
const ROAST_YIELD = 0.84;           // ~16% weight loss green → roasted

interface DeTrade { updated: string; series: Record<string, Record<string, number>> }

// Trailing-12-month sum ending at each month; null until 12 consecutive months.
function matSeries(m: Record<string, number>): Record<string, number> {
  const keys = Object.keys(m).sort();
  const out: Record<string, number> = {};
  for (let i = 11; i < keys.length; i++) {
    const win = keys.slice(i - 11, i + 1);
    const [y0, m0] = win[0].split("-").map(Number);
    const [y1, m1] = win[11].split("-").map(Number);
    if (y1 * 12 + m1 - (y0 * 12 + m0) !== 11) continue;   // gap → skip
    out[keys[i]] = win.reduce((s, k) => s + m[k], 0);
  }
  return out;
}

const yoy = (s: Record<string, number>, k: string): number | null => {
  const [y, m] = k.split("-").map(Number);
  const prev = s[`${y - 1}-${String(m).padStart(2, "0")}`];
  return prev ? ((s[k] / prev) - 1) * 100 : null;
};

// Maps the German coffee tax (levied ONLY on domestic releases — exports are
// exempt) against Germany's roasting trade, all as 12-month totals, so a tax
// rise can be attributed to real domestic demand vs roasting-for-re-export.
export default function KaffeesteuerReexport() {
  const [ks, setKs] = useState<Record<string, number> | null>(null);
  const [de, setDe] = useState<DeTrade | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/kaffeesteuer.json").then(r => r.json()).then(setKs).catch(() => setErr(true));
    fetch("/data/de_coffee_trade.json").then(r => (r.ok ? r.json() : null))
      .then(d => (d ? setDe(d) : setErr(true))).catch(() => setErr(true));
  }, []);

  const { rows, latest } = useMemo(() => {
    if (!ks || !de) return { rows: [] as Record<string, number | string | null>[], latest: null as Record<string, number | null> | null };
    const s = de.series ?? {};
    // Implied taxed volume (kt/yr): tax MAT (Tsd €) → € → kg @2.19 → kt.
    const taxVol: Record<string, number> = {};
    for (const [k, v] of Object.entries(matSeries(ks))) taxVol[k] = (v * 1000) / ROASTED_RATE_EUR_KG / 1e6;
    const gi = matSeries(s.green_imports ?? {});
    const ge = matSeries(s.green_exports ?? {});
    const ri = matSeries(s.roasted_imports ?? {});
    const rex = matSeries(s.roasted_exports ?? {});
    // Domestic availability proxy (roasted-equivalent kt/yr). Green that is
    // re-exported (Hamburg is a major green trading hub) never reaches a
    // German roaster, so net it out before applying the roast yield.
    const avail: Record<string, number> = {};
    for (const k of Object.keys(gi)) {
      if (ge[k] != null && ri[k] != null && rex[k] != null)
        avail[k] = ((gi[k] - ge[k]) * ROAST_YIELD + ri[k] - rex[k]) / 1000;
    }
    const months = Object.keys(taxVol).filter(k => gi[k] != null && rex[k] != null).sort();
    const rows = months.map(k => ({
      m: k,
      tax: +taxVol[k].toFixed(1),
      greenIn: +(gi[k] / 1000).toFixed(1),
      roastedOut: +(rex[k] / 1000).toFixed(1),
      avail: avail[k] != null ? +avail[k].toFixed(1) : null,
    }));
    const lk = months[months.length - 1];
    const latest = lk ? {
      taxYoy: yoy(taxVol, lk), exYoy: yoy(rex, lk), availYoy: avail[lk] != null ? yoy(avail, lk) : null,
    } : null;
    return { rows, latest };
  }, [ks, de]);

  if (err) return null;
  if (!ks || !de) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading Kaffeesteuer cross-check…</div>;
  if (rows.length < 2) return null;

  const fmtYoy = (v: number | null | undefined) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Kaffeesteuer vs German roasting trade</h2>
          <p className="text-[11px] text-slate-500 max-w-2xl">
            All series are trailing-12-month totals. The tax is levied only on coffee released for
            consumption in Germany — <b>exports are exempt</b> — so if the tax rises while domestic
            availability is flat, the rise is not explained by roasting-for-re-export.
          </p>
        </div>
        {latest && (
          <div className="text-[10px] font-mono text-slate-400 bg-slate-800 rounded px-3 py-2">
            <div>taxed volume YoY <span className="text-amber-300">{fmtYoy(latest.taxYoy)}</span></div>
            <div>roasted exports YoY <span className="text-sky-300">{fmtYoy(latest.exYoy)}</span></div>
            <div>domestic availability YoY <span className="text-emerald-300">{fmtYoy(latest.availYoy)}</span></div>
          </div>
        )}
      </div>
      <div className="h-72 bg-slate-900 border border-slate-800 rounded-lg p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 10, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={v => `${v}kt`} width={44} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [
              `${Number(v).toLocaleString()} kt/yr`,
              n === "tax" ? "Implied taxed volume" : n === "greenIn" ? "Green imports"
                : n === "roastedOut" ? "Roasted exports" : "Domestic availability",
            ]} />
            <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v: string) =>
              v === "tax" ? "Implied taxed volume (tax ÷ €2.19/kg)" : v === "greenIn" ? "Green imports"
                : v === "roastedOut" ? "Roasted exports" : "Domestic availability ((green in−out)×0.84 + roasted in−out)"} />
            <Line dataKey="tax" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line dataKey="greenIn" stroke="#94a3b8" strokeWidth={1.4} dot={false} strokeDasharray="4 3" />
            <Line dataKey="roastedOut" stroke="#38bdf8" strokeWidth={1.6} dot={false} />
            <Line dataKey="avail" stroke="#34d399" strokeWidth={1.6} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-slate-600 italic">
        Kaffeesteuer (BMF, €2.19/kg roasted — soluble at €4.78/kg makes the implied volume a slight
        overestimate but leaves the trend intact) vs Eurostat Comext DE monthly HS6 quantities.
        Availability proxy assumes ~16% roast weight loss. Product weights, not green-equivalent.
      </p>
    </div>
  );
}
