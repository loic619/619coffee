"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface ImpYear {
  year: number;
  total_mt: number | null;
  green_mt: number | null;
  roasted_mt: number | null;
  decaf_mt: number | null;
  husks_mt: number | null;
  value_usd: number | null;
}
interface ImpCountry {
  name: string;
  iso3: string;
  reporter_code: string;
  annual: ImpYear[];
  latest_year: number;
  monthly_total?: Record<string, number>;
  src?: "comtrade" | "eurostat";   // synthetic Eurostat entries are tagged
}
interface EuReporter {
  name: string; years: number[];
  total_by_year: Record<string, number>;
  monthly_total?: Record<string, number>;
}
interface CoffeeImports {
  updated: string;
  source: string;
  hs_codes: Record<string, string>;
  is_seed?: boolean;
  seed_note?: string;
  countries: Record<string, ImpCountry>;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const GREEN = "#16a34a", ROASTED = "#b45309", DECAF = "#06b6d4";

const kt = (mt: number | null | undefined) => (mt == null ? null : mt / 1000);
const fmtKt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kt`);

function latest(c: ImpCountry): ImpYear | undefined {
  return c.annual.find(a => a.year === c.latest_year) ?? c.annual[c.annual.length - 1];
}

export default function ImportsPanel() {
  const [data, setData] = useState<CoffeeImports | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<string>("");
  const [trendMode, setTrendMode] = useState<"annual" | "monthly">("annual");

  useEffect(() => {
    Promise.all([
      fetch("/data/coffee_imports.json").then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/data/eu_coffee_imports.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([d, eu]: [CoffeeImports, { reporters?: Record<string, EuReporter> } | null]) => {
        // UN Comtrade's keyless endpoint serves stale/no data for most EU
        // members (Germany's latest there is 2014), so the big EU importers
        // come from Eurostat instead: synthesize a country entry per member
        // reporter that Comtrade doesn't cover (total volumes only — Eurostat
        // per-member has no green/roasted split).
        for (const [code, r] of Object.entries(eu?.reporters ?? {})) {
          if (code === "EU27_2020") continue;                       // bloc ≠ a country
          const iso = code.toLowerCase();
          const existing = Object.values(d.countries).find(c => c.name === r.name);
          if (existing) {
            // Comtrade-native EU member (Italy, NL, BE, PL, DK, AT…): Comtrade
            // deliberately skips EU members in its monthly loop, but Eurostat
            // has ~29 months for every member reporter — attach it so the
            // Monthly toggle works for these markets too.
            if (!existing.monthly_total && r.monthly_total && Object.keys(r.monthly_total).length) {
              existing.monthly_total = r.monthly_total;
            }
            continue;
          }
          const annual = Object.entries(r.total_by_year)
            .map(([y, mt]) => ({ year: +y, total_mt: mt, green_mt: null, roasted_mt: null,
                                 decaf_mt: null, husks_mt: null, value_usd: null }))
            .filter(a => a.total_mt > 0).sort((a, b) => a.year - b.year);
          if (!annual.length) continue;
          d.countries[`eu_${iso}`] = {
            // "ᴱ" marks the Eurostat-sourced rows everywhere the name renders.
            name: `${r.name} ᴱ`, iso3: code, reporter_code: code, annual,
            latest_year: annual[annual.length - 1].year,
            monthly_total: r.monthly_total, src: "eurostat",
          };
        }
        setData({ ...d });
        // default selection: largest importer in the latest year
        const top = Object.entries(d.countries)
          .map(([k, c]) => [k, latest(c)?.total_mt ?? 0] as const)
          .sort((a, b) => b[1] - a[1])[0];
        if (top) setSel(top[0]);
      })
      .catch(() => setError(true));
  }, []);

  const countries = useMemo(() => data?.countries ?? {}, [data]);
  const list = useMemo(() => Object.entries(countries), [countries]);

  // Latest-year ranking (total) + form-of-import composition.
  const ranking = useMemo(() =>
    list.map(([k, c]) => {
      const ly = latest(c);
      return {
        key: k, name: c.name,
        total: kt(ly?.total_mt) ?? 0,
        green: kt(ly?.green_mt) ?? 0,
        roasted: kt(ly?.roasted_mt) ?? 0,
        year: ly?.year,
      };
    }).filter(r => r.total > 0).sort((a, b) => b.total - a.total),
  [list]);

  const selCountry = countries[sel];
  const trend = useMemo(() => (selCountry?.annual ?? []).map(a => ({
    year: a.year,
    green: kt(a.green_mt),
    roasted: kt(a.roasted_mt),
    decaf: kt(a.decaf_mt),
  })), [selCountry]);

  // Monthly total series (kt) for the selected market, where UN Comtrade
  // publishes it (rest-of-world importers; US→USITC, EU→Eurostat have their
  // own monthly panels). `{ "YYYY-MM": mt }` → sorted points.
  const monthlyTrend = useMemo(() =>
    Object.entries(selCountry?.monthly_total ?? {})
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, mt]) => ({ m, total: mt / 1000 })),
  [selCountry]);
  const hasMonthly = monthlyTrend.length > 0;
  // Don't strand the toggle on "monthly" for a market without a monthly series.
  const mode = hasMonthly ? trendMode : "annual";

  if (error) return null;
  if (!data) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading coffee-import data…</div>;
  if (ranking.length === 0) {
    return <div className="p-4 text-xs text-slate-500">No coffee-import data yet — awaiting first UN Comtrade pull.</div>;
  }

  const worldTotal = ranking.reduce((s, r) => s + r.total, 0);
  // One merged ranking: stacked green/roasted (+ grey remainder) where the
  // split is reported; a single amber "totalOnly" bar where it isn't.
  const rankingStacked = ranking.map(r => {
    const hasSplit = r.green > 0 || r.roasted > 0;
    return {
      name: r.name,
      green: hasSplit ? +r.green.toFixed(1) : 0,
      roasted: hasSplit ? +r.roasted.toFixed(1) : 0,
      other: hasSplit ? +Math.max(0, r.total - r.green - r.roasted).toFixed(1) : 0,
      totalOnly: hasSplit ? 0 : +r.total.toFixed(1),
    };
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Coffee Imports by Country</h2>
          <p className="text-xs text-slate-400">
            HS 0901 imports from World · {ranking.length} markets · UN Comtrade + Eurostat (EU members)
          </p>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          Σ tracked: <span className="text-white">{fmtKt(worldTotal)}</span>
          <span className="text-slate-600"> · updated {data.updated.slice(0, 10)}</span>
        </div>
      </div>

      {data.is_seed && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          ⚠ Preview/seed figures — replaced by the live UN Comtrade pull once network egress to
          <code className="mx-1 px-1 rounded bg-slate-800 text-amber-300">comtradeapi.un.org</code>is enabled.
          {data.seed_note ? <span className="text-amber-300/70"> {data.seed_note}</span> : null}
        </div>
      )}

      {/* Ranking — one chart: stacked green/roasted where the split is known,
          a single amber total bar where it isn't (Eurostat ᴱ members). */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Total coffee imports — latest year (kt/yr) · green/roasted split where reported
        </div>
        <div className="h-[520px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rankingStacked} layout="vertical" margin={{ top: 0, right: 14, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={94} interval={0} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, n: unknown) => {
                const lbl = n === "green" ? "Green" : n === "roasted" ? "Roasted"
                  : n === "other" ? "Other/unspec." : "Total (no split)";
                return [`${Number(v).toLocaleString()} kt`, lbl];
              }} />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) =>
                v === "green" ? "Green" : v === "roasted" ? "Roasted"
                  : v === "other" ? "Other/unspec." : "Total (no split)"} />
              <Bar dataKey="green" stackId="a" fill={GREEN} />
              <Bar dataKey="roasted" stackId="a" fill={ROASTED} />
              <Bar dataKey="other" stackId="a" fill="#475569" />
              <Bar dataKey="totalOnly" stackId="a" fill="#f59e0b" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-country trend */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            {mode === "monthly"
              ? "Monthly import momentum — total (kt)"
              : "Import trend by form — green / roasted (stacked) + decaffeinated"}
          </div>
          {/* Annual/Monthly toggle — monthly only where Comtrade publishes it */}
          <div className="flex rounded border border-slate-700 overflow-hidden text-[10px]">
            <button onClick={() => setTrendMode("annual")}
              className={`px-2 py-0.5 transition-colors ${mode === "annual" ? "bg-amber-500 text-slate-900 font-medium" : "text-slate-400 hover:text-slate-200"}`}>
              Annual
            </button>
            <button onClick={() => setTrendMode("monthly")} disabled={!hasMonthly}
              title={hasMonthly ? "" : "No monthly series for this market"}
              className={`px-2 py-0.5 transition-colors ${mode === "monthly" ? "bg-amber-500 text-slate-900 font-medium" : hasMonthly ? "text-slate-400 hover:text-slate-200" : "text-slate-600 cursor-not-allowed"}`}>
              Monthly
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {ranking.map(r => (
            <button key={r.key} onClick={() => setSel(r.key)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                r.key === sel ? "border-transparent bg-amber-500 text-slate-900 font-medium" : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}>
              {r.name}
              {countries[r.key]?.monthly_total ? <span className="ml-1 text-[8px] opacity-60">●</span> : null}
            </button>
          ))}
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {mode === "monthly" ? (
              <ComposedChart data={monthlyTrend} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
                  minTickGap={28} tickFormatter={(m: string) => m.slice(0, 7)} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} width={40} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(1)} kt`, "Total"]} />
                <Area dataKey="total" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} strokeWidth={1.6} />
              </ComposedChart>
            ) : (
              <ComposedChart data={trend} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} width={40} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, n: unknown) => {
                  if (v == null) return ["—", String(n)];
                  const lbl = n === "green" ? "Green" : n === "roasted" ? "Roasted" : "Decaf (of total)";
                  return [`${Number(v).toLocaleString()} kt`, lbl];
                }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                <Area dataKey="green" stackId="f" stroke={GREEN} fill={GREEN} fillOpacity={0.5} connectNulls />
                <Area dataKey="roasted" stackId="f" stroke={ROASTED} fill={ROASTED} fillOpacity={0.5} connectNulls />
                <Line dataKey="decaf" stroke={DECAF} strokeWidth={1.6} dot={false} connectNulls strokeDasharray="3 2" />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
        {mode === "monthly" && (
          <div className="text-[9px] text-slate-500 italic">
            Monthly total HS-0901 imports (kt). ● marks markets with a monthly series — UN Comtrade for
            rest-of-world markets, Eurostat for EU members (incl. Comtrade-native ones like Italy/NL).
            Gaps = months not yet reported. US &amp; EU monthly live in their own panels below (USITC / Eurostat).
          </div>
        )}
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">Market</th>
              <th className="text-right px-2 py-1.5">Year</th>
              <th className="text-right px-2 py-1.5">Total</th>
              <th className="text-right px-2 py-1.5">Green</th>
              <th className="text-right px-2 py-1.5">Roasted</th>
              <th className="text-right px-2 py-1.5">Decaf</th>
              <th className="text-right px-2 py-1.5">Value</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map(r => {
              const ly = latest(countries[r.key])!;
              const pctRoasted = ly.total_mt && ly.roasted_mt ? (ly.roasted_mt / ly.total_mt) * 100 : null;
              const pctDecaf = ly.total_mt && ly.decaf_mt ? (ly.decaf_mt / ly.total_mt) * 100 : null;
              return (
                <tr key={r.key} className={`border-b border-slate-800 hover:bg-slate-800/40 cursor-pointer ${r.key === sel ? "bg-slate-800/30" : ""}`}
                  onClick={() => setSel(r.key)}>
                  <td className="px-2 py-1 text-slate-200">{r.name}</td>
                  <td className="px-2 py-1 text-right text-slate-500 font-mono">{ly.year}</td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">{fmtKt(kt(ly.total_mt))}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-300">{fmtKt(kt(ly.green_mt))}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-300">
                    {fmtKt(kt(ly.roasted_mt))}{pctRoasted != null && <span className="text-slate-600"> ({pctRoasted.toFixed(0)}%)</span>}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-400">
                    {pctDecaf != null ? `${pctDecaf.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-400">
                    {ly.value_usd != null ? `$${(ly.value_usd / 1e9).toFixed(1)}bn` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Imports of HS 0901 (coffee) from World. UN Comtrade for non-EU markets; EU members (marked ᴱ) come from
        Eurostat Comext, since Comtrade&rsquo;s keyless endpoint serves stale data for them — totals only, no
        green/roasted split. Green = not-roasted (0901.11/.12); roasted = 0901.21/.22; decaf (0901.12 + .22) is a
        cross-cut shown as a share of total. Weights net kg → MT → kt. Netherlands/Belgium figures include
        substantial re-export hubs. Value is CIF import value where reported.
      </div>
    </div>
  );
}
