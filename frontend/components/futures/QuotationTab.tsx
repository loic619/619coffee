"use client";
import React, { useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { FOBBING_USD, MONTHLY_CARRY_USD } from "@/lib/originCosts";
import { PRINT_CSS_LIGHT, PRINT_CSS_DARK } from "@/lib/report/printStyles";
import { MONTH_ABB, type Contract } from "./types";
import { chgTone } from "@/lib/formatters";

// ─── Quotation Tab ────────────────────────────────────────────────────────────

// Shipping month → next available RC contract letter
const SHIPMENT_TO_CONTRACT: Record<number, string> = {
  1:"H", 2:"H",   // Jan/Feb  → RCH (Mar)
  3:"K", 4:"K",   // Mar/Apr  → RCK (May)
  5:"N", 6:"N",   // May/Jun  → RCN (Jul)
  7:"U", 8:"U",   // Jul/Aug  → RCU (Sep)
  9:"X", 10:"X",  // Sep/Oct  → RCX (Nov)
  11:"F", 12:"F", // Nov/Dec  → RCF (Jan next year)
};

interface Quality {
  key: string;
  section: string;
  label: string;
  desc: string;
  diff: number;
  isBasis?: boolean;
}

const QUALITIES: Quality[] = [
  { key:"g3",    section:"GRADE 3  ·  SCREEN 12", label:"Standard",  desc:"FM 5%, 20-25%BB, MC 13%",           diff:-250           },
  { key:"g2",    section:"GRADE 2  ·  SCREEN 13", label:"★  Basis",  desc:"Standard, BB 5%, FM 1%, MC 13%",    diff:0,  isBasis:true },
  { key:"s16s",  section:"GRADE 1  ·  SCREEN 16", label:"Standard",  desc:"BB 2%, FM 0.5%, MC 12.5%",          diff:70             },
  { key:"s16c",  section:"GRADE 1  ·  SCREEN 16", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:130            },
  { key:"s16wp", section:"GRADE 1  ·  SCREEN 16", label:"WP",        desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:190            },
  { key:"s18s",  section:"GRADE 1  ·  SCREEN 18", label:"Standard",  desc:"BB 2%, FM 0.5%, MC 12.5%",          diff:80             },
  { key:"s18c",  section:"GRADE 1  ·  SCREEN 18", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:140            },
  { key:"s18wp", section:"GRADE 1  ·  SCREEN 18", label:"WP",        desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:200            },
];

function fmtDiff(letter: string, diff: number): string {
  return diff >= 0 ? `${letter}+${diff}` : `${letter}${diff}`;
}

const PACKING_OPTIONS = [
  { key: "jute",   label: "Food-grade jute bags  60 kg each", short: "Jute bags", display: "+25 USD/MT", val: 25 },
  { key: "bigbag", label: "Big bags  1 MT per bag",           short: "Big bags",  display: "+15 USD/MT", val: 15 },
];
const CERT_OPTIONS = [
  { key: "eudr", label: "EUDR",                                        short: "EUDR", display: "+50 USD/MT",                        val: 50 },
  { key: "4c",   label: "4C",                                          short: "4C",   display: "+15 USD/MT",                        val: 15 },
  { key: "rfa",  label: "RFA",  short: "RFA",  display: "+5 ¢/lb · +60 USD/MT (Robusta)",  val: 60 },
];

interface ShippingMonth {
  label:       string;
  mo:          number;
  yr:          number;
  letter:      string;
  contractSym: string;
  // Letter + 2-digit contract year (e.g. "U26", "F27"). Uniquely identifies the
  // underlying futures contract so spreads stay correct even when the strip
  // spans more than one crop year and a letter (N, U, X, F…) recurs.
  priceKey:    string;
}

interface MonthWithBasis extends ShippingMonth {
  contractLetter: string;
  // Flat at-port price for this shipment month (USD/MT). null if its contract
  // price is unavailable.
  flat:           number | null;
  // Differential vs this month's own contract (flat − contract price). null when
  // the flat or contract price is missing.
  basisForMonth:  number | null;
}

// Robusta crop year identifier: the calendar year of the X (Nov delivery)
// contract that closes a crop year. Shipments in Dec belong to NEXT year's
// crop — so Dec 2026 belongs to crop year 2027 (which ends Nov 2027). This
// is the boundary the user wants explicit: current crop ends Nov X; new crop
// starts Dec, even though both ship against the same F (Jan delivery)
// contract.
function cropYearEndYear(yr: number, mo: number): number {
  return mo === 12 ? yr + 1 : yr;
}

// First shipping month whose underlying contract differs from the front. Keyed
// by priceKey (letter+year), not bare letter, so e.g. a new-crop strip running
// F27 → … → F28 still finds the genuine next contract (H27) rather than treating
// the two F's as one.
function getNextContract(months: ShippingMonth[]): ShippingMonth | null {
  const frontKey = months[0]?.priceKey;
  if (!frontKey) return null;
  return months.find(m => m.priceKey !== frontKey) ?? null;
}

// Unique contract transitions in the strip, identified by priceKey so a letter
// recurring in a later crop year (e.g. N26 vs N27) is treated as a real roll.
function getTransitions(months: ShippingMonth[]): { from: string; to: string; key: string }[] {
  const result: { from: string; to: string; key: string }[] = [];
  let prevKey = months[0]?.priceKey ?? "";
  months.slice(1).forEach(m => {
    if (m.priceKey !== prevKey) {
      const key = `${prevKey}-${m.priceKey}`;
      if (!result.find(t => t.key === key)) result.push({ from: prevKey, to: m.priceKey, key });
      prevKey = m.priceKey;
    }
  });
  return result;
}

// Flat-price model. The front shipping month's at-port flat price (flatFront =
// VN FAQ USD/MT + origin FOBbing) ramps by `carry` USD/MT every shipment month,
// continuously across the whole crop (it does NOT reset at contract rolls). Each
// month's differential is then flat − that month's own contract price, so the
// calendar spread is incorporated automatically (no manual spread roll).
//
// The two basis boxes act as manual overrides: a non-null frontBasisOverride
// re-anchors the flat at the front contract (flat = override + front price); a
// non-null nextBasisOverride re-anchors it at the first non-front contract. From
// each anchor the carry ramp and the flat→differential conversion continue.
function computeMonthsFlat(
  months:             ShippingMonth[],
  flatFront:          number,
  carry:              number,
  priceByKey:         Record<string, number>,
  frontBasisOverride: number | null,
  nextBasisOverride:  number | null,
): MonthWithBasis[] {
  let lastKey     = months[0]?.priceKey ?? "";
  let contractIdx = 0;
  const frontPrice = priceByKey[lastKey];
  let flat = (frontBasisOverride != null && frontPrice != null)
    ? frontBasisOverride + frontPrice
    : flatFront;
  return months.map((m, i) => {
    if (i > 0) {
      flat += carry;                       // continuous carry, including across rolls
      if (m.priceKey !== lastKey) {
        contractIdx += 1;
        lastKey = m.priceKey;
        const price = priceByKey[m.priceKey];
        if (contractIdx === 1 && nextBasisOverride != null && price != null) {
          flat = nextBasisOverride + price;
        }
      }
    }
    const price = priceByKey[m.priceKey];
    const basisForMonth = price != null ? Math.round(flat - price) : null;
    return { ...m, contractLetter: m.letter, flat: price != null ? Math.round(flat) : null, basisForMonth };
  });
}

export default function QuotationTab({ contracts = [], vnFaqUsdMt }: { contracts?: Contract[]; vnFaqUsdMt?: number | null }) {
  // Basis overrides per crop year. Left null, each crop's differentials come
  // from the flat-price model (VN FAQ + FOBbing, ramped by carry). A non-null
  // value re-anchors the flat at the front or next contract; the carry ramp and
  // the per-month flat→differential conversion continue from there.
  const [currentBasisOverride,  setCurrentBasisOverride]  = useState<number | null>(null);
  const [currentBasis2Override, setCurrentBasis2Override] = useState<number | null>(null);
  const [newBasisOverride,      setNewBasisOverride]      = useState<number | null>(null);
  const [newBasis2Override,     setNewBasis2Override]     = useState<number | null>(null);
  const [freight,               setFreight]               = useState(0);
  const [financing,             setFinancing]             = useState(0);
  const [selectedOptions,       setSelectedOptions]       = useState<Set<string>>(new Set());
  // Pricelist scope: current crop only (default) or both crops.
  const [scope,                 setScope]                 = useState<"current" | "both">("current");
  // Pricelist export (browser print → Save as PDF), mirroring Build a Briefing.
  // Defaults to dark so the PDF keeps the web-app look (rounded cards, colour-
  // coded prices); the toggle can flip to a light, ink-friendly sheet.
  const [printTheme,            setPrintTheme]            = useState<"light" | "dark">("dark");
  const printRef = useRef<HTMLDivElement>(null);
  const printPricelist = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Vietnam coffee prices - ${new Date().toISOString().slice(0, 10)}`,
    // Base theme CSS + a landscape override so the (up to 5-month) tables have
    // room without clipping. The later @page rule wins over the portrait default.
    pageStyle: `${printTheme === "light" ? PRINT_CSS_LIGHT : PRINT_CSS_DARK}\n@page { size: A4 landscape; }`,
  });

  const toggleOption = (key: string) =>
    setSelectedOptions(prev => { const s = new Set(prev); if (s.has(key)) { s.delete(key); } else { s.add(key); } return s; });

  const optionsAddon = [...PACKING_OPTIONS, ...CERT_OPTIONS]
    .filter(o => selectedOptions.has(o.key))
    .reduce((sum, o) => sum + o.val, 0);

  // "Detail" column = selected packing + certification, defaulting to the
  // conventional bulk offer so the pricelist always reads e.g. "Bulk, Conv.".
  const selPacking = PACKING_OPTIONS.filter(o => selectedOptions.has(o.key));
  const selCert    = CERT_OPTIONS.filter(o => selectedOptions.has(o.key));
  const detailLabel = `${selPacking.length ? selPacking.map(o => o.short).join(" + ") : "Bulk"}, `
                    + `${selCert.length ? selCert.map(o => o.short).join(" + ") : "Conv."}`;

  // Price lookup keyed by contract (letter + 2-digit year), e.g. "U26", "F27".
  // Keeps the nearest expiry per contract. Keying by the full contract — not the
  // bare letter — is what lets a multi-crop-year strip read the correct price for
  // each roll (N26 ≠ N27, F27 ≠ F28).
  const priceByKey = useMemo(() => {
    const p: Record<string, number> = {};
    contracts.forEach(c => {
      const m = c.symbol.match(/^R[CM]([FGHJKMNQUVXZ])(\d{2})$/i);
      if (m) {
        const k = `${m[1].toUpperCase()}${m[2]}`;
        if (!(k in p)) p[k] = c.last;
      }
    });
    return p;
  }, [contracts]);

  // Shipping months from the front (skips current month after the 14th to roll
  // off near-FND contracts) through November of the NEXT crop year, so the
  // new-crop table can run all the way to its Nov close.
  const monthsBase = useMemo<ShippingMonth[]>(() => {
    const today  = new Date();
    const offset = today.getDate() >= 14 ? 1 : 0;
    const start  = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const startCropEnd = cropYearEndYear(start.getFullYear(), start.getMonth() + 1);
    // Last shipping month we need = Nov of the next crop year (month index 10).
    const end    = new Date(startCropEnd + 1, 10, 1);
    const count  = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    return Array.from({ length: count }, (_, i) => {
      const d  = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const mo = d.getMonth() + 1;
      const yr = d.getFullYear();
      const letter = SHIPMENT_TO_CONTRACT[mo];
      const cYear  = letter === "F" && mo >= 11 ? yr + 1 : yr;
      const yy     = String(cYear).slice(2);
      return { label: `${MONTH_ABB[mo]}-${String(yr).slice(2)}`, mo, yr, letter, contractSym: `RC${letter}${yy}`, priceKey: `${letter}${yy}` };
    });
  }, []);

  // Today's crop year (Nov-ending calendar year).
  const todayCropEndYear = useMemo(() => {
    const today = new Date();
    return cropYearEndYear(today.getFullYear(), today.getMonth() + 1);
  }, []);

  // Split monthsBase at the Nov/Dec crop year boundary.
  const { currentCropMonths, newCropMonths } = useMemo(() => {
    const cur:  ShippingMonth[] = [];
    const next: ShippingMonth[] = [];
    monthsBase.forEach(m => {
      if (cropYearEndYear(m.yr, m.mo) === todayCropEndYear) cur.push(m);
      else                                                  next.push(m);
    });
    return { currentCropMonths: cur, newCropMonths: next };
  }, [monthsBase, todayCropEndYear]);

  // Flat front price for a crop = VN FAQ USD/MT + origin FOBbing (single source:
  // lib/originCosts). Falls back to front contract + 150 when the VN FAQ spot
  // isn't available.
  const flatFrontFor = (months: ShippingMonth[]): { flatFront: number; frontPrice: number | null } => {
    const fk = months[0]?.priceKey;
    const frontPrice = fk ? priceByKey[fk] ?? null : null;
    const flatFront = vnFaqUsdMt != null ? vnFaqUsdMt + FOBBING_USD["VN FAQ"] : (frontPrice ?? 0) + 150;
    return { flatFront, frontPrice };
  };
  // Differential the next-contract box should show when un-overridden: the flat
  // (front anchor + carry to that contract's first month) minus its price. Uses
  // the effective front flat so a front-box override propagates into this box.
  const nextBasisDefaultFor = (
    months: ShippingMonth[], next: ShippingMonth | null, effFlatFront: number, fallback: number,
  ): number => {
    if (!next) return fallback;
    const idx = months.findIndex(m => m.priceKey === next.priceKey);
    const np  = priceByKey[next.priceKey];
    if (idx < 0 || np == null) return fallback;
    return Math.round(effFlatFront + idx * MONTHLY_CARRY_USD - np);
  };

  // ── Current crop computed state ────────────────────────────────────────
  const currentNext        = useMemo(() => getNextContract(currentCropMonths), [currentCropMonths]);
  const currentTransitions = useMemo(() => getTransitions(currentCropMonths),  [currentCropMonths]);
  const { flatFront: currentFlatFront, frontPrice: currentFrontPrice } = flatFrontFor(currentCropMonths);
  const currentEffFlatFront = (currentBasisOverride != null && currentFrontPrice != null)
    ? currentBasisOverride + currentFrontPrice : currentFlatFront;
  const currentBasisDefault = currentFrontPrice != null ? Math.round(currentFlatFront - currentFrontPrice) : 150;
  const currentBasisDiff    = currentBasisOverride ?? currentBasisDefault;
  const currentBasis2Default = nextBasisDefaultFor(currentCropMonths, currentNext, currentEffFlatFront, currentBasisDiff + MONTHLY_CARRY_USD);
  const currentBasis2Diff    = currentBasis2Override ?? currentBasis2Default;
  const currentMonths = useMemo(
    () => computeMonthsFlat(currentCropMonths, currentFlatFront, MONTHLY_CARRY_USD, priceByKey, currentBasisOverride, currentBasis2Override),
    [currentCropMonths, currentFlatFront, priceByKey, currentBasisOverride, currentBasis2Override],
  );

  // ── New crop computed state (restarts at VN FAQ + FOBbing) ──────────────
  const newNext        = useMemo(() => getNextContract(newCropMonths), [newCropMonths]);
  const newTransitions = useMemo(() => getTransitions(newCropMonths),  [newCropMonths]);
  const { flatFront: newFlatFront, frontPrice: newFrontPrice } = flatFrontFor(newCropMonths);
  const newEffFlatFront = (newBasisOverride != null && newFrontPrice != null)
    ? newBasisOverride + newFrontPrice : newFlatFront;
  const newBasisDefault = newFrontPrice != null ? Math.round(newFlatFront - newFrontPrice) : 150;
  const newBasisDiff    = newBasisOverride ?? newBasisDefault;
  const newBasis2Default = nextBasisDefaultFor(newCropMonths, newNext, newEffFlatFront, newBasisDiff + MONTHLY_CARRY_USD);
  const newBasis2Diff    = newBasis2Override ?? newBasis2Default;
  const newMonths = useMemo(
    () => computeMonthsFlat(newCropMonths, newFlatFront, MONTHLY_CARRY_USD, priceByKey, newBasisOverride, newBasis2Override),
    [newCropMonths, newFlatFront, priceByKey, newBasisOverride, newBasis2Override],
  );

  // Market spread between current crop's last and new crop's first contract.
  // Renders as the inter-table badge so the roll the new-crop basisDefault
  // implicitly bakes in is also visible to the eye.
  const cropYearRoll = useMemo(() => {
    const lastCur  = currentCropMonths[currentCropMonths.length - 1];
    const firstNew = newCropMonths[0];
    if (!lastCur || !firstNew) return null;
    const lp = priceByKey[lastCur.priceKey];
    const fp = priceByKey[firstNew.priceKey];
    if (lp == null || fp == null) return null;
    return { from: lastCur.priceKey, to: firstNew.priceKey, value: Math.round(lp - fp) };
  }, [currentCropMonths, newCropMonths, priceByKey]);

  const sections: string[] = [];
  QUALITIES.forEach(q => { if (!sections.includes(q.section)) sections.push(q.section); });

  // ── Render one crop year's controls + table ─────────────────────────────
  function renderCropPanel(opts: {
    title:          string;
    subtitle:       string;
    months:         MonthWithBasis[];
    transitions:    { from: string; to: string; key: string }[];
    nextLabel:      string | null;
    basisDiff:      number;
    basis2Diff:     number;
    flatFront:      number;
    onBasisChange:  (n: number) => void;
    onBasis2Change: (n: number) => void;
  }) {
    if (opts.months.length === 0) return null;
    const frontLabel = opts.months[0].priceKey;
    // Cap the strip at 5 shipment months so the table stays within a printable
    // column width; a crop with more months (the new crop) shows only its first 5.
    const months = opts.months.slice(0, 5);
    return (
      <div className="space-y-3">
        {/* Per-crop controls — screen only (excluded from the pricelist PDF) */}
        <div className="print:hidden bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-wrap items-center gap-6">
          <div className="flex-shrink-0">
            <div className="text-[11px] text-amber-300 uppercase font-bold tracking-widest">{opts.title}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">{opts.subtitle}</div>
          </div>
          <div className="border-l border-slate-700 pl-6">
            <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
              Flat front · {frontLabel}
            </div>
            <div className="text-sm font-mono text-emerald-300 font-bold">
              ${opts.flatFront.toLocaleString()}<span className="text-slate-500 font-normal">/MT</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">
              VN FAQ {vnFaqUsdMt != null ? `$${vnFaqUsdMt.toLocaleString()}` : "—"} + FOBbing ${FOBBING_USD["VN FAQ"]} · +${MONTHLY_CARRY_USD}/mo carry
            </div>
          </div>
          <div className="border-l border-slate-700 pl-6">
            <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
              Basis — Grade 2 S13 — {frontLabel} contract
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={opts.basisDiff}
                onChange={e => opts.onBasisChange(Number(e.target.value))}
                className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white font-mono text-sm text-right focus:outline-none focus:border-indigo-500"
              />
              <span className="text-slate-400 text-sm">USD / MT</span>
            </div>
          </div>
          {opts.nextLabel && (
            <div className="border-l border-slate-700 pl-6">
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
                Basis — Grade 2 S13 — {opts.nextLabel} contract
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={opts.basis2Diff}
                  onChange={e => opts.onBasis2Change(Number(e.target.value))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white font-mono text-sm text-right focus:outline-none focus:border-indigo-500"
                />
                <span className="text-slate-400 text-sm">USD / MT</span>
              </div>
            </div>
          )}
          {opts.transitions.length > 0 && (
            <div className="border-l border-slate-700 pl-6">
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
                Calendar Spreads — USD/MT
              </div>
              <div className="flex flex-wrap gap-4">
                {opts.transitions.map(({ key, from, to }) => {
                  const val = (priceByKey[from] != null && priceByKey[to] != null)
                    ? Math.round(priceByKey[from] - priceByKey[to])
                    : null;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-mono">RC {from}→{to}</span>
                      <span className="text-amber-300 font-mono text-sm font-bold">
                        {val != null ? (val >= 0 ? `+${val}` : `${val}`) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Print-only crop heading (the screen title lives in the controls above) */}
        <div className="hidden print:block mb-1">
          <div className="text-sm font-bold uppercase tracking-widest text-amber-300">{opts.title}</div>
          <div className="text-[10px] text-slate-400">{opts.subtitle}</div>
        </div>

        {/* Per-crop table. No min-w-full: columns keep a fixed width so the
            current crop's months line up with the wider new-crop table instead
            of stretching to fill the row. */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden inline-block max-w-full align-top">
          <div className="overflow-x-auto">
            <table className="text-xs font-mono w-auto">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-600">
                  <th className="text-left px-4 py-2.5 text-slate-400 font-bold uppercase text-[11px] w-[110px] border-r border-slate-700">
                    Grade
                  </th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-bold uppercase text-[11px] w-px whitespace-nowrap border-r border-slate-700">
                    Specification
                  </th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-bold uppercase text-[11px] w-[120px] border-r border-slate-700">
                    Detail
                  </th>
                  {months.map((m, i) => (
                    <th key={i} className="px-3 py-2.5 text-center w-[84px] border-l border-slate-700">
                      <div className="text-white font-bold">{m.label}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{m.contractSym}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map(section => {
                  const sectionQuals = QUALITIES.filter(q => q.section === section);
                  return (
                    <React.Fragment key={section}>
                      <tr className="bg-slate-800/50 border-t border-slate-600">
                        <td
                          colSpan={3 + months.length}
                          className="px-4 py-1.5 text-[10px] text-slate-400 uppercase font-bold tracking-widest"
                        >
                          {section}
                        </td>
                      </tr>
                      {sectionQuals.map(q => (
                        <tr
                          key={q.key}
                          className={`border-t border-slate-800/60 transition-colors ${
                            q.isBasis ? "bg-indigo-950/30" : "hover:bg-slate-800/20"
                          }`}
                        >
                          <td className={`px-4 py-2 border-r border-slate-800 font-medium ${
                            q.isBasis ? "text-indigo-300" : "text-slate-200"
                          }`}>
                            {q.label}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-[10px] border-r border-slate-800 whitespace-nowrap">
                            {q.desc}
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-[10px] border-r border-slate-800 whitespace-nowrap">
                            {detailLabel}
                          </td>
                          {months.map((m, i) => {
                            if (m.basisForMonth == null) {
                              return (
                                <td key={i} className="px-3 py-2 text-center font-bold border-l border-slate-800/50 text-slate-600">
                                  —
                                </td>
                              );
                            }
                            const totalDiff = Math.round((m.basisForMonth + q.diff + optionsAddon + freight + financing) / 5) * 5;
                            const display   = fmtDiff(m.contractLetter, totalDiff);
                            const color = q.isBasis
                              ? "text-indigo-300"
                              : chgTone(totalDiff);
                            return (
                              <td key={i} className={`px-3 py-2 text-center font-bold border-l border-slate-800/50 ${color}`}>
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Export toolbar — screen only. Mirrors Build a Briefing: light/dark PDF
          theme + a browser-print "Build pricelist" the user can Save as PDF. */}
      <div className="print:hidden flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Robusta Pricelist</h2>
          <p className="text-[11px] text-slate-500">
            Set the basis, packing &amp; certification, then export a customer-ready price list (print → Save as PDF).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="Pricelist scope">
            {([["current", "Current crop"], ["both", "Both crops"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setScope(val)}
                aria-pressed={scope === val}
                title={val === "current" ? "Show only the current crop" : "Show current + new crop"}
                className={`px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  scope === val ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="PDF theme">
            {(["light", "dark"] as const).map(t => (
              <button
                key={t}
                onClick={() => setPrintTheme(t)}
                aria-pressed={printTheme === t}
                title={t === "light" ? "Light PDF — best for printing" : "Dark PDF — matches the screen"}
                className={`px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  printTheme === t ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            onClick={() => printPricelist()}
            className="px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors
                       bg-amber-500/10 text-amber-300 border-amber-600/50 hover:bg-amber-500/20"
          >
            Build pricelist
          </button>
        </div>
      </div>

      {/* Shared controls: freight + financing apply across both crops */}
      <div className="print:hidden bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-wrap items-center gap-6">
        {(["Freight", "Financing"] as const).map(label => {
          const val   = label === "Freight" ? freight   : financing;
          const setVal = label === "Freight" ? setFreight : setFinancing;
          return (
            <div key={label}>
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">{label} — USD/MT</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={val}
                  onChange={e => setVal(Number(e.target.value))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sky-300 font-mono text-sm text-right focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          );
        })}
        <div className="text-xs text-slate-500 leading-relaxed border-l border-slate-700 pl-6">
          Monthly carry <span className="text-slate-300 font-medium">+30 USD/MT</span> per shipment month<br />
          RC bimonthly cycle: K (May) · N (Jul) · U (Sep) · X (Nov) · F (Jan)<br />
          <span className="text-slate-600">FOB · Bulk · CAD 1st · ESCC NSW 0.5% · All subject to confirmation</span>
        </div>
      </div>

      {/* Printable pricelist (react-to-print target) */}
      <div ref={printRef} id="report-canvas" className="space-y-4">
      {/* Print-only letterhead — matches the app: rounded card, amber accent */}
      <div className="hidden print:block">
        <div className="bg-slate-900 border border-slate-700 rounded-lg px-5 py-3 flex items-baseline justify-between gap-4">
          <div className="text-xl font-bold tracking-tight text-amber-300">Vietnam coffee prices</div>
          <div className="text-[11px] font-mono text-slate-400">{new Date().toISOString().slice(0, 10)}</div>
        </div>
      </div>

      {/* Current crop */}
      {renderCropPanel({
        title:          `Current Crop · ending Nov ${String(todayCropEndYear).slice(2)}`,
        subtitle:       "Physical shipments in the current crop year",
        months:         currentMonths,
        transitions:    currentTransitions,
        nextLabel:      currentNext?.priceKey ?? null,
        basisDiff:      currentBasisDiff,
        basis2Diff:     currentBasis2Diff,
        flatFront:      currentFlatFront,
        onBasisChange:  setCurrentBasisOverride,
        onBasis2Change: setCurrentBasis2Override,
      })}

      {/* Crop year roll indicator (only when both tables render) — screen only */}
      {scope === "both" && cropYearRoll && currentCropMonths.length > 0 && newCropMonths.length > 0 && (
        <div className="print:hidden flex justify-center">
          <div className="bg-slate-900 border border-amber-600/40 rounded-full px-5 py-1.5 flex items-center gap-3 text-[10px]">
            <span className="text-amber-300 uppercase font-bold tracking-widest">Crop Year Roll</span>
            <span className="text-slate-400 font-mono">RC {cropYearRoll.from}→{cropYearRoll.to}</span>
            <span className="text-amber-300 font-mono font-bold">
              {cropYearRoll.value >= 0 ? `+${cropYearRoll.value}` : cropYearRoll.value} USD/MT
            </span>
          </div>
        </div>
      )}

      {/* New crop — only when the user opts into both crops */}
      {scope === "both" && renderCropPanel({
        title:          `New Crop · starting Dec ${String(todayCropEndYear).slice(2)}`,
        subtitle:       "Physical shipments in next crop year",
        months:         newMonths,
        transitions:    newTransitions,
        nextLabel:      newNext?.priceKey ?? null,
        basisDiff:      newBasisDiff,
        basis2Diff:     newBasis2Diff,
        flatFront:      newFlatFront,
        onBasisChange:  setNewBasisOverride,
        onBasis2Change: setNewBasis2Override,
      })}

      {/* Footer note */}
      <div className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-[10px] text-slate-500">
        * Diffs quoted vs ICE London (RC) bimonthly contracts. Basis = Grade 2 S13 Standard.
        Screen 18 = Screen 16 + 10. Grade 3 = Basis − 250. Prices indicative, subject to availability and confirmation.
      </div>
      </div>{/* /printable pricelist */}

      {/* Packing & Compliance — screen only; selection feeds the Detail column */}
      <div className="print:hidden grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3">
            Packing Options
          </div>
          <div className="space-y-2">
            {PACKING_OPTIONS.map(o => {
              const on = selectedOptions.has(o.key);
              return (
                <button
                  key={o.key}
                  onClick={() => toggleOption(o.key)}
                  className={`w-full flex justify-between items-center text-xs px-3 py-2 rounded border transition-colors cursor-pointer ${
                    on ? "bg-emerald-900/40 border-emerald-600 text-emerald-300" : "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${on ? "bg-emerald-500 border-emerald-400" : "border-slate-500"}`} />
                    {o.label}
                  </span>
                  <span className={`font-bold font-mono whitespace-nowrap ml-4 ${on ? "text-emerald-300" : "text-emerald-500"}`}>{o.display}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3">
            Certificate &amp; Compliance{" "}
            <span className="text-slate-600 normal-case font-normal">(subject to availability)</span>
          </div>
          <div className="space-y-2">
            {CERT_OPTIONS.map(o => {
              const on = selectedOptions.has(o.key);
              return (
                <button
                  key={o.key}
                  onClick={() => toggleOption(o.key)}
                  className={`w-full flex justify-between items-center text-xs px-3 py-2 rounded border transition-colors cursor-pointer ${
                    on ? "bg-amber-900/30 border-amber-600 text-amber-300" : "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${on ? "bg-amber-500 border-amber-400" : "border-slate-500"}`} />
                    {o.label}
                  </span>
                  <span className={`font-bold font-mono whitespace-nowrap ml-4 ${on ? "text-amber-300" : "text-amber-500"}`}>{o.display}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

