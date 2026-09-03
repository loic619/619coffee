"use client";
// World coffee balance sheet — an accounting-style statement of where the
// crop comes from and where it goes, in million 60-kg bags.
//
// Three levels of depth, all collapsible:
//   · Columns — Arabica as one column, or ungrouped into washed / natural
//     (plus the legacy unsplit leg while anything still uses it) with
//     "Arabica (all)" carrying the subtotal.
//   · Rows, supply — region group → origin → that origin's quality grades,
//     in the origin's OWN vocabulary (Honduras SHG/HG/Standard, Vietnam
//     G1/G2/G3, Brazil fine cup/GC/Rio). Nothing is harmonised across
//     origins, so a grade row is only ever summed inside its own origin.
//   · Rows, demand — hub → channel → the form it is sold in (retail ground,
//     beans, pads, capsules, RTD, instant pure, instant mixes; coffee shop).
//
// Two kinds of line, deliberately:
//   · Production is DERIVED from the same per-origin crop-estimate seeds
//     the by-source editor writes, so the world view can never disagree
//     with an origin tab. It is read-only here; edit it in the ✎ editor.
//   · Everything else — carry-in, consumption by hub, transit, carry-out —
//     has no upstream feed, so it lives in world_balance_sheet.json and is
//     editable in place (admin password, same write path as crop estimates).
//
// Grades and segments are stored as shares of their parent leg and split
// with a largest-remainder allocator, so a reader can add a column of
// children and land on the subtotal exactly.
import { chgTone } from "@/lib/formatters";
import { useEffect, useMemo, useState } from "react";
import WorldBalanceEditor from "./WorldBalanceEditor";
import {
  LEGS, LEG_LABEL, LEG_TONE, allocate,
  addLegs, arabicaAll, emptyLegs, fmt, legTotal, r1,
  ORIGIN_FILES,
  type ConsumptionSource, type DemandSegmentsDoc, type GradeRow, type Leg, type Legs,
  type Line, type OriginGradesDoc, type Risk, type WorldBalanceDoc,
  type WorldConsumptionDoc,
} from "@/lib/worldBalance";

/** Just the slice of ccs_sd.json this component needs. */
interface CcsDoc {
  seasons: string[];
  production: Record<"total" | "robusta" | "arabica", Record<string, number[]>>;
}

interface SeedSeason {
  season: string;
  production?: Record<string, number>;
  production_split?: Record<string, Legs>;
  production_final?: number;
}

const GROUPS: { label: string; origins: string[] }[] = [
  { label: "Brazil",      origins: ["brazil"] },
  { label: "Colombia",    origins: ["colombia"] },
  { label: "MAG 6",       origins: ["honduras", "guatemala", "nicaragua", "costa_rica", "mexico", "peru"] },
  { label: "Asia",        origins: ["vietnam", "indonesia", "india", "china"] },
  { label: "Africa",      origins: ["uganda", "ethiopia", "ivory_coast", "tanzania"] },
];

/** One line of the statement. A row with children is collapsible; its own
 *  numbers are the parent total, never the sum of what is rendered below it,
 *  so collapsing never changes what the statement says. */
interface StmtRow {
  key: string;
  label: string;
  legs: Record<Leg, number>;
  children?: StmtRow[];
  tone?: string;
  title?: string;
  /** Subtotal / total line — heavier rule and bold figures. */
  bold?: boolean;
  /** Tints a grade row with the leg it belongs to. */
  leg?: Leg;
}

interface ColDef {
  key: string; label: string; tone: string;
  value: (l: Record<Leg, number>) => number;
}

const legOnly = (leg: Leg, v: number): Record<Leg, number> => {
  const l = emptyLegs();
  l[leg] = v;
  return l;
};

/** An origin's grades, in its own vocabulary. Legs with volume but no ladder
 *  get one honest "ungraded" row rather than being silently dropped. */
