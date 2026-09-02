"use client";
import { useEffect, useMemo, useState } from "react";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import type { MarketMetrics } from "@/lib/pdf/types";
import { buildPostCot, confidenceTier, LDN_PARAMS, NY_PARAMS, type IntraweekParams, type OiDay, type PostCot } from "@/lib/cot/intraweekModel";
import { nearbyOiDelta } from "@/lib/cot/oiNearby";
import { MONTH_ABBR as MONTHS } from "@/lib/formatters";
import SectionHeader from "./SectionHeader";

// ── number formatting (mirrors the COT weekly PDF) ────────────────────────────
const lotsSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v / 1000).toFixed(1)} k lots`;
const lotsAbs    = (v: number) => `${(Math.abs(v) / 1000).toFixed(1)} k lots`;
const pctSigned  = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pct1       = (v: number) => `${v.toFixed(1)}%`;
const kTons      = (mt: number) => `${(mt / 1000).toFixed(1)} k tons`;
const kTonsSigned = (mt: number) => `${mt >= 0 ? "+" : ""}${(mt / 1000).toFixed(1)} k tons`;
const num        = (x: unknown) => (typeof x === "number" ? x : 0);

const md = (iso: string) => { const [, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}`; };

const priceAbsNY  = (v: number, signed = false) => `${signed && v >= 0 ? "+" : ""}${Math.round(v)} ¢/lb`;
const priceAbsLDN = (v: number, signed = false) =>
  signed ? `${v >= 0 ? "+" : "-"}$${Math.abs(Math.round(v))} per ton` : `$${Math.round(v)} per ton`;

const FLOW_THRESHOLD = 50; // lots below which a leg reads "stable/holding"

const OI_HISTORY_URL = "/data/oi_history.json";
type OiHistory = { arabica?: OiDay[]; robusta?: OiDay[] };

/** Nearest-two active contract letters, e.g. "N and U". days[] is newest-first. */
function nearestLetters(days: OiDay[] | undefined): string | null {
  const latest = days?.[0];
  if (!latest?.contracts?.length) return null;
  const letters = latest.contracts.filter(c => num(c.oi) > 0).slice(0, 2).map(c => c.symbol.charAt(2));
  return letters.length === 2 ? `${letters[0]} and ${letters[1]}` : letters[0] ?? null;
}


// Backtested directional hit-rate per confidence tier (5y archive).
const CONF_META = {
  high:   { label: "high conf",   cls: "text-emerald-400 border-emerald-700/50", hint: "≈82-86% directional hit-rate (5y backtest)" },
  medium: { label: "med conf",    cls: "text-amber-400 border-amber-700/50",     hint: "≈67-69% directional hit-rate (5y backtest)" },
  low:    { label: "low conf",    cls: "text-slate-500 border-slate-700",        hint: "≈60% — near base rate; treat as tentative" },
} as const;

