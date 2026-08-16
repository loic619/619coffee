"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import {
  buildCostStack, buildLevelSeries, buildOriginInflow, eventStudy, parityInflowStudy,
  buildLadder, PARITY_ORIGINS, CONTAINER_MT, PARITY_ADDERS_USD,
  type DatedPrice, type Snapshot, type GradingDay, type ParityRow, type CostStackRow,
  type ParityAdderLine,
} from "@/lib/research/certStocksParity";

// ── colours (fixed categorical order — never cycled) ────────────────────────
const C = { rc: "#f59e0b", farmgate: "#38bdf8", atPort: "#a78bfa", tendering: "#34d399", bar: "#38bdf8", up: "#34d399", grad: "#818cf8" };
const AX = "#64748b", GRID = "#1e293b";

const tip = {
  contentStyle: { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 },
  labelStyle: { color: "#94a3b8" }, itemStyle: { color: "#e2e8f0" },
};

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;
}

interface Loaded {
  rc: DatedPrice[];
  farmgate: Record<string, DatedPrice[]>;
  fx: Record<string, DatedPrice[]>;
  snapshots: Snapshot[];
  deep: Snapshot[][];
  gradings: GradingDay[];
  freightUsdMt: number;
  parity: Record<string, ParityRow[]>;
  fobModel: Record<string, { fixed?: number; pct?: number }>;
  adderLines: ParityAdderLine[];
}