function gradeChildren(
  origin: string,
  legs: Record<Leg, number>,
  ladders: Partial<Record<Leg, GradeRow[]>> | undefined,
): StmtRow[] {
  const out: StmtRow[] = [];
  for (const leg of LEGS) {
    const v = legs[leg];
    if (!v) continue;
    const ladder = ladders?.[leg];
    if (!ladder?.length) {
      out.push({
        key: `${origin}:${leg}:ungraded`, leg,
        label: `${LEG_LABEL[leg]} — ungraded`,
        legs: legOnly(leg, v),
        title: "No grade ladder filed for this origin and leg yet",
      });
      continue;
    }
    const parts = allocate(v, ladder.map(g => g.share));
    ladder.forEach((g, i) => out.push({
      key: `${origin}:${leg}:${g.key}`, leg,
      label: g.label,
      legs: legOnly(leg, parts[i]),
      title: `${LEG_LABEL[leg]} · ${Math.round(g.share * 100)}% of the leg`,
    }));
  }
  return out;
}

/** A hub's consumption by the form it is sold in, grouped by channel. */
function segmentChildren(
  hubKey: string, legs: Record<Leg, number>, sd: DemandSegmentsDoc,
): StmtRow[] {
  const mix = sd.hub_mix?.[hubKey] ?? sd.default_mix;
  const perSeg: Record<string, Record<Leg, number>> = {};
  for (const s of sd.segments) perSeg[s.key] = emptyLegs();

  for (const leg of LEGS) {
    const v = legs[leg];
    if (!v) continue;
    const m = mix?.[leg] ?? sd.default_mix?.[leg];
    const shares = sd.segments.map(s => m?.[s.key] ?? 0);
    const tot = shares.reduce((a, b) => a + b, 0);
    // Renormalise rather than trust the file: a mix that does not quite sum
    // to 1 should stretch to the hub total, not leak volume out of the row.
    const parts = allocate(v, tot > 0 ? shares.map(s => s / tot) : shares);
    sd.segments.forEach((s, i) => { perSeg[s.key][leg] = parts[i]; });
  }

  return sd.channels.map(ch => {
    const kids = sd.segments.filter(s => s.channel === ch.key).map(s => ({
      key: `${hubKey}:seg:${s.key}`, label: s.label, legs: perSeg[s.key],
    }));
    const total = kids.reduce((acc, k) => addLegs(acc, k.legs), emptyLegs());
    // A one-segment channel (the coffee shop) is its own line — no expander
    // that reveals a single identical row.
    return kids.length === 1
      ? { key: `${hubKey}:ch:${ch.key}`, label: ch.label, legs: total }
      : { key: `${hubKey}:ch:${ch.key}`, label: ch.label, legs: total, children: kids };
  });
}

function collectKeys(rows: StmtRow[], into: string[] = []): string[] {
  for (const r of rows) {
    if (r.children?.length) { into.push(r.key); collectKeys(r.children, into); }
  }
  return into;
}