function ConfChip({ lots, params }: { lots: number; params: IntraweekParams }) {
  const meta = CONF_META[confidenceTier(Math.abs(lots), params)];
  return <span title={meta.hint} className={`ml-1 px-1 py-px rounded border text-[9px] uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>;
}

function Bullet({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return (
    <li className={`flex gap-2 ${sub ? "ml-4 text-slate-400" : "text-slate-300"}`}>
      <span className={sub ? "text-slate-600" : "text-amber-500/70"}>{sub ? "◦" : "•"}</span>
      <span>{children}</span>
    </li>
  );
}

// Bullish=green / bearish=red tint for a variation value. `sign` drives the
// colour; `invert` flips it (shorts & producers, where a positive change is
// bearish). sign === 0 stays neutral, so "holding"/"stable" reads plain.
function Tone({ sign, invert, children }: { sign: number; invert?: boolean; children: React.ReactNode }) {
  const dir = invert ? -sign : sign;
  const cls = dir > 0 ? "text-emerald-400" : dir < 0 ? "text-red-400" : "";
  return <span className={cls}>{children}</span>;
}

function MarketColumn({ m, prevPrice, letters, label, post, params, oiChangeNearbyOverride }: {
  m: MarketMetrics; prevPrice: number; letters: string | null; label: string; post: PostCot | null; params: IntraweekParams;
  /** Re-derived nearby delta from per-contract OI history (issue #132 Body-7
   *  fix). When provided, takes precedence over m.oiChangeNearby which
   *  pulled from the buggy single `exch_oi_*` DB field. Forward bullet is
   *  re-derived as Total − Nearby so the math stays internally consistent. */
  oiChangeNearbyOverride: number | null;
}) {
  const isNY = m.market === "NY Arabica";
  const priceAbs = isNY ? priceAbsNY(m.priceChangeAbs) : priceAbsLDN(m.priceChangeAbs);

  let structureClause: React.ReactNode = null;
  if (m.structureValue !== null) {
    const invNow  = (-m.structureValue / m.price) * 100;
    const invPrev = m.structurePrevValue !== null && prevPrice > 0 ? (-m.structurePrevValue / prevPrice) * 100 : null;
    const backwardated = m.structureValue <= 0;
    const movingToward = invPrev === null ? null : invNow > invPrev ? "backwardation" : "carry";
    structureClause = (
      <>; structure{movingToward ? ` moving toward ${movingToward}` : ""},{" "}
        {backwardated ? "inverted" : "in carry"} at {pct1(Math.abs(invNow))}
        {invPrev !== null ? ` (vs ${pct1(Math.abs(invPrev))} LW)` : ""}</>
    );
  }

  const longVerb  = m.mmLongChangeLots  < 0 ? "liquidating" : m.mmLongChangeLots  > 0 ? "adding to" : "holding";
  const shortVerb = m.mmShortChangeLots > 0 ? "increasing"  : m.mmShortChangeLots < 0 ? "covering"  : "holding";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">{label} Overview</div>
      {(() => {
        // Prefer the override re-derived from per-contract OI history (issue
        // #132 Body-7). Forward = Total − Nearby to keep the three numbers
        // self-consistent. Falls back to the metrics-object values when the
        // override is unavailable (e.g. fresh page load before oi_history.json
        // resolves, or a date missing from the 14-day window).
        const nearbyShown = oiChangeNearbyOverride !== null ? oiChangeNearbyOverride : m.oiChangeNearby;
        const forwardShown = oiChangeNearbyOverride !== null ? m.oiChangeLots - oiChangeNearbyOverride : m.oiChangeForward;
        return (
          <ul className="space-y-1.5 text-xs leading-relaxed">
            <Bullet>Total OI change of {lotsSigned(m.oiChangeLots)} since last COT</Bullet>
            {nearbyShown !== null && (
              <Bullet sub>{lotsSigned(nearbyShown)} in nearby contracts{letters ? ` (${letters})` : ""}</Bullet>
            )}
            {forwardShown !== null && (
              <Bullet sub>{lotsSigned(forwardShown)} in forward contracts</Bullet>
            )}
            <Bullet>Price <Tone sign={m.priceChangePct}>{pct1(m.priceChangePct)} ({priceAbs})</Tone>{structureClause}.</Bullet>
            <Bullet>
              {m.cats.pmpu.dLong > 0 ? "Roasters are covering for" : "Roasters holding & fixing for"} <Tone sign={m.cats.pmpu.dLong}>{lotsSigned(m.cats.pmpu.dLong)} ({kTonsSigned(m.roasterMTWoW)})</Tone>,
              reaching {kTons(m.roasterMT)} ({pct1(m.roasterCovPct)} maxed).
            </Bullet>
            <Bullet>
              {m.cats.pmpu.dShort > 0 ? "Producers are selling for" : "Producers holding & exporters are fixing for"} <Tone sign={m.cats.pmpu.dShort} invert>{lotsSigned(m.cats.pmpu.dShort)} ({kTonsSigned(m.producerMTWoW)})</Tone>,
              reaching {kTons(m.producerMT)} ({pct1(m.producerCovPct)} maxed).
            </Bullet>
            <Bullet>
              MM {longVerb} longs <Tone sign={m.mmLongChangeLots}>({lotsSigned(m.mmLongChangeLots)} / {pctSigned(m.mmLongChangePct)} of their position)</Tone>
              {" "}and {shortVerb} shorts <Tone sign={m.mmShortChangeLots} invert>({lotsSigned(m.mmShortChangeLots)} / {pctSigned(m.mmShortChangePct)} of their position)</Tone>.
              {" "}Net {m.mmLong - m.mmShort >= 0 ? "long" : "short"} of {lotsAbs(m.mmLong - m.mmShort)}.
            </Bullet>
          </ul>
        );
      })()}

      {post && (
        <div className="mt-4 pt-3 border-t border-slate-800">
          <div className="text-[11px] font-semibold text-sky-300/90 mb-2">
            {label.split(" ")[0]} post COT
            <span className="text-slate-500 font-normal"> · from {md(post.cotDate)} until {md(post.latestDate)}</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed">
            <Bullet>OI change of {lotsSigned(post.oiChange)} since COT day, of which:</Bullet>
            <Bullet sub>{lotsSigned(post.nearbyChange)} in nearby contracts</Bullet>
            <Bullet sub>{lotsSigned(post.forwardChange)} in forward contracts</Bullet>
            <Bullet>
              Price <Tone sign={post.priceChangePct}>{pctSigned(post.priceChangePct)} ({isNY ? priceAbsNY(post.priceChangeAbs, true) : priceAbsLDN(post.priceChangeAbs, true)})</Tone>;
              {" "}structure moving toward {post.movingToward}, {post.inCarry ? "in carry" : "inverted"} at {pct1(post.invertedNow)}.
            </Bullet>
            <Bullet>
              Roasters&rsquo; coverage probably <Tone sign={Math.abs(post.roasterLotsDelta) > FLOW_THRESHOLD ? post.roasterLotsDelta : 0}>{post.roasterLotsDelta > FLOW_THRESHOLD
                ? <>increasing ~{lotsAbs(post.roasterLotsDelta)} long — buying into weakness, counterparty to MM<ConfChip lots={post.roasterLotsDelta} params={params} /></>
                : post.roasterLotsDelta < -FLOW_THRESHOLD
                ? <>reducing ~{lotsAbs(post.roasterLotsDelta)} long — trimming into strength<ConfChip lots={post.roasterLotsDelta} params={params} /></>
                : "stable"}</Tone>.
            </Bullet>
            <Bullet>
              Producers&rsquo; coverage probably <Tone sign={Math.abs(post.producerLotsDelta) > FLOW_THRESHOLD ? post.producerLotsDelta : 0} invert>{post.producerLotsDelta > FLOW_THRESHOLD
                ? <>increasing ~{lotsAbs(post.producerLotsDelta)} short — selling into strength, counterparty to MM<ConfChip lots={post.producerLotsDelta} params={params} /></>
                : post.producerLotsDelta < -FLOW_THRESHOLD
                ? <>reducing ~{lotsAbs(post.producerLotsDelta)} short — covering into weakness<ConfChip lots={post.producerLotsDelta} params={params} /></>
                : "stable"}</Tone>.
            </Bullet>
            <Bullet>
              MM probably {post.mmLongDelta < -FLOW_THRESHOLD ? "liquidating" : post.mmLongDelta > FLOW_THRESHOLD ? "building" : "holding"} longs <Tone sign={Math.abs(post.mmLongDelta) > FLOW_THRESHOLD ? post.mmLongDelta : 0}>({lotsSigned(post.mmLongDelta)})</Tone>
              {" "}and {post.mmShortDelta > FLOW_THRESHOLD ? "increasing" : post.mmShortDelta < -FLOW_THRESHOLD ? "covering" : "holding"} shorts <Tone sign={Math.abs(post.mmShortDelta) > FLOW_THRESHOLD ? post.mmShortDelta : 0} invert>({lotsSigned(post.mmShortDelta)})</Tone>{" "}
              <span className="text-slate-600">(est. OI&times;price regime)</span>.
            </Bullet>
            {Math.abs(post.othersDelta) > FLOW_THRESHOLD && (
              <Bullet sub>swaps / other reportables absorbing ~{lotsAbs(post.othersDelta)} of the counterparty flow</Bullet>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Overview({ data }: { data: ProcessedCotRow[] }) {
  const [oi, setOi] = useState<OiHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(OI_HISTORY_URL)
      .then(r => (r.ok ? r.json() : null))
      .then((d: OiHistory | null) => { if (!cancelled && d) setOi(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const recent52 = data.slice(-52);
  const ny  = buildMarketMetrics(recent52, data, "ny");
  const ldn = buildMarketMetrics(recent52, data, "ldn");

  const { lettersNy, lettersLdn, postNy, postLdn, nearbyNyOverride, nearbyLdnOverride } = useMemo(() => {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const cotDate = last?.date ?? "";
    const priorCotDate = prev?.date ?? "";
    return {
      lettersNy:  nearestLetters(oi?.arabica),
      lettersLdn: nearestLetters(oi?.robusta),
      postNy:  last ? buildPostCot(oi?.arabica, cotDate, last.ny,  NY_PARAMS)  : null,
      postLdn: last ? buildPostCot(oi?.robusta, cotDate, last.ldn, LDN_PARAMS) : null,
      // Issue #132 Body-7: re-derive nearby OI delta from per-contract history
      // (oi_history.json) instead of the buggy `exch_oi_*` DB field that
      // dataHelpers.ts still reads. Falls back to null when either date is
      // outside the 14-day window or fetch hasn't resolved yet — MarketColumn
      // then uses the metrics-object value.
      nearbyNyOverride:  nearbyOiDelta(oi?.arabica, cotDate, priorCotDate),
      nearbyLdnOverride: nearbyOiDelta(oi?.robusta, cotDate, priorCotDate),
    };
  }, [oi, data]);

  const prevPriceNY  = data.length >= 2 ? data[data.length - 2].priceNY  : 0;
  const prevPriceLDN = data.length >= 2 ? data[data.length - 2].priceLDN : 0;

  return (
    <>
      <SectionHeader icon="Eye" title="Overview"
        subtitle="Weekly positioning summary per market — OI, price/structure, industry coverage and managed-money flow vs. the prior COT week, plus an intraweek update from the COT day to the latest data." />
      {ny && ldn ? (
        <div className="grid grid-cols-2 gap-2 lg:gap-4">
          <MarketColumn m={ny}  prevPrice={prevPriceNY}  letters={lettersNy}  label="Arabica · NY"  post={postNy}  params={NY_PARAMS}  oiChangeNearbyOverride={nearbyNyOverride} />
          <MarketColumn m={ldn} prevPrice={prevPriceLDN} letters={lettersLdn} label="Robusta · LDN" post={postLdn} params={LDN_PARAMS} oiChangeNearbyOverride={nearbyLdnOverride} />
        </div>
      ) : (
        <div className="text-xs text-slate-500 px-1">Insufficient history to build the overview.</div>
      )}
    </>
  );
}
