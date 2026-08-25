// Certified-stocks system-flow builders (pure). Turn the raw scraper JSON for
// each market into the per-warehouse PortFlow cards + intake summary the
// component renders. Behaviour lifted verbatim from the original in-component
// memo; the only change is that the window helpers and props are now explicit
// parameters instead of closure captures.

import { BAGS_PER_WARRANT_KC, LOTS_PER_WARRANT_RC, _assignSpans } from "./grid";
import { _canonicalKC, ARABICA_PORT_NAMES, ROBUSTA_PORT_NAMES } from "./ports";
import { _binByDays, _binByMonths, type AgeDist } from "./age";
import { _originColor } from "./colors";
import { _computePoison } from "./poison";
import { _simulateRobustaPortStock } from "./sim";
import type { OriginFlowPair, OriginFlow, PortFlow, RobustaPortSim } from "./types";
import {
  type ArabicaJsonShape, type ArabicaSnap,
  type RobustaJsonShape, type RobustaAgeMonth,
  _arabicaPassedByPortOrigin,
} from "./shapes";

// One market's resolved flow:
//   • ports — per-warehouse PortFlow cards (current stock, per-origin mix, age
//     distribution, and flowByOrigin gross_in/gross_out used to derive the
//     existing / net-gained / lost / transited squares)
//   • intake — window grading summary for the side indicators
// Resolve one port's gauge scale. `port_peaks` (exporter-computed, all-time) is
// the honest basis; the loaded window's max is only a fallback for a port with
// no archived history. Using the window alone is what made Antwerp read "100%
// full" at 12% of its 2011 peak, and Trieste read full on 24 lots.
function _gauge(
  peaks: Record<string, { min: number; max: number; max_date?: string | null; first_seen?: string | null }> | undefined,
  code: string, current: number, windowMax: number,
): { capacity: number; floor: number; peakDate: string | null; historyFrom: string | null; peakIsHistorical: boolean; pctFull: number } {
  const pk = peaks?.[code];
  const historical = !!pk && pk.max > 0;
  // Never let the scale sit below today — a fresh all-time high is 100%, and
  // legitimately so.
  const capacity = Math.max(historical ? pk.max : windowMax, current);
  const floor = historical ? Math.min(pk.min, current) : 0;
  const span = capacity - floor;
  return {
    capacity, floor,
    peakDate: historical ? pk.max_date ?? null : null,
    historyFrom: historical ? pk.first_seen ?? null : null,
    peakIsHistorical: historical,
    pctFull: span > 0 ? ((current - floor) / span) * 100 : (current > 0 ? 100 : 0),
  };
}


export interface SystemFlowMarket {
  market: "KC" | "RC";
  label: string;
  unit: "bags" | "lots";
  squareUnit: number;
  ports: PortFlow[];
  // Whether we can surface in & out for this market/window. Drives the
  // density-grid split (transit-aware when true).
  cohortMatched: boolean;
  // How in & out is derived — drives the per-market caption:
  //   "fifo"   = Arabica daily per-(origin,port) ledger (oldest-leaves-first)
  //   "ageing" = Robusta cohort-DNA matched against an ageing report in-window
  //   "none"   = no in & out yet (Robusta intra-month, before the next report)
  inOutBasis: "fifo" | "ageing" | "none";
  intake: {
    pending: number;
    passed: number;
    failed: number;
    passedPremium: number;
    passedBorderline: number;
    date: string | null;
  } | null;
}

// Find the snapshot closest to (but not after) `target` for the T0 baseline.
const findSnapAt = <T extends { date: string }>(snaps: T[], target: Date): T | null => {
  if (!snaps.length) return null;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const s of snaps) {
    const t = new Date(s.date).getTime();
    if (t > target.getTime()) continue;
    const dist = target.getTime() - t;
    if (dist < bestDist) { best = s; bestDist = dist; }
  }
  return best ?? snaps[0];
};

// Last snapshot at or before the window end (`endT`) — the "as-of" frame for
// the period (current stock / by-origin). Falls back to the newest snapshot.
const snapAtOrBefore = <T extends { date: string }>(snaps: T[], endT: number): T | null => {
  let best: T | null = null, bestT = -Infinity;
  for (const s of snaps) {
    const t = new Date(s.date).getTime();
    if (t <= endT && t > bestT) { best = s; bestT = t; }
  }
  return best ?? (snaps.length ? snaps[snaps.length - 1] : null);
};