export default function WorldBalanceSheet({ cropYear }: { cropYear?: string }) {
  /** Bumped by the editor after a successful save so the statement re-reads
   *  the file — the commit lands ~2 min later, so this is a nudge for the
   *  next visit rather than an instant refresh. */
  const [reload, setReload] = useState(0);
  const [doc, setDoc]   = useState<WorldBalanceDoc | null>(null);
  const [prod, setProd] = useState<Record<string, Record<Leg, number>> | null>(null);
  const [grades, setGrades] = useState<OriginGradesDoc | null>(null);
  const [segs, setSegs]     = useState<DemandSegmentsDoc | null>(null);
  const [cons, setCons]     = useState<WorldConsumptionDoc | null>(null);
  const [ccs, setCcs]       = useState<CcsDoc | null>(null);
  const [unsplitOrigins, setUnsplitOrigins] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [arabicaSplit, setArabicaSplit] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/data/world_balance_sheet.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: WorldBalanceDoc | null) => d ? setDoc(d) : setFailed(true))
      .catch(() => setFailed(true));
  }, [reload]);

  // The depth-3 files are optional: without them the statement still reads
  // exactly as before, just with nothing to expand into.
  useEffect(() => {
    fetch(`/data/origin_grades.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null)).then(setGrades).catch(() => {});
    fetch(`/data/demand_segments.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null)).then(setSegs).catch(() => {});
    fetch(`/data/world_consumption.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null)).then(setCons).catch(() => {});
    fetch(`/data/ccs_sd.json?t=${reload}`)
      .then(r => (r.ok ? r.json() : null)).then(setCcs).catch(() => {});
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
          legs.arabica         = acc.arabica         / splits.length;
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
          for (const l of LEGS) legs[l] = r1(legs[l] * k);
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

  /** Consumption headline = mean of the published estimates AND our own hub
   *  build. The externals come from the file; `internal` is recomputed here
   *  from what is actually on screen, so an admin edit to the hub lines moves
   *  the consensus immediately instead of waiting for the next pipeline run
   *  and disagreeing with itself in the meantime. */
  const consensus = useMemo(() => {
    const hubSum = (doc?.demand_hubs ?? []).reduce(
      (t, l) => t + legTotal(addLegs(emptyLegs(), l)), 0);
    const external = (cons?.sources ?? []).filter(s => s.key !== "internal");
    if (!hubSum) return null;
    const internal: ConsumptionSource = {
      key: "internal", label: "Our hubs", season: doc?.crop_year ?? null,
      m_bags: r1(hubSum), note: "Sum of the consumption-by-hub lines on this sheet",
    };
    const all = [internal, ...external];
    const mean = r1(all.reduce((t, s) => t + s.m_bags, 0) / all.length);
    // Scale the hub lines to the consensus. They supply the SHAPE of demand —
    // how the world drinks — and the consensus supplies the level. Exactly how
    // production already works here: mean of sources, split scaled to it.
    return { sources: all, mean, hubSum: r1(hubSum), k: mean / hubSum };
  }, [doc, cons]);

  /** The long tail we do not itemise. The sheet sums 16 named origins; CCS's
   *  "Others" row is everything else — Kenya, PNG, the smaller Central
   *  Americans — and at 8.8 M bags it is not a rounding difference. Leaving it
   *  out understates supply by about that much and turns a balanced sheet into
   *  a false deficit, which is exactly what happened when consumption moved to
   *  a consensus while production stayed on 16 origins.
   *
   *  Split: every itemised robusta producer appears in CCS's robusta table, so
   *  its "Others" is entirely long-tail robusta; arabica is the remainder.
   *  That reconciles against CCS's arabica "Others" to within 0.7 M bags once
   *  the arabica of origins we DO carry is added back. */
  const restOfWorld = useMemo(() => {
    if (!ccs?.seasons?.length) return null;
    const usable = ccs.seasons
      .map((sea, i) => ({ sea, i }))
      .filter(({ sea }) => sea !== "2024/25");   // CCS marks it PRELIM
    if (!usable.length) return null;
    const exact = usable.find(u => u.sea === season);
    const { sea, i } = exact ?? usable[usable.length - 1];
    const total = ccs.production.total?.others?.[i];
    const robusta = ccs.production.robusta?.others?.[i];
    if (total == null || robusta == null) return null;
    const legs = emptyLegs();
    legs.robusta = r1(robusta);
    legs.arabica_natural = r1(total - robusta);
    return { legs, season: sea, carried: sea !== season, total: r1(total) };
  }, [ccs, season]);

  const sums = useMemo(() => {
    const k = consensus?.k ?? 1;
    const sumLines = (ls: Line[] | undefined) =>
      (ls ?? []).reduce((acc, l) => addLegs(acc, l), emptyLegs());
    const production = Object.values(prod ?? {}).reduce(
      (acc, l) => addLegs(acc, l), emptyLegs());
    if (restOfWorld) addLegs(production, restOfWorld.legs);
    const carryIn  = sumLines(doc?.carry_in);
    const demand   = emptyLegs();
    for (const l of LEGS) demand[l] = r1(sumLines(doc?.demand_hubs)[l] * k);
    const carryOut = sumLines(doc?.carry_out);
    const supply = addLegs(addLegs(emptyLegs(), production), carryIn);
    const totalDemand = addLegs(addLegs(emptyLegs(), demand), carryOut);
    const residual = emptyLegs();
    for (const l of LEGS) residual[l] = r1(supply[l] - totalDemand[l]);
    return { production, carryIn, demand, carryOut, supply, totalDemand, residual };
  }, [prod, doc, consensus, restOfWorld]);

  // ── Statement rows ────────────────────────────────────────────────────
  const supplyRows = useMemo<StmtRow[]>(() => {
    if (!doc || !prod) return [];
    const rows: StmtRow[] = (doc.carry_in ?? []).map(l => ({
      key: `ci:${l.key}`, label: l.label, legs: addLegs(emptyLegs(), l), tone: "text-slate-400",
    }));
    rows.push({ key: "ci:total", label: "Carry-in stocks", legs: sums.carryIn, bold: true });
    for (const g of GROUPS) {
      const kids = g.origins
        .filter(o => prod[o] && legTotal(prod[o]) > 0)
        .map(o => ({
          key: `pr:${o}`, label: ORIGIN_FILES[o].label, legs: prod[o], tone: "text-slate-400",
          children: gradeChildren(o, prod[o], grades?.origins?.[o]),
        }));
      const legs = kids.reduce((acc, k) => addLegs(acc, k.legs), emptyLegs());
      rows.push({
        key: `pr:g:${g.label}`, label: g.label, legs, tone: "text-slate-400",
        title: g.origins.map(o => ORIGIN_FILES[o].label).join(", "),
        // Brazil and Colombia are their own group — expanding to a single
        // identical row would be noise, so they go straight to grades.
        children: kids.length === 1 ? kids[0].children : kids,
      });
    }
    if (restOfWorld) {
      rows.push({
        key: "pr:row", label: "Rest of world", legs: restOfWorld.legs, tone: "text-slate-400",
        title: `CCS "Others" — origins this sheet does not itemise. ${restOfWorld.season}`
          + (restOfWorld.carried ? " (carried forward)" : ""),
      });
    }
    rows.push({ key: "pr:total", label: "Total production", legs: sums.production, bold: true });
    rows.push({ key: "supply:total", label: "TOTAL SUPPLY", legs: sums.supply, bold: true, tone: "text-emerald-300" });
    return rows;
  }, [doc, prod, grades, sums, restOfWorld]);

  const demandRows = useMemo<StmtRow[]>(() => {
    if (!doc) return [];
    const k = consensus?.k ?? 1;
    const rows: StmtRow[] = (doc.demand_hubs ?? []).map(l => {
      const legs = addLegs(emptyLegs(), l);
      // Same factor as the total, so the lines still add up to it.
      for (const leg of LEGS) legs[leg] = r1(legs[leg] * k);
      return {
        key: `dh:${l.key}`, label: l.label, legs, tone: "text-slate-400",
        children: segs ? segmentChildren(l.key, legs, segs) : undefined,
      };
    });
    rows.push({ key: "dh:total", label: "Total consumption", legs: sums.demand, bold: true });
    for (const l of doc.carry_out ?? []) {
      rows.push({ key: `co:${l.key}`, label: l.label, legs: addLegs(emptyLegs(), l), tone: "text-slate-400" });
    }
    rows.push({ key: "co:total", label: "Total carry-out", legs: sums.carryOut, bold: true });
    rows.push({ key: "demand:total", label: "TOTAL DEMAND", legs: sums.totalDemand, bold: true, tone: "text-red-300" });
    return rows;
  }, [doc, segs, sums, consensus]);

  const allKeys = useMemo(
    () => collectKeys([...supplyRows, ...demandRows]), [supplyRows, demandRows]);

  if (failed) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-[10px] text-slate-500">
        World balance sheet unavailable (world_balance_sheet.json).
      </div>
    );
  }
  if (!doc || !prod) {
    return <div className="text-xs text-slate-500 animate-pulse py-8 text-center">Loading balance sheet…</div>;
  }

  // The legacy arabica column shows itself only while something still uses it.
  const legacyInUse =
    Object.values(prod).some(l => (l.arabica ?? 0) > 0) ||
    [...(doc.carry_in ?? []), ...(doc.demand_hubs ?? []), ...(doc.carry_out ?? [])]
      .some(l => (l.arabica ?? 0) > 0);

  const arabicaCol: ColDef = {
    key: "arabica_all", label: arabicaSplit ? "Arabica (all)" : "Arabica",
    tone: "text-amber-500", value: arabicaAll,
  };
  const robustaCol: ColDef = {
    key: "robusta", label: LEG_LABEL.robusta, tone: LEG_TONE.robusta, value: l => l.robusta,
  };
  const cols: ColDef[] = arabicaSplit
    ? [
        { key: "arabica_washed", label: LEG_LABEL.arabica_washed, tone: LEG_TONE.arabica_washed, value: l => l.arabica_washed },
        { key: "arabica_natural", label: LEG_LABEL.arabica_natural, tone: LEG_TONE.arabica_natural, value: l => l.arabica_natural },
        ...(legacyInUse
          ? [{ key: "arabica", label: LEG_LABEL.arabica, tone: LEG_TONE.arabica, value: (l: Record<Leg, number>) => l.arabica }]
          : []),
        arabicaCol, robustaCol,
      ]
    : [arabicaCol, robustaCol];
  const span = cols.length + 2;

  const toggle = (k: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
  const th = "text-right py-1 px-2 font-medium";
  const chip = "text-[9px] px-2 py-0.5 transition-colors";

  const renderRows = (rows: StmtRow[], depth = 0): React.ReactNode[] =>
    rows.flatMap(r => {
      const kids = r.children ?? [];
      const isOpen = open.has(r.key);
      const tone = r.tone ?? (r.leg ? LEG_TONE[r.leg] : "text-slate-300");
      const node = (
        <tr key={r.key}
          className={r.bold ? "border-t border-slate-600" : "border-t border-slate-800/60"}
          title={r.title}>
          <td className={`py-1 pr-2 ${r.bold ? "font-bold" : ""} ${tone} whitespace-nowrap`}
            style={{ paddingLeft: depth * 12 }}>
            {kids.length > 0 ? (
              <button onClick={() => toggle(r.key)}
                aria-expanded={isOpen}
                className="mr-1 text-slate-600 hover:text-slate-300 transition-colors"
                title={isOpen ? "Group" : "Ungroup"}>
                {isOpen ? "▾" : "▸"}
              </button>
            ) : depth > 0 ? <span className="mr-1 inline-block w-[9px]" /> : null}
            {r.label}
          </td>
          {cols.map(c => (
            <td key={c.key}
              className={`py-1 px-2 text-right font-mono ${r.bold ? "font-bold" : ""} ${
                c.key === "arabica_all" && !r.bold ? "text-amber-500/90" : tone}`}>
              {fmt(c.value(r.legs))}
            </td>
          ))}
          <td className={`py-1 pl-2 text-right font-mono font-bold ${tone}`}>{fmt(legTotal(r.legs))}</td>
        </tr>
      );
      return isOpen && kids.length
        ? [node, ...renderRows(kids, depth + 1)]
        : [node];
    });

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
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              <button onClick={() => setArabicaSplit(false)}
                className={`${chip} ${!arabicaSplit ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
                title="Arabica as one column">
                Arabica grouped
              </button>
              <button onClick={() => setArabicaSplit(true)}
                className={`${chip} ${arabicaSplit ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
                title="Washed and natural as separate columns, with Arabica (all) as the subtotal">
                Washed / natural
              </button>
            </div>
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              <button onClick={() => setOpen(new Set(allKeys))}
                className={`${chip} text-slate-500 hover:text-slate-200`}
                title="Ungroup every row down to grades and segments">
                Ungroup all
              </button>
              <button onClick={() => setOpen(new Set())}
                className={`${chip} text-slate-500 hover:text-slate-200`}
                title="Collapse back to the summary statement">
                Group all
              </button>
            </div>
            <span className="text-[8px] text-slate-600">updated {doc.updated}</span>
            <WorldBalanceEditor production={sums.production} onSaved={() => setReload(n => n + 1)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1 pr-2 font-medium">Line</th>
                {cols.map(c => <th key={c.key} className={`${th} ${c.tone}`}>{c.label}</th>)}
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t-2 border-slate-500/50">
                <td colSpan={span} className="pt-2 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-emerald-500">
                  Supply
                </td>
              </tr>
              {renderRows(supplyRows)}

              <tr className="border-t-2 border-slate-500/50">
                <td colSpan={span} className="pt-3 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-red-400">
                  Demand
                </td>
              </tr>
              {renderRows(demandRows)}

              <tr className="border-t-2 border-slate-500">
                <td className="py-1.5 pr-2 font-bold text-slate-200">Balance (supply − demand)</td>
                {cols.map(c => {
                  // While any production is still unsplit, a per-process
                  // residual compares a washed/natural demand line against a
                  // supply line that has no process — structurally
                  // meaningless. Suppress it and let Arabica (all) carry the
                  // balance until the restating is done.
                  const dead = legacyInUse && (c.key === "arabica_washed" || c.key === "arabica_natural");
                  const v = c.value(sums.residual);
                  return (
                    <td key={c.key}
                      className={`py-1.5 px-2 text-right font-mono font-bold ${
                        dead ? "text-slate-700" : chgTone(v)}`}
                      title={dead ? "Not comparable while some production is unsplit — see Arabica (all)" : undefined}>
                      {dead ? "–" : `${v >= 0 ? "+" : ""}${fmt(v)}`}
                    </td>
                  );
                })}
                <td className={`py-1.5 pl-2 text-right font-mono font-bold ${
                  chgTone(legTotal(sums.residual))}`}>
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
          {consensus && consensus.sources.length > 1 && (
            <> Consumption is the mean of {consensus.sources.length} estimates —{" "}
              {consensus.sources.map((src, i) => (
                <span key={src.key}>
                  {i > 0 && ", "}
                  <span className={src.key === "internal" ? "text-slate-500" : ""}>
                    {src.label} {src.m_bags.toFixed(1)}
                  </span>
                  {src.carried_forward && src.season && (
                    <span className="text-slate-700" title={`Latest published season: ${src.season}`}>
                      {" "}({src.season})
                    </span>
                  )}
                </span>
              ))}
              {" "}— giving <span className="text-slate-400">{consensus.mean.toFixed(1)}</span>.
              The hub lines supply the shape of demand and are scaled to it, the same way an
              origin&apos;s crop split is scaled to its production headline, so they stay editable
              and keep saying how the world drinks rather than how much. A season in brackets is a
              source whose latest print trails {doc.crop_year}.
            </>
          )}
          {" "}Arabica is stated by processing. Where a source publishes only a country
          total, the washed/natural cut comes from that origin&apos;s processing convention,
          recorded in the seed&apos;s <span className="text-slate-500">arabica_split_basis</span> —
          a source&apos;s own breakdown, or a hand edit, always wins over it.
          {" "}Ungrouping an origin shows its grades in its own vocabulary and ungrouping a hub
          shows the form the coffee is sold in; both are shares of the line above them, so a
          column of children always adds back to its parent exactly.
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
                chgTone(sumExp(rows))}`}>
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
