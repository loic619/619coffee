"use client";
import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { AgronomyCard, H, P, LI } from "./prose";

// ── Article 3: Production Costs ───────────────────────────────────────────────

const NUTRIENTS = [
  { name: "K  (Potassium)",  kg: 46.9 },
  { name: "N  (Nitrogen)",   kg: 34.2 },
  { name: "P  (Phosphorus)", kg: 6.1  },
  { name: "Ca (Calcium)",    kg: 4.3  },
  { name: "Mg (Magnesium)",  kg: 4.1  },
];

const NUTRIENT_COLORS: Record<string, string> = {
  "K  (Potassium)":  "#f59e0b",
  "N  (Nitrogen)":   "#60a5fa",
  "P  (Phosphorus)": "#f472b6",
  "Ca (Calcium)":    "#a78bfa",
  "Mg (Magnesium)":  "#34d399",
};

function NutrientExtractionChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Nutrients permanently extracted per tonne of green beans
      </p>
      <ResponsiveContainer width="100%" height={185}>
        <BarChart
          data={NUTRIENTS}
          layout="vertical"
          margin={{ top: 4, right: 50, left: 110, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 55]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit=" kg"
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={105}
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={((v) => [`${v} kg / tonne`, "Extraction"]) satisfies Formatter<ValueType, NameType>}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Bar dataKey="kg" radius={[0, 3, 3, 0]}>
            {NUTRIENTS.map((n) => (
              <Cell key={n.name} fill={NUTRIENT_COLORS[n.name]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PhenologicalTimeline() {
  const events = [
    { label: "Dry S2", dose: "200 kg/ha", x: 60,  color: "#f59e0b", note: "Floral induction" },
    { label: "May",    dose: "500 kg/ha", x: 200, color: "#60a5fa", note: "Fruit set"        },
    { label: "July",   dose: "400 kg/ha", x: 340, color: "#34d399", note: "Bean expansion"   },
    { label: "Sep",    dose: "500 kg/ha", x: 480, color: "#f59e0b", note: "Maturation"       },
  ];
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        NPK application windows — mature coffee (total 1,600 kg/ha/year · 3 t/ha baseline)
      </p>
      <svg viewBox="0 0 560 88" className="w-full rounded overflow-hidden">
        <rect width="560" height="88" fill="#0f172a" />
        <rect x={40} y={38} width={480} height={3} fill="#334155" rx={2} />
        <text x={40}  y={53} textAnchor="middle" fontSize={8} fill="#64748b">Jan</text>
        <text x={520} y={53} textAnchor="middle" fontSize={8} fill="#64748b">Dec</text>
        {events.map((e) => (
          <g key={e.label}>
            <line x1={e.x} y1={14} x2={e.x} y2={39} stroke={e.color} strokeWidth={1.5} />
            <circle cx={e.x} cy={39} r={4} fill={e.color} />
            <text x={e.x} y={11} textAnchor="middle" fontSize={9}   fill={e.color} fontWeight="600">{e.dose}</text>
            <text x={e.x} y={55} textAnchor="middle" fontSize={7.5} fill="#94a3b8">{e.label}</text>
            <text x={e.x} y={66} textAnchor="middle" fontSize={7}   fill="#64748b">{e.note}</text>
          </g>
        ))}
        <text x={280} y={82} textAnchor="middle" fontSize={7.5} fill="#64748b">
          +150 kg urea · +83 kg MAP · +122 kg KCl per extra tonne above 3 t/ha baseline
        </text>
      </svg>
    </div>
  );
}

// ── Live fertilizer cost calculator ─────────────────────────────────────────
// Pure-fertilizer equivalents for IPHM target nutrients (3 t/ha baseline):
//   Target: N 235 kg, P₂O₅ 130 kg, K₂O 220 kg/ha
//   MAP (11-52-0): 130/0.52 = 250 kg → also supplies 250×0.11 = 27.5 kg N
//   Urea (46-0-0): (235-27.5)/0.46 = 451 kg (remaining N after MAP)
//   KCl  (0-0-60): 220/0.60 = 367 kg
const NPK_KG_HA = [
  { name: "Urea (N)", kg: 451, color: "#22c55e" },
  { name: "MAP (P)",  kg: 250, color: "#3b82f6" },
  { name: "KCl (K)",  kg: 367, color: "#f97316" },
] as const;
const YIELD_THA        = 2.7;   // WASI 2024-25 observed
const SA_COST_HA       = 41;    // ammonium sulphate, WASI 2024-25, no live price
const COMPOST_COST_HA  = 229;   // organic inputs, WASI 2024-25, fixed

function LiveFertilizerCostPanel() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [asOf,   setAsOf]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then(r => r.json())
      .then((d: { fertilizer?: { items?: { name: string; price_usd_mt: number }[]; prices_as_of?: string } }) => {
        const map: Record<string, number> = {};
        for (const it of d?.fertilizer?.items ?? []) map[it.name] = it.price_usd_mt;
        setPrices(map);
        setAsOf(d?.fertilizer?.prices_as_of ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="text-[11px] text-slate-500 animate-pulse py-3">Loading live prices…</div>
  );

  const rows = NPK_KG_HA.map(({ name, kg, color }) => {
    const price   = prices[name] ?? null;
    const cost_ha = price !== null ? (kg * price) / 1000 : null;
    const cost_t  = cost_ha !== null ? cost_ha / YIELD_THA : null;
    return { name, kg, price, cost_ha, cost_t, color };
  });

  const npk_ha    = rows.reduce((s, r) => s + (r.cost_ha ?? 0), 0);
  const total_ha  = npk_ha + SA_COST_HA + COMPOST_COST_HA;
  const total_t   = total_ha / YIELD_THA;
  const wasi_2425 = 253; // WASI observed fertilizer cost/tonne 2024-25
  const delta_pct = Math.round((total_t / wasi_2425 - 1) * 100);

  return (
    <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
      <div className="flex items-baseline gap-2 mb-2.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Live fertilizer cost · VN Robusta · 3 t/ha baseline
        </span>
        {asOf && (
          <span className="text-[10px] text-slate-600">· {asOf}</span>
        )}
      </div>

      <table className="text-[11px] w-full border-collapse mb-2">
        <thead>
          <tr className="border-b border-slate-700">
            {["Input", "Qty (kg/ha)", "WB Price", "Cost / ha", "Cost / tonne"].map(h => (
              <th key={h} className={`pb-1.5 text-[10px] font-medium text-slate-500 ${h === "Input" ? "text-left pr-3" : "text-right pr-3 last:pr-0"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map(({ name, kg, price, cost_ha, cost_t, color }) => (
            <tr key={name}>
              <td className="py-1.5 pr-3 font-semibold text-[11px]" style={{ color }}>{name}</td>
              <td className="py-1.5 pr-3 text-right text-slate-300">{kg}</td>
              <td className="py-1.5 pr-3 text-right text-slate-300">
                {price !== null ? `$${price.toLocaleString()}/MT` : "—"}
              </td>
              <td className="py-1.5 pr-3 text-right text-slate-300">
                {cost_ha !== null ? `$${Math.round(cost_ha)}` : "—"}
              </td>
              <td className="py-1.5 text-right text-slate-300">
                {cost_t !== null ? `$${Math.round(cost_t)}` : "—"}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 pr-3 text-slate-500">Ammonium sulphate</td>
            <td className="py-1.5 pr-3 text-right text-slate-500">~275</td>
            <td className="py-1.5 pr-3 text-right text-slate-600">fixed</td>
            <td className="py-1.5 pr-3 text-right text-slate-500">${SA_COST_HA}</td>
            <td className="py-1.5 text-right text-slate-500">${Math.round(SA_COST_HA / YIELD_THA)}</td>
          </tr>
          <tr>
            <td className="py-1.5 pr-3 text-slate-500">Compost / organic</td>
            <td className="py-1.5 pr-3 text-right text-slate-500">bulk</td>
            <td className="py-1.5 pr-3 text-right text-slate-600">fixed</td>
            <td className="py-1.5 pr-3 text-right text-slate-500">${COMPOST_COST_HA}</td>
            <td className="py-1.5 text-right text-slate-500">${Math.round(COMPOST_COST_HA / YIELD_THA)}</td>
          </tr>
          <tr className="border-t border-slate-600">
            <td className="py-2 pr-3 font-bold text-slate-100 text-xs" colSpan={3}>Total fertilizer</td>
            <td className="py-2 pr-3 text-right font-bold text-amber-400">${Math.round(total_ha)}/ha</td>
            <td className="py-2 text-right font-bold text-amber-400">${Math.round(total_t)}/tonne</td>
          </tr>
        </tbody>
      </table>

      <div className="flex items-start justify-between gap-4 mt-1">
        <p className="text-[10px] text-slate-600 leading-relaxed max-w-xs">
          WB Pink Sheet prices (international benchmark). VN farm-gate typically 1.5–2× higher due to distribution and duties.
        </p>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-slate-500">vs WASI 2024–25 observed</div>
          <div className={`text-sm font-bold ${delta_pct >= 0 ? "text-red-400" : "text-green-400"}`}>
            {delta_pct >= 0 ? "+" : ""}{delta_pct}% vs $253/t
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Article3() {
  return (
    <AgronomyCard
      kicker="Agronomy · Production Costs"
      title="What does a kilo of Robusta actually cost to grow?"
      subtitle="Farm production-cost stack and the farmgate break-even"
      briefing={
        <span>
          Producing one tonne of green Robusta beans permanently extracts 34.2 kg
          of nitrogen and 46.9 kg of potassium from the soil. Annual baseline
          fertiliser application is 1,600 kg NPK/ha across four phenological
          windows. Organised cooperatives capture up to 95% of FOB export value;
          isolated smallholders lose a significant share to intermediary brokers
          — a structural factor in farmer price responsiveness.
        </span>
      }
    >
      <H>Nutrient extraction per tonne of green beans</H>
      <P>
        These quantities are permanently removed from the soil with each harvest.
        Potassium dominates because it drives sugar transport into the developing
        bean; nitrogen builds vegetative structure; phosphorus powers root and
        floral ATP synthesis.
      </P>
      <NutrientExtractionChart />

      <H>Ion antagonisms — over-application risks</H>
      <ul className="space-y-1 mb-2">
        <LI>Excess <strong>P</strong> locks up zinc → disrupts enzyme function</LI>
        <LI>Excess <strong>K</strong> induces Mg deficiency → interveinal chlorosis and leaf blight (K–Mg antagonism)</LI>
        <LI>High <strong>K</strong> restricts boron uptake → terminal necrosis in young tissues (K–B antagonism)</LI>
      </ul>

      <H>Annual NPK schedule — mature bearing coffee</H>
      <PhenologicalTimeline />
      <LiveFertilizerCostPanel />

      <H>Cooperative FOB capture mechanics</H>
      <P>
        Isolated smallholders face broker extraction that can reduce net margin
        by 30–50%. Organised cooperative groups aggregate purchasing power
        (bulk input discounts) and negotiate direct FOB contracts with processors
        and international roasters. In well-organised regions, FOB price capture
        reaches <strong>95% of total export value</strong>. This explains why
        farmers in cooperative zones respond more elastically to price signals —
        they retain a larger share of the upside.
      </P>

      <H>Water costs</H>
      <P>
        Basin irrigation requires <strong>400–600 litres / tree / cycle</strong>,
        spaced 25–30 days apart through the dry season. Late-ripening clones
        TR14 and TR15 eliminate one complete cycle. Drip irrigation combined
        with macadamia intercropping reduces total plantation water demand by
        up to 36%.
      </P>
    </AgronomyCard>
  );
}

