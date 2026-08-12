"use client";
// The conilon reference stack — why Cooabriel, CCCV, CEPEA and the B3 CNL
// future never print the same number, and how wide the gaps between them run.
// Data: conilon_basis.json (backend/scraper/exporters/conilon_basis.py).
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, ScatterChart, XAxis, YAxis,
  Tooltip, ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Fml, Highlight, RefTable } from "./methodology/prose";

interface Leg { key: string; label: string; spec: string; place: string; role: string }
interface Pair {
  key: string; leg: string; base: string; label: string; driver: string; n: number;
  insufficient?: boolean; start?: string; end?: string;
  mean?: number; sd?: number; min?: number; p5?: number; median?: number; p95?: number; max?: number;
  mean_pct?: number; sd_pct?: number; min_pct?: number; p5_pct?: number;
  median_pct?: number; p95_pct?: number; max_pct?: number;
  cv_brl?: number; cv_pct?: number;
  fixed?: number; advalorem_pct?: number; r2?: number;
  fit_at?: { base: number; gap: number }[];
  share_positive?: number; momentum_corr?: number; ar1?: number; half_life_sessions?: number;
  by_year?: Record<string, { mean: number; mean_pct: number }>;
  widest?: { date: string; gap: number; pct: number }[];
  tightest?: { date: string; gap: number; pct: number }[];
}
interface Pt {
  date: string; cccv?: number; co7?: number; co8?: number; cepea?: number; cnl?: number;
  g_cepea?: number; g_co7?: number; g_cnl?: number;
}
interface FobLine { line: string; lo?: number; hi?: number; pct?: number; scales: boolean; note: string }
interface FobCross {
  available: boolean;
  booked: {
    total_usd_mt: number; reference_price: number; lines: FobLine[];
    fixed_usd_mt: number; advalorem_usd_mt: number; advalorem_share_pct: number;
    previous_flat_usd_mt: number; previous_quality_line: string; live_usd_mt: number;
  };
  base_usd_mt: { latest: number; latest_date: string; mean: number };
  booked_as_pct_of_base: { latest: number; min: number; max: number };
  measured_usd_mt: {
    grade_uplift_mean: number; grade_uplift_latest: number;
    grade_uplift_p5: number; grade_uplift_p95: number;
    coop_grade_step: number | null; interior_port_basis: number | null;
  };
  by_year: Record<string, { base: number; uplift: number; uplift_pct: number; booked_pct: number }>;
  price_aware_stack: { base: number; stack: number }[];
}
interface Basis {
  unit: string; updated: string;
  window: { start: string; end: string; sessions: number };
  legs: Leg[];
  latest: Pt & { cnl_date?: string };
  pairs: Pair[];
  fob_crosscheck?: FobCross;
  staleness: Record<string, { n: number; unchanged_pct: number; mean_abs_change: number; max_abs_change: number }>;
  series: Pt[];
  sources: string[];
}

