"use client";
import { Fragment, useEffect, useState } from "react";
import ModelledBadge from "@/components/ModelledBadge";
import { useDirectionHitRate } from "@/lib/useDirectionHitRate";

// ── Live open-direction model output (quant_report.json["open_direction"]) ──
// Produced PRE-OPEN (03:00 UTC) by backend/scraper/quant_model/
// open_direction_log.py → open_direction.py: a logistic classifier on ICE
// Robusta's OVERNIGHT GAP (first-bar open vs prior 17:30-London close, roll
// days excluded), with an EXACT additive (SHAP-style) decomposition. For
// logistic regression φᵢ = βᵢ·zᵢ in log-odds space and Σφᵢ = margin(x) −
// base_margin with zero residual, so the waterfall below is mathematically
// exact, not a sampled approximation. Every prediction is also logged
// append-only to open_direction_history.json and graded after the open.
// Methodology: docs/research/open-price-direction-findings.md

interface Feature {
  var_name:    string;
  label:       string;
  raw_value:   number;
  raw_fmt:     string;
  z?:          number | null;   // standardised vs the feature's own history
  usd_per_ton: number | null;   // factor magnitude on the robusta USD/MT ruler
  phi:         number;          // margin (log-odds) units
  detail?:     { text: string };
}

interface Regime {
  ny_shock?:       boolean;
  vol_regime?:     "low" | "high" | null;
  vol_percentile?: number | null;
  harvest_weight?: number;
  harvest_active?: boolean;
  brent_overnight_pct?: number | null;
  // null = the anchor feed could not tell us, which is NOT the same as a calm
  // tape. The payload published `false` for 35 sessions after the feed froze.
  oil_shock?:      boolean | null;
  brent_status?:   "ok" | "stale" | "missing" | null;
  brent_last_date?: string | null;
  brent_stale_sessions?: number | null;
}

// Written by open_direction_log.py onto the FROZEN payload when the model
// cannot train. The runner keeps the last good call (the record still grades
// it) but the panel must not present it as today's view — see the banner.
interface StaleMark {
  since:                string;   // first failed run, never bumped → outage length
  last_check?:          string;
  reason?:              string;
  frozen_for_session?:  string;
  failed_runs?:         number;
}