// ── Arabica market ─────────────────────────────────────────────────
export function buildArabica(arabica: ArabicaJsonShape | null, start: Date, end: Date): SystemFlowMarket {
  const cutoff = start;
  // Inclusive end-of-day so the chosen end date's own snapshot is in range.
  const endT = end.getTime() + 86_400_000 - 1;

  const empty: SystemFlowMarket = {
    market: "KC", label: "Arabica · ICE Futures US (KC)",
    unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports: [], cohortMatched: false, inOutBasis: "none", intake: null,
  };
  const snaps = arabica?.snapshots ?? [];
  if (snaps.length === 0) return empty;
  const latest = snapAtOrBefore(snaps, endT) ?? snaps[snaps.length - 1];
  const base = findSnapAt(snaps, cutoff) ?? snaps[0];
  const latestSec = latest.sections?.total_certified;
  if (!latestSec) return empty;

  // 365-day per-port max, keyed by canonical port code so the snapshot
  // history's short codes (NOR/MIA/NYK/HAM) merge into the long forms.
  const maxByPort = new Map<string, number>();
  for (const s of snaps) {
    for (const [p, v] of Object.entries(s.by_port || {})) {
      const k = _canonicalKC(p);
      if (v > (maxByPort.get(k) ?? 0)) maxByPort.set(k, v);
    }
  }

  // Age distribution per port from latest_detail.age_detail. Canonicalise
  // here too so the latest's "NOLA" key picks up workbook rows still
  // written as "NOR" (older imports of sheet 12).
  const ageByPort: Record<string, AgeDist> = {};
  const ageDetail = arabica?.latest_detail?.age_detail ?? {};
  for (const [port, rows] of Object.entries(ageDetail)) {
    const canon = _canonicalKC(port);
    const dist: AgeDist = ageByPort[canon] ?? { fresh: 0, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
    for (const r of rows) {
      const m = r.age_bucket?.match(/^(\d+)/);
      const days = m ? parseInt(m[1], 10) : 0;
      dist[_binByDays(days)] += r.bags || 0;
    }
    ageByPort[canon] = dist;
  }
  // Renormalise to shares per canonical port.
  for (const port of Object.keys(ageByPort)) {
    const a = ageByPort[port];
    const sum = a.fresh + a.y1to2 + a.y2to3 + a.y3to4 + a.y4plus;
    if (sum > 0) {
      a.fresh /= sum; a.y1to2 /= sum; a.y2to3 /= sum; a.y3to4 /= sum; a.y4plus /= sum;
    }
  }

  // Roll up latest + base port volumes per canonical code so periods
  // with mismatched short/long codes compare cleanly.
  const collapseSec = (sec: typeof latestSec | undefined) => {
    const byPort: Record<string, number> = {};
    const byOriginPort: Record<string, Record<string, number>> = {};
    const originMeta: Record<string, { group: string }> = {};
    for (const [p, v] of Object.entries(sec?.by_port ?? {})) {
      byPort[_canonicalKC(p)] = (byPort[_canonicalKC(p)] ?? 0) + v;
    }
    for (const [origin, od] of Object.entries(sec?.by_origin ?? {})) {
      byOriginPort[origin] = byOriginPort[origin] ?? {};
      originMeta[origin] = { group: od.group };
      for (const [p, v] of Object.entries(od.by_port ?? {})) {
        const k = _canonicalKC(p);
        byOriginPort[origin][k] = (byOriginPort[origin][k] ?? 0) + v;
      }
    }
    return { byPort, byOriginPort, originMeta };
  };
  const latestC = collapseSec(latestSec);

  // Walk every snapshot in the window in chronological order and
  // accumulate per-(port, origin) gross inflows / outflows from daily
  // deltas. Including `base` at the start captures the first transition
  // into the window. This is what lets us surface stock that arrived
  // AND departed inside the period (the "transited" bucket).
  const cutT = cutoff.getTime();
  const winSnaps = snaps
    .filter((s) => { const t = new Date(s.date).getTime(); return t >= cutT && t <= endT; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const walk = winSnaps[0] === base ? winSnaps : [base, ...winSnaps];
  const flowByPort: Record<string, Record<string, OriginFlowPair>> = {};
  for (let i = 0; i < walk.length - 1; i++) {
    const a = collapseSec(walk[i].sections?.total_certified);
    const b = collapseSec(walk[i + 1].sections?.total_certified);
    const keys = new Set<string>();
    for (const [origin, perPort] of Object.entries(a.byOriginPort)) for (const p of Object.keys(perPort)) keys.add(`${p}|${origin}`);
    for (const [origin, perPort] of Object.entries(b.byOriginPort)) for (const p of Object.keys(perPort)) keys.add(`${p}|${origin}`);
    for (const key of Array.from(keys)) {
      const sep = key.indexOf("|");
      const port = key.slice(0, sep);
      const origin = key.slice(sep + 1);
      const av = (a.byOriginPort[origin] || {})[port] ?? 0;
      const bv = (b.byOriginPort[origin] || {})[port] ?? 0;
      const d = bv - av;
      if (d === 0) continue;
      flowByPort[port] = flowByPort[port] || {};
      flowByPort[port][origin] = flowByPort[port][origin] || { gross_in: 0, gross_out: 0 };
      if (d > 0) flowByPort[port][origin].gross_in  += d;
      else       flowByPort[port][origin].gross_out += -d;
    }
  }

  // ── Exact per-(origin, port) ledger via daily FIFO ──────────────────
  // Arabica publishes exact daily per-(origin,port) stock AND per-origin
  // gradings, so we don't infer — we account exactly:
  //   in  = passed gradings in the window           (exact)
  //   out = base + in − current per (origin,port)   (exact mass balance)
  //   in & out (transit) = of the window's gradings, how much also LEFT in
  //     the window, by a per-(origin,port) FIFO ledger seeded with the
  //     start-of-window stock as the oldest cohort (oldest warrants leave
  //     first — age allowances make that the realistic tender order).
  // The monthly ageing report is age×port with no origin, so it can't drive
  // an origin cohort match; it powers the age fade and validates this ledger.
  // `walk` is the chronological [base, …window snapshots] built above.
  {
    type LedgerCell = { in: number; out: number; transit: number };
    const ledger: Record<string, Record<string, LedgerCell>> = {};
    const cell = (p: string, o: string): LedgerCell => {
      ledger[p] = ledger[p] || {};
      return (ledger[p][o] = ledger[p][o] || { in: 0, out: 0, transit: 0 });
    };
    // FIFO queues per (port, origin): [cohortDate | "LEGACY", qty].
    const queues = new Map<string, Array<[string, number]>>();
    const qOf = (p: string, o: string) => {
      const k = `${p}|${o}`;
      let q = queues.get(k);
      if (!q) { q = []; queues.set(k, q); }
      return q;
    };
    // Seed legacy = start-of-window stock (oldest cohort).
    let prev = collapseSec(walk[0]?.sections?.total_certified).byOriginPort;
    for (const [o, perPort] of Object.entries(prev))
      for (const [p, v] of Object.entries(perPort)) if (v > 0) qOf(p, o).push(["LEGACY", v]);
    // Per-day grading inflow for a snapshot, canonical-port keyed. Uses the
    // exact per-origin matrix; if a day only has the scalar (pre-matrix),
    // spreads it across origins by that day's positive stock movement.
    const gradOf = (snap: ArabicaSnap, prevBO: Record<string, Record<string, number>>,
                    curBO: Record<string, Record<string, number>>): Record<string, Record<string, number>> => {
      const rows = _arabicaPassedByPortOrigin(snap);
      const out: Record<string, Record<string, number>> = {};
      if (rows && rows.length) {
        for (const [p, o, b] of rows) { out[p] = out[p] || {}; out[p][o] = (out[p][o] ?? 0) + b; }
        return out;
      }
      const scalar = snap.passed_today_bags ?? 0;
      if (scalar <= 0) return out;
      const ups: Array<[string, string, number]> = [];
      let upSum = 0;
      const keys = new Set<string>();
      for (const o of Object.keys({ ...prevBO, ...curBO })) for (const p of Object.keys({ ...(prevBO[o] || {}), ...(curBO[o] || {}) })) keys.add(`${p}|${o}`);
      for (const key of Array.from(keys)) {
        const sep = key.indexOf("|"); const p = key.slice(0, sep), o = key.slice(sep + 1);
        const d = (curBO[o]?.[p] ?? 0) - (prevBO[o]?.[p] ?? 0);
        if (d > 0) { ups.push([p, o, d]); upSum += d; }
      }
      for (const [p, o, d] of ups) { out[p] = out[p] || {}; out[p][o] = scalar * (d / (upSum || 1)); }
      return out;
    };
    for (let i = 1; i < walk.length; i++) {
      const cur = collapseSec(walk[i]?.sections?.total_certified).byOriginPort;
      const grad = gradOf(walk[i], prev, cur);
      const keys = new Set<string>();
      for (const o of Object.keys(prev)) for (const p of Object.keys(prev[o])) keys.add(`${p}|${o}`);
      for (const o of Object.keys(cur)) for (const p of Object.keys(cur[o])) keys.add(`${p}|${o}`);
      for (const p of Object.keys(grad)) for (const o of Object.keys(grad[p])) keys.add(`${p}|${o}`);
      for (const key of Array.from(keys)) {
        const sep = key.indexOf("|"); const p = key.slice(0, sep), o = key.slice(sep + 1);
        const gin = grad[p]?.[o] ?? 0;
        const c = cell(p, o);
        if (gin > 0) { c.in += gin; qOf(p, o).push([walk[i].date, gin]); }
        const outToday = Math.max(0, (prev[o]?.[p] ?? 0) + gin - (cur[o]?.[p] ?? 0));
        if (outToday > 0) {
          c.out += outToday;
          let rem = outToday;
          const q = qOf(p, o);
          while (rem > 1e-9 && q.length) {
            const head = q[0];
            const take = Math.min(rem, head[1]);
            if (head[0] !== "LEGACY") c.transit += take;   // graded in-window AND left
            head[1] -= take; rem -= take;
            if (head[1] <= 1e-9) q.shift();
          }
        }
      }
      prev = cur;
    }
    // Replace the signed-delta flows with the exact ledger (carrying transit).
    for (const k of Object.keys(flowByPort)) delete flowByPort[k];
    for (const [p, byO] of Object.entries(ledger))
      for (const [o, f] of Object.entries(byO))
        if (f.in > 0 || f.out > 0) {
          flowByPort[p] = flowByPort[p] || {};
          flowByPort[p][o] = { gross_in: f.in, gross_out: f.out, transit: f.transit };
        }
  }
  // Arabica always has the daily ledger as its in & out basis.
  const cohortMatched = true;
  const inOutBasis: "fifo" | "ageing" | "none" = "fifo";

  const ports: PortFlow[] = [];
  for (const [code, current] of Object.entries(latestC.byPort)) {
    if (current <= 0) continue;
    const byOrigin: Record<string, number> = {};
    for (const [origin, perPort] of Object.entries(latestC.byOriginPort)) {
      const v = perPort[code] ?? 0;
      if (v > 0) byOrigin[origin] = v;
    }
    const flowByOrigin = flowByPort[code] ?? {};
    const inflow: OriginFlow[] = [];
    const outflow: OriginFlow[] = [];
    for (const [origin, f] of Object.entries(flowByOrigin)) {
      if (f.gross_in  > 0) inflow.push({  origin, volume: f.gross_in,  color: _originColor(origin, "KC") });
      if (f.gross_out > 0) outflow.push({ origin, volume: f.gross_out, color: _originColor(origin, "KC") });
    }
    inflow.sort((a, b) => b.volume - a.volume);
    outflow.sort((a, b) => b.volume - a.volume);
    const g = _gauge(arabica?.port_peaks, code, current, maxByPort.get(code) ?? current);
    const ageFinal = ageByPort[code] ?? { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
    const poison = _computePoison(current, "KC", code, byOrigin, ageFinal, 0);
    ports.push({
      market: "KC", code, name: ARABICA_PORT_NAMES[code] ?? code,
      current, ...g,
      unit: "bags", squareUnit: BAGS_PER_WARRANT_KC,
      byOrigin, age: ageFinal,
      flowByOrigin, inflow, outflow, span: 1, poison,
    });
  }
  ports.sort((a, b) => b.current - a.current);
  _assignSpans(ports);

  // Intake summary — SUM over the window (so it aligns with the
  // per-warehouse inflow numbers below). Pending stays point-in-time
  // (it's a standing queue, not a flow).
  const cutTime = cutoff.getTime();
  let passed = 0, failed = 0;
  for (const s of snaps) {
    const t = new Date(s.date).getTime();
    if (t < cutTime || t > endT) continue;
    passed += s.passed_today_bags ?? 0;
    failed += s.failed_today_bags ?? 0;
  }
  let premiumShare = 0, borderlineShare = 0;
  for (const [origin, perPort] of Object.entries(latestC.byOriginPort)) {
    const tot = Object.values(perPort).reduce((a, b) => a + b, 0);
    const group = latestC.originMeta[origin]?.group ?? "";
    if (group === "Group 3" || group === "Group 4") borderlineShare += tot;
    else premiumShare += tot;
  }
  const sum = premiumShare + borderlineShare || 1;
  const passedPremium    = Math.round(passed * (premiumShare    / sum));
  const passedBorderline = Math.round(passed * (borderlineShare / sum));
  return {
    market: "KC", label: "Arabica · ICE Futures US (KC)",
    unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports, cohortMatched, inOutBasis,
    intake: { pending: latest.pending_grading_bags ?? 0, passed, failed, passedPremium, passedBorderline, date: latest.date },
  };
}

// ── Robusta market ──────────────────────────────────────────────────
// No standing by_origin per port in the source — inferred from gradings
// flow proportions (per port, full history). Mark every robusta panel
// with the inferred caveat.
export function buildRobusta(robusta: RobustaJsonShape | null, start: Date, end: Date): SystemFlowMarket {
  const cutoff = start;
  // Inclusive end-of-day so the chosen end date's own snapshot is in range.
  const endT = end.getTime() + 86_400_000 - 1;

  const empty: SystemFlowMarket = {
    market: "RC", label: "Robusta · ICE Futures Europe (RC)",
    unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports: [], cohortMatched: false, inOutBasis: "none", intake: null,
  };
  const snaps = robusta?.snapshots ?? [];
  const grads = robusta?.recent_activity?.gradings ?? [];
  const overv = robusta?.recent_activity?.grading_overview ?? [];
  if (snaps.length === 0) return empty;
  const latest = snapAtOrBefore(snaps, endT) ?? snaps[snaps.length - 1];

  // Origin proportion per port — prefer the full-history rollup the
  // importer attached (covers stock graded outside the daily window,
  // e.g. Felixstowe's 34 lots that pre-date our gradings events).
  // Fall back to the rolling window's gradings entries when the
  // workbook field isn't present.
  const portOriginLots: Record<string, Record<string, number>> = {};
  const portClass34Lots: Record<string, number> = {};
  const portTotalLotsHist: Record<string, number> = {};
  const fullHist = robusta?.port_origin_history;
  if (fullHist) {
    for (const [port, byOrigin] of Object.entries(fullHist)) {
      portOriginLots[port] = {};
      let class34 = 0, total = 0;
      for (const [origin, d] of Object.entries(byOrigin) as Array<[string, { tenderable: number; class34: number }]>) {
        portOriginLots[port][origin] = (portOriginLots[port][origin] ?? 0) + d.tenderable;
        class34 += d.class34;
        total   += d.tenderable;
      }
      portClass34Lots[port] = class34;
      portTotalLotsHist[port] = total;
    }
  } else {
    for (const ev of grads) {
      for (const e of (ev.entries || [])) {
        if (e.tenderable === false) continue;
        const port = e.port || "?";
        const origin = e.origin?.trim() || "?";
        portOriginLots[port] = portOriginLots[port] ?? {};
        portOriginLots[port][origin] = (portOriginLots[port][origin] ?? 0) + (e.lots ?? 0);
        portTotalLotsHist[port] = (portTotalLotsHist[port] ?? 0) + (e.lots ?? 0);
        if (e.class === 3 || e.class === 4) {
          portClass34Lots[port] = (portClass34Lots[port] ?? 0) + (e.lots ?? 0);
        }
      }
    }
  }

  // Per-(port, origin, class) tenderable lots from gradings events —
  // drives the per-square Robusta class assignment + border colour.
  // Normalised to shares per (port, origin) so each square is stamped
  // with a class sampled from that origin's quality mix at the port.
  const portOriginClassMix: Record<string, Record<string, Record<number, number>>> = {};
  for (const ev of grads) {
    for (const e of (ev.entries || [])) {
      if (e.tenderable === false) continue;
      const klass = e.class;
      if (klass == null) continue;
      const port = e.port || "?";
      const origin = e.origin?.trim() || "?";
      portOriginClassMix[port] = portOriginClassMix[port] || {};
      portOriginClassMix[port][origin] = portOriginClassMix[port][origin] || {};
      portOriginClassMix[port][origin][klass] = (portOriginClassMix[port][origin][klass] ?? 0) + (e.lots ?? 0);
    }
  }
  const portOriginClassShares: Record<string, Record<string, Record<number, number>>> = {};
  for (const [port, byOrigin] of Object.entries(portOriginClassMix)) {
    const out: Record<string, Record<number, number>> = {};
    for (const [origin, byClass] of Object.entries(byOrigin)) {
      const total = Object.values(byClass).reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      const shares: Record<number, number> = {};
      for (const [k, v] of Object.entries(byClass)) shares[Number(k)] = v / total;
      out[origin] = shares;
    }
    if (Object.keys(out).length > 0) portOriginClassShares[port] = out;
  }

  // Age distribution per port from the latest age_allowance month.
  const ageByPort: Record<string, AgeDist> = {};
  const ageMonths = robusta?.monthly?.age_allowance ?? [];
  const latestAge = ageMonths.reduce<RobustaAgeMonth | null>((acc, m) =>
    !acc || new Date(m.month_end) > new Date(acc.month_end) ? m : acc, null);
  const buckets = latestAge?.valid?.buckets ?? [];
  for (const b of buckets) {
    const bin = _binByMonths(b.months_since_graded);
    for (const [port, mt] of Object.entries(b.by_port || {})) {
      ageByPort[port] = ageByPort[port] ?? { fresh: 0, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
      ageByPort[port][bin] += Number(mt) || 0;
    }
  }
  for (const port of Object.keys(ageByPort)) {
    const a = ageByPort[port];
    const sum = a.fresh + a.y1to2 + a.y2to3 + a.y3to4 + a.y4plus;
    if (sum > 0) {
      a.fresh /= sum; a.y1to2 /= sum; a.y2to3 /= sum; a.y3to4 /= sum; a.y4plus /= sum;
    }
  }

  const maxByPort = new Map<string, number>();
  for (const s of snaps) {
    for (const [p, v] of Object.entries(s.by_port_lots || {})) {
      if (v > (maxByPort.get(p) ?? 0)) maxByPort.set(p, v);
    }
  }

  // Preferred path: read backend's cohort-DNA outputs (cohort_outflow.py).
  // `current_by_origin` gives the per-origin breakdown of the latest
  // ageing report; `implied_outflow` gives per-origin outflow per
  // calendar month, apportioned by each cohort's own DNA. Falls back
  // to the in-browser per-port stock simulation when either field is
  // missing (older JSON or fresh builds before the importer re-runs).
  const cohortCurrent = robusta?.monthly?.current_by_origin;
  const cohortOutflow = robusta?.monthly?.implied_outflow;
  const useCohort = !!cohortCurrent && !!cohortOutflow;
  // in & out is only meaningful once an ageing report inside the window
  // lets us cohort-match the outflow. Intra-month (no new month_end yet)
  // we show all gradings as "in" and the decline as "out", no in & out —
  // exactly the "assume nothing until end of month" state in the model.
  const cutStartT = cutoff.getTime();
  const cohortMatched = useCohort && (cohortOutflow ?? []).some((e) => {
    const t = new Date(e.month_end).getTime();
    return t >= cutStartT && t <= endT;
  });
  // Whether the data carries the cohort-resolved in & out subset
  // (by_port_transit). New importer output has it; older JSON does not, in
  // which case buildDensityGrid falls back to the min(in, out) heuristic.
  const transitFieldPresent = (cohortOutflow ?? []).some((e) => e.by_port_transit != null);

  // Always compute the in-browser per-port stock simulation. In the
  // fallback path it is the sole source of flows; in the cohort path it
  // supplements the monthly implied_outflow with recent DAILY outflow
  // (decertifications) that lands after the last month-end ageing report
  // — otherwise a fresh drop like "22 lots decertified on Jun 2" never
  // shows in the system flow because implied_outflow only updates monthly.
  const sims: Record<string, RobustaPortSim> = {};
  {
    const allPortCodes = new Set<string>();
    for (const s of snaps) for (const p of Object.keys(s.by_port_lots || {})) allPortCodes.add(p);
    for (const p of Array.from(allPortCodes)) {
      sims[p] = _simulateRobustaPortStock(p, snaps, grads, portOriginLots[p] ?? {});
    }
  }
  // Newest month_end covered by the cohort implied_outflow. Daily-sim
  // outflow strictly AFTER this date is additive (no double counting),
  // because implied_outflow has not yet absorbed it.
  const lastCohortMonthEndT = (cohortOutflow && cohortOutflow.length)
    ? Math.max(...cohortOutflow.map((e) => new Date(e.month_end).getTime()))
    : -Infinity;

  // Real per-(port, origin) gradings inflow per calendar month —
  // needed when cohort-DNA outflow is the trusted source for gross_out;
  // gross_in still comes straight from gradings events (the source
  // of truth for inflows).
  const cutT = cutoff.getTime();
  const cohortInflowByPortOrigin: Record<string, Record<string, number>> = {};
  if (useCohort) {
    for (const ev of grads) {
      const t = new Date(ev.date).getTime();
      if (t < cutT || t > endT) continue;
      for (const e of (ev.entries || [])) {
        if (e.tenderable === false) continue;
        const port = e.port || "?";
        const origin = (e.origin || "?").trim();
        cohortInflowByPortOrigin[port] = cohortInflowByPortOrigin[port] || {};
        cohortInflowByPortOrigin[port][origin] = (cohortInflowByPortOrigin[port][origin] ?? 0) + (e.lots ?? 0);
      }
    }
  }

  const ports: PortFlow[] = [];
  for (const [code, current] of Object.entries(latest.by_port_lots || {})) {
    if (current <= 0) continue;
    const byOrigin: Record<string, number> = {};
    const flowByOrigin: Record<string, OriginFlowPair> = {};

    if (useCohort) {
      // PREFERRED: cohort-DNA pipeline outputs.
      // byOrigin from current_by_origin, normalised to the live port
      // total so it always sums to `current` (which comes from the
      // most recent daily snapshot, not the month-end ageing report).
      const cur = cohortCurrent?.[code] ?? {};
      const curSum = Object.values(cur).reduce((a, b) => a + b, 0);
      if (curSum > 0) {
        for (const [o, v] of Object.entries(cur)) if (v > 0) byOrigin[o] = (v / curSum) * current;
      } else {
        byOrigin["Unknown"] = current;
      }
      // gross_out from implied_outflow summed over months in window;
      // gross_in from real gradings events. `transitByOrigin` is the
      // cohort-resolved "in & out" subset (by_port_transit) — outflow from
      // cohorts graded inside the same interval, i.e. graded AND left.
      const inflowByOrigin = cohortInflowByPortOrigin[code] ?? {};
      const outflowByOrigin: Record<string, number> = {};
      const transitByOrigin: Record<string, number> = {};
      for (const entry of cohortOutflow ?? []) {
        const t = new Date(entry.month_end).getTime();
        if (t < cutT || t > endT) continue;
        const byO = entry.by_port?.[code];
        if (byO) {
          for (const [o, v] of Object.entries(byO)) outflowByOrigin[o] = (outflowByOrigin[o] ?? 0) + v;
        }
        const byT = entry.by_port_transit?.[code];
        if (byT) {
          for (const [o, v] of Object.entries(byT)) transitByOrigin[o] = (transitByOrigin[o] ?? 0) + v;
        }
      }
      // Supplement with recent DAILY outflow from the per-port sim for
      // dates after the last month-end the cohort outflow covers. This
      // surfaces same-month decertifications (e.g. the Jun 2 drop) that
      // implied_outflow won't reflect until the next monthly ageing run.
      const simRecent = sims[code];
      if (simRecent) {
        for (const [date, byO] of Object.entries(simRecent.outflowByOriginByDate)) {
          const t = new Date(date).getTime();
          if (t < cutT || t > endT || t <= lastCohortMonthEndT) continue;
          for (const [o, v] of Object.entries(byO)) {
            outflowByOrigin[o] = (outflowByOrigin[o] ?? 0) + v;
          }
        }
      }
      // Attach the cohort-resolved transit when the window brackets an
      // ageing report AND the data carries by_port_transit. Every origin
      // then gets an explicit transit (0 = "no in & out for this origin"),
      // which overrides the min(in, out) heuristic. Older JSON without the
      // field leaves transit undefined → heuristic fallback downstream.
      const haveTransit = cohortMatched && transitFieldPresent;
      for (const o of Array.from(new Set([...Object.keys(inflowByOrigin), ...Object.keys(outflowByOrigin)]))) {
        const gi = inflowByOrigin[o] ?? 0;
        const go = outflowByOrigin[o] ?? 0;
        if (gi > 0 || go > 0) {
          flowByOrigin[o] = { gross_in: gi, gross_out: go };
          if (haveTransit) flowByOrigin[o].transit = transitByOrigin[o] ?? 0;
        }
      }
    } else {
      // FALLBACK: in-browser per-port stock simulation.
      const sim = sims[code];
      const stateSum = sim ? Object.values(sim.state).reduce((a, b) => a + b, 0) : 0;
      if (sim && stateSum > 0) {
        for (const [o, v] of Object.entries(sim.state)) if (v > 0) byOrigin[o] = (v / stateSum) * current;
      } else {
        byOrigin["Unknown"] = current;
      }
      if (sim) {
        for (const [date, byO] of Object.entries(sim.inflowByOriginByDate)) {
          const t = new Date(date).getTime();
          if (t < cutT || t > endT) continue;
          for (const [o, v] of Object.entries(byO)) {
            flowByOrigin[o] = flowByOrigin[o] || { gross_in: 0, gross_out: 0 };
            flowByOrigin[o].gross_in += v;
          }
        }
        for (const [date, byO] of Object.entries(sim.outflowByOriginByDate)) {
          const t = new Date(date).getTime();
          if (t < cutT || t > endT) continue;
          for (const [o, v] of Object.entries(byO)) {
            flowByOrigin[o] = flowByOrigin[o] || { gross_in: 0, gross_out: 0 };
            flowByOrigin[o].gross_out += v;
          }
        }
      }
    }
    const inflow:  OriginFlow[] = [];
    const outflow: OriginFlow[] = [];
    for (const [origin, f] of Object.entries(flowByOrigin)) {
      if (f.gross_in  > 0) inflow.push({  origin, volume: f.gross_in,  color: _originColor(origin, "RC") });
      if (f.gross_out > 0) outflow.push({ origin, volume: f.gross_out, color: _originColor(origin, "RC") });
    }
    inflow.sort((a, b) => b.volume - a.volume);
    outflow.sort((a, b) => b.volume - a.volume);
    // Class 3/4 share — taken from the precomputed full-history rollup
    // when present, falls back to per-window inference above.
    const totalHist = portTotalLotsHist[code] ?? 0;
    const class34Share = totalHist > 0 ? (portClass34Lots[code] ?? 0) / totalHist : 0;
    const g = _gauge(robusta?.port_peaks, code, current, maxByPort.get(code) ?? current);
    const ageFinal = ageByPort[code] ?? { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
    const poison = _computePoison(current, "RC", code, byOrigin, ageFinal, class34Share);
    ports.push({
      market: "RC", code, name: ROBUSTA_PORT_NAMES[code] ?? code,
      current, ...g,
      unit: "lots", squareUnit: LOTS_PER_WARRANT_RC,
      byOrigin, age: ageFinal,
      flowByOrigin, classShares: portOriginClassShares[code],
      inflow, outflow, span: 1, poison,
    });
  }
  ports.sort((a, b) => b.current - a.current);
  _assignSpans(ports);

  // Intake summary — SUM all gradings entries in the window. Aligns
  // with the per-warehouse inflow numbers below (which also sum lots
  // from the same gradings events). Pending stays point-in-time from
  // the most recent grading_overview report.
  const cutTimeR = cutoff.getTime();
  let pPrem = 0, pBord = 0, fail = 0;
  for (const g of grads) {
    const t = new Date(g.date).getTime();
    if (t < cutTimeR || t > endT) continue;
    for (const e of (g.entries || [])) {
      const lots = e.lots || 0;
      if (e.tenderable === false) { fail += lots; continue; }
      if (e.class === 3 || e.class === 4) pBord += lots;
      else pPrem += lots;
    }
  }
  // Pending from the most recent grading_overview report at or before the
  // window end (point-in-time queue + forecast — not a flow).
  const overvInWin = overv.filter((o) => new Date(o.date).getTime() <= endT);
  const lastOverv = overvInWin.length ? overvInWin[overvInWin.length - 1]
    : (overv.length ? overv[overv.length - 1] : null);
  const pendingTotal = lastOverv?.total_pending_lots ?? 0;
  // Date label = latest event in window so the user knows the period end.
  const inWinGrad = grads.filter((g) => { const t = new Date(g.date).getTime(); return t >= cutTimeR && t <= endT; });
  const dateLabel = inWinGrad.length ? inWinGrad[inWinGrad.length - 1].date : (grads[grads.length - 1]?.date ?? null);
  return {
    market: "RC", label: "Robusta · ICE Futures Europe (RC)",
    unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports, cohortMatched,
    inOutBasis: cohortMatched ? "ageing" : "none",
    intake: { pending: pendingTotal, passed: pPrem + pBord, failed: fail,
              passedPremium: pPrem, passedBorderline: pBord, date: dateLabel },
  };
}
