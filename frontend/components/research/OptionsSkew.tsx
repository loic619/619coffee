"use client";
// The 25-delta risk reversal — Research D of the options program. The call/put
// wing spread reconstructed from stored per-strike IVs via Black-76 deltas,
// its frost-calendar seasonality, the Uganda drought alignment, and the IPHM
// alert ledger that accumulates the lead/lag event study going forward.
// Data: options_skew.json (backend/scraper/exporters/options_skew.py).
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
  CartesianGrid, Legend,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import { H2, P, UL, LI, Code, Highlight, RefTable } from "./methodology/prose";

interface SeriesPt {
  date: string; u: string; dte: number; px: number;
  c25: number; p25: number; atm: number | null; rr: number;
}
interface Summary {
  n: number; start: string; end: string; mean: number; median: number;
  share_pos: number; ar1: number; min: number; max: number;
}
interface WingSplit { n: number; c_minus_atm: number; p_minus_atm: number }
interface RetTest { h: number; n: number; r: number; n_blocks: number; r_blocks: number; t_blocks: number | null }
interface Season { year: number; n: number; mean: number; max: number; snaps: number }
interface Episode { date: string; coldmin: number; rr_on: number | null; rr_session: string | null }
interface Frost {
  threshold: number; pctile: number; n_hist_days: number;
  calibration: { date: string; coldmin: number; captured: boolean }[];
  episodes: Episode[];
  fw_mean: number; rest_mean: number; seasons: Season[];
  leadlag: {
    n: number; level_coming7: number; level_past7: number;
    change_coming7: { r: number; t: number }; change_past7: { r: number; t: number };
  };
}
interface Uganda {
  vhi: { week: string; vhi: number }[];
  rc_weekly: { week: string; rr: number }[];
  onsets: Record<string, string>;
}
interface Now {
  date: string; u: string; dte: number; rr: number; c25: number; p25: number;
  pctile: number; n: number;
}
interface Market {
  series: SeriesPt[]; summary: Summary; monthly: { month: string; n: number; mean: number }[];
  wings: Record<"frost" | "rest", WingSplit>; ret_test: RetTest[]; now: Now;
  frost?: Frost; uganda?: Uganda;
}
interface Doc {
  generated_at: string; method: Record<string, string | number>;
  ledger: { n_days: number; latest_date: string | null; latest: Record<string, Record<string, string>> };
  markets: { arabica: Market; robusta: Market };
}

