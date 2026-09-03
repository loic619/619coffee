"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { MONTH_ABBR, chgTone } from "@/lib/formatters";

interface ExportMonth {
  month: string;
  total_bags: number;
  total_k_bags: number;
  robusta_bags?: number;
  arabica_bags?: number;
  robusta_k_bags?: number;
  arabica_k_bags?: number;
  robusta_pct?: number;
  arabica_pct?: number;
  avg_price_usd_kg?: number;
  total_value_usd?: number;
  yoy_pct?: number | null;
}

interface GradeRow {
  grade: string;
  qty_bags?: number;
  pct_qty?: number;
  value_usd?: number;
  pct_val?: number;
  price_usd_kg?: number;
}

interface Farmgate {
  kiboko_ugx_kg?: number;
  faq_ugx_kg?: number;
  arabica_parchment_ugx_kg?: number;
  drugar_ugx_kg?: number;
  mt_elgon_aplus_usd_kg?: number;
}

interface ExportsData {
  source: string;
  last_updated: string;
  unit: string;
  monthly: ExportMonth[];
}

interface UcdaPrice {
  usd_cwt?: number;
  as_of?: string;
  grade?: string;
}

interface UcdaDetail {
  month: string;
  grades: GradeRow[];
  farmgate: Farmgate;
}

