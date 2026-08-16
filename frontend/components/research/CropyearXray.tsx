"use client";
// Cross-commodity crop-year X-ray — the September-X-ray mechanism generalized
// to every CFTC market with a real old/other crop-year split. Data:
// cropyear_xray.json (backend/scraper/exporters/cot_cropyear_xray.py).
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";

interface XRow {
  date: string; dtr: number; oi: number; oi_all: number; share: number | null;
  mm_l: number; mm_s: number; mm_net: number; comm_l: number; comm_s: number; comm_net: number;
}
interface XYear { source: string; rows: XRow[] }
interface XMarket { label: string; code: string; roll_month: number; years: Record<string, XYear> }
interface XData { generated_at: string; markets: Record<string, XMarket> }

type MetricKey = "oi" | "mm_net" | "share";
const METRICS: { key: MetricKey; label: string; pct?: boolean }[] = [
  { key: "oi",     label: "Old-bucket OI (last crop-year contract)" },
  { key: "mm_net", label: "Specs net (MM)" },
  { key: "share",  label: "% of total OI", pct: true },
];
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtLots = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(Math.round(v));
const fmtVal = (v: number | null, pct?: boolean) =>
  v == null ? "—" : pct ? `${(v * 100).toFixed(1)}%` : v.toLocaleString("en-US");
const wkBin = (dtr: number) => Math.round(dtr / 7);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(v: number, hist: number[]): number | null {
  if (!hist.length) return null;
  const below = hist.filter(h => h < v).length;
  const equal = hist.filter(h => h === v).length;
  return Math.round(((below + equal / 2) / hist.length) * 100);
}

