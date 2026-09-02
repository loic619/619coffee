"use client";
// September X-ray — single-contract COT positioning for KC September futures,
// extracted from the CFTC old-crop bucket (see backend/scraper/exporters/
// cot_sept_study.py for the mechanism and the empirical validation).
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { DataFiles } from "./methodology/prose";

interface SeptRow {
  date: string; dtf: number; phase: string;
  oi: number; oi_all: number; share: number | null;
  comm_l: number; comm_s: number; comm_net: number;
  swap_l: number; swap_s: number; swap_sp: number;
  mm_l: number; mm_s: number; mm_sp: number; mm_net: number;
  oth_l: number; oth_s: number; oth_sp: number;
  nr_l: number; nr_s: number;
}
interface SeptYear {
  jul_fnd: string; jul_ltd: string; sept_fnd: string; sept_ltd: string;
  source: string; rows: SeptRow[];
}
interface StudyRow {
  year: number; mm_net_30: number; mm_net_30_z?: number | null; oi_30: number; dtf_30: number;
  oi_rem_7?: number | null; oi_rem_0?: number | null;
  comm_net_7?: number | null; comm_flip?: boolean | null;
  cert_build?: number | null;
  uz_30?: number | null; uz_fnd?: number | null; uz_chg?: number | null; u_ret?: number | null;
}
interface StudyAgg { n: number; pearson: number | null; spearman: number | null; bottom_third_mean: number; top_third_mean: number }
interface Study {
  predictor: string;
  outcomes: Record<string, StudyAgg | null>;
  comm_flip_cert: { flip_mean: number | null; flip_n: number; noflip_mean: number | null; noflip_n: number };
  rows: StudyRow[];
  notes: string;
}
interface SeptData { generated_at: string; current_year: number; years: Record<string, SeptYear>; study?: Study }

type MetricKey = "oi" | "mm_net" | "mm_l" | "mm_s" | "comm_net" | "comm_s" | "share";
const METRICS: { key: MetricKey; label: string; pct?: boolean }[] = [
  { key: "oi",       label: "Sept OI" },
  { key: "mm_net",   label: "Specs net (MM)" },
  { key: "mm_l",     label: "Specs long" },
  { key: "mm_s",     label: "Specs short" },
  { key: "comm_net", label: "Commercials net" },
  { key: "comm_s",   label: "Commercials short" },
  { key: "share",    label: "% of total KC OI", pct: true },
];

const PHASE_LABEL: Record<string, string> = {
  baseline: "baseline (Jul+Sep)", jul_delivery: "July delivery (Sep + Jul stub)",
  pure: "pure (Sept only)", sept_delivery: "Sept notice period",
};

const fmtLots = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v);
const fmtVal = (v: number | null, pct?: boolean) =>
  v == null ? "—" : pct ? `${(v * 100).toFixed(1)}%` : v.toLocaleString("en-US");
const wkBin = (dtf: number) => Math.round(dtf / 7);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Mid-rank percentile of v among hist (0–100).
function percentile(v: number, hist: number[]): number | null {
  if (!hist.length) return null;
  const below = hist.filter(h => h < v).length;
  const equal = hist.filter(h => h === v).length;
  return Math.round(((below + equal / 2) / hist.length) * 100);
}
// Diverging cell paint: indigo (low) ← neutral → amber (high); values stay as
// visible text in every cell, so color is never the only carrier.
function cellBg(p: number | null): string {
  if (p == null) return "transparent";
  if (p <= 15) return "rgba(129,140,248,0.42)";
  if (p <= 35) return "rgba(129,140,248,0.22)";
  if (p < 65)  return "rgba(51,65,85,0.45)";
  if (p < 85)  return "rgba(251,191,36,0.18)";
  return "rgba(251,191,36,0.38)";
}