const TT_STYLE   = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function fmtMonth(m: string) {
  const [yr, mo] = m.split("-");
  return `${MONTH_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

function toK(bags: number) { return Math.round(bags / 1000); }

export default function UgandaExportPanel({
  exports: exp,
  ucda_price,
  ucda_detail,
}: {
  exports: ExportsData;
  ucda_price: UcdaPrice | null;
  ucda_detail: UcdaDetail | null;
}) {
  const recent = exp.monthly.slice(-24);
  const last   = recent[recent.length - 1];
  const hasRobArab = recent.some(m => m.robusta_bags != null);

  const chartData = recent.map(m => ({
    month:   fmtMonth(m.month),
    total:   toK(m.total_bags),
    robusta: m.robusta_k_bags != null ? Math.round(m.robusta_k_bags) : undefined,
    arabica: m.arabica_k_bags != null ? Math.round(m.arabica_k_bags) : undefined,
    yoy:     m.yoy_pct,
  }));

  const prev12   = recent.slice(-13, -1);
  const avg12k   = prev12.length > 0
    ? Math.round(prev12.reduce((s, r) => s + toK(r.total_bags), 0) / prev12.length)
    : null;
  const ytdRows  = recent.filter(r => r.month.startsWith(last?.month.slice(0, 4)));
  const ytdBags  = ytdRows.reduce((s, r) => s + r.total_bags, 0);

  const usdMT    = ucda_price?.usd_cwt ? Math.round(ucda_price.usd_cwt * 22.046) : null;
  const latestPrice = last?.avg_price_usd_kg;
  const farmgate = ucda_detail?.farmgate;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Uganda Green Coffee Exports</div>
          <div className="text-[8px] text-slate-600">{exp.source} · {fmtMonth(exp.last_updated)}</div>
        </div>

        <div className="grid grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Last month</div>
            <div className="text-white font-bold">{last ? toK(last.total_bags).toLocaleString() : "—"}k</div>
            <div className="text-[9px] text-slate-600">bags (60-kg)</div>
            {last?.yoy_pct != null && (
              <div className={`text-[9px] font-semibold ${chgTone(last.yoy_pct)}`}>
                {last.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(last.yoy_pct).toFixed(1)}% YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">12-mo avg</div>
            <div className="text-white font-bold">{avg12k?.toLocaleString() ?? "—"}k</div>
            <div className="text-[9px] text-slate-600">bags / month</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">YTD {last?.month.slice(0, 4)}</div>
            <div className="text-white font-bold">{(ytdBags / 1000).toFixed(0)}k</div>
            <div className="text-[9px] text-slate-600">bags total</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Avg price</div>
            {latestPrice ? (
              <>
                <div className="text-amber-400 font-bold">${latestPrice.toFixed(2)}</div>
                <div className="text-[9px] text-slate-600">USD/kg FOB</div>
              </>
            ) : ucda_price?.usd_cwt ? (
              <>
                <div className="text-amber-400 font-bold">{ucda_price.usd_cwt.toFixed(2)}</div>
                <div className="text-[9px] text-slate-600">US¢/lb S15</div>
                <div className="text-[9px] text-slate-500">${usdMT?.toLocaleString()}/MT</div>
              </>
            ) : (
              <div className="text-slate-500 text-[9px]">—</div>
            )}
          </div>
        </div>

        {/* Split KPI if available */}
        {last?.robusta_pct != null && (
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-700">
            <div className="text-[9px]">
              <span className="text-amber-400 font-semibold">{last.robusta_pct.toFixed(1)}%</span>
              <span className="text-slate-500 ml-1">Robusta</span>
              <span className="text-slate-400 ml-2">{toK(last.robusta_bags!).toLocaleString()}k bags</span>
            </div>
            <div className="text-[9px]">
              <span className="text-emerald-400 font-semibold">{last.arabica_pct?.toFixed(1)}%</span>
              <span className="text-slate-500 ml-1">Arabica</span>
              <span className="text-slate-400 ml-2">{toK(last.arabica_bags!).toLocaleString()}k bags</span>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 36, left: -10, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false} tickLine={false} interval={2} />
              <YAxis yAxisId="vol" orientation="left"
                tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}k`} />
              <YAxis yAxisId="yoy" orientation="right"
                tick={{ fontSize: 7, fill: "#f59e0b" }} axisLine={false} tickLine={false}
                width={32} tickFormatter={v => `${v}%`} />
              <ReferenceLine yAxisId="yoy" y={0} stroke="#475569" strokeDasharray="3 3" />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name?: string | number) => {
                if (String(name) === "yoy") return [`${Number(v).toFixed(1)}%`, "YoY"];
                return [`${Number(v).toLocaleString()}k bags`, String(name)];
              }} />
              {hasRobArab ? (
                <>
                  <Bar yAxisId="vol" dataKey="robusta" name="robusta" stackId="a"
                    fill="#f59e0b" opacity={0.85} radius={[0,0,0,0]} />
                  <Bar yAxisId="vol" dataKey="arabica" name="arabica" stackId="a"
                    fill="#22c55e" opacity={0.85} radius={[2,2,0,0]} />
                </>
              ) : (
                <Bar yAxisId="vol" dataKey="total" name="total"
                  fill="#f59e0b" opacity={0.8} radius={[2,2,0,0]} />
              )}
              <Line yAxisId="yoy" dataKey="yoy" name="yoy" type="monotone"
                stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Farm-gate prices */}
      {farmgate && Object.keys(farmgate).length > 0 && (
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Farm-Gate Prices · {ucda_detail?.month}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
            {farmgate.kiboko_ugx_kg && (
              <div className="flex justify-between">
                <span className="text-slate-500">Kiboko (Robusta dry)</span>
                <span className="text-amber-400 font-mono">UGX {farmgate.kiboko_ugx_kg.toLocaleString()}/kg</span>
              </div>
            )}
            {farmgate.faq_ugx_kg && (
              <div className="flex justify-between">
                <span className="text-slate-500">FAQ (Fair Avg Quality)</span>
                <span className="text-amber-400 font-mono">UGX {farmgate.faq_ugx_kg.toLocaleString()}/kg</span>
              </div>
            )}
            {farmgate.arabica_parchment_ugx_kg && (
              <div className="flex justify-between">
                <span className="text-slate-500">Arabica Parchment</span>
                <span className="text-emerald-400 font-mono">UGX {farmgate.arabica_parchment_ugx_kg.toLocaleString()}/kg</span>
              </div>
            )}
            {farmgate.drugar_ugx_kg && (
              <div className="flex justify-between">
                <span className="text-slate-500">Drugar (washed arabica)</span>
                <span className="text-emerald-400 font-mono">UGX {farmgate.drugar_ugx_kg.toLocaleString()}/kg</span>
              </div>
            )}
            {farmgate.mt_elgon_aplus_usd_kg && (
              <div className="flex justify-between col-span-2">
                <span className="text-slate-500">Mt Elgon A+ (premium)</span>
                <span className="text-blue-400 font-mono">${farmgate.mt_elgon_aplus_usd_kg.toFixed(2)}/kg</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grade breakdown */}
      {ucda_detail?.grades && ucda_detail.grades.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Grade Breakdown · {ucda_detail.month}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700">
                  <th className="text-left pb-1 font-normal">Grade</th>
                  <th className="text-right pb-1 font-normal">Bags</th>
                  <th className="text-right pb-1 font-normal">Share</th>
                  <th className="text-right pb-1 font-normal">USD/kg</th>
                </tr>
              </thead>
              <tbody>
                {ucda_detail.grades.map(g => {
                  const isRobusta = /screen|robusta|bhp/i.test(g.grade);
                  return (
                    <tr key={g.grade} className="border-b border-slate-700/50">
                      <td className={`py-0.5 ${isRobusta ? "text-amber-300" : "text-emerald-300"}`}>
                        {g.grade}
                      </td>
                      <td className="text-right text-slate-300 font-mono">
                        {g.qty_bags?.toLocaleString() ?? "—"}
                      </td>
                      <td className="text-right text-slate-400 font-mono">
                        {g.pct_qty?.toFixed(1) ?? "—"}%
                      </td>
                      <td className="text-right text-slate-300 font-mono">
                        {g.price_usd_kg?.toFixed(2) ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[8px] text-slate-600 mt-1">
            Amber = robusta grades · Green = arabica grades · Source: UCDA Monthly Report
          </div>
        </div>
      )}
    </div>
  );
}
