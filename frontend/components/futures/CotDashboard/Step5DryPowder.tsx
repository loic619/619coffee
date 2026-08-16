"use client";
import { useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { LegendProps } from "recharts";
import { ARABICA_MT_FACTOR, ROBUSTA_MT_FACTOR } from "@/lib/cot/transformApiData";
import type { CotMarketPositions, CotTradersGroup, CotTradersGroupShort, ProcessedCotRow } from "@/lib/cot/types";
import { CAT_ITEMS, CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";
import { CatToggles } from "./Toggles";

type PositionField = keyof CotMarketPositions;
type TradersCat = keyof CotTradersGroup;
type DpCatKey = "pmpu" | "mm" | "swap" | "other" | "nonrep";

const OI_PREFIX: Record<DpCatKey, "pmpu" | "mm" | "swap" | "other" | "nonRep"> = {
  pmpu: "pmpu", mm: "mm", swap: "swap", other: "other", nonrep: "nonRep",
};

export default function Step5DryPowder({ data }: { data: ProcessedCotRow[] }) {
  const [dpCats, setDpCats] = useState<Record<DpCatKey, boolean>>({ pmpu: false, mm: true, swap: false, other: false, nonrep: false });

  const processedDpData = useMemo(() => {
    const compute = (market: "ny" | "ldn") => {
      const byTf: Record<string, { date: string; traders: number; oi: number }[]> = {
        historical: [], year: [], recent_4: [], recent_1: [], current: [],
      };
      const mt = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
      data.forEach(d => {
        const trL: CotTradersGroup | undefined = market === "ny" ? d.tradersNY : d.tradersLDN;
        const trS: CotTradersGroupShort | undefined = market === "ny" ? d.tradersNY_short : d.tradersLDN_short;
        let dpLong = 0, dpShort = 0, dpTradersLong = 0, dpTradersShort = 0;
        (Object.keys(dpCats) as DpCatKey[]).forEach(cat => {
          if (dpCats[cat]) {
            const prefix = OI_PREFIX[cat];
            const mktOi = d[market];
            dpLong         += mktOi[`${prefix}Long`  as PositionField] * mt;
            dpShort        += mktOi[`${prefix}Short` as PositionField] * mt;
            dpTradersLong  += trL?.[cat as TradersCat] ?? 0;
            dpTradersShort += trS?.[cat as TradersCat] ?? 0;
          }
        });
        const tf = d.timeframe;
        if (byTf[tf]) {
          if (dpTradersLong  > 0) byTf[tf].push({ date: d.date, traders: dpTradersLong,  oi: dpLong  });
          if (dpTradersShort > 0) byTf[tf].push({ date: d.date, traders: dpTradersShort, oi: -dpShort });
        }
      });
      return byTf;
    };
    return { ny: compute("ny"), ldn: compute("ldn") };
  }, [data, dpCats]);

  const dpDomain = useMemo(() => {
    const calc = (byTf: Record<string, { date: string; traders: number; oi: number }[]>) => {
      const all = Object.values(byTf).flat();
      if (!all.length) return { x: [0, 1000] as [number, number], y: [-5000000, 5000000] as [number, number] };
      const tVals = all.map(p => p.traders).filter(v => v > 0);
      const oVals = all.map(p => p.oi);
      const tMin  = tVals.length ? Math.min(...tVals) : 0;
      const tMax  = tVals.length ? Math.max(...tVals) : 1000;
      const oMin  = oVals.length ? Math.min(...oVals) : -5000000;
      const oMax  = oVals.length ? Math.max(...oVals) : 5000000;
      // Tight padding so the point cloud fills the frame — the dominant "squeeze"
      // was ~10% empty margin baked into the domain on every side, which no card
      // resize could recover. ~3% keeps points off the very edge without wasting
      // space. (No clipping: tMin/tMax/oMin/oMax still span every point.)
      const tPad  = (tMax - tMin) * 0.03 || 2;
      const oPad  = Math.max(Math.abs(oMax), Math.abs(oMin)) * 0.03;
      return {
        x: [Math.floor(tMin - tPad), Math.ceil(tMax + tPad)] as [number, number],
        y: [Math.floor(oMin < 0 ? oMin * 1.03 : oMin - oPad), Math.ceil(oMax > 0 ? oMax * 1.03 : oMax + oPad)] as [number, number],
      };
    };
    return { ny: calc(processedDpData.ny), ldn: calc(processedDpData.ldn) };
  }, [processedDpData]);

  const mkScatter = (market: "ny" | "ldn") => {
    const d = processedDpData[market];
    const dom = dpDomain[market];
    const legendContent: LegendProps["content"] = (props) => {
      const items = [...(props.payload ?? [])].reverse();
      return (
        <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 10, paddingTop: 8 }}>
          {items.map((e, i: number) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#94a3b8" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: e.color, display: "inline-block" }} />
              {e.value}
            </span>
          ))}
        </div>
      );
    };
    return (
      <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl h-[460px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="traders" name="# traders" stroke="#475569" fontSize={10}
              domain={dom.x} height={20} />
            {/* width kept tight (just the tick labels); the rotated "OI (k MT)"
                and "# traders" titles are dropped — the section subtitle already
                names both axes — so the plot isn't boxed into the centre. */}
            <YAxis type="number" dataKey="oi" name="OI" stroke="#475569" fontSize={10}
              domain={dom.y} width={34}
              tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
              formatter={((v, name) => name === "# traders"
                ? [Math.round(Number(v)).toString(), name as NameType]
                : [`${(Number(v) / 1000).toFixed(1)}k MT`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} content={legendContent} />
            {/* eslint-disable @typescript-eslint/no-explicit-any */}
            <Scatter name="Historic"   data={d.historical} fill="#bfdbfe" fillOpacity={0.18} {...{ size: 12  } as any} />
            <Scatter name="Prior Y"    data={d.year}       fill="#3b82f6" fillOpacity={0.45} {...{ size: 28  } as any} />
            <Scatter name="Prior 4W"   data={d.recent_4}   fill="#eab308" fillOpacity={0.9}  {...{ size: 78  } as any} />
            <Scatter name="Prior week" data={d.recent_1}   fill="#c2410c" fillOpacity={1.0}  {...{ size: 154 } as any} />
            <Scatter name="Last CoT"   data={d.current}    fill="#ef4444" fillOpacity={1.0}  {...{ size: 314 } as any} />
            {/* eslint-enable @typescript-eslint/no-explicit-any */}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div id="cot-section-5">
      <SectionHeader icon="Droplets" title="Dry Powder Indicator"
        subtitle="Gross Long OI (positive) and Gross Short OI (negative) vs number of traders. Color = recency." />
      <div className="flex items-center gap-3 mb-4">
        <CatToggles cats={dpCats} set={k => setDpCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
          {mkScatter("ny")}
        </div>
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
          {mkScatter("ldn")}
        </div>
      </div>
    </div>
  );
}
