"use client";
import { PieChart, Pie, Cell, Tooltip, Label } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { ARABICA_MT_FACTOR, ROBUSTA_MT_FACTOR, CENTS_LB_TO_USD_TON } from "@/lib/cot/transformApiData";

export type CpUnit = "contracts" | "mt" | "usd";

export const CP_CATS: { name: string; longF: string | string[]; shortF: string | string[]; longC: string; shortC: string }[] = [
  { name: "PMPU",      longF: "pmpuLong",    shortF: "pmpuShort",    longC: "#92400e", shortC: "#92400e" },
  { name: "Swap",      longF: "swapLong",    shortF: "swapShort",    longC: "#10b981", shortC: "#10b981" },
  { name: "MM",        longF: "mmLong",      shortF: "mmShort",      longC: "#1e40af", shortC: "#1e40af" },
  { name: "Other Rpt", longF: "otherLong",   shortF: "otherShort",   longC: "#38bdf8", shortC: "#38bdf8" },
  { name: "Non-Rep",   longF: "nonRepLong",  shortF: "nonRepShort",  longC: "#64748b", shortC: "#64748b" },
];

export const CP_SPREADS: { name: string; f: string; color: string }[] = [
  { name: "MM",    f: "mmSpread",    color: "#f59e0b" },
  { name: "Swap",  f: "swapSpread",  color: "#10b981" },
  { name: "Other", f: "otherSpread", color: "#64748b" },
];

