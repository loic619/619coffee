"use client";
// World coffee balance sheet — an accounting-style statement of where the
// crop comes from and where it goes, in million 60-kg bags, split three
// ways (arabica washed / arabica natural / robusta).
//
// Two kinds of line, deliberately:
//   · Production is DERIVED from the same per-origin crop-estimate seeds
//     the by-source editor writes, so the world view can never disagree
//     with an origin tab. It is read-only here; edit it in the ✎ editor.
//   · Everything else — carry-in, consumption by hub, transit, carry-out —
//     has no upstream feed, so it lives in world_balance_sheet.json and is
//     editable in place (admin password, same write path as crop estimates).
//
// The statement balances by construction: Total supply − Total demand is
// shown as the residual, which is the number an analyst actually reads.
import { useEffect, useMemo, useState } from "react";
import WorldBalanceEditor from "./WorldBalanceEditor";
import {
  LEGS, LEG_LABEL, LEG_TONE,
  addLegs, arabicaAll, emptyLegs, fmt, legTotal, r1,
  type Leg, type Legs, type Line, type Risk, type WorldBalanceDoc,
} from "@/lib/worldBalance";

interface SeedSeason {
  season: string;
  production?: Record<string, number>;
  production_split?: Record<string, Legs>;
  production_final?: number;
}

const ORIGIN_FILES: Record<string, { file: string; subkey?: string; label: string }> = {
  brazil:    { file: "br_balance_sheet.json",      label: "Brazil" },
  colombia:  { file: "co_balance_sheet.json",      label: "Colombia" },
  honduras:  { file: "hn_balance_sheet.json",      label: "Honduras" },
  guatemala: { file: "gt_balance_sheet.json",      label: "Guatemala" },
  nicaragua: { file: "ni_balance_sheet.json",      label: "Nicaragua" },
  costa_rica:{ file: "cr_balance_sheet.json",      label: "Costa Rica" },
  mexico:    { file: "mx_balance_sheet.json",      label: "Mexico" },
  peru:      { file: "pe_balance_sheet.json",      label: "Peru" },
  vietnam:   { file: "vn_farmer_economics.json", subkey: "balance_sheet", label: "Vietnam" },
  indonesia: { file: "id_balance_sheet.json",      label: "Indonesia" },
  india:     { file: "in_balance_sheet.json",      label: "India" },
  china:     { file: "cn_balance_sheet.json",      label: "China" },
  uganda:    { file: "ug_balance_sheet.json",      label: "Uganda" },
  ethiopia:  { file: "et_balance_sheet.json",      label: "Ethiopia" },
  ivory_coast:{ file: "ci_balance_sheet.json",     label: "Ivory Coast" },
  tanzania:  { file: "tz_balance_sheet.json",      label: "Tanzania" },
};
const GROUPS: { label: string; origins: string[] }[] = [
  { label: "Brazil",      origins: ["brazil"] },
  { label: "Colombia",    origins: ["colombia"] },
  { label: "MAG 6",       origins: ["honduras", "guatemala", "nicaragua", "costa_rica", "mexico", "peru"] },
  { label: "Asia",        origins: ["vietnam", "indonesia", "india", "china"] },
  { label: "Africa",      origins: ["uganda", "ethiopia", "ivory_coast", "tanzania"] },
];

