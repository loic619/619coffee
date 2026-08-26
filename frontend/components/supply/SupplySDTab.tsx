"use client";
/**
 * Supply & demand across every origin and every source, in one place.
 *
 * Three things live here:
 *   · the world balance sheet, in accounting format (shared component, so it
 *     is the same statement the Total tab shows — not a second version of it);
 *   · a source-comparison chart, one line per source across crop years, with
 *     production / consumption / stocks on a toggle;
 *   · the same numbers as a full by-source table, matching the grid in the
 *     crop-estimate editor.
 *
 * THE THING TO KNOW BEFORE READING THE CHART
 * Sources do not cover the same origins. Marex and USDA publish all sixteen;
 * CONAB publishes Brazil, FNC Colombia, StoneX Ethiopia. Summing a source
 * across whatever it happens to cover would put CONAB's Brazil-only 55 on the
 * same axis as a world 165 — a chart that looks like disagreement about the
 * crop and is really a difference in scope. So the world chart admits only
 * sources that estimate the world, and says which ones it left out; the
 * specialists are compared against each other inside their own origin, in the
 * table below.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import WorldBalanceSheet from "@/components/supply/WorldBalanceSheet";
import { ORIGIN_FILES } from "@/lib/worldBalance";
import {
  derivedWorld, loadSdBundle, originSpreads, worldCapableSources,
  type SdBundle,
} from "@/lib/sdSources";

const TT = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 6, fontSize: 10, color: "#e2e8f0",
} as const;
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const LABEL = "text-[10px] text-slate-400 uppercase tracking-wide";
const CHIP = "text-[9px] px-2 py-0.5 transition-colors";
const DERIVED_COLOR = "#e2e8f0";

type Metric = "production" | "consumption" | "stocks";
type View = "sheet" | "table";

interface CcsDoc {
  seasons: string[];
  production: Record<"total" | "robusta" | "arabica", Record<string, number[]>>;
  production_totals: Record<"total" | "robusta" | "arabica", number[]>;
  consumption: Record<"total" | "robusta" | "arabica", number[]>;
  stocks: Record<"total" | "robusta" | "arabica", number[]>;
  stock_consumption_pct: Record<"total" | "robusta" | "arabica", number[]>;
}
interface ConsumptionDoc {
  crop_year: string;
  sources: { key: string; label: string; season: string | null; m_bags: number;
             carried_forward?: boolean }[];
  mean: number | null;
}

export default function SupplySDTab() {
  const [bundle, setBundle] = useState<SdBundle | null>(null);
  const [ccs, setCcs] = useState<CcsDoc | null>(null);
  const [cons, setCons] = useState<ConsumptionDoc | null>(null);
  const [view, setView] = useState<View>("sheet");
  const [metric, setMetric] = useState<Metric>("production");
  const [crop, setCrop] = useState<"total" | "arabica" | "robusta">("total");
  const [tableSeason, setTableSeason] = useState<string>("");

  useEffect(() => {
    loadSdBundle().then(setBundle).catch(() => setBundle(null));
    fetch("/data/ccs_sd.json").then(r => (r.ok ? r.json() : null)).then(setCcs).catch(() => {});
    fetch("/data/world_consumption.json").then(r => (r.ok ? r.json() : null)).then(setCons).catch(() => {});
  }, []);

  // Default the table to the most recent season that actually has numbers.
  useEffect(() => {
    if (bundle && !tableSeason && bundle.seasons.length) {
      setTableSeason(bundle.seasons[bundle.seasons.length - 1]);
    }
  }, [bundle, tableSeason]);

  const capable = useMemo(() => (bundle ? worldCapableSources(bundle) : []), [bundle]);
  const partial = useMemo(
    () => (bundle ? Object.keys(bundle.world).filter(s => !capable.includes(s)) : []),
    [bundle, capable],
  );

  /** One row per crop year; one key per plotted source. */
  const chartData = useMemo(() => {
    if (metric === "production") {
      if (!bundle) return [];
      return bundle.seasons.map(season => {
        const row: Record<string, string | number | null> = { season };
        for (const src of capable) {
          row[src] = bundle.world[src]?.[season]?.m_bags ?? null;
        }
        // CCS publishes a complete world row of its own, including the
        // groups our seeds cannot hold, so it comes from there rather than
        // from summing the nine origins we mapped.
        if (ccs) {
          const i = ccs.seasons.indexOf(season);
          row.ccs_world = i >= 0 ? ccs.production_totals[crop]?.[i] ?? null : null;
        }
        if (crop === "total") row.derived = derivedWorld(bundle, season);
        return row;
      });
    }
    if (!ccs) return [];
    const block = metric === "consumption" ? ccs.consumption : ccs.stocks;
    return ccs.seasons.map((season, i) => {
      const row: Record<string, string | number | null> = { season, ccs_world: block[crop]?.[i] ?? null };
      // Our own estimates are single points, not series — placed on the crop
      // year they refer to rather than drawn as a line across years we never
      // estimated.
      if (metric === "consumption" && cons) {
        for (const s of cons.sources) {
          // CCS is already the continuous line above — plotting its point
          // estimate as well put it in the legend twice.
          if (s.key === "ccs") continue;
          if (s.season === season) row[`c_${s.key}`] = s.m_bags;
        }
      }
      return row;
    });
  }, [bundle, ccs, cons, metric, crop, capable]);

  const chartSeries = useMemo(() => {
    if (metric === "production") {
      const out = capable.map(src => ({
        key: src, label: bundle?.sources[src]?.label ?? src,
        color: bundle?.sources[src]?.color ?? "#94a3b8", dashed: false,
      }));
      if (ccs) out.push({ key: "ccs_world", label: "CCS (world)", color: "#facc15", dashed: false });
      if (crop === "total") {
        out.push({ key: "derived", label: "Our consensus", color: DERIVED_COLOR, dashed: true });
      }
      return out;
    }
    const out = [{ key: "ccs_world", label: "CCS Coffee", color: "#facc15", dashed: false }];
    if (metric === "consumption" && cons) {
      for (const s of cons.sources) {
        if (s.key === "ccs") continue;   // see chartData
        out.push({
          key: `c_${s.key}`, label: s.label,
          color: s.key === "internal" ? DERIVED_COLOR : s.key === "ico" ? "#f59e0b" : "#3b82f6",
          dashed: true,
        });
      }
    }
    return out;
  }, [bundle, ccs, cons, metric, crop, capable]);

  const spreads = useMemo(
    () => (bundle && tableSeason ? originSpreads(bundle, tableSeason) : []),
    [bundle, tableSeason],
  );

  if (!bundle) {
    return <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading supply & demand…</div>;
  }

  const tableSources = Object.keys(bundle.world).filter(
    src => bundle.seeds && Object.values(bundle.seeds).some(seed =>
      (seed.seasons ?? []).some(s => s.season === tableSeason && s.production?.[src] != null)),
  ).sort((a, z) => (bundle.coverage[z] ?? 0) - (bundle.coverage[a] ?? 0));

  return (
    <div className="space-y-4">
      {/* ── View toggle ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded border border-slate-700 overflow-hidden">
          {([["sheet", "Balance sheet"], ["table", "By source"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`${CHIP} ${view === v ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-[9px] text-slate-600">
          {Object.keys(bundle.seeds).length} origins · {Object.keys(bundle.sources).length} sources ·
          {" "}{bundle.seasons[0]}–{bundle.seasons[bundle.seasons.length - 1]}
        </div>
      </div>

      {view === "sheet" ? <WorldBalanceSheet /> : (
        <SourceTable bundle={bundle} season={tableSeason} setSeason={setTableSeason}
                     sources={tableSources} />
      )}

      {/* ── Source comparison ───────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className={LABEL}>
            Source comparison
            <span className="ml-2 text-slate-600 normal-case">
              · million 60-kg bags by crop year
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              {(["production", "consumption", "stocks"] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`${CHIP} ${metric === m ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              {(["total", "arabica", "robusta"] as const).map(c => (
                <button key={c} onClick={() => setCrop(c)}
                  className={`${CHIP} ${crop === c ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
                  title={metric === "production" && c !== "total"
                    ? "Only sources that publish a crop split carry this view"
                    : undefined}>
                  {c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="season" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
              {/* Auto domain, not zero-anchored: production sits in a 150-185
                  band and a zero baseline flattens every difference between
                  sources into a single thick line. */}
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false}
                width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 9 }} iconType="plainline" />
              {chartSeries.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color} strokeWidth={s.dashed ? 2 : 1.6}
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                  dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="text-[8px] text-slate-600 leading-relaxed">
          {metric === "production" ? (
            <>
              Only sources that estimate the WHOLE world are plotted — {capable.length} of{" "}
              {Object.keys(bundle.world).length} cover at least 90% of the {bundle.originCount}{" "}
              origins. {partial.length > 0 && (
                <>Left out because they publish a single origin, not a world:{" "}
                  <span className="text-slate-500">
                    {partial.map(p => bundle.sources[p]?.label ?? p).join(", ")}
                  </span>. Summing those across whatever they cover would read as a
                  disagreement about the crop when it is a difference in scope — compare them
                  inside their own origin in the by-source table instead.</>
              )}
              {" "}CCS is drawn from its own published world row rather than from the nine
              origins we mapped into seeds, because that row includes the groups a per-origin
              seed cannot hold — which is also why it sits ABOVE the others by roughly 9 M bags:
              its world includes a long tail of small origins that a 16-origin sum does not.
              That gap is scope, not disagreement.{" "}
              <span className="text-slate-400">Our consensus</span> is the analyst Final where
              set, otherwise the mean of each origin&apos;s sources, and it stops before 2021/22
              because only CCS reaches further back — a sum over nine origins is not a world
              estimate, so the line breaks rather than dropping off a cliff that is coverage
              rather than crop.
            </>
          ) : (
            <>
              CCS is the only source publishing a continuous {metric} series, so it is the only
              line. Our own estimates are single points placed on the crop year they refer to,
              not drawn across years we never estimated. Consumption sources whose latest print
              trails the current crop year still inform the consensus on the balance sheet —
              consumption moves slowly — but they are not extrapolated here.
            </>
          )}
        </div>
      </div>

      {ccs && <ReconcilePanel bundle={bundle} ccs={ccs} />}
      <SpreadPanel spreads={spreads} season={tableSeason} bundle={bundle} />
      {ccs && <TightnessPanel ccs={ccs} />}
    </div>
  );
}

