"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const US_C = "#0ea5e9", EU_C = "#f59e0b";

// US + EU monthly imports in ONE chart, each with its MAT (trailing-12-month
// total, right axis) so the level trend reads through the monthly noise.
// Sources: USITC (US), Eurostat Comext (EU extra-EU).
export default function MonthlyTrendCombined() {
  const [us, setUs] = useState<Record<string, number> | null>(null);
  const [eu, setEu] = useState<Record<string, number> | null>(null);
  // Extra-EU EXPORTS (re-exports/value-added out of the bloc) — used for the
  // NET import line: at bloc level intra-EU flows cancel, so
  // net = extra-EU imports − extra-EU exports.
  const [euEx, setEuEx] = useState<Record<string, number>>({});
  const [euSol, setEuSol] = useState<Record<string, number>>({});   // soluble exports HS2101.11/.12, product MT
  const [euSolImp, setEuSolImp] = useState<Record<string, number>>({});   // soluble imports (symmetric term)
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/us_coffee_imports.json").then(r => r.json())
      .then(d => setUs(d?.monthly_total ?? {})).catch(() => setErr(true));
    fetch("/data/eu_coffee_imports.json").then(r => r.json())
      .then(d => { setEu(d?.monthly_total ?? {}); setEuEx(d?.monthly_exports ?? {});
                   setEuSol(d?.monthly_exports_soluble ?? {}); setEuSolImp(d?.monthly_imports_soluble ?? {}); })
      .catch(() => setErr(true));
  }, []);

  const rows = useMemo(() => {
    if (!us || !eu) return [];
    // MAT: trailing 12 *consecutive* months (a gap voids the window).
    const mat = (m: Record<string, number>): Record<string, number> => {
      const keys = Object.keys(m).filter(k => m[k] > 0).sort();
      const out: Record<string, number> = {};
      for (let i = 11; i < keys.length; i++) {
        const w = keys.slice(i - 11, i + 1);
        const [y0, m0] = w[0].split("-").map(Number);
        const [y1, m1] = w[11].split("-").map(Number);
        if (y1 * 12 + m1 - (y0 * 12 + m0) !== 11) continue;
        out[keys[i]] = w.reduce((s, k) => s + m[k], 0);
      }
      return out;
    };
    const usMat = mat(us), euMat = mat(eu), exMat = mat(euEx), solMat = mat(euSol), solImpMat = mat(euSolImp);
    const GBE_SOLUBLE = 2.6;   // ICO: 1 kg soluble ≈ 2.6 kg green-bean equivalent
    const months = Array.from(new Set([...Object.keys(us), ...Object.keys(eu)]))
      .filter(k => (us[k] ?? 0) > 0 || (eu[k] ?? 0) > 0).sort();
    return months.map(k => ({
      m: k,
      us: us[k] ? +(us[k] / 1000).toFixed(1) : null,
      eu: eu[k] ? +(eu[k] / 1000).toFixed(1) : null,
      usMat: usMat[k] ? +(usMat[k] / 1000).toFixed(0) : null,
      euMat: euMat[k] ? +(euMat[k] / 1000).toFixed(0) : null,
      // Symmetric GBE net: soluble enters BOTH sides (the EU imports instant
      // from Brazil/Vietnam/India as well as exporting it).
      euNetMat: euMat[k] && exMat[k]
        ? +((euMat[k] + GBE_SOLUBLE * (solImpMat[k] ?? 0)
             - exMat[k] - GBE_SOLUBLE * (solMat[k] ?? 0)) / 1000).toFixed(0) : null,
    }));
  }, [us, eu, euEx, euSol, euSolImp]);

  if (err) return null;
  if (!us || !eu) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading monthly series…</div>;
  if (rows.length < 2) return null;

  const last = [...rows].reverse().find(r => r.usMat != null || r.euMat != null);
  const NAMES: Record<string, string> = {
    us: "US monthly", eu: "EU monthly", usMat: "US MAT (12m, right)", euMat: "EU MAT (12m, right)",
    euNetMat: "EU NET MAT (− re-exports incl. soluble GBE, right)",
  };
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          US &amp; EU imports — monthly + MAT trend
        </div>
        {last && (
          <div className="text-[10px] font-mono text-slate-400">
            MAT @ {last.m}: <span style={{ color: US_C }}>US {last.usMat?.toLocaleString() ?? "—"} kt</span>
            {" · "}<span style={{ color: EU_C }}>EU {last.euMat?.toLocaleString() ?? "—"} kt</span>
          </div>
        )}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis yAxisId="mo" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}kt`} width={42} />
            <YAxis yAxisId="mat" orientation="right" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}kt`} width={46} />
            <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) =>
              [`${Number(v).toLocaleString()} kt`, NAMES[String(n)] ?? String(n)]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => NAMES[v] ?? v} />
            <Line yAxisId="mo" dataKey="us" stroke={US_C} strokeWidth={1.3} dot={false} connectNulls />
            <Line yAxisId="mo" dataKey="eu" stroke={EU_C} strokeWidth={1.3} dot={false} connectNulls />
            <Line yAxisId="mat" dataKey="usMat" stroke={US_C} strokeWidth={2.2} strokeDasharray="6 3" dot={false} connectNulls />
            <Line yAxisId="mat" dataKey="euMat" stroke={EU_C} strokeWidth={2.2} strokeDasharray="6 3" dot={false} connectNulls />
            <Line yAxisId="mat" dataKey="euNetMat" stroke="#34d399" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[9px] text-slate-500 italic mt-1">
        Solid = monthly HS-0901 imports (left, kt); dashed = MAT, the trailing-12-month total (right, kt/yr) —
        the level trend with seasonality removed. Green dotted = EU NET MAT, the symmetric green-bean-equivalent
        balance: (HS-0901 imports + soluble imports ×2.6) − (HS-0901 exports + soluble exports ×2.6),
        soluble = HS 2101.11/.12; intra-EU flows cancel at bloc level. US: USITC · EU: Eurostat. MAT starts once 12 consecutive months are available.
      </div>
    </div>
  );
}