export function RadialCounterparty({
  latest, prev1, prev4, market, unit,
}: {
  latest: ProcessedCotRow;
  prev1: ProcessedCotRow | null;
  prev4: ProcessedCotRow | null;
  market: "ny" | "ldn";
  unit: CpUnit;
}) {
  const mtFactor = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
  const usdPerMT = market === "ny" ? latest.priceNY * CENTS_LB_TO_USD_TON : latest.priceLDN;

  const cv = (row: ProcessedCotRow, field: string | string[]): number => {
    const obj = (row[market] as unknown as Record<string, number>) ?? {};
    const contracts: number = Array.isArray(field)
      ? field.reduce((s: number, f: string) => s + (obj[f] ?? 0), 0)
      : (obj[field] ?? 0);
    if (unit === "contracts") return contracts;
    const mt = contracts * mtFactor;
    return unit === "mt" ? mt : mt * usdPerMT;
  };

  const gs = (row: ProcessedCotRow, f: string): number => (row[market] as unknown as Record<string, number>)?.[f] ?? 0;

  const fmtVal = (v: number): string => {
    if (unit === "usd") return `$${(v / 1_000_000_000).toFixed(2)}B`;
    if (unit === "mt")  return `${(v / 1_000).toFixed(0)}k MT`;
    return `${(v / 1_000).toFixed(0)}k lots`;
  };
  const fmtDelta = (v: number): string => {
    const sign = v >= 0 ? "+" : "";
    if (unit === "usd") return `${sign}$${(v / 1_000_000).toFixed(0)}M`;
    if (unit === "mt")  return `${sign}${(v / 1_000).toFixed(1)}k`;
    return `${sign}${(v / 1_000).toFixed(1)}k`;
  };
  const dc = (v: number | null, invert = false): string =>
    v == null ? "text-slate-600" : v === 0 ? "text-slate-500"
      : (invert ? v < 0 : v > 0) ? "text-emerald-400" : "text-red-400";

  const longData  = CP_CATS.map(c => ({ name: c.name + " Long",  value: cv(latest, c.longF),  fill: c.longC  }));
  const shortData = CP_CATS.map(c => ({ name: c.name + " Short", value: cv(latest, c.shortF), fill: c.shortC }));
  const pieData   = [...longData, ...shortData];
  const totalLong = longData.reduce((s, d) => s + d.value, 0);
  const oiTotal   = (market === "ny" ? latest.oiNY : latest.oiLDN) ?? 0;

  const totalSpread     = CP_SPREADS.reduce((s, c) => s + gs(latest, c.f), 0);
  const prevTotalSpread = prev1 ? CP_SPREADS.reduce((s, c) => s + gs(prev1, c.f), 0) : null;
  const spreadWow       = prevTotalSpread != null ? totalSpread - prevTotalSpread : null;

  const tooltipStyle = { backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px" };

  return (
    <div>
      <div className="relative h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%"
              startAngle={90} endAngle={450}
              innerRadius={46} outerRadius={82} paddingAngle={1} dataKey="value">
              {pieData.map((_: unknown, i: number) => <Cell key={i} fill={pieData[i].fill} stroke="rgba(0,0,0,0)" />)}
              <Label value={fmtVal(totalLong)} position="center" fill="#f1f5f9" fontSize={11} fontWeight="bold" dy={-7} />
              <Label value={`OI: ${(oiTotal / 1000).toFixed(0)}k`} position="center" fill="#94a3b8" fontSize={9} dy={7} />
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ fontSize: 10 }}
              formatter={(v: unknown, name: unknown) => [fmtVal(Number(v)), String(name ?? "")]} />
          </PieChart>
        </ResponsiveContainer>
        <span className="absolute text-[8px] font-bold text-emerald-400 uppercase" style={{ top: "50%", left: 4, transform: "translateY(-50%)" }}>← L</span>
        <span className="absolute text-[8px] font-bold text-red-400 uppercase" style={{ top: "50%", right: 4, transform: "translateY(-50%)" }}>S →</span>
      </div>

      <div className="mt-1">
        <div className="grid pb-1 border-b border-slate-700/50 gap-1" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr" }}>
          <span></span>
          <span className="text-[8px] text-emerald-700 font-bold text-center uppercase">L 1W</span>
          <span className="text-[8px] text-emerald-700 font-bold text-center uppercase">L 4W</span>
          <span className="text-[8px] text-red-700 font-bold text-center uppercase">S 1W</span>
          <span className="text-[8px] text-red-700 font-bold text-center uppercase">S 4W</span>
        </div>
        {CP_CATS.map(cat => {
          const ld1 = prev1 ? cv(latest, cat.longF)  - cv(prev1, cat.longF)  : null;
          const ld4 = prev4 ? cv(latest, cat.longF)  - cv(prev4, cat.longF)  : null;
          const sd1 = prev1 ? cv(latest, cat.shortF) - cv(prev1, cat.shortF) : null;
          const sd4 = prev4 ? cv(latest, cat.shortF) - cv(prev4, cat.shortF) : null;
          return (
            <div key={cat.name} className="grid gap-1 py-0.5 items-center" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr" }}>
              <div className="flex items-center gap-1 pr-2">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.longC }} />
                <span className="text-[8px] text-slate-400">{cat.name}</span>
              </div>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(ld1)}`}>{ld1 == null ? "—" : fmtDelta(ld1)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(ld4)}`}>{ld4 == null ? "—" : fmtDelta(ld4)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(sd1, true)}`}>{sd1 == null ? "—" : fmtDelta(sd1)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(sd4, true)}`}>{sd4 == null ? "—" : fmtDelta(sd4)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Spreading</span>
          <span className="text-[9px] text-slate-500">
            {(totalSpread / 1000).toFixed(1)}k lots
            {spreadWow != null && (
              <span className={`ml-1 font-bold ${spreadWow > 0 ? "text-emerald-400" : spreadWow < 0 ? "text-red-400" : "text-slate-500"}`}>
                ({spreadWow >= 0 ? "+" : ""}{(spreadWow / 1000).toFixed(1)}k WoW)
              </span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-3 text-[8px] text-slate-500 font-bold uppercase pb-0.5 border-b border-slate-700/50 gap-1">
          <span></span>
          <span className="text-center">Lots</span>
          <span className="text-center">WoW</span>
        </div>
        {CP_SPREADS.map(cat => {
          const cur = gs(latest, cat.f);
          const wow = prev1 ? cur - gs(prev1, cat.f) : null;
          return (
            <div key={cat.name} className="grid grid-cols-3 items-center gap-1 py-0.5">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[8px] text-slate-400">{cat.name}</span>
              </div>
              <span className="text-[9px] text-slate-300 text-center tabular-nums">{(cur / 1000).toFixed(1)}k</span>
              <span className={`text-[9px] text-center tabular-nums ${wow == null ? "text-slate-600" : wow > 0 ? "text-emerald-400" : wow < 0 ? "text-red-400" : "text-slate-500"}`}>
                {wow == null ? "—" : (wow >= 0 ? "+" : "") + (wow / 1000).toFixed(1) + "k"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
