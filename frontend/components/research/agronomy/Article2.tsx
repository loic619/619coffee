"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { AgronomyCard, H, P, Code } from "./prose";

// ── Article 2: Clone Varieties ────────────────────────────────────────────────

const CLONE_YIELDS = [
  { clone: "TR4",  t: 7.3,  late: false },
  { clone: "TR9",  t: 6.7,  late: false },
  { clone: "TR11", t: 6.6,  late: false },
  { clone: "TR13", t: 5.5,  late: false },
  { clone: "TR14", t: 5.4,  late: true  },
  { clone: "TR15", t: 5.2,  late: true  },
  { clone: "TRS1", t: 5.25, late: false },
];

function CloneYieldChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Yield potential by clone (t/ha · green beans)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={CLONE_YIELDS} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="clone"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 9]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit=" t"
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={((v) => [`${v} t/ha`, "Yield"]) satisfies Formatter<ValueType, NameType>}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Bar dataKey="t" radius={[3, 3, 0, 0]}>
            {CLONE_YIELDS.map((entry, i) => (
              <Cell key={i} fill={entry.late ? "#3b82f6" : "#f59e0b"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="w-3 h-3 rounded-sm bg-amber-500" /> Normal harvest
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="w-3 h-3 rounded-sm bg-blue-500" /> Late harvest (Jan–Feb)
        </div>
      </div>
    </div>
  );
}

function HarvestGantt() {
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const MW = 76;
  const PAD = 20;
  const W = PAD * 2 + MW * 6;
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Harvest windows by clone group
      </p>
      <svg viewBox={`0 0 ${W} 88`} className="w-full rounded overflow-hidden">
        <rect width={W} height="88" fill="#0f172a" />
        {months.map((m, i) => (
          <text key={i} x={PAD + i * MW + MW / 2} y={16} textAnchor="middle" fontSize={9} fill="#64748b">
            {m}
          </text>
        ))}
        {/* Normal clones: Oct–Dec */}
        <rect x={PAD} y={22} width={MW * 3} height={22} fill="#b45309" opacity={0.85} rx={3} />
        <text x={PAD + MW * 1.5} y={37} textAnchor="middle" fontSize={9} fill="#fde68a" fontWeight="600">
          Normal · TR4  TR9  TR11
        </text>
        {/* Late clones: Jan–Feb */}
        <rect x={PAD + MW * 3} y={48} width={MW * 2} height={22} fill="#1d4ed8" opacity={0.85} rx={3} />
        <text x={PAD + MW * 3 + MW} y={63} textAnchor="middle" fontSize={9} fill="#bfdbfe" fontWeight="600">
          Late · TR14  TR15
        </text>
        {/* Shift annotation */}
        <line
          x1={PAD + MW * 3 - 4} y1={33}
          x2={PAD + MW * 3 + 4} y2={50}
          stroke="#64748b" strokeWidth={1} strokeDasharray="3,2"
        />
        <text x={PAD + MW * 4.1} y={82} textAnchor="middle" fontSize={8} fill="#94a3b8">
          ▶ 6–8 week supply delay
        </text>
      </svg>
    </div>
  );
}

export default function Article2() {
  return (
    <AgronomyCard
      kicker="Agronomy · Varieties"
      title="Which clones ship when, and how much?"
      subtitle="Vietnamese clone calendar — harvest timing and screen-size yield by variety"
      briefing={
        <span>
          Vietnam&rsquo;s late-ripening clones TR14 and TR15 were engineered to
          mature 6–8 weeks after standard varieties, shifting delivery into
          January–February and compressing the seasonal supply window. This delay
          also eliminates one dry-season irrigation cycle, reducing water
          consumption. Traders modelling peak Vietnamese Robusta shipments should
          weight this phenological split.
        </span>
      }
    >
      <H>Elite Robusta clone profiles</H>
      <div className="overflow-x-auto mt-1">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Clone</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Cycle</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Yield (t/ha)</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Bean (g/100)</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {([
              ["TR4",  "Normal",  "7.3",     "18.4",      "Best yield; absolute rust resistance; drooping branches"],
              ["TR9",  "Normal",  "6.7",     "22.5–29.6", "Exceptional bean size; wide spreading canopy"],
              ["TR11", "Normal",  "6.6",     "18.3",      "High cup quality; stable multi-year production"],
              ["TR13", "Normal",  "4.5–6.5", "—",         "⚠ Sensitive to nematodes (P. coffeae) and Fusarium wilt"],
              ["TR14", "Late ★",  "5.1–5.6", "19.1–24.9", "Harvest Jan–Feb; eliminates one irrigation cycle"],
              ["TR15", "Late ★",  "5.1–5.2", "19.1–24.9", "Exceptional drought tolerance under extreme stress"],
              ["TRS1", "Normal",  "4.5–6.0", "—",         "Multi-parent hybrid seed; no grafting bottleneck"],
            ] as const).map(([id, cycle, yld, bean, notes]) => (
              <tr key={id}>
                <td className="py-1.5 pr-4 font-semibold text-slate-200">{id}</td>
                <td className={`py-1.5 pr-4 ${cycle.includes("Late") ? "text-blue-400 font-semibold" : ""}`}>
                  {cycle}
                </td>
                <td className="py-1.5 pr-4">{yld}</td>
                <td className="py-1.5 pr-4">{bean}</td>
                <td className="py-1.5 text-slate-400">{notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
        ★ Late-ripening clones push harvest to January–February, saving one
        irrigation cycle worth ~407 million m³ of water annually at regional scale.
      </p>

      <H>Arabica TN series (altitude &gt;1,000 m)</H>
      <P>
        TN1, TN2, TN6, TN7, TN9 — elite F1 hybrids yielding 3.0–3.5 t/ha,
        10–20% above legacy Catimor. Near-total rust resistance. TN1 requires
        drip irrigation and balanced chemigation; THA1 (seed-propagated purebred)
        achieves &gt;3.0 t/ha with simpler management.
      </P>

      <H>Genetic origin</H>
      <P>
        Genomic analysis (261 genome-wide SNPs) places Vietnamese Robusta
        primarily in the Congo Basin <Code>ER group</Code>, with introgression
        from Guinean <Code>D</Code>, Atlantic coast <Code>A</Code>, and East
        Central African <Code>OB</Code> populations — each contributing alleles
        for specific drought tolerance and rust resistance traits.
      </P>

      <HarvestGantt />
      <CloneYieldChart />
    </AgronomyCard>
  );
}

