"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { chgTone } from "@/lib/formatters";

export interface AnnualExportRow {
  year: string;
  total_k_bags: number;
  yoy_pct: number | null;
}

export interface AnnualExports {
  source: string;
  last_updated: string;
  unit: string;
  annual: AnnualExportRow[];
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const toMT = (k: number) => Math.round(k * 60);

/** Annual green-coffee export series (USDA PSD marketing-year data) for origins
 *  with no monthly feed. Shared by the Colombia/Honduras/Indonesia/Ethiopia
 *  Supply tabs. */
export default function AnnualExportsPanel({
  exports: exp,
  title,
}: {
  exports: AnnualExports;
  title: string;
}) {
  const rows = exp.annual;
  const data = rows.map(r => ({ year: r.year, mt: toMT(r.total_k_bags), yoy: r.yoy_pct }));
  const last = rows[rows.length - 1];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{title}</div>
        <div className="text-[8px] text-slate-600">{exp.source} · {exp.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest MY {last?.year}</div>
          <div className="text-white font-bold">{last ? toMT(last.total_k_bags).toLocaleString() : "—"}</div>
          <div className="text-[9px] text-slate-600">metric tons</div>
          {last?.yoy_pct != null && (
            <div className={`text-[9px] font-semibold ${chgTone(last.yoy_pct)}`}>
              {last.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(last.yoy_pct).toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest MY {last?.year}</div>
          <div className="text-white font-bold">{last ? (last.total_k_bags / 1000).toFixed(2) : "—"}M</div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Coverage</div>
          <div className="text-white font-bold">{rows.length}</div>
          <div className="text-[9px] text-slate-600">marketing years</div>
        </div>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 2, right: 36, left: -10, bottom: 0 }}>
            <XAxis dataKey="year" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="vol" orientation="left"  tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
            <YAxis yAxisId="yoy" orientation="right" tick={{ fontSize: 7, fill: "#f59e0b" }} axisLine={false} tickLine={false} width={32} tickFormatter={v => `${v}%`} />
            <ReferenceLine yAxisId="yoy" y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, name?: string | number) =>
                String(name) === "yoy"
                  ? [`${Number(v).toFixed(1)}%`, "YoY"]
                  : [`${Number(v).toLocaleString()} MT`, "Exports"]
              }
            />
            <Bar  yAxisId="vol" dataKey="mt"  name="vol" fill="#22c55e" opacity={0.8} radius={[2,2,0,0]} />
            <Line yAxisId="yoy" dataKey="yoy" name="yoy" type="monotone" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-600">
        USDA FAS PSD — annual green-coffee bean exports by marketing year. Monthly granularity
        pending a national-source scraper (FNC / BPS / IHCAFE / ECTA).
      </div>
    </div>
  );
}