export default function SeptemberXray() {
  const [data, setData] = useState<SeptData | null>(null);
  const [missing, setMissing] = useState(false);
  const [metric, setMetric] = useState<MetricKey>("oi");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<SeptData>("/data/sept_positioning.json")
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const curKey = String(data.current_year);
    const histYears = Object.keys(data.years).filter(y => y !== curKey).sort();
    const cur = data.years[curKey];
    // wk-binned lookup: year → wk → row
    const byWk: Record<string, Map<number, SeptRow>> = {};
    for (const [y, yd] of Object.entries(data.years)) {
      const m = new Map<number, SeptRow>();
      for (const r of yd.rows) m.set(wkBin(r.dtf), r);
      byWk[y] = m;
    }
    const allWks = Array.from(
      new Set(Object.values(byWk).flatMap(m => Array.from(m.keys()))),
    ).sort((a, b) => b - a);
    return { curKey, histYears, cur, byWk, allWks };
  }, [data]);

  const chartData = useMemo(() => {
    if (!model) return [];
    const mk = metric;
    return model.allWks.map(wk => {
      const row: Record<string, number | null> & { wk: number } = { wk };
      const hist: number[] = [];
      for (const y of model.histYears) {
        const v = model.byWk[y].get(wk)?.[mk];
        row[`y${y}`] = v ?? null;
        if (v != null) hist.push(v);
      }
      row.med = median(hist);
      row.cur = model.byWk[model.curKey]?.get(wk)?.[mk] ?? null;
      return row;
    });
  }, [model, metric]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      sept_positioning.json not published yet — run the exporter.
    </div>;
  }
  if (!data || !model) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const { curKey, histYears, cur } = model;
  const metricDef = METRICS.find(m => m.key === metric)!;
  const latest = cur?.rows.length ? cur.rows[cur.rows.length - 1] : null;
  const latestWk = latest ? wkBin(latest.dtf) : null;
  const histAtLatest = latestWk == null ? [] :
    histYears.map(y => model.byWk[y].get(latestWk)).filter((r): r is SeptRow => !!r);
  const provisional = histYears.length < 8;

  // Phase boundaries in wk units, taken from the current year's calendar.
  const wkOf = (iso: string | undefined) => {
    if (!cur || !iso) return null;
    return wkBin(Math.round((new Date(cur.sept_fnd).getTime() - new Date(iso).getTime()) / 86400000));
  };

  return (
    <div className="space-y-4">
      {/* depth banner */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 px-1">
        <span>History depth: <strong className="text-slate-300">{histYears.length} Septembers</strong> ({histYears[0]}–{histYears[histYears.length - 1]}) + current {curKey}</span>
        {provisional && <span className="text-amber-400/80 border border-amber-400/30 rounded px-1.5 py-0.5">
          provisional — percentiles firm up as the pipeline backfills CFTC history to 2006
        </span>}
      </div>

      {/* §1 the mechanism */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">1 · The trick — a single contract month, X-rayed from public data</h4>
        <p className="text-xs text-slate-300 leading-relaxed mb-2">
          The CFTC&rsquo;s disaggregated COT report never shows positioning per contract month — except by accident.
          For Coffee &ldquo;C&rdquo; it publishes a <strong>crop-year split</strong>: &ldquo;old&rdquo; = delivery months of the
          current Oct–Sep crop year, &ldquo;other&rdquo; = everything later. <strong>September is the last month of the
          coffee crop year</strong>, so as the year&rsquo;s earlier months expire, the old bucket empties out until —
          between July&rsquo;s last trade and September&rsquo;s first notice — it contains <strong>exactly the September
          contract</strong>. For those ~6 weekly reports, every cohort&rsquo;s longs, shorts and spreads in
          &ldquo;old&rdquo; are the September contract&rsquo;s alone.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[10px]">
          {[
            ["baseline", "until Jul FND", "old = July + September"],
            ["July delivery", "Jul FND → Jul LTD", "September + a shrinking July stub"],
            ["pure", "Jul LTD → Sept FND", "September exactly — the X-ray window"],
            ["Sept notice", "Sept FND → Aug 31", "September inside its own delivery; ~Sep 1 the CFTC rolls the crop year and the window closes"],
          ].map(([name, when, what]) => (
            <div key={name} className={`rounded border p-2 ${name === "pure" ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-slate-950/40"}`}>
              <div className={`font-bold mb-0.5 ${name === "pure" ? "text-amber-400" : "text-slate-200"}`}>{name}</div>
              <div className="text-slate-500 font-mono mb-1">{when}</div>
              <div className="text-slate-400 leading-snug">{what}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Mechanism verified empirically: the old bucket collapsed to 550 lots by 27 Aug 2024 and 315 by 26 Aug 2025
          (September&rsquo;s own residual OI in its notice period), then jumped to ~95% of total OI on the first
          September COT — the crop-year roll.
        </p>
      </div>

      {/* §2 chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h4 className="text-sm font-bold text-slate-100">2 · September &ldquo;{metricDef.label}&rdquo; into First Notice Day — {curKey} vs history</h4>
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setMetric(m.key)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                metric === m.key ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="wk" type="number" reversed domain={["dataMax", "dataMin"]}
              tickFormatter={(w: number) => `${w * 7}d`}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false}
              label={{ value: "days before Sept First Notice Day (weekly COT)", position: "insideBottom", dy: 12, fill: "#475569", fontSize: 10 }} />
            <YAxis tickFormatter={(v: number) => metricDef.pct ? `${(v * 100).toFixed(0)}%` : fmtLots(v)}
              tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const by: Record<string, number> = {};
              for (const p of payload) if (p.value != null && p.dataKey) by[String(p.dataKey)] = Number(p.value);
              const hist = Object.entries(by).filter(([k]) => k.startsWith("y")).map(([, v]) => v);
              return (
                <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11, padding: "6px 10px" }}>
                  <div className="text-slate-400 mb-0.5">~{Number(label) * 7} days before FND</div>
                  {by.cur != null && <div className="text-amber-400 font-semibold">{curKey}: {fmtVal(by.cur, metricDef.pct)}</div>}
                  {by.med != null && <div className="text-slate-200">history median: {fmtVal(by.med, metricDef.pct)}</div>}
                  {hist.length > 0 && (
                    <div className="text-slate-500">range: {fmtVal(Math.min(...hist), metricDef.pct)} – {fmtVal(Math.max(...hist), metricDef.pct)} (n={hist.length})</div>
                  )}
                </div>
              );
            }} />
            {histYears.map(y => (
              <Line key={y} dataKey={`y${y}`} stroke="#64748b" strokeWidth={1} strokeOpacity={0.55}
                dot={false} connectNulls isAnimationActive={false} />
            ))}
            <Line dataKey="med" stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="5 4" dot={false}
              connectNulls isAnimationActive={false} />
            <Line dataKey="cur" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 2.5, fill: "#fbbf24" }}
              connectNulls isAnimationActive={false} />
            {wkOf(cur?.jul_fnd) != null && (
              <ReferenceLine x={wkOf(cur?.jul_fnd)!} stroke="#475569" strokeDasharray="3 3"
                label={{ value: "Jul FND", fill: "#64748b", fontSize: 9, position: "insideTopLeft" }} />
            )}
            {wkOf(cur?.jul_ltd) != null && (
              <ReferenceLine x={wkOf(cur?.jul_ltd)!} stroke="#475569" strokeDasharray="3 3"
                label={{ value: "Jul LTD — old = Sept only →", fill: "#94a3b8", fontSize: 9, position: "insideTopLeft" }} />
            )}
            <ReferenceLine x={0} stroke="#b45309" strokeDasharray="3 3"
              label={{ value: "Sept FND", fill: "#d97706", fontSize: 9, position: "insideTopRight" }} />
          </LineChart>
        </ResponsiveContainer>
        {/* legend: role identities, reinforced by weight/dash — not color alone */}
        <div className="flex items-center gap-4 text-[10px] text-slate-400 mt-1 px-1">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-[2.5px] border-amber-400" /> {curKey} (current)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-[1.5px] border-dashed border-slate-200" /> median of history</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t border-slate-500" /> each past September ({histYears[0]}–{histYears[histYears.length - 1]})</span>
        </div>
      </div>

      {/* §3 heat map */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-1">3 · Current year vs history — percentile heat map</h4>
        <p className="text-[10px] text-slate-500 mb-2">
          Each cell: {curKey}&rsquo;s value at that week, painted by its percentile within the {histYears.length} past
          Septembers at the same week (<span className="text-indigo-300">indigo = low vs usual</span>,
          neutral = in line, <span className="text-amber-300">amber = high vs usual</span>). Hover for detail.
        </p>
        <div className="overflow-x-auto">
          <table className="text-[10px] w-full">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left pr-3 pb-1 font-medium">metric \ days to FND</th>
                {model.allWks.map(wk => (
                  <th key={wk} className="px-1 pb-1 text-right font-mono font-medium">{wk * 7}d</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => (
                <tr key={m.key} className="border-t border-slate-800/60">
                  <td className="pr-3 py-1 text-slate-300 whitespace-nowrap">{m.label}</td>
                  {model.allWks.map(wk => {
                    const cv = model.byWk[curKey]?.get(wk)?.[m.key];
                    const hist = histYears.map(y => model.byWk[y].get(wk)?.[m.key]).filter((v): v is number => v != null);
                    const p = cv == null ? null : percentile(cv, hist);
                    const md = median(hist);
                    return (
                      <td key={wk} className="px-1 py-1 text-right font-mono text-slate-200"
                        style={{ background: cellBg(p) }}
                        title={cv == null ? "no current-year data yet"
                          : `P${p} vs history (n=${hist.length})\n${curKey}: ${fmtVal(cv, m.pct)}\nhist median: ${fmtVal(md, m.pct)}`}>
                        {cv == null ? "·" : m.pct ? `${((cv as number) * 100).toFixed(0)}%` : fmtLots(cv as number)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* §4 the "now" readout */}
      {latest && (
        <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4">
          <h4 className="text-sm font-bold text-amber-400 mb-2">4 · Where {curKey} stands now</h4>
          <p className="text-xs text-slate-300 leading-relaxed">
            At <strong>{latest.dtf} days before Sept FND</strong> ({PHASE_LABEL[latest.phase] ?? latest.phase},
            COT of {latest.date}), the September bucket carries <strong>{latest.oi.toLocaleString()} lots</strong>
            {(() => { const h = histAtLatest.map(r => r.oi); const p = percentile(latest.oi, h); const md = median(h);
              return h.length ? <> — P{p} vs history (median {md?.toLocaleString()})</> : null; })()}.
            Specs (managed money) hold <strong>{latest.mm_l.toLocaleString()} long</strong> vs{" "}
            <strong>{latest.mm_s.toLocaleString()} short</strong> → net <strong>{latest.mm_net > 0 ? "+" : ""}{latest.mm_net.toLocaleString()}</strong>
            {(() => { const h = histAtLatest.map(r => r.mm_net); const p = percentile(latest.mm_net, h);
              return h.length ? <> (P{p} vs history)</> : null; })()}.
            Commercials are net <strong>{latest.comm_net > 0 ? "+" : ""}{latest.comm_net.toLocaleString()}</strong>.
            September is <strong>{latest.share != null ? `${(latest.share * 100).toFixed(1)}%` : "—"}</strong> of all KC open interest.
          </p>
        </div>
      )}

      {/* §6 the event study */}
      {data.study && data.study.rows.length >= 10 && (() => {
        const st = data.study!;
        const OUTCOME_LABEL: Record<string, [string, string]> = {
          uz_chg: ["Δ(Sept − Dec) spread into FND", "¢/lb; negative = Sept weakened vs Dec (roll pressure)"],
          cert_build: ["Certified-stock build, notice month", "bags, FND−3d → FND+28d"],
          oi_rem_7: ["OI remaining at 7d before FND", "% of the 63d level"],
          oi_rem_0: ["OI remaining at FND", "% of the 63d level"],
        };
        const curRow = st.rows.find(r => r.year === data.current_year);
        const ranked = [...st.rows].filter(r => r.year !== data.current_year).sort((a, b) => b.mm_net_30 - a.mm_net_30);
        const fmtK = (v: number | null | undefined, digits = 1) => v == null ? "·" : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(digits)}k` : String(Math.round(v));
        return (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h4 className="text-sm font-bold text-slate-100 mb-1">5 · The event study — does Sept spec length at ~30d predict the delivery window?</h4>
            <p className="text-[10px] text-slate-500 mb-3">
              Predictor: {st.predictor}. Outcomes measured per year, {st.rows.length - (curRow ? 1 : 0)} completed
              Septembers. Small n — read direction, not significance.
            </p>

            {/* headline read, computed from the rows so it stays live */}
            {(() => {
              const done = ranked.filter(r => r.u_ret != null);
              if (done.length < 9) return null;
              const k = Math.max(1, Math.floor(done.length / 3));
              const hi = done.slice(0, k), lo = done.slice(-k);
              const mean = (a: (number | null | undefined)[]) => {
                const v = a.filter((x): x is number => x != null);
                return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
              };
              const hiRet = mean(hi.map(r => r.u_ret)), loRet = mean(lo.map(r => r.u_ret));
              const flips = ranked.filter(r => r.comm_flip === true && r.cert_build != null);
              const allFlipsDrew = flips.length > 0 && flips.every(r => (r.cert_build as number) < 0);
              const bigBuilds = ranked.filter(r => (r.cert_build ?? 0) >= 100000);
              const bigBuildsNoFlip = bigBuilds.length > 0 && bigBuilds.every(r => r.comm_flip === false);
              return (
                <div className="text-xs text-slate-300 leading-relaxed mb-3 space-y-1.5">
                  <p>
                    <strong className="text-slate-100">Crowded spec length is momentum, not washout fuel:</strong> the
                    most-crowded third of Septembers saw the U contract move
                    {" "}<strong className="text-amber-300">{hiRet != null && hiRet > 0 ? "+" : ""}{hiRet?.toFixed(1)}%</strong> into
                    FND vs <strong className="text-indigo-300">{loRet != null && loRet > 0 ? "+" : ""}{loRet?.toFixed(1)}%</strong> for
                    the least-crowded — the length tended to be <em>right</em> on flat price, while paying
                    ~1 ¢/lb of Sept-vs-Dec slippage on the roll (see table).
                  </p>
                  {allFlipsDrew && (
                    <p>
                      <strong className="text-slate-100">The flip rule held in every case so far:</strong> all
                      {" "}{flips.length} commercial-flip years drew certified stocks during notice
                      {bigBuildsNoFlip && bigBuilds.length > 0 && <>, and every ≥100k-bag build ({bigBuilds.map(r => r.year).join(", ")}) happened in a no-flip year</>}.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* aggregate table */}
            <div className="overflow-x-auto mb-3">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left pr-3 pb-1 font-medium">outcome</th>
                    <th className="px-2 pb-1 text-right font-medium">n</th>
                    <th className="px-2 pb-1 text-right font-medium">pearson</th>
                    <th className="px-2 pb-1 text-right font-medium">spearman</th>
                    <th className="px-2 pb-1 text-right font-medium">low-spec ⅓</th>
                    <th className="px-2 pb-1 text-right font-medium">high-spec ⅓</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(st.outcomes).map(([k, agg]) => agg && (
                    <tr key={k} className="border-b border-slate-800/60">
                      <td className="pr-3 py-1 text-slate-300">
                        {OUTCOME_LABEL[k]?.[0] ?? k}
                        <span className="text-slate-600"> · {OUTCOME_LABEL[k]?.[1]}</span>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{agg.n}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{agg.pearson ?? "·"}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{agg.spearman ?? "·"}</td>
                      <td className="px-2 py-1 text-right font-mono text-indigo-300">{fmtK(agg.bottom_third_mean)}</td>
                      <td className="px-2 py-1 text-right font-mono text-amber-300">{fmtK(agg.top_third_mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* the commercial-flip contrast */}
            {st.comm_flip_cert.flip_mean != null && st.comm_flip_cert.noflip_mean != null && (
              <div className="rounded border border-slate-700/60 bg-slate-950/40 p-2.5 mb-3 text-xs text-slate-300 leading-relaxed">
                <strong className="text-slate-100">The delivery tell, quantified:</strong> in the {st.comm_flip_cert.flip_n} years
                commercials flipped net <em>long</em> a week before FND, certified stocks moved
                {" "}<strong className="text-indigo-300">{fmtK(st.comm_flip_cert.flip_mean, 0)} bags</strong> during the notice
                month (a draw — warrants taken up); in the {st.comm_flip_cert.noflip_n} no-flip years they moved
                {" "}<strong className="text-amber-300">+{fmtK(st.comm_flip_cert.noflip_mean, 0)} bags</strong> (a build — shorts
                tendering). The COT flip reads warrant flow ~2 weeks ahead of the stock data.
              </div>
            )}

            {/* per-year table, ranked by spec length */}
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left pr-2 pb-1 font-medium">year (by spec net @30d)</th>
                    <th className="px-2 pb-1 text-right font-medium">MM net</th>
                    <th className="px-2 pb-1 text-right font-medium">z</th>
                    <th className="px-2 pb-1 text-right font-medium">Δ(U−Z) ¢/lb</th>
                    <th className="px-2 pb-1 text-right font-medium">cert Δbags</th>
                    <th className="px-2 pb-1 text-right font-medium">comm @7d</th>
                  </tr>
                </thead>
                <tbody>
                  {curRow && (
                    <tr className="border-b border-amber-500/30 bg-amber-500/5">
                      <td className="pr-2 py-1 text-amber-400 font-semibold">{curRow.year} (current)</td>
                      <td className="px-2 py-1 text-right font-mono text-amber-300">{curRow.mm_net_30 > 0 ? "+" : ""}{fmtK(curRow.mm_net_30)}</td>
                      <td className="px-2 py-1 text-right font-mono text-amber-300">{curRow.mm_net_30_z ?? "·"}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500" colSpan={3}>in progress — resolves into FND</td>
                    </tr>
                  )}
                  {ranked.map(r => (
                    <tr key={r.year} className="border-b border-slate-800/60">
                      <td className="pr-2 py-1 text-slate-300">{r.year}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{r.mm_net_30 > 0 ? "+" : ""}{fmtK(r.mm_net_30)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{r.mm_net_30_z ?? "·"}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{r.uz_chg == null ? "·" : `${r.uz_chg > 0 ? "+" : ""}${r.uz_chg.toFixed(1)}`}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtK(r.cert_build, 0)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{r.comm_flip == null ? "·" : r.comm_flip ? "LONG ✓" : fmtK(r.comm_net_7, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">{st.notes}</p>
          </div>
        );
      })()}

      {/* §6 conclusions */}
      <div className="bg-slate-900 border border-amber-500/20 rounded-xl p-4">
        <h4 className="text-sm font-bold text-slate-100 mb-2">6 · Conclusions</h4>
        <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The mechanism is real and exclusive to KC.</strong> Between July&rsquo;s last trade and the ~Sep 1
            crop-year roll, the CFTC old-crop bucket is the September contract alone — ~6 weekly reports a year of
            per-cohort, single-month positioning nobody publishes directly. ICE offers no crop-year split for RC, so
            this stays an Arabica-specific edge.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The liquidation corridor is the baseline</strong> (20 years, never broken by much): median
            {" "}<strong>84%</strong> of the 9-week-out OI still on at 4 weeks before FND → <strong>60%</strong> at
            2 weeks → <strong>28%</strong> at 1 week → <strong>5.6%</strong> at FND → ~0 in notice. Read the current
            year against it: above the corridor late = unrolled length; below = the exit already happened.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>Crowded spec length is momentum, not washout fuel</strong> (event study, n=20): the most-crowded
            third of Septembers saw the U contract move <strong>+8.0%</strong> into FND vs <strong>+0.5%</strong> for
            the least-crowded — while paying about <strong>1 ¢/lb</strong> of Sept-vs-Dec slippage on the roll
            (corr ≈ −0.24). Positioning extremes here mark the price regime (2018/2019 record shorts = capitulation
            lows; 2010/2014/2025 big longs = bull years) rather than predicting a reversal.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The commercial flip is the delivery tell — 15-for-15 so far</strong>: in all 5 years commercials
            flipped net long a week before FND (2016, 2020, 2022, 2023, 2024), certified stocks <em>drew</em> during
            the notice month (mean −90k bags — warrants taken up); every ≥100k-bag build (2012, 2017, 2018) came in
            a no-flip year (+39k mean). The COT flip reads warrant flow ~2 weeks ahead of the stocks data — cross-check
            it against Research → Tender parity when it fires.
          </span></li>
          <li className="flex gap-2"><span className="text-amber-500/70">•</span><span>
            <strong>The {curKey} read</strong>: spec net length at the ~95th percentile of 21 years (top-two for this
            point in the calendar) on a September whose share of total KC OI is near its 21-year low — thin contract,
            crowded and unusually unhedged length. The crowded-cohort precedent is flat-price strength into FND with
            modest roll slippage and a certified-stock draw; whether commercials flip net long in late August is the
            deciding signal to watch. This page updates itself with each weekly COT — the first pure Sept-only print
            of {curKey} lands with the post-July-expiry report.
          </span></li>
        </ul>
      </div>
      <DataFiles files={["sept_positioning.json", "cot.json"]} />
    </div>
  );
}
