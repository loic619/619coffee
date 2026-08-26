"use client";
import { useEffect, useMemo, useState } from "react";
import { Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Cell, ReferenceLine, Line, ComposedChart } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  buildScatter, fit, recencyOf, RECENCY_STYLE, sanitiseLevels, TRUSTED_FROM,
  type ScatterPoint, type Fit,
} from "@/lib/arrivalsVsStocks";

// Does coffee landing in Europe still end up in a warehouse?
//
// A steady-demand market stores what it does not roast, so arrivals and the
// change in port stocks move together with about a month between them. The
// tightness of that relationship — not its slope — is the signal: when it
// loosens, arrivals are being drunk rather than stored, and the headline import
// number overstates how comfortable the pipeline is.

interface EcfMonth { period?: string; value_mt?: number; ports?: Record<string, number> }

const BAGS_PER_MT = 1000 / 60;

function splitPeriods(points: ScatterPoint[], cut: string) {
  return {
    early: points.filter(p => p.period < cut),
    late:  points.filter(p => p.period >= cut),
  };
}

function Panel({ title, subtitle, points, allCount }: {
  title: string; subtitle: string; points: ScatterPoint[]; allCount: number;
}) {
  const f: Fit | null = useMemo(() => fit(points), [points]);
  if (!points.length) return null;

  const xs = points.map(p => p.exports);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const pad = (xMax - xMin) * 0.06 || 1;
  const line = f ? [
    { exports: xMin - pad, trend: f.intercept + f.slope * (xMin - pad) },
    { exports: xMax + pad, trend: f.intercept + f.slope * (xMax + pad) },
  ] : [];

  // Recency is global across the whole series, so a point that is "latest"
  // overall stays red even when it lands in the later-period panel.
  const withRecency = points.map(p => ({ ...p, _r: recencyOf(allCount - (points.length - points.indexOf(p)), allCount) }));

  return (
    <div className="flex-1 min-w-[300px]">
      <div className="text-center mb-1">
        <div className="text-[11px] font-semibold text-slate-200 underline underline-offset-2">{title}</div>
        <div className="text-[10px] text-slate-500">{subtitle}</div>
        {f && <div className="text-[11px] font-mono text-slate-300 mt-0.5">R² = {f.r2.toFixed(2)} · n = {f.n}</div>}
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="exports" name="Arrivals"
              domain={[xMin - pad, xMax + pad]} tick={{ fontSize: 9, fill: "#64748b" }}
              tickFormatter={v => Math.round(v).toLocaleString()}
              label={{ value: "Arrivals (000s bags, 2-mo)", position: "insideBottom", offset: -14, fontSize: 9, fill: "#64748b" }} />
            <YAxis type="number" dataKey="stockChange" name="Stock change"
              tick={{ fontSize: 9, fill: "#64748b" }}
              tickFormatter={v => Math.round(v).toLocaleString()}
              label={{ value: "Stock change (000s bags)", angle: -90, position: "insideLeft", fontSize: 9, fill: "#64748b" }} />
            <ZAxis range={[42, 42]} />
            <ReferenceLine y={0} stroke="#475569" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
              formatter={(v: unknown, n: unknown) => [`${Math.round(Number(v)).toLocaleString()} kbags`, String(n)]}
              labelFormatter={() => ""}
              itemSorter={() => 0} />
            {f && <Line data={line} dataKey="trend" stroke="#64748b" strokeWidth={1} dot={false} legendType="none" isAnimationActive={false} />}
            <Scatter data={withRecency} dataKey="stockChange" isAnimationActive={false}>
              {withRecency.map(p => {
                const st = RECENCY_STYLE[p._r];
                return <Cell key={p.period} fill={st.fill} fillOpacity={st.opacity} />;
              })}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ArrivalsVsStockChange() {
  const [ecf, setEcf] = useState<{ monthly?: EcfMonth[] } | null>(null);
  const [eu, setEu] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    Promise.allSettled([
      fetch("/data/ecf_history.json").then(r => r.json()),
      fetch("/data/eu_coffee_imports.json").then(r => r.json()),
    ]).then(([e, u]) => {
      if (e.status === "fulfilled") setEcf(e.value);
      if (u.status === "fulfilled") setEu(u.value);
    });
  }, []);

  const { points, partner, dropped } = useMemo(() => {
    if (!ecf || !eu) return { points: [] as ScatterPoint[], partner: null as string | null, dropped: 0 };
    const stock: Record<string, number> = {};
    for (const m of ecf.monthly ?? []) {
      // Older ECF rows carry only the per-port bag counts, newer ones a total in MT.
      const mt = m.value_mt
        ?? (m.ports ? Object.values(m.ports).reduce((a, b) => a + b, 0) / BAGS_PER_MT : undefined);
      if (m.period && mt) stock[m.period] = mt;
    }
    const arrivals = (eu.monthly_total_deep as Record<string, number> | undefined)
      ?? (eu.monthly_total as Record<string, number>) ?? {};
    // Outlier-filter, then keep only the window the stock feed can be trusted
    // over — see TRUSTED_FROM. Both steps are needed: the filter catches
    // isolated spikes, the window excludes a sustained bad block it cannot.
    const { clean, dropped } = sanitiseLevels(stock);
    const trusted = Object.fromEntries(Object.entries(clean).filter(([k]) => k >= TRUSTED_FROM));
    return {
      points: buildScatter(arrivals, trusted, 1, 2),
      partner: (eu.monthly_total_deep_partner as string) ?? null,
      dropped: dropped.length,
    };
  }, [ecf, eu]);

  if (!points.length) {
    return <div className="text-[11px] text-slate-500 p-3">Arrivals-vs-stocks data not yet available.</div>;
  }

  // The reference chart splits at the 2018/19 turn. Our stock feed is only
  // trustworthy from 2020, so that split would leave nothing on the early side;
  // the code still splits when the data reaches back far enough, and otherwise
  // shows one honest panel rather than a second one built on 4 points.
  const CUT = "2018-10";
  const { early, late } = splitPeriods(points, CUT);
  const canSplit = early.length >= 12 && late.length >= 12;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-bold text-white">Arrivals into the EU vs the change in port stocks</h3>
        <p className="text-[10px] text-slate-400">
          Coffee that lands either goes to a warehouse or straight to a roaster. The tighter this
          relationship, the more of what arrives is being stored rather than drunk.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        {canSplit ? (
          <>
            <Panel title={`${early[0].period.slice(0, 4)}–${CUT.slice(0, 4)}`}
              subtitle="1-month shipment lag · rolling 2-month" points={early} allCount={points.length} />
            <Panel title={`${CUT.slice(0, 4)}–${late.at(-1)!.period.slice(0, 4)}`}
              subtitle="1-month shipment lag · rolling 2-month" points={late} allCount={points.length} />
          </>
        ) : (
          <Panel title={`${points[0].period} – ${points.at(-1)!.period}`}
            subtitle="1-month shipment lag · rolling 2-month" points={points} allCount={points.length} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[9px] text-slate-400">
        {(["latest", "previous", "recent", "history"] as const).map(k => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: RECENCY_STYLE[k].fill, opacity: RECENCY_STYLE[k].opacity }} />
            {RECENCY_STYLE[k].label}
          </span>
        ))}
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Stock change from ECF European port stocks; arrivals from Eurostat Comext HS-0901
        {partner ? ` (${partner})` : ""}. Both converted to 000s bags at 60 kg.
        {" "}Arrivals reach back to 2011, but the chart starts {TRUSTED_FROM}: the ECF series
        carries a contaminated stretch before then (a four-month block of 2019 sits at roughly half
        level, and 2014 changes basis mid-year), and running the regression across it inverts the
        relationship to R² 0.001. {dropped > 0 ? `${dropped} further month${dropped === 1 ? "" : "s"} dropped as outliers. ` : ""}
        {" "}The colouring is monthly, not weekly: both sources publish once a month, so
        &ldquo;latest&rdquo; is the newest month and &ldquo;prior 4&rdquo; the four months before it.
      </div>
    </div>
  );
}