/** Origins × sources for one season — the same grid the editor shows. */
function SourceTable({ bundle, season, setSeason, sources }: {
  bundle: SdBundle; season: string; setSeason: (s: string) => void; sources: string[];
}) {
  const rows = Object.keys(ORIGIN_FILES).filter(o => bundle.seeds[o]);
  const cell = (origin: string, src: string) => {
    const s = (bundle.seeds[origin]?.seasons ?? []).find(x => x.season === season);
    return s?.production?.[src] ?? null;
  };
  const colTotal = (src: string) => {
    const vals = rows.map(o => cell(o, src)).filter((v): v is number => v != null);
    return vals.length ? { sum: Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10, n: vals.length } : null;
  };
  const rowStats = (origin: string) => {
    const vals = sources.map(s => cell(origin, s)).filter((v): v is number => v != null);
    if (!vals.length) return null;
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const s = (bundle.seeds[origin]?.seasons ?? []).find(x => x.season === season);
    return { mean: Math.round(mean * 10) / 10, n: vals.length, final: s?.production_final ?? null };
  };

  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className={LABEL}>
          Production by source
          <span className="ml-2 text-slate-600 normal-case">· million 60-kg bags</span>
        </div>
        <select value={season} onChange={e => setSeason(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-slate-500">
          {bundle.seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2 font-medium">Origin</th>
              {sources.map(s => (
                <th key={s} className="text-right py-1 px-2 font-medium whitespace-nowrap"
                  style={{ color: bundle.sources[s]?.color }}
                  title={`Covers ${bundle.coverage[s]} of ${bundle.originCount} origins`}>
                  {bundle.sources[s]?.label ?? s}
                </th>
              ))}
              <th className="text-right py-1 px-2 font-medium">Mean</th>
              <th className="text-right py-1 pl-2 font-medium">Final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(o => {
              const st = rowStats(o);
              return (
                <tr key={o} className="border-t border-slate-800/60">
                  <td className="py-1 pr-2 text-slate-300 whitespace-nowrap">{ORIGIN_FILES[o].label}</td>
                  {sources.map(s => {
                    const v = cell(o, s);
                    return (
                      <td key={s} className={`py-1 px-2 text-right font-mono ${v == null ? "text-slate-700" : "text-slate-300"}`}>
                        {v == null ? "–" : v.toFixed(1)}
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right font-mono text-slate-400">
                    {st ? st.mean.toFixed(1) : "–"}
                  </td>
                  <td className="py-1 pl-2 text-right font-mono font-bold text-amber-400">
                    {st?.final != null ? st.final.toFixed(1) : "–"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-600">
              <td className="py-1 pr-2 font-bold text-slate-200">World</td>
              {sources.map(s => {
                const t = colTotal(s);
                const full = t && t.n >= rows.length * 0.9;
                return (
                  <td key={s}
                    className={`py-1 px-2 text-right font-mono font-bold ${full ? "text-slate-200" : "text-slate-600"}`}
                    title={t ? `${t.n} of ${rows.length} origins${full ? "" : " — a partial sum, not a world estimate"}` : undefined}>
                    {t ? t.sum.toFixed(1) : "–"}
                    {t && !full && <span className="text-[8px] text-slate-700"> ({t.n})</span>}
                  </td>
                );
              })}
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-[8px] text-slate-600 leading-relaxed">
        A world total in grey with a count beside it is a PARTIAL sum — that source publishes
        only those origins, so the figure is not comparable with a full-coverage source however
        similar it looks. Final is the analyst override where one is set; the balance sheet uses
        it in preference to the mean.
      </div>
    </div>
  );
}

/** Our world against CCS's, decomposed. Scope first, then what is left.
 *
 *  Deliberately does not adjudicate. Two houses can read the same crop
 *  differently and both be publishing in good faith; what is useful is knowing
 *  HOW MUCH of the gap is a different question being answered (origins we do
 *  not itemise) and how much is a genuine difference of view, and where that
 *  view sits. Naming a winner here would be a house opinion dressed as a
 *  reconciliation. */
function ReconcilePanel({ bundle, ccs }: { bundle: SdBundle; ccs: CcsDoc }) {
  // Latest season both sides cover. CCS's PRELIM column is excluded from the
  // consumption consensus, but its production table is published, so it is a
  // fair comparison here.
  const season = [...ccs.seasons].reverse().find(sea => derivedWorld(bundle, sea) != null);
  if (!season) return null;
  const i = ccs.seasons.indexOf(season);
  const ours = derivedWorld(bundle, season);
  const tail = ccs.production.total?.others?.[i];
  const world = ccs.production_totals.total?.[i];
  if (ours == null || tail == null || world == null) return null;
  const comparable = Math.round((ours + tail) * 10) / 10;
  const residual = Math.round((world - comparable) * 10) / 10;

  // Per-origin differences, largest absolute first.
  const diffs = Object.entries(bundle.seeds).flatMap(([o, seed]) => {
    const s = (seed.seasons ?? []).find(x => x.season === season);
    const theirs = s?.production?.ccs;
    if (theirs == null) return [];
    const vals = Object.values(s?.production ?? {});
    const mine = s?.production_final ?? (vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0);
    return [{ origin: o, label: ORIGIN_FILES[o]?.label ?? o,
              mine: Math.round(mine * 10) / 10, theirs,
              diff: Math.round((theirs - mine) * 10) / 10 }];
  }).sort((a, z) => Math.abs(z.diff) - Math.abs(a.diff)).slice(0, 5);

  return (
    <div className={CARD}>
      <div className={LABEL}>
        Our world against CCS
        <span className="ml-2 text-slate-600 normal-case">· {season}, million 60-kg bags</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-[10px]">
          <Row k="Our consensus, 16 origins" v={ours} />
          <Row k="+ rest of world (CCS “Others”)" v={tail} muted />
          <Row k="= on comparable scope" v={comparable} rule />
          <Row k="CCS published world" v={world} />
          <Row k="Difference" v={residual} rule accent />
        </div>
        <div className="space-y-1 text-[10px]">
          <div className="text-slate-500 mb-1">Where that difference sits</div>
          {diffs.map(d => (
            <div key={d.origin} className="flex justify-between gap-2">
              <span className="text-slate-400">{d.label}</span>
              <span className="font-mono text-slate-500">
                {d.mine.toFixed(1)} vs {d.theirs.toFixed(1)}
                <span className={`ml-2 ${Math.abs(d.diff) >= 2 ? "text-slate-300" : "text-slate-600"}`}>
                  {d.diff > 0 ? "+" : ""}{d.diff.toFixed(1)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[8px] text-slate-600 leading-relaxed">
        Scope is separated from opinion: the rest-of-world line closes the part of the gap that is
        simply origins this sheet does not itemise, and what remains sits in the origins both cover.
        No judgement is offered on which figure is right — two houses can read the same crop
        differently and both be publishing in good faith. This records where they differ and by how
        much, which is the part a position actually turns on.
      </div>
    </div>
  );
}

function Row({ k, v, muted, rule, accent }: {
  k: string; v: number; muted?: boolean; rule?: boolean; accent?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 ${rule ? "border-t border-slate-700 pt-1 mt-1" : ""}`}>
      <span className={muted ? "text-slate-500" : "text-slate-400"}>{k}</span>
      <span className={`font-mono ${accent ? "text-amber-400 font-bold" : rule ? "text-slate-200 font-bold" : "text-slate-300"}`}>
        {v > 0 && accent ? "+" : ""}{v.toFixed(1)}
      </span>
    </div>
  );
}

/** Where the houses disagree — more tradeable than where they agree. */
function SpreadPanel({ spreads, season, bundle }: {
  spreads: ReturnType<typeof originSpreads>; season: string; bundle: SdBundle;
}) {
  if (!spreads.length) return null;
  const top = spreads.slice(0, 8);
  return (
    <div className={CARD}>
      <div className={LABEL}>
        Where the sources disagree
        <span className="ml-2 text-slate-600 normal-case">· {season}, widest spread first</span>
      </div>
      <div className="space-y-1.5">
        {top.map(s => (
          <div key={s.origin} className="flex items-center gap-2 text-[10px]">
            <div className="w-20 text-slate-400 truncate">{s.label}</div>
            {/* Each row is scaled to its OWN min-max, not a shared absolute
                axis. On a shared axis Brazil's 66-76 sits far right and
                Ethiopia's 7.6-12.1 is a two-pixel sliver — which hides the
                disagreement this panel exists to show. Magnitude is in the
                figures on the right; the bar is about shape. */}
            <div className="flex-1 relative h-3">
              <div className="absolute inset-y-0 inset-x-0 rounded-sm bg-slate-700/70"
                title={`${bundle.sources[s.low]?.label ?? s.low} ${s.min} → ${bundle.sources[s.high]?.label ?? s.high} ${s.max}`} />
              {(() => {
                const span = s.max - s.min;
                const at = (v: number) => (span > 0 ? ((v - s.min) / span) * 100 : 50);
                return (
                  <>
                    <div className="absolute inset-y-0 w-[2px] bg-slate-300"
                      style={{ left: `calc(${at(s.mean)}% - 1px)` }} title={`mean ${s.mean}`} />
                    {s.final != null && (
                      <div className="absolute inset-y-0 w-[2px] bg-amber-400"
                        style={{ left: `calc(${at(s.final)}% - 1px)` }} title={`Final ${s.final}`} />
                    )}
                  </>
                );
              })()}
            </div>
            <div className="w-28 text-right font-mono text-slate-500">
              {s.min.toFixed(1)}–{s.max.toFixed(1)}
              <span className={`ml-1 ${s.spreadPct > 25 ? "text-amber-400" : "text-slate-600"}`}>
                {s.spreadPct.toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[8px] text-slate-600 leading-relaxed">
        Each bar spans that origin&apos;s own lowest-to-highest estimate — scaled per row, not
        on a shared axis, so a small origin&apos;s disagreement is as readable as a large
        one&apos;s. The pale tick is the mean and the amber tick the analyst Final where one is
        set; the figures on the right carry the magnitude. The percentage is the spread over the mean —
        an origin where the houses are 30% apart is where a position is a view on whose number
        is right, not on the market. Only origins with at least two sources appear.
      </div>
    </div>
  );
}

/** Stocks against consumption — the tightness metric CCS publishes itself. */
function TightnessPanel({ ccs }: { ccs: CcsDoc }) {
  const data = ccs.seasons.map((season, i) => ({
    season,
    total: ccs.stock_consumption_pct.total?.[i] ?? null,
    arabica: ccs.stock_consumption_pct.arabica?.[i] ?? null,
    robusta: ccs.stock_consumption_pct.robusta?.[i] ?? null,
  }));
  const last = data[data.length - 1];
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className={LABEL}>
          Stocks as weeks of demand
          <span className="ml-2 text-slate-600 normal-case">· CCS stock / consumption, %</span>
        </div>
        {last && (
          <div className="text-[9px] font-mono text-slate-400">
            latest {last.season} · total {last.total}% ·{" "}
            <span className="text-amber-400">arabica {last.arabica}%</span> ·{" "}
            <span className={Number(last.robusta) < 15 ? "text-red-400" : "text-emerald-400"}>
              robusta {last.robusta}%
            </span>
          </div>
        )}
      </div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="season" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} width={40}
              tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={TT} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
              formatter={(v) => `${v ?? "–"}%`} />
            <Legend wrapperStyle={{ fontSize: 9 }} iconType="plainline" />
            {/* 15% is roughly eight weeks of cover — below it the market has
                historically priced scarcity rather than balance. */}
            <ReferenceLine y={15} stroke="#dc2626" strokeDasharray="3 3" strokeWidth={1} />
            <Line type="monotone" dataKey="total" name="Total" stroke="#e2e8f0" strokeWidth={1.6} dot={{ r: 2 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="arabica" name="Arabica" stroke="#f59e0b" strokeWidth={1.6} dot={{ r: 2 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="robusta" name="Robusta" stroke="#10b981" strokeWidth={1.6} dot={{ r: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[8px] text-slate-600 leading-relaxed">
        Carry-out divided by that year&apos;s consumption — how much cover the world holds
        entering the next crop. The dashed line at 15% is roughly eight weeks; robusta has sat
        below it since 2022/23 while arabica rebuilt, which is the divergence that has driven
        the differential. Arabica and robusta are read against their own consumption, not the
        world&apos;s.
      </div>
    </div>
  );
}
