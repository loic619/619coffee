"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { AgronomyCard, H, P, LI, Code } from "../agronomy/prose";

// Japan's per-capita transition (kg/head) — the canonical S-curve the study
// uses as its gold-standard analog, indexed to its own "Year Zero" (~mid-1960s).
const JAPAN_SCURVE = [
  { decade: "1960s", kg: 0.4 },
  { decade: "1970s", kg: 1.1 },
  { decade: "1980s", kg: 2.1 },
  { decade: "1990s", kg: 2.8 },
  { decade: "Today", kg: 3.5 },
];

const ANALOGS = [
  { wave: "East Asia", country: "Japan", base: "Green tea", catalyst: "Post-war Westernism, vending", kg: "~3.50" },
  { wave: "East Asia", country: "South Korea", base: "3-in-1 instant", catalyst: "Western franchises, home café", kg: "~2.58" },
  { wave: "East Asia", country: "Taiwan", base: "Tea / bubble tea", catalyst: "Convenience stores (CVS)", kg: "~1.90" },
  { wave: "MENA", country: "Algeria", base: "Tea / mixed", catalyst: "Institutional Robusta imports", kg: "~3.11" },
  { wave: "MENA", country: "Turkey", base: "Tea / cezve coffee", catalyst: "Third-wave urban, chains", kg: "~1.82" },
  { wave: "LatAm", country: "Mexico", base: "Net producer", catalyst: "Rising income, instant", kg: "~0.83" },
];

function JapanSCurveChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Japan per-capita coffee — a textbook S-curve (kg/head)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={JAPAN_SCURVE} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="decade" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} domain={[0, 4]} tickFormatter={v => `${v}kg`} />
          <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
            formatter={(v: unknown) => [`${Number(v).toFixed(1)} kg/head`, "Per-capita"]} />
          <ReferenceLine y={3.5} stroke="#f59e0b" strokeDasharray="2 2"
            label={{ value: "plateau K ≈ 3.5", position: "insideTopRight", fontSize: 8, fill: "#f59e0b" }} />
          <Line dataKey="kg" type="monotone" stroke="#f59e0b" strokeWidth={2.2} dot={{ r: 3, fill: "#f59e0b" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function LogisticModel() {
  return (
    <AgronomyCard
      tone="rose"
      kicker="Demand · Forecasting Methodology"
      title="Beyond the hockey stick: an S-curve model for emerging-market coffee demand"
      subtitle="Logistic growth fitted per market instead of naive linear extrapolation"
      briefing={
        <span>
          Applying a flat compound growth rate (CAGR) to a low starting base produces the classic
          forecasting error — the &ldquo;hockey stick&rdquo; — that eventually has a single country drinking more
          coffee than the whole world produces. The fix is to abandon linear extrapolation for a
          <strong> bounded logistic (S-curve)</strong> anchored on rigorous historical analogues: Japan&rsquo;s
          green-tea-to-coffee transition and South Korea&rsquo;s franchise-led boom.
        </span>
      }
    >
      <H>The failure of linear extrapolation</H>
      <P>
        Markets like China and India start from a structurally tiny per-capita base. A naïve CAGR fitted to
        their explosive early growth, projected 20+ years out, yields mathematically impossible volumes. The
        early slope is real — but it is the <em>foot</em> of an S-curve, not a straight line. Mistaking one for
        the other is the core modelling error this framework exists to prevent.
      </P>

      <H>The logistic (S-curve) model</H>
      <P>
        Mass adoption of a new consumer good follows the diffusion-of-innovations law — a logistic curve:
      </P>
      <p className="text-center text-sm text-slate-100 font-mono my-3">
        P(t) = K / ( 1 + e<sup>−r(t−t₀)</sup> )
      </p>
      <ul className="space-y-1 mb-2">
        <LI><Code>K</Code> — carrying capacity: the local saturation ceiling (the hard part — see the companion article).</LI>
        <LI><Code>r</Code> — the initial exponential growth rate (the steepness of the take-off).</LI>
        <LI><Code>t₀</Code> — the inflection point, i.e. the &ldquo;Year Zero&rdquo; of the take-off.</LI>
      </ul>

      <JapanSCurveChart />

      <H>Temporal translation &amp; &ldquo;Year Zero&rdquo;</H>
      <P>
        Calendar years (1980, 2005…) must be neutralised. Each market is re-indexed to its own
        <strong> Year Zero</strong> — the macro inflection where per-capita consumption breaks out of stagnation
        and crosses a critical threshold (≈ 0.5 kg/head). The take-offs of Japan (mid-1960s) and Korea (Starbucks
        Seoul, 1999) were both triggered by the same universal stimuli: surging GDP-per-capita (PPP), rapid
        urbanisation, and a new middle class. Lining China&rsquo;s present onto Korea&rsquo;s Year Zero (~1998), today&rsquo;s
        Chinese growth tracks Korea&rsquo;s 2000–2010 slope closely — fresh-coffee drinkers are projected to rise from
        40 M (2018) to 260 M (2028). The catch: that velocity cannot be assumed to hold for two decades. Validity
        depends entirely on a strict, <em>local</em> value of K.
      </P>

      <H>The analog cohorts</H>
      <P>
        Reference countries are grouped by their pre-coffee hot-drink culture and economic structure, isolating
        cultural variables from purely economic ones:
      </P>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left py-1.5 pr-2">Wave</th>
              <th className="text-left py-1.5 pr-2">Country</th>
              <th className="text-left py-1.5 pr-2">Cultural base</th>
              <th className="text-left py-1.5 pr-2">Transition catalyst</th>
              <th className="text-right py-1.5">kg/head</th>
            </tr>
          </thead>
          <tbody>
            {ANALOGS.map(a => (
              <tr key={a.country} className="border-b border-slate-800">
                <td className="py-1 pr-2 text-slate-500">{a.wave}</td>
                <td className="py-1 pr-2 text-slate-100 font-medium">{a.country}</td>
                <td className="py-1 pr-2">{a.base}</td>
                <td className="py-1 pr-2 text-slate-400">{a.catalyst}</td>
                <td className="py-1 text-right font-mono text-amber-300">{a.kg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[9px] text-slate-500 italic mt-4">
        Source: deep-research report &ldquo;Predictive Modelling of Coffee Adoption in Emerging Markets&rdquo; (2026).
        Companion article covers the saturation ceiling K and the model&rsquo;s failure modes.
      </p>
    </AgronomyCard>
  );
}