export default function CropyearXray() {
  const [data, setData] = useState<XData | null>(null);
  const [missing, setMissing] = useState(false);
  const [mkt, setMkt] = useState<string>("coffee");
  const [metric, setMetric] = useState<MetricKey>("mm_net");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<XData>("/data/cropyear_xray.json")
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const curCycle = (m: XMarket) => Math.max(...Object.keys(m.years).map(Number));

  const model = useMemo(() => {
    if (!data) return null;
    const m = data.markets[mkt];
    if (!m) return null;
    const cy = curCycle(m);
    const histYears = Object.keys(m.years).filter(y => Number(y) !== cy).sort();
    const byWk: Record<string, Map<number, XRow>> = {};
    for (const [y, yd] of Object.entries(m.years)) {
      const map = new Map<number, XRow>();
      for (const r of yd.rows) map.set(wkBin(r.dtr), r);
      byWk[y] = map;
    }
    const allWks = Array.from(new Set(Object.values(byWk).flatMap(x => Array.from(x.keys())))).sort((a, b) => b - a);
    return { m, cy, histYears, byWk, allWks };
  }, [data, mkt]);

  const chartData = useMemo(() => {
    if (!model) return [];
    return model.allWks.map(wk => {
      const row: Record<string, number | null> & { wk: number } = { wk };
      const hist: number[] = [];
      for (const y of model.histYears) {
        const v = model.byWk[y].get(wk)?.[metric];
        row[`y${y}`] = v ?? null;
        if (v != null) hist.push(v);
      }
      row.med = median(hist);
      row.cur = model.byWk[String(model.cy)]?.get(wk)?.[metric] ?? null;
      return row;
    });
  }, [model, metric]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      cropyear_xray.json not published yet — dispatch the 9.7 backfill workflow.
    </div>;
  }
  if (!data || !model) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const metricDef = METRICS.find(x => x.key === metric)!;
  const marketKeys = Object.keys(data.markets);

  // Cross-market snapshot: latest current-cycle observation vs history at the same week.
  const snapshot = marketKeys.map(k => {
    const m = data.markets[k];
    const cy = curCycle(m);
    const rows = m.years[String(cy)]?.rows ?? [];
    const last = rows.length ? rows[rows.length - 1] : null;
    if (!last) return { k, m, cy, last: null as XRow | null, pOi: null as number | null, pMm: null as number | null, n: 0 };
    const wk = wkBin(last.dtr);
    const histYears = Object.keys(m.years).filter(y => Number(y) !== cy);
    const histRows = histYears.map(y => m.years[y].rows.find(r => wkBin(r.dtr) === wk)).filter((r): r is XRow => !!r);
    return {
      k, m, cy, last,
      pOi: percentile(last.oi, histRows.map(r => r.oi)),
      pMm: percentile(last.mm_net, histRows.map(r => r.mm_net)),
      n: histRows.length,
    };
  });

  return (
    <div className="space-y-4">
      {/* §1 premise */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">1 · One trick, seven markets</h4>
        <p className="text-xs text-slate-300 leading-relaxed mb-2">
          The KC September X-ray works because the CFTC splits Coffee &ldquo;C&rdquo; positions into crop-year buckets —
          and it maintains the same split for other agricultural markets. In each, as the crop year&rsquo;s earlier
          delivery months expire, the &ldquo;old&rdquo; bucket degenerates to the <strong>last crop-year contract
          alone</strong> — the same single-contract cohort X-ray, on a different calendar per market. The crop-year
          roll (old jumping back to ~all of OI) is <em>detected empirically</em> per market from the same signature
          validated on coffee, not assumed. Every detected roll matches its market&rsquo;s crop calendar: cocoa is
          coffee&rsquo;s exact structural twin (Oct–Sep, roll Sep 1); cotton rolls Jul 1 (Aug–Jul crop year), wheat
          May 1 (Jun–May), soybeans Aug 1, corn Sep 1.
        </p>
        <p className="text-[10px] text-slate-500 mb-2">
          <strong className="text-slate-400">Tested and excluded:</strong> Sugar No. 11 — its COT rows were fetched
          (551 weeks) but show <em>no</em> crop-year roll signature: the CFTC keeps all sugar positions in
          &ldquo;old&rdquo;, so no single-contract window exists there.
        </p>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {marketKeys.map(k => {
            const m = data.markets[k];
            return (
              <span key={k} className="rounded border border-slate-700/60 bg-slate-950/40 px-2 py-1 text-slate-300">
                <strong className="text-slate-100">{m.label}</strong>
                {" "}· roll {MONTHS[m.roll_month]} 1 · last old = {MONTHS[m.roll_month === 1 ? 12 : m.roll_month]}
                {" "}· {Object.keys(m.years).length} cycles
              </span>
            );
          })}
        </div>
      </div>

      {/* §2 per-market corridor */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">2 · The corridor, market by market</h4>
        <div className="flex items-center gap-1 flex-wrap mb-1">
          {marketKeys.map(k => (
            <button key={k} onClick={() => setMkt(k)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                mkt === k ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}>
              {data.markets[k].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {METRICS.map(x => (
            <button key={x.key} onClick={() => setMetric(x.key)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                metric === x.key ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}>
              {x.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="wk" type="number" reversed domain={["dataMax", "dataMin"]}
              tickFormatter={(w: number) => `${w * 7}d`}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false}
              label={{ value: `days before the ${MONTHS[model.m.roll_month]} 1 crop-year roll (weekly COT)`, position: "insideBottom", dy: 12, fill: "#475569", fontSize: 10 }} />
            <YAxis tickFormatter={(v: number) => metricDef.pct ? `${(v * 100).toFixed(0)}%` : fmtLots(v)}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const by: Record<string, number> = {};
              for (const p of payload) if (p.value != null && p.dataKey) by[String(p.dataKey)] = Number(p.value);
              const hist = Object.entries(by).filter(([k]) => k.startsWith("y")).map(([, v]) => v);
              return (
                <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11, padding: "6px 10px" }}>
                  <div className="text-slate-400 mb-0.5">~{Number(label) * 7} days before the roll</div>
                  {by.cur != null && <div className="text-amber-400 font-semibold">{model.cy}: {fmtVal(by.cur, metricDef.pct)}</div>}
                  {by.med != null && <div className="text-slate-200">history median: {fmtVal(by.med, metricDef.pct)}</div>}
                  {hist.length > 0 && (
                    <div className="text-slate-500">range: {fmtVal(Math.min(...hist), metricDef.pct)} – {fmtVal(Math.max(...hist), metricDef.pct)} (n={hist.length})</div>
                  )}
                </div>
              );
            }} />
            {model.histYears.map(y => (
              <Line key={y} dataKey={`y${y}`} stroke="#64748b" strokeWidth={1} strokeOpacity={0.45}
                dot={false} connectNulls isAnimationActive={false} />
            ))}
            <Line dataKey="med" stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="5 4" dot={false}
              connectNulls isAnimationActive={false} />
            <Line dataKey="cur" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 2.5, fill: "#fbbf24" }}
              connectNulls isAnimationActive={false} />
            <ReferenceLine x={0} stroke="#b45309" strokeDasharray="3 3"
              label={{ value: "crop-year roll", fill: "#d97706", fontSize: 9, position: "insideTopRight" }} />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 text-[10px] text-slate-400 mt-1 px-1">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-[2.5px] border-amber-400" /> {model.cy} (current cycle)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-[1.5px] border-dashed border-slate-200" /> median of history</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t border-slate-500" /> each past cycle ({model.histYears[0]}–{model.histYears[model.histYears.length - 1]})</span>
        </div>
      </div>

      {/* §3 cross-market snapshot */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-1">3 · Who&rsquo;s crowded right now — all markets</h4>
        <p className="text-[10px] text-slate-500 mb-2">
          Each market&rsquo;s latest current-cycle COT week, ranked against its own history at the same distance from
          its crop-year roll. Percentiles: P85+ unusually high, P15− unusually low.
        </p>
        <div className="overflow-x-auto">
          <table className="text-[10px] w-full">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left pr-3 pb-1 font-medium">market</th>
                <th className="px-2 pb-1 text-right font-medium">days to roll</th>
                <th className="px-2 pb-1 text-right font-medium">old-bucket OI</th>
                <th className="px-2 pb-1 text-right font-medium">OI %ile</th>
                <th className="px-2 pb-1 text-right font-medium">MM net</th>
                <th className="px-2 pb-1 text-right font-medium">MM %ile</th>
                <th className="px-2 pb-1 text-right font-medium">n hist</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.map(s => (
                <tr key={s.k} className="border-b border-slate-800/60">
                  <td className="pr-3 py-1 text-slate-200 font-semibold whitespace-nowrap">{s.m.label}</td>
                  {s.last ? (
                    <>
                      <td className="px-2 py-1 text-right font-mono text-slate-300">{s.last.dtr}d</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtLots(s.last.oi)}</td>
                      <td className="px-2 py-1 text-right font-mono"
                        style={{ color: s.pOi == null ? "#64748b" : s.pOi >= 85 ? "#fbbf24" : s.pOi <= 15 ? "#818cf8" : "#e2e8f0" }}>
                        {s.pOi == null ? "·" : `P${s.pOi}`}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{s.last.mm_net > 0 ? "+" : ""}{fmtLots(s.last.mm_net)}</td>
                      <td className="px-2 py-1 text-right font-mono"
                        style={{ color: s.pMm == null ? "#64748b" : s.pMm >= 85 ? "#fbbf24" : s.pMm <= 15 ? "#818cf8" : "#e2e8f0" }}>
                        {s.pMm == null ? "·" : `P${s.pMm}`}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{s.n}</td>
                    </>
                  ) : (
                    <td className="px-2 py-1 text-slate-600" colSpan={6}>between cycles — reappears ~4 months before the next roll</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Markets sit at different points of their crop calendars — a market &ldquo;between cycles&rdquo; simply has no
          contract inside the 120-day pre-roll window right now. Data appends weekly from the CFTC report.
        </p>
      </div>

      {/* §4 conclusions */}
      <div className="bg-slate-900 border border-amber-500/20 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">4 · Conclusions — what generalizes and what doesn&rsquo;t (20 years, 6 markets)</h4>
        <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Two families of delivery behavior.</strong> The softs liquidate essentially to zero before their
            delivery window — old-bucket OI remaining a week before the roll: coffee <strong>0.6%</strong>, cocoa
            {" "}<strong>0.5%</strong>, cotton <strong>0.9%</strong> (median of ~20 cycles) — while the grains
            routinely <em>stand for delivery</em>: wheat <strong>16%</strong>, corn <strong>22%</strong>, soybeans
            {" "}<strong>12%</strong> still open. Certificate-style softs exit; registrar-delivery grains deliver.
            The &ldquo;who blinks before notice&rdquo; read is therefore a <em>softs</em> tool above all.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Cocoa exits earliest of all</strong>: 1.5% of the old bucket left already two weeks before the
            roll (coffee still has 13%) — cocoa positioning is effectively decided a full two weeks before coffee&rsquo;s.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Coffee&rsquo;s crowding behavior is NOT a commodity universal.</strong> Correlating spec net length
            at ~30d with how much OI survives to the final week: coffee <strong>−0.40</strong> (crowded years exit
            <em> earlier</em>), cotton <strong>+0.34</strong> (crowded years hang on), cocoa/wheat/corn ≈ 0. Each
            market has its own liquidation personality — pool them and the signal vanishes, so the X-ray must be
            read per-market against its own history (which is what §3 does).
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The cross-market snapshot already shows a rare divergence</strong>: at the same point of the same
            Oct–Sep calendar, coffee&rsquo;s last old contract carries near-record spec <em>length</em> (P90) while
            cocoa&rsquo;s carries near-record spec <em>shortness</em> (P5) — the two softs twins entering their
            delivery run-ups positioned in opposite extremes. Corn pairs a P95 old-bucket OI with record-short specs
            (P5) into its Sep 1 roll.
          </span></li>
        </ul>
      </div>
    </div>
  );
}
