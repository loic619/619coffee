"use client";
// Vietnam — national coffee IMPORTS, from the Customs 1n (imports-by-
// commodity) bulletins via the vn_fertilizer harvest. The customs 5N
// by-country table carries no coffee line, so national is the only import
// figure the bulletins publish. Renders nothing until the first harvest
// lands (the JSON appears after the monthly vn_fertilizer run + export).
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

interface ImportMonth {
  month: string;
  tonnes: number | null;        // null = partial first month (YTD only)
  value_usd: number | null;
  ytd_tonnes: number;
  ytd_usd: number;
}

interface ImportsData {
  source: string;
  unit: string;
  note?: string;
  monthly: ImportMonth[];
}

const TT_STYLE = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 6, fontSize: 11,
} as const;

const shortMonth = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1]}-${y.slice(2)}`;
};

export default function CoffeeImportsPanel() {
  const [data, setData] = useState<ImportsData | null>(null);

  useEffect(() => {
    fetch("/data/vn_coffee_imports.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.monthly?.length) setData(d); })
      .catch(() => { /* absent until the first 1n harvest — stay hidden */ });
  }, []);

  const rows = useMemo(
    () => (data?.monthly ?? [])
      .filter(m => m.tonnes !== null)
      .map(m => ({
        label: shortMonth(m.month),
        tonnes: m.tonnes as number,
        usd: m.value_usd,
        ytd: m.ytd_tonnes,
      })),
    [data],
  );

  if (!data || rows.length === 0) return null;

  const latest = data.monthly[data.monthly.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Imports · National</div>
          <div className="text-[10px] text-slate-500">
            Monthly tonnes · Vietnam Customs 1N bulletins
            {latest && ` · YTD ${Math.round(latest.ytd_tonnes).toLocaleString()} t`}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis tickFormatter={v => `${Math.round(v / 1000)}kt`}
            tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <Tooltip contentStyle={TT_STYLE} itemStyle={{ color: "#94a3b8" }}
            formatter={((v, _name, item) => {
              const usd = (item?.payload as { usd: number | null } | undefined)?.usd;
              return [
                <span key="v" style={{ color: "#f59e0b" }}>
                  {`${Math.round(Number(v)).toLocaleString()} t`}
                  {usd != null ? ` · $${(usd / 1e6).toFixed(1)}M` : ""}
                </span>,
                "Imports" as NameType,
              ];
            }) satisfies Formatter<ValueType, NameType>} />
          <Bar dataKey="tonnes" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-2 text-[8px] text-slate-600 leading-relaxed">
        Source: {data.source}. {data.note ?? ""}
      </div>
    </div>
  );
}
