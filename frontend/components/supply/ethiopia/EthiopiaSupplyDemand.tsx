"use client";
import { chgTone } from "@/lib/formatters";
import { ComposedChart, Bar, Line, LabelList, XAxis, YAxis, Tooltip, Legend, LineChart, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  SD_BALANCE, PRODUCTION_BY_REGION, PRODUCTION_TOTAL, DOMESTIC_CONSUMPTION,
  FORECAST_2627, HEADLINE, STONEX_META, type RegionRow,
} from "./stonexSurvey";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const chgCls = (v: number) => (chgTone(v));
const chgStr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function StoneXHeader({ title }: { title: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{title}</div>
      <div className="text-[8px] text-slate-600">{STONEX_META.source} · {STONEX_META.cropYear}</div>
    </div>
  );
}

export default function EthiopiaSupplyDemand() {
  const sd = SD_BALANCE.map(r => ({ ...r }));
  const cons = DOMESTIC_CONSUMPTION.series_mBags.map(d => ({ ...d, k: d.value * 1000 }));
  const balance = SD_BALANCE.map(r => {
    const delta = r.ending - r.opening;
    return {
      year: r.year, opening: r.opening, exports: r.exports, consumption: r.consumption,
      stockBuild: Math.max(delta, 0), stockDraw: Math.min(delta, 0), production: r.production,
    };
  });
  const segLabel = (v: unknown) => {
    const n = Number(v);
    return n && Math.abs(n) >= 1 ? Math.round(n).toLocaleString() : "";
  };

  return (
    <div className="space-y-3">
      {/* Headline */}
      <div className={CARD}>
        <StoneXHeader title="2025/26 Crop — Headline" />
        <div className="grid grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Production</div>
            <div className="text-white font-bold">{HEADLINE.production2526_mBags.toFixed(2)}M</div>
            <div className={`text-[9px] font-semibold ${chgCls(HEADLINE.productionChangePct)}`}>{chgStr(HEADLINE.productionChangePct)} YoY</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Productivity</div>
            <div className="text-white font-bold">+{HEADLINE.productivityChangePct}%</div>
            <div className="text-[9px] text-slate-600">W/SW-led</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Avg yield</div>
            <div className="text-white font-bold">{HEADLINE.avgYieldKgHa}</div>
            <div className="text-[9px] text-slate-600">kg green/ha</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Rank (arabica)</div>
            <div className="text-white font-bold">#{HEADLINE.rankArabica}</div>
            <div className="text-[9px] text-slate-600">#{HEADLINE.rankGlobal} overall</div>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 leading-relaxed">{HEADLINE.summary}</div>
      </div>

      {/* S&D balance */}
      <div className={CARD}>
        <StoneXHeader title="Supply & Demand Balance (thousand 60-kg bags)" />
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={balance} stackOffset="sign" margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT} formatter={(v: unknown, n) => [`${Number(v).toLocaleString()}k bags`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"     stackId="a" fill="#64748b">
                <LabelList dataKey="opening"     position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} />
              </Bar>
              <Bar dataKey="exports"     name="Exports"     stackId="a" fill="#f59e0b">
                <LabelList dataKey="exports"     position="center" fontSize={8} fill="#1e293b" formatter={segLabel} />
              </Bar>
              <Bar dataKey="consumption" name="Consumption" stackId="a" fill="#3b82f6">
                <LabelList dataKey="consumption" position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} />
              </Bar>
              <Bar dataKey="stockBuild"  name="Stock build" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]}>
                <LabelList dataKey="stockBuild"  position="center" fontSize={8} fill="#0b1220" formatter={segLabel} />
              </Bar>
              <Bar dataKey="stockDraw"   name="Stock draw"  stackId="a" fill="#ef4444">
                <LabelList dataKey="stockDraw"   position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} />
              </Bar>
              <Line dataKey="production" name="Production"  type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 px-1 text-right font-medium">Open</th>
                <th className="py-1 px-1 text-right font-medium">Prod</th>
                <th className="py-1 px-1 text-right font-medium">Supply</th>
                <th className="py-1 px-1 text-right font-medium">Cons</th>
                <th className="py-1 px-1 text-right font-medium">Exports</th>
                <th className="py-1 pl-1 text-right font-medium">End</th>
              </tr>
            </thead>
            <tbody>
              {sd.map(r => (
                <tr key={r.year} className={`border-t border-slate-700/50 ${r.year === "25/26" ? "text-amber-300" : "text-slate-300"}`}>
                  <td className="py-0.5 pr-2">{r.year}</td>
                  <td className="py-0.5 px-1 text-right">{r.opening.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.production.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.total.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.consumption.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.exports.toLocaleString()}</td>
                  <td className="py-0.5 pl-1 text-right">{r.ending.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] text-slate-500 leading-relaxed">
          Each column = total supply: Opening + Exports + Consumption + stock change. The upper three segments sum to Production
          (purple line). Green = stock build; red below the axis = destock (exports/consumption drew down stocks, e.g. 24/25&apos;s
          record drain). Lower exports (-30%) and weaker consumption let 25/26 ending stocks recover to 1.794M bags.
        </div>
      </div>

      {/* Production by region */}
      <div className={CARD}>
        <StoneXHeader title="Production by Region (thousand bags)" />
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-1 pr-2 font-medium">Region</th>
              <th className="py-1 px-2 text-right font-medium">23/24</th>
              <th className="py-1 px-2 text-right font-medium">24/25</th>
              <th className="py-1 px-2 text-right font-medium">25/26</th>
              <th className="py-1 pl-2 text-right font-medium">YoY</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTION_BY_REGION.map((g: RegionRow) => (
              <RegionGroup key={g.region} row={g} />
            ))}
            <tr className="border-t-2 border-slate-600 text-white font-bold">
              <td className="py-1 pr-2">{PRODUCTION_TOTAL.region}</td>
              <td className="py-1 px-2 text-right">{PRODUCTION_TOTAL.y2324.toLocaleString()}</td>
              <td className="py-1 px-2 text-right">{PRODUCTION_TOTAL.y2425.toLocaleString()}</td>
              <td className="py-1 px-2 text-right">{PRODUCTION_TOTAL.y2526.toLocaleString()}</td>
              <td className={`py-1 pl-2 text-right ${chgCls(PRODUCTION_TOTAL.changePct)}`}>{chgStr(PRODUCTION_TOTAL.changePct)}</td>
            </tr>
          </tbody>
        </table>
        <div className="text-[9px] text-slate-500">
          West +22% and Southwest +49% (high cycle, favourable flowering) offset a -40% South collapse (low cycle + young replants + disease).
        </div>
      </div>

      {/* Domestic consumption */}
      <div className={CARD}>
        <StoneXHeader title="Domestic Consumption — Structural Decline (million bags)" />
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cons} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} domain={[0, 3]} />
              <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${Number(v).toFixed(2)}M bags`, "Consumption"]} />
              <Line dataKey="value" type="monotone" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px] text-slate-400 leading-relaxed">
          -{DOMESTIC_CONSUMPTION.declinePct6y}% in six years (2.92M → 1.5M bags). City green coffee now Birr {DOMESTIC_CONSUMPTION.retail.cityGreenBirrKg}/kg
          (vs {DOMESTIC_CONSUMPTION.retail.cityGreenPriorYearBirrKg} a year earlier). {DOMESTIC_CONSUMPTION.context}
        </div>
      </div>

      {/* 2026/27 estimate */}
      <div className={CARD}>
        <StoneXHeader title="Preliminary 2026/27 Estimate (thousand bags)" />
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-1 pr-2 font-medium">Region</th>
              <th className="py-1 px-2 text-right font-medium">25/26</th>
              <th className="py-1 px-2 text-right font-medium">26/27e</th>
              <th className="py-1 pl-2 text-right font-medium">YoY</th>
            </tr>
          </thead>
          <tbody>
            {FORECAST_2627.rows.map(r => (
              <tr key={r.region} className="border-t border-slate-700/50 text-slate-300">
                <td className="py-0.5 pr-2">{r.region}</td>
                <td className="py-0.5 px-2 text-right">{r.y2526.toLocaleString()}</td>
                <td className="py-0.5 px-2 text-right">{r.y2627.toLocaleString()}</td>
                <td className={`py-0.5 pl-2 text-right ${chgCls(r.changePct)}`}>{chgStr(r.changePct)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-600 text-white font-bold">
              <td className="py-1 pr-2">{FORECAST_2627.total.region}</td>
              <td className="py-1 px-2 text-right">{FORECAST_2627.total.y2526.toLocaleString()}</td>
              <td className="py-1 px-2 text-right">{FORECAST_2627.total.y2627.toLocaleString()}</td>
              <td className={`py-1 pl-2 text-right ${chgCls(FORECAST_2627.total.changePct)}`}>{chgStr(FORECAST_2627.total.changePct)}</td>
            </tr>
          </tbody>
        </table>
        <div className="text-[9px] text-slate-500">{FORECAST_2627.note}</div>
      </div>
    </div>
  );
}

function RegionGroup({ row }: { row: RegionRow }) {
  return (
    <>
      <tr className="border-t border-slate-700 text-slate-100 font-semibold">
        <td className="py-1 pr-2">{row.region}</td>
        <td className="py-1 px-2 text-right">{row.y2324.toLocaleString()}</td>
        <td className="py-1 px-2 text-right">{row.y2425.toLocaleString()}</td>
        <td className="py-1 px-2 text-right">{row.y2526.toLocaleString()}</td>
        <td className={`py-1 pl-2 text-right ${chgCls(row.changePct)}`}>{chgStr(row.changePct)}</td>
      </tr>
      {row.sub?.map(s => (
        <tr key={s.region} className="text-slate-400">
          <td className="py-0.5 pr-2 pl-3">{s.region}</td>
          <td className="py-0.5 px-2 text-right">{s.y2324.toLocaleString()}</td>
          <td className="py-0.5 px-2 text-right">{s.y2425.toLocaleString()}</td>
          <td className="py-0.5 px-2 text-right">{s.y2526.toLocaleString()}</td>
          <td className={`py-0.5 pl-2 text-right ${chgCls(s.changePct)}`}>{chgStr(s.changePct)}</td>
        </tr>
      ))}
    </>
  );
}