export default function WorldBalanceSheet({ cropYear }: { cropYear?: string }) {
  /** Bumped by the editor after a successful save so the statement re-reads
   *  the file — the commit lands ~2 min later, so this is a nudge for the
   *  next visit rather than an instant refresh. */
  const [reload, setReload] = useState(0);
  const [doc, setDoc]   = useState<WorldBalanceDoc | null>(null);
  const [prod, setProd] = useState<Record<string, Record<Leg, number>> | null>(null);
  const [unsplitOrigins, setUnsplitOrigins] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/data/world_balance_sheet.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: WorldBalanceDoc | null) => d ? setDoc(d) : setFailed(true))
      .catch(() => setFailed(true));
  }, [reload]);

  const season = cropYear ?? doc?.crop_year;

  // Derive production per origin for the statement's crop year, using the
  // analyst Final when set, else the mean of the sources — the same
  // precedence the per-origin S&D card displays.
  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    Promise.all(Object.entries(ORIGIN_FILES).map(async ([o, cfg]) => {
      try {
        const r = await fetch(`/data/${cfg.file}`);
        if (!r.ok) return [o, null, false] as const;
        const raw = await r.json();
        const seed = cfg.subkey ? raw?.[cfg.subkey] : raw;
        const s: SeedSeason | undefined = (seed?.seasons ?? []).find(
          (x: SeedSeason) => x.season === season);
        if (!s) return [o, null, false] as const;
        const splits = Object.values(s.production_split ?? {});
        const legs = emptyLegs();
        let usedLegacy = false;
        if (splits.length) {
          // Mean across the sources that published a split.
          const acc = emptyLegs();
          for (const sp of splits) {
            addLegs(acc, sp);
            if (sp.arabica != null) usedLegacy = true;
          }
          legs.arabica_washed  = acc.arabica_washed  / splits.length;
          legs.arabica_natural = acc.arabica_natural / splits.length;
          legs.robusta         = acc.robusta         / splits.length;
        }
        // Scale the split to the headline figure so the origin's world-view
        // contribution matches what its own tab displays.
        const vals = Object.values(s.production ?? {});
        const headline = s.production_final
          ?? (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
        const splitTotal = legTotal(legs);
        if (splitTotal > 0 && headline > 0) {
          const k = headline / splitTotal;
          legs.arabica_washed  = r1(legs.arabica_washed  * k);
          legs.arabica_natural = r1(legs.arabica_natural * k);
          legs.robusta         = r1(legs.robusta         * k);
        }
        return [o, legs, usedLegacy] as const;
      } catch { return [o, null, false] as const; }
    })).then(pairs => {
      if (cancelled) return;
      const out: Record<string, Record<Leg, number>> = {};
      const legacy: string[] = [];
      for (const [o, legs, usedLegacy] of pairs) {
        if (legs) out[o] = legs;
        if (usedLegacy) legacy.push(ORIGIN_FILES[o].label);
      }
      setProd(out);
      setUnsplitOrigins(legacy);
    });
    return () => { cancelled = true; };
  }, [season]);

  const sums = useMemo(() => {
    const sumLines = (ls: Line[] | undefined) =>
      (ls ?? []).reduce((acc, l) => addLegs(acc, l), emptyLegs());
    const production = Object.values(prod ?? {}).reduce(
      (acc, l) => addLegs(acc, l), emptyLegs());
    const carryIn  = sumLines(doc?.carry_in);
    const demand   = sumLines(doc?.demand_hubs);
    const carryOut = sumLines(doc?.carry_out);
    const supply = addLegs(addLegs(emptyLegs(), production), carryIn);
    const totalDemand = addLegs(addLegs(emptyLegs(), demand), carryOut);
    const residual = emptyLegs();
    for (const l of LEGS) residual[l] = r1(supply[l] - totalDemand[l]);
    return { production, carryIn, demand, carryOut, supply, totalDemand, residual };
  }, [prod, doc]);

  if (failed) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-[10px] text-slate-500">
        World balance sheet unavailable (world_balance_sheet.json).
      </div>
    );
  }
  // Columns actually shown: drop the legacy arabica column once every
  // origin (and every hand-entered line) has been restated.
  const legacyInUse =
    Object.values(prod ?? {}).some(l => (l.arabica ?? 0) > 0) ||
    [...(doc?.carry_in ?? []), ...(doc?.demand_hubs ?? []), ...(doc?.carry_out ?? [])]
      .some(l => (l.arabica ?? 0) > 0);
  const cols: readonly Leg[] = legacyInUse ? LEGS : LEGS.filter(l => l !== "arabica");
  if (!doc || !prod) {
    return <div className="text-xs text-slate-500 animate-pulse py-8 text-center">Loading balance sheet…</div>;
  }

  const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
  const th = "text-right py-1 px-2 font-medium";

  /** One statement row: label + three legs + total. */
  const Row = ({ label, legs, tone = "text-slate-300", bold, indent, title }: {
    label: string; legs: Record<Leg, number> | Legs;
    tone?: string; bold?: boolean; indent?: boolean; title?: string;
  }) => {
    const full = addLegs(emptyLegs(), legs);
    const tot = legTotal(full);
    return (
      <tr className={bold ? "border-t border-slate-600" : "border-t border-slate-800/60"} title={title}>
        <td className={`py-1 pr-2 ${indent ? "pl-4" : ""} ${bold ? "font-bold" : ""} ${tone} whitespace-nowrap`}>
          {label}
        </td>
        {cols.filter(l => l !== "robusta").map(l => (
          <td key={l} className={`py-1 px-2 text-right font-mono ${bold ? "font-bold" : ""} ${tone}`}>
            {fmt(full[l])}
          </td>
        ))}
        <td className={`py-1 px-2 text-right font-mono ${bold ? "font-bold" : ""} text-amber-500`}>
          {fmt(arabicaAll(full))}
        </td>
        <td className={`py-1 px-2 text-right font-mono ${bold ? "font-bold" : ""} ${tone}`}>
          {fmt(full.robusta)}
        </td>
        <td className={`py-1 pl-2 text-right font-mono font-bold ${tone}`}>{fmt(tot)}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            World balance sheet
            <span className="ml-2 text-slate-600 normal-case">
              · {doc.crop_year} · {doc.unit}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-slate-600">updated {doc.updated}</span>
            <WorldBalanceEditor production={sums.production} onSaved={() => setReload(n => n + 1)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1 pr-2 font-medium">Line</th>
                {cols.filter(l => l !== "robusta").map(l => (
                  <th key={l} className={`${th} ${LEG_TONE[l]}`}>{LEG_LABEL[l]}</th>
                ))}
                <th className={`${th} text-amber-500`}>Arabica (all)</th>
                <th className={`${th} ${LEG_TONE.robusta}`}>{LEG_LABEL.robusta}</th>
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {/* ── SUPPLY ─────────────────────────────────────────── */}
              <tr className="border-t-2 border-slate-500/50">
                <td colSpan={cols.length + 3} className="pt-2 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-emerald-500">
                  Supply
                </td>
              </tr>
              {doc.carry_in.map(l => (
                <Row key={l.key} label={l.label} legs={l} indent tone="text-slate-400" />
              ))}
              <Row label="Carry-in stocks" legs={sums.carryIn} bold tone="text-slate-300" />

              <tr><td colSpan={cols.length + 3} className="pt-1.5 pb-0.5 pl-1 text-[8px] uppercase tracking-wider text-slate-600">
                Production (derived from crop estimates)
              </td></tr>
              {GROUPS.map(g => {
                const groupLegs = g.origins.reduce(
                  (acc, o) => addLegs(acc, prod[o] ?? {}), emptyLegs());
                return (
                  <Row key={g.label} label={g.label} legs={groupLegs} indent tone="text-slate-400"
                    title={g.origins.map(o => ORIGIN_FILES[o].label).join(", ")} />
                );
              })}
              <Row label="Total production" legs={sums.production} bold tone="text-slate-300" />
              <Row label="TOTAL SUPPLY" legs={sums.supply} bold tone="text-emerald-300" />

              {/* ── DEMAND ─────────────────────────────────────────── */}
              <tr className="border-t-2 border-slate-500/50">
                <td colSpan={cols.length + 3} className="pt-3 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-red-400">
                  Demand
                </td>
              </tr>
              {doc.demand_hubs.map(l => (
                <Row key={l.key} label={l.label} legs={l} indent tone="text-slate-400" />
              ))}
              <Row label="Total consumption" legs={sums.demand} bold tone="text-slate-300" />

              <tr><td colSpan={cols.length + 3} className="pt-1.5 pb-0.5 pl-1 text-[8px] uppercase tracking-wider text-slate-600">
                Carry-out
              </td></tr>
              {doc.carry_out.map(l => (
                <Row key={l.key} label={l.label} legs={l} indent tone="text-slate-400" />
              ))}
              <Row label="Total carry-out" legs={sums.carryOut} bold tone="text-slate-300" />
              <Row label="TOTAL DEMAND" legs={sums.totalDemand} bold tone="text-red-300" />

              {/* ── BALANCE ────────────────────────────────────────── */}
              <tr className="border-t-2 border-slate-500">
                <td className="py-1.5 pr-2 font-bold text-slate-200">Balance (supply − demand)</td>
                {cols.filter(l => l !== "robusta").map(l => (
                  // While any production is still unsplit, a per-process
                  // residual compares a washed/natural demand line against a
                  // supply line that has no process — structurally
                  // meaningless. Suppress it and let Arabica (all) carry the
                  // balance until the restating is done.
                  <td key={l} className={`py-1.5 px-2 text-right font-mono font-bold ${
                    legacyInUse ? "text-slate-700"
                      : sums.residual[l] >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    title={legacyInUse
                      ? "Not comparable while some production is unsplit — see Arabica (all)"
                      : undefined}>
                    {legacyInUse ? "–" : `${sums.residual[l] >= 0 ? "+" : ""}${fmt(sums.residual[l])}`}
                  </td>
                ))}
                <td className={`py-1.5 px-2 text-right font-mono font-bold ${
                  arabicaAll(sums.residual) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {arabicaAll(sums.residual) >= 0 ? "+" : ""}{fmt(arabicaAll(sums.residual))}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono font-bold ${
                  sums.residual.robusta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {sums.residual.robusta >= 0 ? "+" : ""}{fmt(sums.residual.robusta)}
                </td>
                <td className={`py-1.5 pl-2 text-right font-mono font-bold ${
                  legTotal(sums.residual) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {legTotal(sums.residual) >= 0 ? "+" : ""}{fmt(legTotal(sums.residual))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="text-[8px] text-slate-600 leading-relaxed">
          Production is derived from the per-origin crop estimates for {doc.crop_year} — the
          analyst Final where set, otherwise the mean of that origin&apos;s sources — and the
          crop split is scaled to that headline, so an origin&apos;s contribution here always
          matches its own tab. Edit production in the ✎ crop-estimate editor; the other
          lines are analyst-entered and editable from the button above.
          {unsplitOrigins.length > 0 && (
            <> <span className="text-amber-700/80">Ar. unsplit</span> holds arabica not yet
            restated as washed/natural — no process is guessed for it, since these origins
            span both ({unsplitOrigins.join(", ")}). Split them in the editor&apos;s by-source
            view and the column disappears.</>
          )}
          {" "}Arabica is stated by processing. Where a source publishes only a country
          total, the washed/natural cut comes from that origin&apos;s processing convention,
          recorded in the seed&apos;s <span className="text-slate-500">arabica_split_basis</span> —
          a source&apos;s own breakdown, or a hand edit, always wins over it.
          {" "}A non-zero balance is the statement&apos;s residual: it is not forced to zero,
          so it reads as the gap your assumptions imply.
        </div>
      </div>

      <RiskTable risks={doc.risks} />
    </div>
  );
}

// ── Risk & opportunity register ─────────────────────────────────────────────
function RiskTable({ risks }: { risks: Risk[] }) {
  const [sortBy, setSortBy] = useState<"expected" | "impact">("expected");
  const rows = useMemo(() => {
    const withExp = (risks ?? []).map(r => ({
      ...r, expected: r.impact_m_bags * (r.probability ?? 0),
    }));
    return withExp.sort((a, b) => sortBy === "expected"
      ? a.expected - b.expected
      : a.impact_m_bags - b.impact_m_bags);
  }, [risks, sortBy]);

  if (!rows.length) return null;
  const downside = rows.filter(r => r.impact_m_bags < 0);
  const upside   = rows.filter(r => r.impact_m_bags > 0);
  const sumExp = (rs: typeof rows) => r1(rs.reduce((s, r) => s + r.expected, 0));

  const cropLabel = (c: string) =>
    c === "arabica_washed" ? "Ar. washed"
      : c === "arabica_natural" ? "Ar. natural"
      : c === "robusta" ? "Robusta" : c;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Risk &amp; Opps
          <span className="ml-2 text-slate-600 normal-case">
            · what could move the crop, in million bags
          </span>
        </div>
        <div className="inline-flex rounded border border-slate-700 overflow-hidden">
          {(["expected", "impact"] as const).map(k => (
            <button key={k} onClick={() => setSortBy(k)}
              className={`text-[9px] px-2 py-0.5 transition-colors ${
                sortBy === k ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
              title={k === "expected" ? "Rank by probability-weighted impact" : "Rank by gross impact"}>
              {k === "expected" ? "Expected" : "Gross"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2 font-medium">Driver</th>
              <th className="text-left py-1 pr-2 font-medium">Origin</th>
              <th className="text-left py-1 pr-2 font-medium">Crop</th>
              <th className="text-right py-1 px-2 font-medium">Impact</th>
              <th className="text-right py-1 px-2 font-medium">Prob.</th>
              <th className="text-right py-1 pl-2 font-medium">Expected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-slate-800/60" title={r.note}>
                <td className="py-1 pr-2 text-slate-300 whitespace-nowrap">{r.driver}</td>
                <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{r.origin}</td>
                <td className={`py-1 pr-2 whitespace-nowrap ${
                  r.crop === "robusta" ? "text-emerald-400"
                    : r.crop === "arabica_washed" ? "text-amber-300" : "text-orange-400"}`}>
                  {cropLabel(r.crop)}
                </td>
                <td className={`py-1 px-2 text-right font-mono ${
                  r.impact_m_bags < 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {r.impact_m_bags > 0 ? "+" : ""}{r.impact_m_bags.toFixed(1)}
                </td>
                <td className="py-1 px-2 text-right font-mono text-slate-400">
                  {Math.round((r.probability ?? 0) * 100)}%
                </td>
                <td className={`py-1 pl-2 text-right font-mono font-bold ${
                  r.expected < 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {r.expected > 0 ? "+" : ""}{r1(r.expected).toFixed(2)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-600">
              <td className="py-1 pr-2 font-bold text-red-300" colSpan={5}>
                Downside — expected ({downside.length} risks)
              </td>
              <td className="py-1 pl-2 text-right font-mono font-bold text-red-400">
                {sumExp(downside).toFixed(2)}
              </td>
            </tr>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 font-bold text-emerald-300" colSpan={5}>
                Upside — expected ({upside.length} opportunities)
              </td>
              <td className="py-1 pl-2 text-right font-mono font-bold text-emerald-400">
                +{sumExp(upside).toFixed(2)}
              </td>
            </tr>
            <tr className="border-t border-slate-600">
              <td className="py-1 pr-2 font-bold text-slate-200" colSpan={5}>Net expected</td>
              <td className={`py-1 pl-2 text-right font-mono font-bold ${
                sumExp(rows) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {sumExp(rows) >= 0 ? "+" : ""}{sumExp(rows).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-[8px] text-slate-600 leading-relaxed">
        Expected = impact × probability, so a large-but-unlikely event and a
        small-but-likely one are comparable on one scale. These are scenario
        weights on top of the balance sheet above, not part of it — the balance
        does not move until an event is written into the estimates. Hover a row
        for the reasoning.
      </div>
    </div>
  );
}
