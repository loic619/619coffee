"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { MONTH_ABBR, chgTone } from "@/lib/formatters";

interface ExportMonth {
  month: string;
  total_k_bags: number;
  yoy_pct: number | null;
}

interface ExportsData {
  source: string;
  last_updated: string;
  unit: string;
  monthly: ExportMonth[];
}

interface EcxPrice {
  etb_per_kg: number;
  as_of: string;
  grade: string;
}


function fmtMonth(m: string) {
  const [yr, mo] = m.split("-");
  return `${MONTH_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const toMT = (k: number) => Math.round(k * 60);

export default function EthiopiaExportPanel({
  exports: exp,
  ecx_price,
}: {
  exports: ExportsData;
  ecx_price: EcxPrice | null;
}) {
  const recent    = exp.monthly.slice(-24);
  const chartData = recent.map(m => ({
    month: fmtMonth(m.month),
    mt:    toMT(m.total_k_bags),
    yoy:   m.yoy_pct,
  }));

  const last   = recent[recent.length - 1];
  const prev12 = recent.slice(-13, -1);
  const avg12MT = prev12.length > 0
    ? Math.round(prev12.reduce((s, r) => s + toMT(r.total_k_bags), 0) / prev12.length)
    : null;
  const ytdRows = recent.filter(r => r.month.startsWith(last?.month.slice(0, 4)));
  const ytdMT   = ytdRows.reduce((s, r) => s + toMT(r.total_k_bags), 0);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Ethiopia Green Coffee Exports
        </div>
        <div className="text-[8px] text-slate-600">{exp.source} · {fmtMonth(exp.last_updated)}</div>
      </div>

      <div className="grid grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Last month</div>
          <div className="text-white font-bold">{last ? toMT(last.total_k_bags).toLocaleString() : "—"}</div>
          <div className="text-[9px] text-slate-600">metric tons</div>
          {last?.yoy_pct != null && (
            <div className={`text-[9px] font-semibold ${chgTone(last.yoy_pct)}`}>
              {last.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(last.yoy_pct).toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">12-mo avg</div>
          <div className="text-white font-bold">{avg12MT?.toLocaleString() ?? "—"}</div>
          <div className="text-[9px] text-slate-600">MT / month</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">YTD {last?.month.slice(0, 4)}</div>
          <div className="text-white font-bold">{(ytdMT / 1000).toFixed(0)}k</div>
          <div className="text-[9px] text-slate-600">metric tons</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">ECX Price</div>
          {ecx_price ? (
            <>
              <div className="text-green-400 font-bold">{ecx_price.etb_per_kg.toFixed(1)}</div>
              <div className="text-[9px] text-slate-600">ETB/kg</div>
              <div className="text-[9px] text-slate-500">{ecx_price.as_of}</div>
            </>
          ) : (
            <div className="text-slate-500 text-[9px]">—</div>
          )}
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 2, right: 36, left: -10, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis yAxisId="vol" orientation="left"  tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
            <YAxis yAxisId="yoy" orientation="right" tick={{ fontSize: 7, fill: "#f59e0b" }} axisLine={false} tickLine={false} width={32} tickFormatter={v => `${v}%`} />
            <ReferenceLine yAxisId="yoy" y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, name?: string | number) => {
                if (String(name) === "yoy") return [`${Number(v).toFixed(1)}%`, "YoY vs same month prior year"];
                return [`${Number(v).toLocaleString()} MT`, "Volume"];
              }}
            />
            <Bar  yAxisId="vol" dataKey="mt"  name="vol" fill="#22c55e" opacity={0.8} radius={[2,2,0,0]} />
            <Line yAxisId="yoy" dataKey="yoy" name="yoy" type="monotone" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-600">
        Source: ICO Historical CSV. Ethiopia: world&apos;s largest arabica origin, 5th largest exporter (~7M bags/yr). 100% arabica.
      </div>
    </div>
  );
}