interface OpenDirection {
  available:     boolean;
  reason?:       string;
  stale?:        StaleMark | null;
  as_of?:        string;        // last session whose data fed the model
  for_session?:  string;        // the session being predicted
  direction?:    "Bullish" | "Bearish" | "Abstain";
  base_margin?:  number;
  final_margin?: number;
  base_prob?:    number;
  final_prob?:   number;
  prob_up?:      number;
  prob_down?:    number;
  regime?:       Regime;
  expected_gap_pct?:    number | null;
  expected_gap_usd_mt?: number | null;
  features?:     Feature[];
  target?:       { kind: string; definition: string; abstain_band: number };
  model?: {
    kind:            string;
    active_features: string[];
    n_features:      number;
    n_train:         number;
    test_accuracy:   number | null;
    baseline_accuracy?: number | null;
    edge?:           number | null;
    acted_accuracy?: number | null;
    acted_n?:        number | null;
    abstain_rate?:   number | null;
    eval_method?:    string;
    n_test:          number;
  };
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtUsdTon(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}/t`;
}

export default function PriceDirectionSection() {
  const [data, setData] = useState<OpenDirection | null>(null);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => setData(j?.open_direction ?? { available: false, reason: "No data" }))
      .catch(() => setData({ available: false, reason: "Fetch failed" }));
  }, []);

  const loading = data === null;
  const unavailable = data !== null && !data.available;
  const stale = data?.available ? (data.stale ?? null) : null;
  const staleDays = (() => {
    if (!stale?.since) return null;
    const t = Date.parse(`${stale.since}T00:00:00Z`);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  })();

  // ── Waterfall geometry (in MARGIN / log-odds units — the only space where
  // logistic SHAP is exactly additive). Bars walk from base_margin to
  // final_margin; each bar's signed width = φᵢ. ────────────────────────────
  const features = data?.features ?? [];
  const baseM  = data?.base_margin  ?? 0;
  const finalM = data?.final_margin ?? 0;
  // Domain padded around the [base, final] span plus the bar excursions.
  const marginsTouched = [baseM, finalM];
  let cursorScan = baseM;
  for (const f of features) { cursorScan += f.phi; marginsTouched.push(cursorScan); }
  const lo = Math.min(...marginsTouched);
  const hi = Math.max(...marginsTouched);
  const pad = Math.max((hi - lo) * 0.15, 0.05);
  const X_MIN = lo - pad;
  const X_MAX = hi + pad;
  const X_SPAN = X_MAX - X_MIN || 1;
  const toPct = (v: number) => ((v - X_MIN) / X_SPAN) * 100;

  const bars: { left: number; width: number; phi: number; positive: boolean }[] = [];
  let cursor = baseM;
  for (const f of features) {
    const start = cursor;
    const end = cursor + f.phi;
    const left = toPct(Math.min(start, end));
    const width = Math.abs(end - start) / X_SPAN * 100;
    bars.push({ left, width, phi: f.phi, positive: f.phi >= 0 });
    cursor = end;
  }

  const dir = data?.direction ?? "Bearish";
  // Stored value stays "Abstain" (record continuity); the product name is "Undefined".
  const dirLabel = dir === "Abstain" ? "Undefined" : dir;
  const dirCls = dir === "Bullish" ? "text-emerald-400"
    : dir === "Bearish" ? "text-red-400" : "text-amber-400";
  const probUp = data?.prob_up ?? 0.5;
  const probDown = data?.prob_down ?? 0.5;
  // Live, graded record — the number a user should weigh the call against.
  // The "Model Performance" block below shows test-split accuracy, which is
  // fit, not track record; the badge deliberately shows only the live one.
  const { hitRate: liveHitRate } = useDirectionHitRate();

  return (
    <section className="px-6 py-5 space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">Section 1</span>
        <h2 className="text-base font-bold text-white">Open Price Direction</h2>
        <ModelledBadge method="ML classifier" hitRate={liveHitRate} />
        <span className="text-[10px] text-slate-500">
          Robusta · Overnight Gap (open vs prior 17:30 close) · fires pre-open 03:00 UTC
        </span>
        {data?.available && (
          stale ? (
            <span className="text-[10px] font-semibold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded ml-auto">
              STALE · frozen on {stale.frozen_for_session ?? data.for_session ?? data.as_of}
            </span>
          ) : (
            <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded ml-auto">
              LIVE · predicts {data.for_session ?? data.as_of}
            </span>
          )
        )}
      </div>

      {/* ── Freeze banner ──────────────────────────────────────────────
          The runner keeps the last good payload when the model cannot
          train, so without this the card would read as a confident call for
          a session that already traded. No such freeze has happened (the
          2026-08-21 audit verified for_session advancing every trading day),
          but the state is reachable and invisible by construction — hence
          the banner. Every number below is real when it shows; it is just
          not about today. */}
      {stale && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
              ⚠ Prediction frozen
            </span>
            <span className="text-[11px] text-amber-200/90">
              The model has not produced a new call
              {staleDays != null && ` for ${staleDays} day${staleDays === 1 ? "" : "s"}`}
              {stale.since && ` (since ${stale.since}`}
              {stale.since && stale.failed_runs != null && `, ${stale.failed_runs} failed run${stale.failed_runs === 1 ? "" : "s"}`}
              {stale.since && ")"}.
            </span>
          </div>
          <p className="text-[11px] text-slate-300">
            Everything below is the last successful run — a call for{" "}
            <span className="font-semibold text-slate-100">{stale.frozen_for_session ?? data?.for_session}</span>,
            not for the next session. Do not trade it.
          </p>
          {stale.reason && (
            <p className="text-[10px] text-slate-400 font-mono break-words">{stale.reason}</p>
          )}
        </div>
      )}

      {/* Regime tags — decision support, not model inputs. NY-shock is the
          measured 88%-hit-rate setup; confidence is less trustworthy in
          high-vol tape (54% vs 64% in calm markets). */}
      {data?.available && data.regime && (
        <div className="flex flex-wrap gap-1.5">
          {data.regime.ny_shock && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 font-semibold">
              ⚡ NY-shock setup — historically 88% hit-rate
            </span>
          )}
          {data.regime.vol_regime && (
            <span className={`text-[10px] px-2 py-0.5 rounded border ${
              data.regime.vol_regime === "high"
                ? "bg-amber-950/50 border-amber-700/50 text-amber-300"
                : "bg-slate-800 border-slate-700 text-slate-300"}`}>
              {data.regime.vol_regime}-vol tape
              {data.regime.vol_regime === "high" && " — confidence less reliable"}
            </span>
          )}
          {data.regime.harvest_active && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
              robusta harvest window
            </span>
          )}
          {data.regime.oil_shock && data.regime.brent_overnight_pct != null && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/50 border border-amber-700/50 text-amber-300">
              🛢 Brent {data.regime.brent_overnight_pct > 0 ? "+" : ""}{data.regime.brent_overnight_pct.toFixed(1)}% overnight — oil-shock context
            </span>
          )}
          {/* Unknown ≠ calm: without this the absence of an oil-shock chip
              reads as "oil is quiet" even when the feed is dead. */}
          {data.regime.brent_status && data.regime.brent_status !== "ok" && (
            <span
              title={data.regime.brent_last_date
                ? `Last Brent anchor ${data.regime.brent_last_date}`
                : "No Brent anchor file"}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-400"
            >
              🛢 Brent unavailable{data.regime.brent_stale_sessions != null
                ? ` — ${data.regime.brent_stale_sessions} sessions stale` : ""}
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 animate-pulse h-40" />
      )}

      {unavailable && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
          <span className="text-amber-400 font-bold">UNAVAILABLE</span>
          <span>{data?.reason ?? "Model output not present in quant_report.json."}</span>
        </div>
      )}

      {data?.available && (
        <>
          {/* ── Summary table ──────────────────────────────────────── */}
          <div className="bg-slate-900 rounded-lg overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700 bg-slate-800/60">
                  <th className="text-left px-4 py-2 w-56">Factor</th>
                  <th className="text-right px-4 py-2 w-24">Value</th>
                  <th className="text-right px-4 py-2 w-28">USD/ton</th>
                  <th className="text-center px-4 py-2 w-24">Direction</th>
                  <th className="text-center px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f, i) => (
                  <Fragment key={f.var_name}>
                  <tr className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/60" : ""}`}>
                    <td className="px-4 py-2 text-slate-300">{f.label}</td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${f.raw_value < 0 ? "text-red-400" : "text-slate-200"}`}>
                      {f.raw_fmt}
                      {f.z != null && (
                        <span className="ml-1.5 text-[9px] font-normal text-slate-500" title="standardised vs this factor's own history">
                          z{f.z >= 0 ? "+" : ""}{f.z.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${(f.usd_per_ton ?? 0) < 0 ? "text-red-400" : "text-slate-300"}`}>
                      {fmtUsdTon(f.usd_per_ton)}
                    </td>
                    {i === 0 && (
                      <td className={`px-4 py-2 text-center font-bold text-sm ${dirCls}`} rowSpan={features.length}>
                        {dirLabel}
                        {data.expected_gap_usd_mt != null && (
                          <div className="text-[10px] font-mono font-normal text-slate-400 mt-0.5">
                            exp. {fmtUsdTon(data.expected_gap_usd_mt)}
                          </div>
                        )}
                      </td>
                    )}
                    {i === 0 && (
                      <td className="px-4 py-2 text-center" rowSpan={features.length}>
                        <div className="space-y-1">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[11px] text-emerald-400">Bullish:</span>
                            <span className="font-mono font-bold text-emerald-300">{fmtPct(probUp)}</span>
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[11px] text-red-400">Bearish:</span>
                            <span className="font-mono font-bold text-red-300">{fmtPct(probDown)}</span>
                          </div>
                          <div className="mx-auto w-28 h-2 bg-slate-700 rounded-full overflow-hidden flex">
                            <div className="h-2 bg-emerald-700" style={{ width: `${probUp * 100}%` }} />
                            <div className="h-2 bg-red-700 flex-1" />
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                  {/* Factor detail: the components written down beneath the row.
                      Guarded on .text so a transitional old-shape payload
                      (pre-gap-spec detail object) renders nothing. */}
                  {f.detail?.text && (
                    <tr className={i % 2 ? "bg-slate-900/60" : ""}>
                      <td colSpan={3} className="px-4 pb-2 pt-0">
                        <div className="text-[10px] text-slate-500 font-mono leading-relaxed border-l-2 border-slate-700 pl-3">
                          {f.detail.text}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── SHAP Waterfall (margin / log-odds space — exactly additive) ── */}
          <div className="bg-slate-900 rounded-lg p-5">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              SHAP Waterfall — log-odds margin
            </div>
            <div className="text-[10px] text-slate-500 mb-4">
              Bars in log-odds units (exactly additive for logistic regression). Endpoints
              labelled with the implied probability.
            </div>

            <div className="space-y-2">
              {features.map((f, i) => (
                <div key={f.var_name} className="flex items-center gap-3">
                  <div className="w-64 shrink-0 text-right">
                    <span className={`font-mono text-[11px] font-semibold ${f.raw_value < 0 ? "text-red-300" : "text-slate-300"}`}>
                      {f.raw_fmt}
                    </span>
                    {f.usd_per_ton != null && (
                      <span className="text-[10px] text-slate-500 ml-1">({fmtUsdTon(f.usd_per_ton)})</span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-1">{f.var_name}</span>
                  </div>

                  <div className="flex-1 relative h-6 bg-slate-800 rounded">
                    {/* f(x) marker */}
                    <div className="absolute top-0 bottom-0 w-px bg-amber-400/40" style={{ left: `${toPct(finalM)}%` }} />
                    {/* E[f(x)] marker */}
                    <div className="absolute top-0 bottom-0 w-px bg-slate-500/40" style={{ left: `${toPct(baseM)}%` }} />
                    {/* SHAP bar — green = pushes up (bullish), red = pushes down */}
                    <div
                      className={`absolute top-1 bottom-1 rounded ${bars[i].positive ? "bg-emerald-600/80" : "bg-red-600/80"}`}
                      style={{ left: `${bars[i].left}%`, width: `${bars[i].width}%` }}
                    />
                    <span
                      className={`absolute top-0 bottom-0 flex items-center text-[10px] font-mono font-bold pl-1 ${bars[i].positive ? "text-emerald-200" : "text-red-200"}`}
                      style={{ left: `${bars[i].left}%` }}
                    >
                      {f.phi >= 0 ? "+" : ""}{f.phi.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* X-axis labels */}
            <div className="flex items-center gap-3 mt-3">
              <div className="w-64 shrink-0" />
              <div className="flex-1 relative h-8">
                <span
                  className="absolute text-[10px] font-mono text-amber-400 -translate-x-1/2 text-center"
                  style={{ left: `${toPct(finalM)}%` }}
                >
                  f(x)={finalM.toFixed(2)}
                  <br />
                  <span className="text-amber-300/70">{fmtPct(data.final_prob, 1)}</span>
                </span>
                <span
                  className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2 text-center"
                  style={{ left: `${toPct(baseM)}%` }}
                >
                  E[f(x)]={baseM.toFixed(2)}
                  <br />
                  <span className="text-slate-500">{fmtPct(data.base_prob, 1)}</span>
                </span>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 italic mt-3">
              Figure 1.1 — Each bar is feature i&apos;s exact SHAP value φᵢ = βᵢ·zᵢ (log-odds),
              shifting the estimate from the base rate E[f(x)] to the prediction f(x). Green
              pushes toward Bullish, red toward Bearish. The bars sum to f(x) − E[f(x)] with
              zero residual.
            </p>
          </div>

          {/* ── Model Performance ──────────────────────────────────── */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-2">
            <div className="text-xs font-bold text-slate-200">Model Performance</div>
            <div className="flex gap-8 flex-wrap">
              <div>
                <span className="text-[11px] text-slate-400">Test accuracy: </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {data.model?.test_accuracy != null ? fmtPct(data.model.test_accuracy, 1) : "—"}
                </span>
                {data.model?.baseline_accuracy != null && (
                  <span className="text-[11px] text-slate-500">
                    {" "}vs {fmtPct(data.model.baseline_accuracy, 1)} baseline
                    {data.model?.edge != null && (
                      <span className={data.model.edge >= 0 ? "text-emerald-500" : "text-rose-500"}>
                        {" "}({data.model.edge >= 0 ? "+" : ""}{(data.model.edge * 100).toFixed(1)}pp)
                      </span>
                    )}
                  </span>
                )}
                <span className="text-[11px] text-slate-500"> · n={data.model?.n_test ?? 0}, {data.model?.eval_method === "walk_forward" ? "walk-forward" : "holdout"}</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Acted accuracy: </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {data.model?.acted_accuracy != null ? fmtPct(data.model.acted_accuracy, 1) : "—"}
                </span>
                <span className="text-[11px] text-slate-500"> (n={data.model?.acted_n ?? 0})</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Undefined rate: </span>
                <span className="text-[11px] font-mono text-amber-400">
                  {data.model?.abstain_rate != null ? fmtPct(data.model.abstain_rate, 1) : "—"}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Train rows: </span>
                <span className="text-[11px] font-mono text-slate-300">{data.model?.n_train ?? 0}</span>
                <span className="text-[11px] text-slate-500"> · {data.model?.n_features ?? 0} features</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed max-w-2xl">
              Target: {data.target?.definition ?? "overnight gap direction"}. Accuracy is
              out-of-sample (expanding walk-forward, standardise-on-past) vs the rolling
              majority-class baseline on the same sessions; &ldquo;acted&rdquo; restricts to
              calls outside the ±{((data.target?.abstain_band ?? 0.03) * 100).toFixed(0)}pp
              band, inside which the call is &ldquo;Undefined&rdquo; rather than a forced coin-flip.
              Every 03:00 UTC prediction is logged before the open and graded after it —
              see the calendar below. Methodology: docs/research/open-price-direction-findings.md
            </p>
          </div>
        </>
      )}
    </section>
  );
}
