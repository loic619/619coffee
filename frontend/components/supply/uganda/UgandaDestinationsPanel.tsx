"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface DestRow {
  rank: number;
  country: string;
  robusta_bags?: number;
  arabica_bags?: number;
  total_bags: number;
  pct_individual?: number;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const toK = (b: number) => Math.round(b / 1000);

export default function UgandaDestinationsPanel({
  destinations,
  month,
}: {
  destinations: DestRow[];
  month: string;
}) {
  if (!destinations || destinations.length === 0) {
    return (
      <div className="text-xs text-slate-500 text-center py-6">
        Destination data not available
      </div>
    );
  }

  const top10 = destinations.slice(0, 10);
  const hasRobArab = top10.some(d => d.robusta_bags != null);

  const chartData = top10.map(d => ({
    name: d.country,
    robusta: d.robusta_bags ? toK(d.robusta_bags) : undefined,
    arabica: d.arabica_bags ? toK(d.arabica_bags) : undefined,
    total:   toK(d.total_bags),
    pct:     d.pct_individual,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Top Export Destinations
        </div>
        <div className="text-[8px] text-slate-600">UCDA · {month}</div>
      </div>

      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical"
            margin={{ top: 0, right: 60, left: 70, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false}
              tickFormatter={v => `${v}k`} />
            <YAxis type="category" dataKey="name"
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false} tickLine={false} width={65} />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, name?: string | number) => {
                const label = String(name);
                return [`${Number(v).toLocaleString()}k bags`, label];
              }}
            />
            {hasRobArab ? (
              <>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 8, paddingTop: 4 }} />
                <Bar dataKey="robusta" name="Robusta" stackId="a" fill="#f59e0b" radius={[0,0,0,0]} />
                <Bar dataKey="arabica" name="Arabica" stackId="a" fill="#22c55e" radius={[0,2,2,0]} />
              </>
            ) : (
              <Bar dataKey="total" name="Total" fill="#f59e0b" radius={[0,2,2,0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* % share table for top 5 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {top10.slice(0, 10).map(d => (
          <div key={d.country} className="flex items-center justify-between text-[9px]">
            <span className="text-slate-400 truncate max-w-[90px]">
              {d.rank}. {d.country}
            </span>
            <span className="text-slate-300 ml-1 font-mono">
              {d.pct_individual != null ? `${d.pct_individual.toFixed(1)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