const RR = "#8b5cf6", CALL = "#0284c7", PUT = "#059669";
const pt = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);
const ord = (v?: number | null) => {
  if (v == null) return "—";
  const n = Math.round(v), m = n % 100;
  const suf = m >= 11 && m <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suf}`;
};
const tipStyle = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };

function bandEdges(dates: string[], from: string, to: string): [string, string] | null {
  const inside = dates.filter(x => x >= from && x <= to);
  return inside.length >= 2 ? [inside[0], inside[inside.length - 1]] : null;
}

export default function OptionsSkew() {
  const [d, setD] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<Doc>("/data/options_skew.json")
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);

  const kc = d?.markets?.arabica, rc = d?.markets?.robusta;

  // KC chart: the continuous era only (the sparse early sessions would draw a
  // misleading months-long bridge across the gap).
  const kcChart = useMemo(() => (kc?.series ?? []).filter(x => x.date >= "2025-06-01"), [kc]);
  const kcWings = useMemo(
    () => kcChart.filter(x => x.atm != null).map(x => ({
      date: x.date, call: +(x.c25 - (x.atm as number)).toFixed(2), put: +(x.p25 - (x.atm as number)).toFixed(2),
    })),
    [kcChart]);
  const rcChart = useMemo(() => (rc?.series ?? []).filter(x => x.date >= "2026-05-01"), [rc]);
  const kcDates = useMemo(() => kcChart.map(x => x.date), [kcChart]);
  const band25 = useMemo(() => bandEdges(kcDates, "2025-06-01", "2025-08-31"), [kcDates]);
  const band26 = useMemo(() => bandEdges(kcDates, "2026-06-01", "2026-08-31"), [kcDates]);

  if (missing) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
      options_skew.json not published yet — run the exporter.
    </div>;
  }
  if (!d || !kc || !rc) {
    return <div className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">Loading…</div>;
  }

  const f = kc.frost, ug = rc.uganda;
  const snap = f?.episodes.find(e => e.rr_on != null);
  const season26 = f?.seasons.find(s => s.year === 2026);
  const season25 = f?.seasons.find(s => s.year === 2025);
  const ratio = f ? (f.fw_mean / f.rest_mean) : null;
  const ledgerRows = Object.entries(d.ledger.latest).map(([origin, fams]) =>
    [origin, Object.entries(fams).map(([fam, sev]) => `${fam.replace(/_/g, " ")} (${sev})`).join(", ")]);

  return (
    <div className="max-w-3xl">
      <P>
        <strong>Abstract.</strong> The 25-delta risk reversal — call-wing IV minus put-wing IV — is the market&rsquo;s
        price for <em>directional</em> tail risk, the thing the ATM strike cannot express. Equity skew is famously
        put-side; coffee is the mirror image. Across {kc.summary.n} KC sessions the risk reversal averaged
        {" "}<strong>{pt(kc.summary.mean)} vol points and sat call-over-put on {kc.summary.share_pos}% of days</strong> —
        the upside tail is the one that costs extra. The premium lives on the frost calendar: Jun–Aug it runs
        {" "}<strong>{pt(f?.fw_mean)} vs {pt(f?.rest_mean)} the rest of the year</strong> ({ratio?.toFixed(1)}×), each
        season independently, and the steepening is <em>entirely the call wing</em> ({pt(kc.wings.frost.c_minus_atm)} over
        ATM in season while the put wing sits at {pt(kc.wings.frost.p_minus_atm)}). Robusta&rsquo;s skew, by contrast,
        {" "}<strong>flips sign with the supply cycle</strong> — {pt(-3.02)} through December 2025&rsquo;s record-crop
        pricing, {pt(3.27)} by July 2026 as Uganda&rsquo;s drought built. Skew levels do not predict returns (all
        |r| &lt; 0.1, n.s.) — this is insurance pricing, not informed flow. Today both markets sit high:
        {" "}<strong>KC at the {ord(kc.now.pctile)} percentile, RC at the {ord(rc.now.pctile)}</strong>.
      </P>

      <H2>1 · Construction, and where the series can honestly start</H2>
      <UL>
        <LI><strong>Deltas are computed, not copied.</strong> The vendor&rsquo;s delta column is populated for recent
          sessions only, so every delta here is Black-76 from the <em>stored per-strike IVs</em>
          (<Code>{"Δcall = N(d1)"}</Code>, <Code>{"d1 = [ln(F/K) + σ²T/2]/(σ√T)"}</Code>) — one convention across the
          whole archive.</LI>
        <LI><strong>The wing read</strong>: IV at |Δ| = 0.25 per side, linearly interpolated in delta space between
          the bracketing strikes; a wing is void when no bracket exists or the bracketing deltas sit &gt;0.25 apart.
          Board: the nearest tracked with dte ≥ 7 (expiry-week wings are noise). <Code>RR25 = IV(25Δ call) −
          IV(25Δ put)</Code>, vol points, positive = calls dearer.</LI>
        <LI><strong>Scope honesty</strong>: through 2024-25 the tracked boards were far-dated (500–900 dte) and their
          listed strike ladders never reach a 25Δ call — the same scope note as the gamma-map and VRP papers. The
          continuous daily series therefore starts <strong>2025-07 for KC and 2025-12 for RC</strong>; earlier
          sessions with reachable wings are kept in the statistics but not bridged on the charts.</LI>
      </UL>

      <H2>2 · The structural result — coffee skew is call-side, and it&rsquo;s the call wing</H2>
      <RefTable head={["", "KC arabica", "RC robusta"]} rows={[
        ["Window", `${kc.summary.start} → ${kc.summary.end}`, `${rc.summary.start} → ${rc.summary.end}`],
        ["Sessions", `${kc.summary.n}`, `${rc.summary.n}`],
        ["Mean RR25 (median)", `${pt(kc.summary.mean)} (${pt(kc.summary.median)})`, `${pt(rc.summary.mean)} (${pt(rc.summary.median)})`],
        ["Days calls > puts", `${kc.summary.share_pos}%`, `${rc.summary.share_pos}%`],
        ["Range", `${pt(kc.summary.min)} … ${pt(kc.summary.max)}`, `${pt(rc.summary.min)} … ${pt(rc.summary.max)}`],
        ["Persistence (AR1)", `${kc.summary.ar1}`, `${rc.summary.ar1}`],
      ]} />
      <UL>
        <LI><strong>KC never truly flips.</strong> {kc.summary.share_pos}% of sessions call-over-put and a floor of
          just {pt(kc.summary.min)} — even at the bottom of the 2025-26 collapse the market would not price the
          downside tail above the upside one. The supply-shock asymmetry is structural.</LI>
        <LI><strong>The premium is bought upside, not sold downside.</strong> Anchored to ATM, the KC call wing runs
          {" "}{pt(kc.wings.frost.c_minus_atm)} in frost season vs {pt(kc.wings.rest.c_minus_atm)} outside, while the
          put wing goes from {pt(kc.wings.rest.p_minus_atm)} to {pt(kc.wings.frost.p_minus_atm)} — the seasonal
          steepening is call-wing demand, with puts actually cheapening to flat against ATM.</LI>
        <LI><strong>RC is the cyclical one</strong>: {rc.summary.share_pos}% positive overall, but monthly means swing
          from {pt(-3.02)} (Dec 2025, record crop being priced) to {pt(3.27)} (Jul 2026, drought) — robusta&rsquo;s
          wings track the supply cycle in a way KC&rsquo;s calendar-locked skew does not.</LI>
      </UL>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">KC risk reversal, daily — the frost calendar is visible from space</h4>
        <div style={{ height: 195 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={kcChart} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
                label={{ value: "vol pts", fontSize: 9, fill: "#64748b", angle: -90, position: "insideLeft", dx: 14 }} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v) => [`${pt(Number(v))} pts`, "RR25"]} />
              {band25 && <ReferenceArea x1={band25[0]} x2={band25[1]} fill="#334155" fillOpacity={0.35}
                label={{ value: "frost season", fontSize: 9, fill: "#64748b", position: "insideTopLeft" }} />}
              {band26 && <ReferenceArea x1={band26[0]} x2={band26[1]} fill="#334155" fillOpacity={0.35}
                label={{ value: "frost season", fontSize: 9, fill: "#64748b", position: "insideTopLeft" }} />}
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="rr" stroke={RR} dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          Shaded bands are Jun–Aug. The line lifts into each band and decays out of it — season {season25?.year} peaked
          at {pt(season25?.max)}, season {season26?.year} at {pt(season26?.max)}.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">The wings vs their own ATM — where the premium lives</h4>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={kcWings} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={48} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`} />
              <Tooltip contentStyle={tipStyle}
                formatter={(v, n) => [`${pt(Number(v))} pts`, n === "call" ? "25Δ call − ATM" : "25Δ put − ATM"]} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line dataKey="call" stroke={CALL} dot={false} strokeWidth={1.6} name="call" />
              <Line dataKey="put" stroke={PUT} dot={false} strokeWidth={1.4} name="put" />
              <Legend verticalAlign="bottom" height={20} iconSize={8}
                formatter={(n: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{n === "call" ? "25Δ call − ATM" : "25Δ put − ATM"}</span>} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The call wing does the moving; the put wing hugs its ATM. A symmetric smile would show both lines rising
          together — that is not what frost season looks like.
        </p>
      </div>

      <H2>3 · The frost calendar — priced as a window, not as weather</H2>
      <RefTable head={["Season (Jun–Aug)", "Sessions", "Mean RR25", "Max", "Realized belt cold snaps"]} rows={
        (f?.seasons ?? []).map(s => [`${s.year}`, `${s.n}`, `${pt(s.mean)}`, `${pt(s.max)}`, `${s.snaps}`])
      } />
      <P>
        Two seasons, nearly identical premiums ({pt(season25?.mean)} and {pt(season26?.mean)}) — with <strong>opposite
        weather</strong>. A &ldquo;cold snap&rdquo; here is a belt-minimum region tmean at or below
        {" "}{f?.threshold} °C, the {f?.pctile}th percentile of {f?.n_hist_days?.toLocaleString()} winter days since
        1995 — a threshold that captures both 2021 frost-disaster dates ({f?.calibration.map(c => `${c.date}: ${c.coldmin} °C`).join("; ")}).
        Season 2025 delivered two such snaps; <strong>season 2026 has delivered none, and the market charged the same
        premium anyway</strong>. The wings price the <em>window</em> in which frost is possible, not the cold that
        actually arrives.
      </P>
      {snap && (
        <P>
          The one snap the daily series caught: <strong>{snap.date}</strong> (belt minimum {snap.coldmin} °C). The
          risk reversal printed <strong>{pt(snap.rr_on)}</strong> that session — the 2025 season&rsquo;s maximum,
          on the day. And the counter-case is May 2026: a −6 °C <em>anomaly</em> week (cold for May, but an absolute
          14 °C — no frost threat) drew a skew response of essentially nothing. The market watches absolute frost
          proximity on the calendar, exactly as the damage physics say it should.
        </P>
      )}

      <H2>4 · Does skew lead realized cold? Two winters can&rsquo;t say</H2>
      <UL>
        <LI>Against day-of-year cold <em>anomalies</em> (the level test is calendar-confounded and reported only for
          completeness): daily <em>changes</em> in RR25 vs the coming 7 days&rsquo; cold run r =
          {" "}{f?.leadlag.change_coming7.r} (t {f?.leadlag.change_coming7.t}); vs the past 7 days&rsquo; r =
          {" "}{f?.leadlag.change_past7.r} (t {f?.leadlag.change_past7.t}). <strong>Neither direction clears
          significance</strong> on {f?.leadlag.n} winter sessions.</LI>
        <LI>That is an honest &ldquo;underpowered&rdquo;, not a &ldquo;no&rdquo;: the series contains two winters and
          exactly one belt-wide snap. The question this paper actually wants — does skew steepen <em>before our own
          alerts fire</em> — is what the ledger below accumulates toward.</LI>
      </UL>

      <H2>5 · Robusta — the drought trade, watched in real time</H2>
      <P>
        Uganda&rsquo;s canopy read (weekly NOAA VHI, worst of Masaka/Kasese/Mbale) slid from {ug?.vhi[0]?.vhi} in
        late May to a floor of {Math.min(...(ug?.vhi ?? []).map(v => v.vhi)).toFixed(1)} — through the IPHM drought
        ladder&rsquo;s watch, alert and critical gates. RC&rsquo;s risk reversal climbed with it: monthly mean
        {" "}{pt(1.78)} (May) → {pt(3.27)} (Jul). When the engine published Uganda&rsquo;s ladder on
        {" "}<strong>{ug?.onsets.critical ?? ug?.onsets.alert ?? "—"}</strong> — alert and critical tiers together,
        the critical having cleared its 10-day persistence gate — the skew was <em>already</em> at {pt(2.67)}: the
        wings and the alert engine were reading the same satellite, on the same delay. What followed is a caution
        against over-reading single episodes: the skew faded to {pt(0.68)} by 08-11, then repriced to {pt(3.65)} on
        08-12 — six days after the critical print, into RMU26 expiry week, with the VHI actually ticking up off its
        floor. One episode cannot separate satellite-driven wing demand from expiry positioning; that separation is
        what the ledger below will eventually afford.
      </P>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">Uganda VHI, weekly — the drought builds</h4>
        <div style={{ height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ug?.vhi ?? []} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={24} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40} domain={[0, 50]} />
              <Tooltip contentStyle={tipStyle} formatter={(v) => [`${v}`, "VHI (worst province)"]} />
              <ReferenceLine y={35} stroke="#475569" strokeDasharray="4 3"
                label={{ value: "critical gate 35", fontSize: 9, fill: "#64748b", position: "insideBottomRight" }} />
              <Line dataKey="vhi" stroke={CALL} dot={{ r: 2 }} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 my-3">
        <h4 className="text-xs font-bold text-slate-100 mb-1">RC risk reversal, daily, with the published alert onsets</h4>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rcChart} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={40} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`} />
              <Tooltip contentStyle={tipStyle} formatter={(v) => [`${pt(Number(v))} pts`, "RR25"]} />
              <ReferenceLine y={0} stroke="#475569" />
              {ug?.onsets.alert && <ReferenceLine x={ug.onsets.alert} stroke="#94a3b8" strokeDasharray="4 3"
                label={{ value: "ladder published", fontSize: 9, fill: "#94a3b8", position: "left", dy: -55 }} />}
              {ug?.onsets.critical && ug.onsets.critical !== ug.onsets.alert &&
                <ReferenceLine x={ug.onsets.critical} stroke="#94a3b8" strokeDasharray="4 3"
                  label={{ value: "critical", fontSize: 9, fill: "#94a3b8", position: "insideTopRight" }} />}
              <Line dataKey="rr" stroke={RR} dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 italic mt-1">
          The dashed vertical is the IPHM engine&rsquo;s first-published date for Uganda&rsquo;s drought ladder
          (alert + critical together). The skew was already elevated at publication, faded, then repriced hard six
          days later into expiry week — see the text for why that ordering resists a causal read.
        </p>
      </div>

      <H2>6 · Skew is insurance pricing, not a return forecast</H2>
      <RefTable head={["Market", "Horizon", "corr(RR25, fwd return)", "Non-overlapping r (t)"]} rows={[
        ...kc.ret_test.map(r => ["KC", `${r.h} sessions`, `${r.r}`, `${r.r_blocks} (t ${r.t_blocks})`]),
        ...rc.ret_test.map(r => ["RC", `${r.h} sessions`, `${r.r}`, `${r.r_blocks} (t ${r.t_blocks})`]),
      ]} />
      <P>
        Dead flat, every specification. A steep risk reversal has told you nothing about the next two weeks&rsquo;
        return — consistent with the VRP paper&rsquo;s finding that coffee options are priced roughly fair on
        average. The wings encode <em>state</em> (what season it is, what the satellite says), not <em>direction</em>.
      </P>

      <H2>7 · The current read</H2>
      <RefTable head={["Market", "As of", "Board", "25Δ call", "25Δ put", "RR25", "Percentile"]} rows={[
        ["KC", kc.now.date, `${kc.now.u} (${kc.now.dte}d)`, `${kc.now.c25}%`, `${kc.now.p25}%`, `${pt(kc.now.rr)} pts`, `${ord(kc.now.pctile)} of ${kc.now.n}`],
        ["RC", rc.now.date, `${rc.now.u} (${rc.now.dte}d)`, `${rc.now.c25}%`, `${rc.now.p25}%`, `${pt(rc.now.rr)} pts`, `${ord(rc.now.pctile)} of ${rc.now.n}`],
      ]} />
      <Highlight>
        Both wings are bid at once — KC at the {ord(kc.now.pctile)} percentile of its history in the heart of frost
        season, RC at the {ord(rc.now.pctile)} on a live critical drought. Read with the VRP card&rsquo;s
        99th-percentile IV-over-realized spread, the options market is currently paying up for <em>both</em> the
        level of volatility and its upside direction. That is a lot of priced fear; the ledger will record whether
        the weather validates it.
      </Highlight>

      <H2>8 · The alert ledger — the event study this paper couldn&rsquo;t run yet</H2>
      <P>
        From today, every export appends one line to <Code>iphm_alert_ledger.json</Code>: the active IPHM alert
        families per origin at max severity. Entry #{d.ledger.n_days} ({d.ledger.latest_date}):
      </P>
      <RefTable head={["Origin", "Active alert families"]} rows={ledgerRows} />
      <P>
        Once a few dozen onsets accumulate, the question this paper is really after — does the market&rsquo;s skew
        move <em>before</em> our alert engine publishes, and by how many sessions — becomes a properly powered event
        study instead of one Uganda anecdote. Same accumulation pattern as the expiry ledger and the life-matched
        VRP series.
      </P>

      <H2>9 · Limits</H2>
      <UL>
        <LI><strong>The cold-snap proxy is tmean, not Tmin.</strong> The daily weather seed stores region mean
          temperature; frost is a minimum-temperature event. The p{f?.pctile} belt-min threshold captures the 2021
          disasters, but marginal radiative frosts on dry nights can hide inside a mild daily mean (ERA5 Tmin
          backfill is not reachable from this environment).</LI>
        <LI><strong>Two winters.</strong> Every seasonal statistic rests on 2025 and 2026; the lead/lag tests are
          honest n.s., not established negatives.</LI>
        <LI><strong>Wing IVs inherit settlement noise</strong> on illiquid strikes, and the 25Δ point is an
          interpolation — the bracket-gap guard (≤0.25 in delta space) drops thin ladders rather than fabricating a
          wing.</LI>
        <LI><strong>The VHI panel is 12 weeks deep</strong> — the published feed keeps a recent window only. The
          ledger fixes this class of problem going forward by recording state daily.</LI>
        <LI>The dte ≥ 7 floor rolls the board mid-month near expiries; the Uganda spike was checked across the roll
          (it prints on both RMU26 and RMX26) but level comparisons across a roll date carry that caveat.</LI>
      </UL>

      <H2>Sources &amp; method</H2>
      <P>
        Boards archive (565 sessions, per-strike IV); Black-76 deltas from stored IVs, uniform across the archive;
        daily weather seed 1995→present (region tmean); weekly NOAA STAR VHI; IPHM alert engine state
        (first-seen dates). Statistics recomputed on every export from <Code>options_skew.json</Code>.
      </P>
    </div>
  );
}
