"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { AgronomyCard, H, P, LI } from "./prose";

// ── Article 4: Long-term Fragility ────────────────────────────────────────────

const AREA_PROJECTION = [
  { year: 2025, pct: 100 },
  { year: 2030, pct: 93  },
  { year: 2035, pct: 84  },
  { year: 2040, pct: 73  },
  { year: 2045, pct: 62  },
  { year: 2050, pct: 50  },
];

function ViableAreaChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
        CIAT projection · viable Robusta growing area · Vietnam
      </p>
      <p className="text-[10px] text-slate-600 mb-2">
        100% = ~720,000 ha today. Driven by temperature rise + precipitation shift.
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart
          data={AREA_PROJECTION}
          margin={{ top: 8, right: 32, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="redFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="year"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 105]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={((v) => [`${v}%`, "Viable area"]) satisfies Formatter<ValueType, NameType>}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <ReferenceLine
            y={50}
            stroke="#ef4444"
            strokeDasharray="4 3"
            strokeOpacity={0.55}
            label={{ value: "–50%", position: "right", fill: "#ef4444", fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#redFade)"
            dot={{ fill: "#ef4444", r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Article4() {
  return (
    <AgronomyCard
      kicker="Agronomy · Long-term Risk"
      title="How fragile is Vietnamese supply long-term?"
      subtitle="Ageing trees, water stress and land competition as slow structural risks"
      briefing={
        <span>
          Intensive monoculture has driven soil pH below 4.0 across large areas
          of the Central Highlands. At that threshold, phosphorus binds to iron
          and aluminium oxides and becomes unavailable regardless of application
          volume — a silent productivity trap. CIAT projects up to 50% of
          Vietnam&rsquo;s viable Robusta growing area eliminated by 2050 as
          temperatures rise and precipitation patterns shift.
        </span>
      }
    >
      <H>Soil pH degradation</H>
      <P>
        Decades of ammonium sulphate application — physiologically acidic — have
        pushed pH below 4.0 in many plots. Phosphorus becomes insoluble at this
        level (bound to Fe/Al oxides) regardless of how much fertiliser is
        applied. Remediation requires lime amendments. On sloping land, contour
        planting and permanent ground cover (5–10 cm leguminous species) stop
        the topsoil erosion that accelerates acidification.
      </P>

      <H>Nematode thresholds</H>
      <P>
        Parasitic nematodes — primarily <em>Pratylenchus coffeae</em>,{" "}
        <em>Meloidogyne</em> spp., and <em>Radopholus</em> spp. — penetrate the
        root cortex, cause necrosis, and create lesions that let Fusarium wilt
        enter. Global yield losses attributed to nematode parasitism: ~15%.
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          <strong>Replanting prohibited</strong> if soil shows &gt;100 individuals
          / 100 g soil or &gt;150 / 5 g root tissue.
        </LI>
        <LI>
          Mandatory crop rotation for ≥1 year to starve the population before
          replanting.
        </LI>
        <LI>
          TR13 clone has documented sensitivity — avoid on historically
          nematode-affected plots.
        </LI>
      </ul>

      <H>Intercropping as structural hedge</H>
      <P>
        When global Robusta prices drop below cost of production, intercrop
        revenue prevents farm abandonment and preserves supply-side capacity:
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          <strong>Macadamia</strong> (194 trees/ha): deep taproot avoids
          competition with coffee feeder roots; +10% yield boost under rainfed
          conditions, +60% under combined drip irrigation.
        </LI>
        <LI>
          <strong>Durian</strong> (69–123 trees/ha): revenues can double total
          farm income. This is why farmers stay in production during multi-year
          Robusta bear markets rather than uprooting.
        </LI>
        <LI>
          <strong>Black Pepper</strong> on Cassia supports: staggered harvests
          distribute peak labour demands evenly across the year.
        </LI>
      </ul>

      <H>CIAT long-term area projection</H>
      <ViableAreaChart />
      <P>
        The projection combines rising mean temperatures (reducing altitude
        suitability) and shifting monsoon patterns (disrupting phenological
        cycles). A transition to late-ripening, drought-tolerant clones (TR14,
        TR15) and agroforestry intercropping mitigates but does not eliminate
        the projected loss.
      </P>
    </AgronomyCard>
  );
}

