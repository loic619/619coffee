"use client";
import { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, bagsToKT, type UgandaMonthlyRow } from "./helpers";

/** Stacked monthly bars (Robusta / Arabica in kt) with a Robusta-share %
 *  line overlay. Last 24 months by default. Matches Brazil's
 *  TypeShareChart visual language. */
export default function UgandaTypeShareChart({ monthly }: { monthly: UgandaMonthlyRow[] }) {
  const data = useMemo(() => {
    return monthly
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-24)
      .map(r => {
        const rob = r.robusta_bags ?? 0;
        const ara = r.arabica_bags ?? 0;
        const total = rob + ara;
        return {
          month:   r.month.slice(2),                      // "YY-MM"
          robusta: bagsToKT(rob),
          arabica: bagsToKT(ara),
          rob_pct: total > 0 ? Math.round(rob / total * 1000) / 10 : 0,
        };
      });
  }, [monthly]);

  if (data.length < 3) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Robusta vs Arabica · Monthly Mix</div>
        <div className="text-[10px] text-slate-500">
          Last 24 months · Stacked kt · Line = Robusta share (%)
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 9 }} interval={2} />
          <YAxis yAxisId="kt"
            tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]}
            tickFormatter={v => `${v}%`} tick={{ fill: "#a3a3a3", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => {
              if (name === "rob_pct") return [`${v}%`, "Robusta share" as NameType];
              if (name === "robusta") return [`${v} kt`, "Robusta" as NameType];
              if (name === "arabica") return [`${v} kt`, "Arabica" as NameType];
              return [`${v}`, name as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === "robusta" ? "Robusta" : v === "arabica" ? "Arabica" : "Robusta share"}
              </span>
            )} />
          <Bar yAxisId="kt" dataKey="robusta" stackId="a" fill="#f59e0b" />
          <Bar yAxisId="kt" dataKey="arabica" stackId="a" fill="#22c55e" />
          <Line yAxisId="pct" type="monotone" dataKey="rob_pct"
            stroke="#fbbf24" strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