export default function CertifiedStocksParity() {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState(false);
  const [originKey, setOriginKey] = useState("vietnam");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fph, oph, fx, cs, d25, d20, freight, tp] = await Promise.all([
          cachedFetchStatic<{ robusta: DatedPrice[] }>("/data/futures_price_history.json"),
          cachedFetchStatic<{ origins: Record<string, { currency: string; history: DatedPrice[] }> }>("/data/origin_prices_history.json"),
          cachedFetchStatic<{ pairs: Record<string, { history: { date: string; close: number }[] }> }>("/data/fx_history.json"),
          cachedFetchStatic<{ snapshots: Snapshot[]; recent_activity: { gradings: GradingDay[] } }>("/data/certified_stocks_robusta.json"),
          cachedFetchStatic<{ snapshots: Snapshot[] }>("/data/certified_stocks_robusta_deep_2025-2029.json").catch(() => ({ snapshots: [] })),
          cachedFetchStatic<{ snapshots: Snapshot[] }>("/data/certified_stocks_robusta_deep_2020-2024.json").catch(() => ({ snapshots: [] })),
          cachedFetchStatic<{ routes?: { id: string; rate: number }[] }>("/data/freight.json").catch(() => ({ routes: [] })),
          cachedFetchStatic<{
            meta?: { adder_lines?: ParityAdderLine[] };
            origins?: Record<string, { history: ParityRow[]; fobbing_fixed?: number; fobbing_pct?: number }>;
          }>("/data/tender_parity_history.json").catch(() => ({
            meta: undefined as { adder_lines?: ParityAdderLine[] } | undefined,
            origins: {} as Record<string, { history: ParityRow[]; fobbing_fixed?: number; fobbing_pct?: number }>,
          })),
        ]);
        const farmgate: Record<string, DatedPrice[]> = {};
        for (const o of PARITY_ORIGINS) farmgate[o.key] = (oph.origins?.[o.farmgateKey]?.history ?? []).map(d => ({ date: d.date, price: d.price }));
        const fxOut: Record<string, DatedPrice[]> = {};
        for (const o of PARITY_ORIGINS) if (o.fxTicker) fxOut[o.fxTicker] = (fx.pairs?.[o.fxTicker]?.history ?? []).map(d => ({ date: d.date, price: d.close }));
        const vnEu = (freight.routes ?? []).find(r => r.id === "vn-eu");
        const parity: Record<string, ParityRow[]> = {};
        const fobModel: Record<string, { fixed?: number; pct?: number }> = {};
        for (const o of PARITY_ORIGINS) {
          const src = tp.origins?.[o.farmgateKey];
          parity[o.key] = src?.history ?? [];
          fobModel[o.key] = { fixed: src?.fobbing_fixed, pct: src?.fobbing_pct };
        }
        if (alive) setData({
          rc: fph.robusta ?? [],
          farmgate, fx: fxOut,
          snapshots: cs.snapshots ?? [],
          deep: [d20.snapshots ?? [], d25.snapshots ?? []],
          gradings: cs.recent_activity?.gradings ?? [],
          freightUsdMt: (vnEu ? vnEu.rate : 4741) / CONTAINER_MT,
          parity, fobModel,
          adderLines: tp.meta?.adder_lines ?? [],
        });
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, []);

  const origin = PARITY_ORIGINS.find(o => o.key === originKey) ?? PARITY_ORIGINS[0];

  // Daily graded lots for the SELECTED origin, keyed by date (secondary-axis bars).
  const dailyGrad = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const g of data.gradings) {
      let lots = 0;
      for (const e of g.entries ?? []) if (e.origin === origin.gradingOrigin && typeof e.lots === "number") lots += e.lots;
      if (lots > 0 && g.date) m.set(g.date, (m.get(g.date) ?? 0) + lots);
    }
    return m;
  }, [data, origin]);

  const stack = useMemo(() => {
    if (!data) return [] as (CostStackRow & { gradedLots: number })[];
    // Prefer the persisted pipeline series (per-day historical freight/FX/RC);
    // fall back to an on-the-fly recompute (flat current freight) if absent.
    const ph = data.parity[origin.key] ?? [];
    const base: CostStackRow[] = ph.length
      ? ph.map(r => ({ date: r.date, rc: r.rc ?? null, farmgate: r.farmgate_usd ?? null, atPort: r.at_port ?? null, tendering: r.tendering ?? null }))
      : buildCostStack(data.farmgate[origin.key] ?? [], data.fx[origin.fxTicker] ?? [], data.rc, origin, data.freightUsdMt);
    return base.map(r => ({ ...r, gradedLots: dailyGrad.get(r.date) ?? 0 }));
  }, [data, origin, dailyGrad]);

  const level = useMemo(() => (data ? buildLevelSeries(...data.deep, data.snapshots) : []), [data]);
  const inflow = useMemo(() => (data ? buildOriginInflow(data.gradings, origin.gradingOrigin) : []), [data, origin]);
  const originRank = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>();
    for (const g of data.gradings) for (const e of g.entries ?? []) if (e.origin && typeof e.lots === "number") m.set(e.origin, (m.get(e.origin) ?? 0) + e.lots);
    return Array.from(m.entries()).map(([o, lots]) => ({ origin: o.replace("Brazilian ", "Brazil "), lots })).sort((a, b) => b.lots - a.lots).slice(0, 7);
  }, [data]);
  const es = useMemo(() => (level.length ? eventStudy(data!.rc, level, 6, 10) : null), [level, data]);
  const pStudy = useMemo(() => (data ? parityInflowStudy(data.parity[origin.key] ?? [], data.gradings, origin.gradingOrigin) : null), [data, origin]);

  // fill months with 0 so a barely-tendering origin reads honestly as ~empty
  const inflowFilled = useMemo(() => {
    if (!inflow.length) return [];
    const map = new Map(inflow.map(d => [d.month, d.lots]));
    const start = inflow[0].month, end = inflow[inflow.length - 1].month;
    const out: { month: string; lots: number }[] = [];
    let [y, mo] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    while (y < ey || (y === ey && mo <= em)) {
      const k = `${y}-${String(mo).padStart(2, "0")}`;
      out.push({ month: k, lots: map.get(k) ?? 0 });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }, [inflow]);

  // Itemised farmgate → tendering ladder for the latest stored parity row.
  const fob = data?.fobModel?.[originKey] ?? {};
  const ladderRow = useMemo(() => {
    const rows = (data?.parity?.[originKey] ?? []).filter(r => r.farmgate_usd != null && r.tendering != null);
    return rows.length ? rows[rows.length - 1] : null;
  }, [data, originKey]);
  const ladder = useMemo(
    () => (ladderRow ? buildLadder(ladderRow, fob.fixed, fob.pct, data?.adderLines ?? [], origin.label) : null),
    [ladderRow, fob.fixed, fob.pct, data, origin.label],
  );

  if (err) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs text-red-400 max-w-4xl">Failed to load certified-stocks / price data.</div>;
  if (!data) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs text-slate-500 animate-pulse max-w-4xl">Loading certified-stocks &amp; parity data…</div>;

  const last = stack[stack.length - 1];
  const gapNow = last?.rc != null && last?.tendering != null ? last.rc - last.tendering : null;

  const totalOriginLots = inflow.reduce((s, d) => s + d.lots, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-4xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Certified stocks · Tenderable parity</div>
      <h3 className="text-xl font-bold text-slate-100 leading-tight mb-1">When does origin coffee flow to the exchange?</h3>
      <P>
        A trader tenders coffee onto the exchange only when it pays more than selling commercial — i.e. when the all-in
        cost to place origin coffee into a certified warehouse falls <strong>below</strong> the exchange price. That
        break-even is <strong>tenderable parity</strong>. This tool stacks an origin&rsquo;s cost chain against London
        Robusta (RC) over time, shows who actually fills the exchange, and tests whether reaching parity systematically
        pulls coffee in — and with what lag.
      </P>

      {/* Origin selector */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-3 mb-1">
        <span>Origin:</span>
        {PARITY_ORIGINS.map(o => (
          <button key={o.key} onClick={() => setOriginKey(o.key)}
            className={`px-2 py-0.5 rounded border text-[11px] ${originKey === o.key ? "bg-slate-800 text-amber-400 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {o.label}
          </button>
        ))}
        <span className="text-slate-600">· vs London RC (USD/MT)</span>
      </div>

      {/* ── Chart A: cost stack vs RC ─────────────────────────────────── */}
      <H>1 · The cost stack against the exchange</H>
      <P>
        <Code>farmgate</Code> (local price → USD/MT) → <Code>+FOBbing</Code> = at-port → <Code>+freight +{PARITY_ADDERS_USD}</Code>
        (port transport, rent, loading-out, allowances) = <strong>all-in tendering cost</strong>. When the tendering line
        sits <em>below</em> RC, tendering is profitable and certified stock should build. The <span style={{ color: C.grad }}>indigo
        bars</span> (right axis) are <strong>{origin.label}&rsquo;s own daily gradings</strong> — so you can see whether inflow
        actually clusters when the cost stack dips toward RC. FX and RC are per-day historical; freight is per-day where the
        freight-rate history reaches (recent months) and, before that, estimated from the <strong>Containerized Freight
        Index</strong> shape (digitized from its chart, calibrated to the route) — approximate, but far better than a flat rate.
      </P>
      <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={stack} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fill: AX, fontSize: 10 }} minTickGap={44} />
            <YAxis yAxisId="price" tick={{ fill: AX, fontSize: 10 }} width={44} domain={["auto", "auto"]} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
            <YAxis yAxisId="lots" orientation="right" tick={{ fill: C.grad, fontSize: 9 }} width={30} domain={[0, "auto"]} allowDecimals={false} />
            <Tooltip {...tip} formatter={(v, n) => n === "Graded (lots)" ? [`${Number(v)} lots`, n] : [v == null ? "—" : `$${Math.round(Number(v))}`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="lots" dataKey="gradedLots" name="Graded (lots)" fill={C.grad} fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={14} />
            <Line yAxisId="price" dataKey="farmgate" name="Farmgate" stroke={C.farmgate} dot={false} strokeWidth={1.5} connectNulls />
            <Line yAxisId="price" dataKey="atPort" name="FOB + logistics" stroke={C.atPort} dot={false} strokeWidth={1.5} connectNulls />
            <Line yAxisId="price" dataKey="tendering" name="All-in tendering cost" stroke={C.tendering} dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="price" dataKey="rc" name="London RC" stroke={C.rc} dot={false} strokeWidth={2.5} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <P className="text-[11px] text-slate-400 mt-1">
        {last && gapNow != null ? (
          <>Latest ({last.date}): RC <strong className="text-amber-400">${Math.round(last.rc!)}</strong> vs tendering cost{" "}
            <strong className="text-emerald-400">${Math.round(last.tendering!)}</strong> →{" "}
            <strong className={gapNow >= 0 ? "text-emerald-400" : "text-red-400"}>
              {gapNow >= 0 ? `tenderable (+$${Math.round(gapNow)})` : `not tenderable (−$${Math.round(-gapNow)})`}</strong>.
            Over the {stack.length}-day window, tendering was profitable on{" "}
            {stack.filter(r => r.rc != null && r.tendering != null && r.rc >= r.tendering).length} days.</>
        ) : "No overlapping price/farmgate data for this origin."}
        {stack.length > 0 && <>{" "}Window: {stack[0].date} → {stack[stack.length - 1].date} ({stack.length} days of farmgate).</>}
      </P>

      {/* ── The itemised ladder behind the green line ─────────────────── */}
      {ladder && (
        <>
          <H>1b · From farmgate to tendering cost — every rung</H>
          <P>
            The green line above is a total; this is what it is made of, for <strong>{origin.label}</strong> on the
            latest session it prices ({ladderRow!.date}). Every figure is the one that row actually observed — the
            same FX, freight and RC the chart uses — so the table can never drift from the line.
          </P>
          <div className="overflow-x-auto">
            <table className="w-full text-xs my-2">
              <thead>
                <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="pb-1.5 pr-3">Step</th>
                  <th className="pb-1.5 pr-3 text-right">USD/MT</th>
                  <th className="pb-1.5 pr-3 text-right">Running</th>
                  <th className="pb-1.5">What it covers</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((st, i) => {
                  const strong = st.kind === "subtotal" || st.kind === "total" || st.kind === "market";
                  const tone = st.kind === "total" ? "text-emerald-400"
                    : st.kind === "market" ? "text-amber-400"
                    : st.kind === "subtotal" ? "text-violet-300"
                    : st.kind === "start" ? "text-sky-300" : "text-slate-300";
                  return (
                    <tr key={i} className={`border-b border-slate-800 ${strong ? "font-semibold" : ""}`}>
                      <td className={`py-1.5 pr-3 ${strong ? tone : "text-slate-300"}`}>{st.label}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-400">
                        {st.amount == null ? "" : st.kind === "start" ? Math.round(st.amount).toLocaleString() : `+${Math.round(st.amount).toLocaleString()}`}
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-mono ${strong ? tone : "text-slate-300"}`}>
                        {st.running == null ? "" : Math.round(st.running).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-slate-500 text-[11px]">{st.note}</td>
                    </tr>
                  );
                })}
                {ladderRow?.rc != null && ladderRow?.tendering != null && (
                  <tr className="font-semibold">
                    <td className="py-1.5 pr-3 text-slate-200">Parity gap (RC − tendering)</td>
                    <td className="py-1.5 pr-3"></td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${ladderRow.rc >= ladderRow.tendering ? "text-emerald-400" : "text-red-400"}`}>
                      {ladderRow.rc >= ladderRow.tendering ? "+" : "−"}{Math.abs(Math.round(ladderRow.rc - ladderRow.tendering)).toLocaleString()}
                    </td>
                    <td className="py-1.5 text-slate-500 text-[11px]">
                      {ladderRow.rc >= ladderRow.tendering
                        ? "the exchange pays more than it costs to deliver — tendering is economic"
                        : "delivering costs more than the exchange pays — tendering is uneconomic today"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <P className="text-[11px] text-slate-400">
            <strong>Read the two FOBbing rungs together.</strong> The fixed block is inland haulage, inspection and
            terminal handling — it does not care what coffee is worth. The ad-valorem rung is quality preparation and
            outturn loss, financing and exporter margin, all of which scale with the cargo: for Brazil conilon that
            share is <strong>{fob.pct != null ? `${fob.pct.toFixed(2)}%` : "—"}</strong>, of which
            {" "}<strong>4.33%</strong> is the grade uplift measured directly in the conilon-basis research (tipo 7/8 →
            tipo 6 · screen 13+). Because it is a percentage, the whole ladder re-rates with the market instead of
            standing at a stale reference — and the history above was re-derived on that basis, so the green line is
            consistent end to end rather than kinked at the date the model changed.
          </P>
        </>
      )}

      {/* ── Chart B: gradings for this origin + who fills the exchange ── */}
      <H>2 · Gradings — who actually fills the exchange</H>
      <P>
        Monthly graded lots for <strong>{origin.label}</strong> (gross inflow to the certified pool). Over the ~13-month
        gradings window this origin contributed <strong>{totalOriginLots.toLocaleString()} lots</strong>.
      </P>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{origin.label} · monthly gradings (lots)</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={inflowFilled} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m) => m.slice(2)} tick={{ fill: AX, fontSize: 9 }} minTickGap={16} />
              <YAxis tick={{ fill: AX, fontSize: 10 }} width={34} />
              <Tooltip {...tip} formatter={(v) => [`${Number(v)} lots`, "graded"]} />
              <Bar dataKey="lots" fill={C.bar} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">All robusta gradings by origin (lots, ~13mo)</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={originRank} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AX, fontSize: 9 }} />
              <YAxis type="category" dataKey="origin" tick={{ fill: AX, fontSize: 9 }} width={92} />
              <Tooltip {...tip} formatter={(v) => [`${Number(v).toLocaleString()} lots`, "graded"]} />
              <Bar dataKey="lots" radius={[0, 2, 2, 0]}>
                {originRank.map((r) => <Cell key={r.origin} fill={r.origin.startsWith(origin.gradingOrigin.replace("Brazilian ", "Brazil ")) ? C.rc : C.bar} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <P className="text-[11px] text-slate-400 mt-1">
        The tell: <strong>Indonesia and Brazil Conillon dominate</strong> the certified pool, while{" "}
        <strong>Vietnam barely tenders</strong> (~a few hundred lots, one July-2025 cluster) despite being the largest
        robusta exporter — Vietnamese coffee sells to the trade, not the exchange. Reaching parity is <em>necessary but
        not sufficient</em>: origin selling behaviour decides who fills LIFFE.
      </P>

      {/* ── Chart C + event study ─────────────────────────────────────── */}
      <H>3 · Does hitting parity systematically pull coffee in?</H>
      <P>
        The rigorous per-origin test isn&rsquo;t possible from stored data (the at-port differential is only ~2 months and
        per-origin inflow counts are tiny). The best available proxy: does the <strong>total</strong> certified pool build
        after RC is elevated (a high RC compresses every origin&rsquo;s differential toward parity)?
      </P>
      <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Total certified robusta stock (lots)</div>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={level} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fill: AX, fontSize: 9 }} minTickGap={44} />
            <YAxis tick={{ fill: AX, fontSize: 10 }} width={44} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip {...tip} formatter={(v) => [`${Number(v).toLocaleString()} lots`, "certified"]} />
            <Line dataKey="price" name="certified" stroke={C.rc} dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {es && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">RC → forward Δstock correlation by lag (weeks)</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={es.lagCorrs} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="lag" tick={{ fill: AX, fontSize: 9 }} />
                <YAxis tick={{ fill: AX, fontSize: 10 }} width={34} domain={[0, "auto"]} />
                <Tooltip {...tip} formatter={(v) => [Number(v).toFixed(2), "corr"]} labelFormatter={(l) => `lag ${l}w`} />
                <Bar dataKey="corr" radius={[2, 2, 0, 0]}>
                  {es.lagCorrs.map((l) => <Cell key={l.lag} fill={l.lag === es.bestLag ? C.up : "#334155"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3 text-xs text-slate-300 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">What the {es.weeks} weeks say ({es.spanLabel})</div>
            <div>Peak response lag: <strong className="text-emerald-400">~{es.bestLag} weeks</strong> (corr {es.bestCorr.toFixed(2)} — weak).</div>
            <div>After <strong>high-RC</strong> weeks, the pool changes <strong className="text-emerald-400">{es.buildHiRc >= 0 ? "+" : ""}{Math.round(es.buildHiRc).toLocaleString()}</strong> lots over the next {es.horizonWeeks}w, vs{" "}
              <strong className="text-red-400">{es.buildLoRc >= 0 ? "+" : ""}{Math.round(es.buildLoRc).toLocaleString()}</strong> after low-RC weeks — a{" "}
              <strong>{Math.round(es.buildHiRc - es.buildLoRc).toLocaleString()}-lot</strong> relative build.</div>
            <div className="text-slate-400 text-[11px]">So the signal is real but <strong>weak and lagged (~2 months)</strong>: high RC leans stocks toward building, but the effect is swamped by the secular drawdown, EUDR transition and freight.</div>
          </div>
        </div>
      )}

      <H>4 · The rigorous per-origin test (building toward it)</H>
      <P>
        The exact test you want — <em>when {origin.label}&rsquo;s differential compresses to tenderable parity, how much
        grades onto the exchange and how long after</em> — needs a persisted daily differential series. That pipeline
        now exists (<Code>tender_parity_history.json</Code>, appended every day), and this panel activates automatically
        once it has enough parity crossings and span.
      </P>
      {pStudy && (
        <div className={`rounded-lg p-3 border ${pStudy.ready ? "bg-emerald-950/20 border-emerald-800/50" : "bg-slate-950/40 border-slate-700/60"}`}>
          {pStudy.ready ? (
            <div className="text-xs text-slate-200 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">Fitted · {pStudy.nEvents} crossings · {pStudy.spanLabel}</div>
              <div>After a parity crossing, <strong>{origin.label}</strong> grades a mean of{" "}
                <strong className="text-emerald-400">{Math.round(pStudy.meanForwardLots).toLocaleString()} lots</strong> onto the exchange within {pStudy.horizonWeeks} weeks,</div>
              <div>with a median lag of <strong className="text-emerald-400">{pStudy.medianLagDays} days</strong> and a{" "}
                <strong>{Math.round(pStudy.hitRate * 100)}%</strong> hit-rate.</div>
            </div>
          ) : (
            <div className="text-xs text-slate-300 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Accumulating — not yet significant</div>
              <div>Collected so far: <strong className="text-amber-400">{pStudy.nEvents}</strong> parity crossing{pStudy.nEvents === 1 ? "" : "s"} over{" "}
                <strong className="text-amber-400">{pStudy.daysCovered}</strong> days ({pStudy.spanLabel}).</div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500/70 rounded-full" style={{ width: `${Math.min(100, (pStudy.daysCovered / 180) * 100)}%` }} />
              </div>
              <div className="text-slate-400 text-[11px]">{pStudy.need}. The pipeline appends one row per origin per day, so this fills in on its own.
                {pStudy.nEvents > 0 && <> Provisional read (not yet trusted): ~<strong>{Math.round(pStudy.meanForwardLots).toLocaleString()} lots</strong> within {pStudy.horizonWeeks}w, median lag <strong>{pStudy.medianLagDays}d</strong>.</>}</div>
            </div>
          )}
        </div>
      )}

      <H>Reading & caveats</H>
      <ul className="space-y-1 mb-2">
        {[
          "Parity is a floor, not a trigger: a differential at/below parity makes tendering economic, but origins that can sell commercial (Vietnam) mostly do — so parity predicts capacity to tender, not the act.",
          "The §3 event study uses RC level as the parity driver over net all-origin stock change; the rigorous per-origin fit (§4) reads the newly-persisted daily differential series and activates once it has enough crossings and span.",
          "Δ(certified stock) is net (gradings − decertifications), so it understates gross inflow; the gradings bars above are the gross-inflow view.",
          "Structural breaks — Red Sea freight re-routing, the EUDR transition-stock allowances, age-allowance decay — move certified stock independently of parity.",
          "Robusta / London shown; the same framework applies to NY arabica (per-origin gradings exist in bags), but arabica farmgate history is too thin to draw the cost stack.",
        ].map((t, i) => (
          <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed"><span className="text-amber-500/70">•</span><span>{t}</span></li>
        ))}
      </ul>
      <P className="text-[11px] text-slate-500">
        Data: <Code>futures_price_history</Code> (RC), <Code>origin_prices_history</Code> + <Code>fx_history</Code>
        (farmgate→USD), <Code>freight.json</Code> (ocean leg), <Code>certified_stocks_robusta</Code> (+ deep files) for
        levels and per-origin gradings. Cost constants from <Code>lib/originCosts</Code> and the Contract-rules parity
        stack. Everything recomputes live as the feeds update.
      </P>
    </div>
  );
}