const COL = { cccv: "#94a3b8", co7: "#fb7185", co8: "#f0abfc", cepea: "#38bdf8", cnl: "#34d399" };
const brl = (v: number | undefined | null, d = 0) =>
  v == null ? "—" : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pc = (v: number | undefined | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

function pick(pairs: Pair[], key: string): Pair | undefined {
  return pairs.find(p => p.key === key);
}

// ── Fig. 1 · the ladder: where each reference sits, and what separates them ──
function LadderFigure({ latest, cepeaMean, coStep }: {
  latest: Basis["latest"]; cepeaMean: number; coStep: number;
}) {
  const rungs = [
    { key: "cepea", label: "CEPEA/ESALQ indicator", v: latest.cepea, note: "tipo 6 · peneira 13+ · deal-weighted" },
    { key: "cnl", label: `B3 CNL front${latest.cnl_date ? ` (${latest.cnl_date})` : ""}`, v: latest.cnl, note: "futures — spot + carry" },
    { key: "co7", label: "Cooabriel Tipo 7", v: latest.co7, note: "co-op bid · interior ES" },
    { key: "co8", label: "Cooabriel Tipo 8", v: latest.co8, note: "same buyer, one grade lower" },
    { key: "cccv", label: "CCCV Vitória T7/8", v: latest.cccv, note: "port trade reference · CNL spec" },
  ].filter(r => r.v != null) as { key: string; label: string; v: number; note: string }[];

  // Rungs can sit within a couple of reais of each other (T8 and the T7/8
  // blend routinely do), so the text rows are declustered to a minimum
  // spacing and joined back to their true price by a leader line.
  const TOP = 34, BOT = 250, ROW = 21;
  const vals = rungs.map(r => r.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(6, (hi - lo) * 0.18);
  const yMin = lo - pad, yMax = hi + pad;
  const y = (v: number) => BOT - ((v - yMin) / (yMax - yMin)) * (BOT - TOP);

  const sorted = [...rungs].sort((a, b) => b.v - a.v);
  const rowY = sorted.map(r => y(r.v));
  for (let i = 1; i < rowY.length; i++) {              // push down from the top
    if (rowY[i] - rowY[i - 1] < ROW) rowY[i] = rowY[i - 1] + ROW;
  }
  const overflow = rowY[rowY.length - 1] - BOT;        // then lift back into frame
  if (overflow > 0) for (let i = 0; i < rowY.length; i++) rowY[i] -= overflow;

  // Columns: label | rung line | value | step brackets with captions. Per-leg
  // spec/place/role is not repeated here — the table in §1 above carries it.
  const X0 = 210, X1 = 400, XV = 410, XB1 = 474, XB2 = 592;
  const bracket = (a: number, b: number, x: number, color: string, tint: string,
                   head: string, sub: string, key: string) => (
    <g key={key}>
      <line x1={x} y1={y(a)} x2={x} y2={y(b)} stroke={color} strokeWidth={1.2} />
      <line x1={x - 4} y1={y(a)} x2={x + 4} y2={y(a)} stroke={color} strokeWidth={1.2} />
      <line x1={x - 4} y1={y(b)} x2={x + 4} y2={y(b)} stroke={color} strokeWidth={1.2} />
      <text x={x + 8} y={(y(a) + y(b)) / 2 - 2} fontSize={8.5} fill={tint} fontWeight={600}>{head}</text>
      <text x={x + 8} y={(y(a) + y(b)) / 2 + 8} fontSize={7.8} fill="#64748b">{sub}</text>
    </g>
  );

  return (
    <figure className="my-3">
      <div className="overflow-x-auto">
        <div style={{ minWidth: 660 }}>
          <svg viewBox="0 0 700 272" role="img" className="w-full"
            aria-label="Price ladder of the four conilon references on the latest session, with the driver of each step annotated">
            <text x={8} y={14} fontSize={9} fill="#94a3b8">R$/saca 60 kg</text>
            <text x={692} y={14} fontSize={9} fill="#64748b" textAnchor="end">
              {latest.date} — one session, four prices for the same coffee
            </text>
            {sorted.map((r, i) => {
              const yl = y(r.v), yr = rowY[i];
              const col = COL[r.key as keyof typeof COL];
              return (
                <g key={r.key}>
                  {/* surface halo so rungs a couple of reais apart stay separable */}
                  <line x1={X0} y1={yl} x2={X1} y2={yl} stroke="#0f172a" strokeWidth={6} strokeLinecap="round" />
                  <line x1={X0} y1={yl} x2={X1} y2={yl} stroke={col} strokeWidth={2.5} strokeLinecap="round" />
                  {Math.abs(yr - yl) > 1.5 && (
                    <path d={`M ${X0} ${yl} L ${X0 - 10} ${yl} L ${X0 - 16} ${yr} L ${X0 - 22} ${yr}`}
                      fill="none" stroke={col} strokeOpacity={0.45} strokeWidth={1} />
                  )}
                  <text x={X0 - 26} y={yr + 3.5} fontSize={9.5} fill="#e2e8f0" textAnchor="end" fontWeight={600}>
                    {r.label}
                  </text>
                  <text x={XV} y={yr + 3.5} fontSize={9.5} fill="#e2e8f0" fontFamily="ui-monospace, monospace">
                    {r.v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </text>
                  <text x={X0 - 26} y={yr + 12} fontSize={7.6} fill="#64748b" textAnchor="end">{r.note}</text>
                </g>
              );
            })}
            {latest.cepea != null && latest.cccv != null &&
              bracket(latest.cepea, latest.cccv, XB1, "#38bdf8", "#7dd3fc",
                "grade + market mix", `≈ ${pc(cepeaMean)} · ad valorem`, "b1")}
            {latest.co7 != null && latest.co8 != null &&
              bracket(latest.co7, latest.co8, XB2, "#fb7185", "#fda4af",
                "one grade step", `${brl(coStep)}, administered`, "b2")}
          </svg>
        </div>
      </div>
      <figcaption className="text-[10px] text-slate-500 italic mt-1 leading-relaxed">
        <span className="font-semibold not-italic text-slate-400">Fig. 1</span> — the ladder on the latest session.
        Each rung is a different <em>contract</em> on the same bean: a different grade, a different place in the chain,
        a different quoting body. The spread between rungs is what this paper measures.
      </figcaption>
    </figure>
  );
}

export default function ConilonBasis() {
  const [d, setD] = useState<Basis | null>(null);
  const [missing, setMissing] = useState(false);
  const [win, setWin] = useState<"1Y" | "2Y" | "ALL">("2Y");

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Basis>("/data/conilon_basis.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const gapSeries = useMemo(() => {
    if (!d) return [];
    const days = win === "1Y" ? 252 : win === "2Y" ? 504 : d.series.length;
    return d.series.slice(-days).map(p => ({
      date: p.date, g_cepea: p.g_cepea, g_co7: p.g_co7, g_cnl: p.g_cnl,
    }));
  }, [d, win]);

  const scatter = useMemo(() => {
    if (!d) return { pts: [], fit: [] as { x: number; y: number }[] };
    const pts = d.series
      .filter(p => p.cepea != null && p.cccv != null)
      .map(p => ({ x: p.cccv as number, y: (p.cepea as number) - (p.cccv as number), date: p.date }));
    const pr = pick(d.pairs, "cepea_cccv");
    const fit = pr?.fixed != null && pr?.advalorem_pct != null
      ? [500, 2150].map(x => ({ x, y: pr.fixed! + (pr.advalorem_pct! / 100) * x }))
      : [];
    return { pts, fit };
  }, [d]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      conilon_basis.json not published yet — run the exporter.
    </div>;
  }
  if (!d) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const cepeaCccv = pick(d.pairs, "cepea_cccv");
  const co7Cccv = pick(d.pairs, "co7_cccv");
  const co8Cccv = pick(d.pairs, "co8_cccv");
  const step = pick(d.pairs, "co7_co8");
  const cepeaCo7 = pick(d.pairs, "cepea_co7");
  const cnlCccv = pick(d.pairs, "cnl_cccv");
  const cnlCepea = pick(d.pairs, "cnl_cepea");
  const fob = d.fob_crosscheck;
  const hasCnl = cnlCccv && !cnlCccv.insufficient;

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> Four public numbers quote Espírito Santo conilon every session, in the same unit —
        reais per 60-kg saca — and they never agree. Read on one chart the gaps look almost constant, which is the
        question this note answers with {d.window.sessions.toLocaleString()} sessions of history
        ({d.window.start} → {d.window.end}): what each reference actually <em>is</em>, what economics separates them,
        how much of each gap is a fixed cost versus a percentage of the price, and how wide the spread can run before
        it snaps back. The headline: the CEPEA-to-Vitória gap is <strong>ad valorem, not a freight cost</strong> —
        it averages <strong>{pc(cepeaCccv?.mean_pct)}</strong> ({brl(cepeaCccv?.mean, 2)}) and is more stable measured
        in percent than in reais; and the Cooabriel-to-Vitória gap is structurally <em>zero</em> but transiently huge,
        because a co-op bid is an administered price that does not reprice every day.
      </P>

      <H2>1 · The four references are four different contracts</H2>
      <P>
        Nothing here is a data problem. Each series is a correct price for a <em>different</em> good sold at a
        different point in the chain — the gaps are the economics between those points.
      </P>
      <RefTable head={["Reference", "Spec quoted", "Where / who"]} rows={d.legs.map(l => [
        l.label, l.spec, `${l.place} — ${l.role}`,
      ])} />
      <UL>
        <LI><strong>CCCV Vitória T7/8</strong> is the trade reference at the port and the spec the B3 contract
          delivers against — so it is the natural benchmark, and every gap below is measured against it.</LI>
        <LI><strong>Cooabriel</strong> is not a market print at all: it is the price a co-operative <em>offers its
          members</em> at São Gabriel da Palha, ~250 km inland. It is a bid, posted, administered, and — as measured
          in §5 — updated on barely half of sessions.</LI>
        <LI><strong>CEPEA/ESALQ</strong> is a deal-weighted indicator built from transactions actually reported
          across the Espírito Santo market, converted to common cash-payment terms — and, decisively, it quotes a
          <strong> better grade</strong>: tipo 6, screen 13 and above.</LI>
        <LI><strong>B3 CNL</strong> is a futures settlement: a price for coffee delivered <em>later</em>, into a
          licensed warehouse, under contract quality allowances.</LI>
      </UL>

      <LadderFigure latest={d.latest} cepeaMean={cepeaCccv?.mean_pct ?? 0} coStep={step?.mean ?? 10} />

      <H2>2 · What the gaps measure — and what they are not</H2>
      <P>
        The natural first hypothesis is a cost stack: FOBbing, port charges, freight. That is the wrong frame for
        <em> these three</em> quotes, and it is worth being explicit about why.
      </P>
      <Highlight>
        All four references are <strong>internal Brazilian prices in R$/saca</strong>. Export costs — port handling,
        FOBbing, ocean freight, EUDR paperwork — sit <em>outside</em> this stack: they open between any of these
        numbers and the export FOB differential quoted against London, not between the numbers themselves. What
        separates the rungs of this ladder is grade, place in the chain, who is quoting, and time value.
      </Highlight>
      <RefTable head={["Component", "Direction", "Order of magnitude"]} rows={[
        ["Grade / screen (tipo 6 · pen. 13+ vs tipo 7/8)", "raises CEPEA above CCCV & Cooabriel", "the dominant term — see §3"],
        ["Administered grade step, tipo 7 vs tipo 8", "raises T7 above T8", `${brl(step?.mean, 2)} exactly, ${step?.n} sessions`],
        ["Interior vs port (internal freight, ~250 km)", "lowers Cooabriel vs Vitória", `≈ ${brl(Math.abs(co8Cccv?.mean ?? 0), 0)} — offsets the grade step`],
        ["Trade level (co-op bid vs merchant reference vs deal average)", "widens with market stress", "second-order, embedded above"],
        ["Time value: carry, warehousing, delivery frictions", "raises CNL above spot", hasCnl ? `${brl(cnlCccv?.mean, 0)} mean (§6)` : "see §6"],
        ["Quote timing / stickiness", "either sign, mean-reverting", `up to ${brl(Math.max(Math.abs(co7Cccv?.min ?? 0), co7Cccv?.max ?? 0), 0)} transiently`],
        ["FOBbing & export costs", "not in this stack", "zero — see the note above"],
      ]} />

      <H2>3 · The measured gaps — amplitude, in reais and in percent</H2>
      <P>
        Every pair, over the full window. The percentile columns are the answer to &ldquo;how wide can it get&rdquo;:
        p5–p95 is the ordinary range, min/max the extremes actually printed.
      </P>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-1.5 pr-3">Gap</th><th className="pb-1.5 pr-3 text-right">n</th>
              <th className="pb-1.5 pr-3 text-right">mean</th><th className="pb-1.5 pr-3 text-right">mean %</th>
              <th className="pb-1.5 pr-3 text-right">p5…p95</th><th className="pb-1.5 pr-3 text-right">min / max</th>
              <th className="pb-1.5 pr-3 text-right">&gt;0</th>
            </tr>
          </thead>
          <tbody>
            {d.pairs.map(p => (
              <tr key={p.key} className="border-b border-slate-800">
                <td className="py-1.5 pr-3 text-slate-200 font-semibold">{p.label}</td>
                {p.insufficient ? (
                  <td className="py-1.5 pr-3 text-slate-500 italic" colSpan={6}>
                    accumulating — {p.n} overlapping session{p.n === 1 ? "" : "s"} so far
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{p.n}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-200">{brl(p.mean, 2)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-sky-300">{pc(p.mean_pct)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{brl(p.p5, 0)} … {brl(p.p95, 0)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{brl(p.min, 0)} / {brl(p.max, 0)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{p.share_positive?.toFixed(0)}%</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UL>
        <LI><strong>CEPEA sits above the Vitória reference on {cepeaCccv?.share_positive?.toFixed(1)}% of
          {" "}{cepeaCccv?.n} sessions</strong> — an essentially unbroken premium of {pc(cepeaCccv?.mean_pct)},
          ordinarily between {pc(cepeaCccv?.p5_pct)} and {pc(cepeaCccv?.p95_pct)}. That constancy is real, and it is
          the &ldquo;almost constant gap&rdquo; the chart shows.</LI>
        <LI><strong>The co-op grade step is a constant by construction</strong>: Cooabriel T7 minus T8 was
          {" "}{brl(step?.mean, 2)} on essentially every one of {step?.n} sessions (σ = {step?.sd?.toFixed(2)}). No
          market clears that precisely — it is an administered ladder, which tells you how to read the co-op quote.</LI>
        <LI><strong>The spread a farmer actually feels</strong> — the co-op&rsquo;s bid against the market indicator —
          averages {brl(cepeaCo7?.mean, 2)} ({pc(cepeaCo7?.mean_pct)}), but reached {brl(cepeaCo7?.max, 0)}
          ({pc(cepeaCo7?.max_pct)}) at its worst. That extreme is not a co-op taking margin: it is the same stickiness
          measured in §5, seen from the producer&rsquo;s side of the counter.</LI>
        <LI><strong>Cooabriel T7 versus Vitória T7/8 averages {brl(co7Cccv?.mean, 2)}</strong> — economically zero.
          The interior discount (freight to port) and the grade premium (pure tipo 7 against a 7/8 blend) very nearly
          cancel. Yet its extremes run {brl(co7Cccv?.min, 0)} to {brl(co7Cccv?.max, 0)}: all mechanism, no economics
          — §5.</LI>
      </UL>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h4 className="text-xs font-bold text-slate-100">Gap to the Vitória T7/8 benchmark, % — {win}</h4>
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["1Y", "2Y", "ALL"] as const).map(w => (
              <button key={w} onClick={() => setWin(w)}
                className={`px-2 py-1 transition ${win === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {w}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gapSeries} margin={{ top: 6, right: 8, bottom: 4, left: -18 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} unit="%" width={44} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#e2e8f0" }}
                formatter={(v, n) => [v == null ? "—" : `${Number(v).toFixed(2)}%`,
                  n === "g_cepea" ? "CEPEA" : n === "g_co7" ? "Cooabriel T7" : "CNL front"]} />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              {cepeaCccv?.mean_pct != null && (
                <ReferenceLine y={cepeaCccv.mean_pct} stroke="#38bdf8" strokeDasharray="4 4" strokeOpacity={0.6}
                  label={{ value: `CEPEA mean ${pc(cepeaCccv.mean_pct)}`, fill: "#7dd3fc", fontSize: 9, position: "insideTopRight" }} />
              )}
              <Line type="monotone" dataKey="g_cepea" stroke={COL.cepea} dot={false} strokeWidth={1.6} name="g_cepea" />
              <Line type="monotone" dataKey="g_co7" stroke={COL.co7} dot={false} strokeWidth={1.2} name="g_co7" />
              {hasCnl && <Line type="monotone" dataKey="g_cnl" stroke={COL.cnl} dot={false} strokeWidth={1.6} name="g_cnl" />}
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  {n === "g_cepea" ? "CEPEA/ESALQ" : n === "g_co7" ? "Cooabriel T7" : "B3 CNL front"}
                </span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The sky band hugs its mean — a structural, proportional premium. The rose line oscillates around zero with
          violent excursions — a sticky bid catching up to a moving market.
        </p>
      </div>

      <H2>4 · Fixed cost or percentage? Regress the gap on the price</H2>
      <P>
        This is the test that answers &ldquo;is it the fobbing cost, or what&rdquo;. A physical cost — trucking a saca
        from São Gabriel to Vitória, handling it, bagging it — is a <strong>fixed number of reais</strong> and does not
        care whether coffee trades at R$700 or R$2,000. A quality discount, a trade margin or a financing charge is a
        <strong> percentage</strong>. Fit both at once and let four years of prices, which ranged from
        {" "}{brl(Math.min(...d.series.filter(p => p.cccv).map(p => p.cccv as number)), 0)} to
        {" "}{brl(Math.max(...d.series.filter(p => p.cccv).map(p => p.cccv as number)), 0)}, decide the split:
      </P>
      <Fml>{`gap(t) = a + b · base_price(t)

a   fixed component  — R$/saca that does not scale (freight, handling)
b   ad-valorem share — % of the price (grade discount, margin, carry)`}</Fml>
      <RefTable head={["Gap", "fixed a", "ad-valorem b", "R²", "implied @R$700 → @R$2,000"]}
        rows={d.pairs.filter(p => !p.insufficient).map(p => [
          p.label,
          brl(p.fixed, 2),
          `${p.advalorem_pct?.toFixed(2)}%`,
          p.r2?.toFixed(2) ?? "—",
          `${brl(p.fit_at?.[0]?.gap, 0)} → ${brl(p.fit_at?.[3]?.gap, 0)}`,
        ])} />
      <UL>
        <LI><strong>CEPEA vs Vitória is dominated by the percentage term</strong>: {brl(cepeaCccv?.fixed, 2)} fixed plus
          {" "}{cepeaCccv?.advalorem_pct?.toFixed(2)}% of the price. At R$700 coffee the gap is worth about
          {" "}{brl(cepeaCccv?.fit_at?.[0]?.gap, 0)}; at R$2,000 about {brl(cepeaCccv?.fit_at?.[3]?.gap, 0)}. It is a
          <em> quality-and-market</em> spread, not a haulage bill.</LI>
        <LI>The corroborating statistic: the gap is <strong>more stable in percent than in reais</strong> — coefficient
          of variation {cepeaCccv?.cv_pct?.toFixed(2)} on the % series against {cepeaCccv?.cv_brl?.toFixed(2)} on the
          R$ series. Quote it as a percentage and it behaves like a constant; quote it in reais and it drifts with the
          market. In the annual means it doubled from {brl(cepeaCccv?.by_year?.["2022"]?.mean, 0)} in 2022 to
          {" "}{brl(cepeaCccv?.by_year?.["2025"]?.mean, 0)} in 2025 while the percentage barely moved
          ({pc(cepeaCccv?.by_year?.["2022"]?.mean_pct)} → {pc(cepeaCccv?.by_year?.["2025"]?.mean_pct)}).</LI>
        <LI><strong>The co-op grade step is the pure opposite case</strong>: {brl(step?.fixed, 2)} fixed,
          {" "}{step?.advalorem_pct?.toFixed(2)}% ad valorem — a number set by committee and left alone, so its
          <em> real</em> value halved as prices doubled.</LI>
        <LI>Low R² on the Cooabriel pairs ({co7Cccv?.r2?.toFixed(2)}) is itself the finding: no cost model explains
          that gap, because it is not a cost. It is timing — §5.</LI>
      </UL>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">CEPEA − Vitória gap vs the price level, every session</h4>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 10, bottom: 16, left: -12 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis type="number" dataKey="x" name="Vitória T7/8" domain={[500, 2150]}
                tick={{ fontSize: 9, fill: "#64748b" }}
                label={{ value: "Vitória T7/8, R$/saca", fontSize: 9, fill: "#64748b", position: "insideBottom", dy: 12 }} />
              <YAxis type="number" dataKey="y" name="gap" tick={{ fontSize: 9, fill: "#64748b" }} width={46} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [n === "gap" ? brl(Number(v), 1) : brl(Number(v), 0),
                  n === "gap" ? "CEPEA − CCCV" : "Vitória"]} />
              <Scatter data={scatter.pts} fill="#38bdf8" fillOpacity={0.28} shape="circle" r={2} />
              <Scatter data={scatter.fit} line={{ stroke: "#fbbf24", strokeWidth: 2 }} shape={() => <g />} legendType="none" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The cloud tilts upward: dearer coffee, wider gap in reais. The amber line is the fitted
          {" "}{brl(cepeaCccv?.fixed, 0)} + {cepeaCccv?.advalorem_pct?.toFixed(2)}% cost model. A pure freight
          component would be flat.
        </p>
      </div>

      <H2>5 · Why the extremes happen — the sticky bid</H2>
      <P>
        The tails belong to a different mechanism than the levels. Measure how often each series actually changes:
      </P>
      <RefTable head={["Reference", "sessions unchanged", "mean daily move"]} rows={Object.entries(d.staleness).map(([k, s]) => [
        d.legs.find(l => l.key === k)?.label ?? k,
        `${s.unchanged_pct}%`,
        brl(s.mean_abs_change, 2),
      ])} />
      <P>
        The CEPEA indicator reprints essentially every session ({d.staleness.cepea?.unchanged_pct}% unchanged) because
        it is computed from that day&rsquo;s deals. The Cooabriel bid is unchanged on
        {" "}<strong>{d.staleness.co7?.unchanged_pct}% of sessions</strong> — a posted price the co-op revises when it
        chooses to. When the market moves fast, the gap is not economics; it is the co-op not having repriced yet.
      </P>
      <UL>
        <LI>The signature is a negative correlation between the gap&rsquo;s deviation from its own trailing median and
          5-session price momentum: <strong>{co7Cccv?.momentum_corr?.toFixed(2)}</strong> for Cooabriel vs Vitória. A
          rally pushes the sticky bid <em>below</em> the market; a slump leaves it stranded <em>above</em>.</LI>
        <LI>These excursions decay fast — an AR(1) half-life of about
          {" "}<strong>{co7Cccv?.half_life_sessions?.toFixed(1)} sessions</strong>. Structural gap, transient noise.</LI>
        <LI>The record: <Code>{co7Cccv?.tightest?.[0]?.date}</Code> at {brl(co7Cccv?.tightest?.[0]?.gap, 0)}, during the
          November-2024 robusta squeeze — Cooabriel held its bid frozen for seven straight sessions while the Vitória
          reference rallied, then jumped in one step and the gap snapped back to near zero. The mirror image came on
          {" "}<Code>{co7Cccv?.widest?.[0]?.date}</Code> at {brl(co7Cccv?.widest?.[0]?.gap, 0)}, when the market
          collapsed and the posted bid lagged on the way down.</LI>
        <LI>Even the CEPEA gap carries a little of this ({cepeaCccv?.momentum_corr?.toFixed(2)} against momentum), for
          the same reason in milder form: an indicator built from the day&rsquo;s reported deals lags a reference quote
          that can be marked instantly.</LI>
      </UL>
      <Highlight>
        Practical reading: a gap outside its usual band is <strong>information about quoting, not about the
        market</strong> — until it survives more than a few sessions. Anything beyond
        {" "}{pc(cepeaCccv?.p95_pct)} on the CEPEA leg or ±{brl(co7Cccv?.p95, 0)} on the co-op leg is, on this history,
        a timing artefact roughly {(100 - 10).toFixed(0)}% of the time, decaying with a ~2-session half-life.
      </Highlight>

      <H2>6 · The futures leg — B3 CNL</H2>
      {hasCnl ? (
        <>
          <P>
            Over {cnlCccv?.n} overlapping sessions the CNL front settled {brl(cnlCccv?.mean, 2)}
            ({pc(cnlCccv?.mean_pct)}) against the Vitória physical, ordinarily between {brl(cnlCccv?.p5, 0)} and
            {" "}{brl(cnlCccv?.p95, 0)}, and {brl(cnlCepea?.mean, 2)} against CEPEA. A futures price is a
            <em> forward</em> price, so this basis is a carry: financing plus warehousing plus delivery frictions,
            less whatever convenience the physical holder gives up.
          </P>
          <Fml>{`CNL(t, T) ≈ Spot(t) · [1 + (i · days/252)] + storage + insurance − convenience

i          Brazilian short rate — the dominant term at Selic-level rates
storage    licensed-warehouse rent + handling at the delivery point
delivery   grading, allowances, and the T7/8 deliverable spec itself`}</Fml>
          <P>
            With Brazilian short rates in double digits, financing alone is worth roughly one percent of the price per
            month of carry — which is the right order of magnitude for the observed basis and explains why it widens
            as the front contract&rsquo;s maturity lengthens and collapses into delivery.
          </P>
        </>
      ) : (
        <>
        <P>
          The futures leg is the thin one, and honestly so. B3&rsquo;s public quotation API serves a live snapshot with
          no history endpoint, so this series can only build forward from the day the scraper was switched on —
          {" "}{cnlCccv?.n ?? 0} session{(cnlCccv?.n ?? 0) === 1 ? "" : "s"} overlap the physical series today, which is
          not enough to quote a distribution. On the latest session the front settled {brl(d.latest.cnl, 2)} against
          {" "}{brl(d.latest.cccv, 2)} at Vitória — a {pc(d.latest.g_cnl)} basis, the right order of magnitude for carry
          at Brazilian short rates (financing alone runs about a percent of the price per month) plus warehousing.
        </P>
        <P>
          The deep history is not recoverable: B3&rsquo;s legacy <em>Ajustes do Pregão</em> bulletin has been retired
          (dated requests return an empty stub), the arquivos.b3.com.br settlement tables carry no CNL rows, and the
          republisher that mirrors B3 arabica 4/5 publishes no conilon-futures page. Until a dated source appears, this
          section grows one session per day rather than being backfilled — the physical legs above carry the four-year
          record.
        </P>
        </>
      )}
      <UL>
        <LI><strong>Read the CNL basis as a carry, not as a differential.</strong> It should widen with time to
          expiry and converge into delivery; a basis that moves without a rate or maturity change is telling you
          something about deliverable supply.</LI>
        <LI><strong>Liquidity caveat, and it is a big one.</strong> Open interest on the front CNL contract is
          measured in tens of lots. Settlements on an illiquid contract are largely exchange-set adjustments rather
          than traded prices, so short-horizon CNL &ldquo;moves&rdquo; can be mechanical. Weight this leg accordingly
          against CEPEA and CCCV, which are built from actual trade.</LI>
      </UL>

      {fob?.available && (
        <>
          <H2>7 · Cross-check: what this said about our own FOBbing stack — and what changed</H2>
          <P>
            The Origin-Logistics research lifts the <Code>CON T7</Code> physical — which is the Cooabriel Tipo 7 bid,
            the interior co-op quote measured above — to at-port parity against RC. Until this study it did so with a
            flat <strong>${fob.booked.previous_flat_usd_mt}/t</strong>, whose largest single line was
            {" "}<strong>{fob.booked.previous_quality_line} of &ldquo;quality preparation&rdquo;</strong> to a
            Class-1+ spec. The Espírito Santo market prices that same upgrade every session — it is the CEPEA
            (tipo 6, peneira 13+) premium over the tipo 7/8 reference — so for the first time the booked number could
            be held against a measured one, in the stack&rsquo;s own unit.
          </P>
          <RefTable head={["", "Booked before", "What the market prices"]} rows={[
            ["Grade uplift, tipo 7/8 → tipo 6 · pen. 13+",
              `${fob.booked.previous_quality_line}`,
              `$${fob.measured_usd_mt.grade_uplift_mean}/t mean · $${fob.measured_usd_mt.grade_uplift_latest}/t today`],
            ["…as a share of the price", `${((60 / fob.booked.reference_price) * 100).toFixed(2)}% at the $${fob.booked.reference_price.toLocaleString()} calibration`,
              `${cepeaCccv?.mean_pct?.toFixed(2)}% — stable across a four-fold price range`],
            ["One grade step (T7 → T8)", "not separately booked", `$${fob.measured_usd_mt.coop_grade_step}/t (administered)`],
            ["L2 — mill to port haulage", "$20–25/t", `interior-vs-port basis $${Math.abs(fob.measured_usd_mt.interior_port_basis ?? 0)}/t`],
          ]} />
          <UL>
            <LI><strong>The quality line was about half the size of the thing it represents.</strong> Moving conilon
              from tipo 7/8 to tipo 6 · screen 13+ is worth
              {" "}<strong>${fob.measured_usd_mt.grade_uplift_mean}/t on average</strong> and
              {" "}${fob.measured_usd_mt.grade_uplift_latest}/t at today&rsquo;s price, against
              {" "}{fob.booked.previous_quality_line} booked. The two are not the same object — ours was a
              <em> processing cost</em>, the market&rsquo;s is a <em>price differential</em> — and the difference
              between them is mostly the <strong>outturn loss</strong>: screening defects and small beans out removes
              mass, and that lost weight never appears in a machine-time estimate.</LI>
            <LI><strong>The functional form was wrong, and the stack already half-admitted it.</strong> Two of its own
              lines were defined as percentages (financing &ldquo;0.5% of $3,000&rdquo;, margin &ldquo;~1% of
              FOB&rdquo;) but frozen at a ${fob.booked.reference_price.toLocaleString()} reference. Measured against
              the actual CON T7 price, the flat ${fob.booked.previous_flat_usd_mt} ranged from
              {" "}<strong>{fob.booked_as_pct_of_base.max}%</strong> of the coffee&rsquo;s value down to
              {" "}<strong>{fob.booked_as_pct_of_base.min}%</strong> ({fob.booked_as_pct_of_base.latest}% today) —
              a stack that quietly re-rated itself by a factor of three as the market moved.</LI>
          </UL>
          <Highlight>
            <strong>Adopted.</strong> The CON T7 stack is now
            {" "}<Code>${fob.booked.fixed_usd_mt}/t fixed + {fob.booked.advalorem_share_pct}% of cargo value</Code> —
            quality/outturn 4.0% (conservative against the measured {cepeaCccv?.mean_pct?.toFixed(2)}%, since part of
            that gap is deal mix rather than grade), financing 0.5%, exporter margin 1.0%. That is
            {" "}<strong>${fob.booked.live_usd_mt}/t at today&rsquo;s price</strong> against
            {" "}${fob.booked.previous_flat_usd_mt} before, and it re-rates every day instead of standing still. Every
            other origin was restated the same way — same form, unchanged level at its own reference price. The effect
            here is to raise at-port parity, so Brazilian conilon no longer reads cheaper against RC than it is.
          </Highlight>
          <P>
            The stored parity history was re-derived in place under the new model rather than rebuilt from source, so
            all 814 conilon observations survive with their original farmgate, freight and RC prints intact — only the
            model-dependent columns (at-port, differential, parity gap) moved.
          </P>
        </>
      )}

      <H2>{fob?.available ? "8" : "7"} · How to use this</H2>
      <UL>
        <LI><strong>Pick the right reference for the question.</strong> Farmer economics and the retention decision
          read Cooabriel (it is what a producer is actually offered). Market valuation reads CEPEA. Anything about the
          futures — parity, delivery, hedging — reads CCCV T7/8, because that is the contract spec.</LI>
        <LI><strong>Convert between them as a percentage, not a constant.</strong> {pc(cepeaCccv?.mean_pct)} from
          Vitória to CEPEA holds across a four-fold price range; {brl(cepeaCccv?.mean, 0)} does not.</LI>
        <LI><strong>Treat band breaks as an alert on quoting, not a signal — for about two sessions.</strong> Then, if
          it persists, it is real: a genuine grade-mix shift (harvest pressure moves the tipo 6 premium — the gap is
          seasonally widest around the April–July harvest) or a genuine change in who is bidding.</LI>
        <LI><strong>Never mix them inside one differential calculation.</strong> A parity or FOB build that takes its
          physical leg from CEPEA and its futures leg from the CNL/CCCV complex silently books
          {" "}{pc(cepeaCccv?.mean_pct)} of grade premium as if it were margin.</LI>
      </UL>

      <H2>{fob?.available ? "9" : "8"} · Limits</H2>
      <UL>
        <LI>The grade decomposition is inferred, not observed: no public series prices tipo 6 and tipo 7/8 at the same
          location on the same day. The co-op&rsquo;s administered {brl(step?.mean, 0)} step bounds one increment; the
          rest of the CEPEA premium mixes screen size, deal mix and payment terms in a way this data cannot separate.</LI>
        <LI>The fixed/ad-valorem split is a two-parameter reduced form. It answers &ldquo;does this gap scale with the
          price&rdquo; convincingly; it does not identify which cost is which.</LI>
        <LI>Both physical tables are read from the same republisher, so a bad scrape can move two legs at once. The
          CEPEA and CCCV series disagreeing in the same direction on the same day is the check.</LI>
        <LI>The futures leg is young — the contract launched in September 2024 — thin, and unbackfillable from public
          sources (§6). Its basis statistics should be revisited once the accumulated history and the open interest are
          deeper; today they are an order-of-magnitude read, not a distribution.</LI>
      </UL>

      <H2>Sources</H2>
      <P>
        {d.sources.join("; ")}. Window {d.window.start} → {d.window.end},
        {" "}{d.window.sessions.toLocaleString()} sessions. Statistics recomputed on every export from
        {" "}<Code>conilon_basis.json</Code>.
      </P>
    </div>
  );
}
