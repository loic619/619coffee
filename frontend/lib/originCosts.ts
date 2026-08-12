// Single source of truth for origin FOBbing costs (origin logistics + exporter
// margin), in USD/MT. Edit these numbers here and every consumer updates:
//   - Research → Origin Logistics tab (the "~$X/t" headline figures)
//   - Market ticker: lifts origin spot prices to at-port parity vs RC futures
//   - Futures → Quotation tab: the flat reference price for each origin
//
// VN FAQ ≈ $65 logistics (Cat Lai trucking + port) + ~$35 exporter margin.
// See components/research/ResearchView.tsx → Origin Logistics for the full
// cost-stack breakdown behind each number.
//
// Fixed vs ad-valorem
// ===================
// A cost stack has two kinds of line. Haulage, inspection and terminal handling
// are a fixed number of dollars per tonne — they do not care whether coffee is
// worth $2,000 or $4,500. Quality preparation, financing and exporter margin are
// PERCENTAGES of the cargo's value, and two of those were already written that
// way ("0.5% on $3,000", "~1% of FOB") but then frozen at a single reference
// price. Freezing them makes the whole stack drift: the flat $200 booked for
// CON T7 has been worth anywhere from 12.3% to 3.5% of the coffee it moves.
//
// The conilon-basis research (Research → Exchange) measures the grade component
// directly: lifting Espírito Santo conilon from the tipo 7/8 the CON T7 quote
// represents to a tipo 6 / screen-13+ export spec is worth ~4.3% of the price
// (mean $135/MT, $176/MT at current levels) — not the flat $55–65 the stack used
// to book. `quality` below is set to a deliberately conservative 4.0%, since
// part of that measured 4.3% is deal-mix rather than pure grade.
export interface FobbingModel {
  fixedUsdMt: number;      // haulage, inspection, terminal handling — no price scaling
  advaloremPct: number;    // quality/outturn + financing + exporter margin
  referenceUsdMt: number;  // price level the headline figure is quoted at
}

// Every origin is split the same way: the ad-valorem percentage is the sum of
// that origin's own value-scaling lines (as its Origin-Logistics cost table
// already describes them), and the fixed component is set so the model
// reproduces the published headline at that origin's reference price. So for
// every origin except CON T7 this is a change of FORM, not of level: the number
// now re-rates daily with the price instead of standing still.
//
// CON T7 is the one deliberate level change — its quality line moves from a flat
// $55–65 to 4.0% on the measured grade ladder (see the block comment above).
export const FOBBING_MODEL: Record<string, FobbingModel> = {
  // fixed 62.5 = L1 12.5 + L2 22.5 + MAPA 10 + THC/docs 17.5
  // 5.5% = quality/outturn 4.0 + financing 0.5 + exporter margin 1.0
  "CON T7":  { fixedUsdMt: 62.5,  advaloremPct: 5.5, referenceUsdMt: 3000 },
  // 1.29% = financing $10 + exporter margin $35, over the $3,500 reference
  "VN FAQ":  { fixedUsdMt: 55.0,  advaloremPct: 1.29, referenceUsdMt: 3500 },
  // 3.31% = drying shrinkage $37.5 + UCDA cess $30 + financing $18 + margin $37
  //   (shrinkage is a weight loss, so it costs a share of the cargo's value —
  //    the same reasoning that puts Brazil's outturn loss in this column)
  "UGA S15": { fixedUsdMt: 142.5, advaloremPct: 3.31, referenceUsdMt: 3700 },
  // 1.75% = ANACAFE cess $25 + financing $18 + exporter margin $60
  "GT SHB":  { fixedUsdMt: 177.0, advaloremPct: 1.75, referenceUsdMt: 5900 },
  // 1.69% = IHCAFE levies $25 + financing $18 + exporter margin $55
  "HN HG":   { fixedUsdMt: 152.0, advaloremPct: 1.69, referenceUsdMt: 5800 },
};

/** FOBbing for one origin at a given cargo value (USD/MT).
 *  Omit `priceUsdMt` to get the headline figure at the model's reference price. */
export function fobbingUsdMt(label: string, priceUsdMt?: number): number {
  const m = FOBBING_MODEL[label];
  if (!m) return 0;
  return m.fixedUsdMt + (m.advaloremPct / 100) * (priceUsdMt ?? m.referenceUsdMt);
}

/** Headline figure per origin, evaluated at each model's reference price.
 *  Price-aware call sites should use fobbingUsdMt(label, price) instead. */
export const FOBBING_USD: Record<string, number> = Object.fromEntries(
  Object.keys(FOBBING_MODEL).map(k => [k, Math.round(fobbingUsdMt(k))]),
);

export const VN_FAQ_FOBBING_USD = FOBBING_USD["VN FAQ"];

// Carry cost added per shipment month within a crop year, USD/MT.
export const MONTHLY_CARRY_USD = 30;

// ── FOB / CIF Antwerp conversion (Origin Farmgate Prices basis toggle) ──────
// FOB   = farmgate (USD/MT) + fobbing (the research-tab cost stack above).
// CIF   = FOB + ocean freight (route USD/FEU ÷ 21.6 MT) + financing of the
//         cargo value at CIF_FINANCING_RATE p.a. over the transit time.
export const CIF_FINANCING_RATE = 0.08;   // p.a., applied × transitDays/365 on FOB
export const FEU_MT = 21.6;               // net coffee MT per FEU (matches tender_parity)

// ICE fixed certification fees per MT — sampling + grading, editable estimates:
//   arabica (KC): sampling $50 + grading ~$300 per 250-bag lot (~17.0 MT) ≈ $21/MT
//   robusta (RC): sampling + grading ~$200 per 10-MT lot                  ≈ $20/MT
export const SAMPLING_GRADING_USD_MT: Record<"arabica" | "robusta", number> = {
  arabica: 21,
  robusta: 20,
};

export interface OriginExportCost {
  fobLabel: string;       // key into FOBBING_MODEL — use fobbingUsdMt(label, price)
  fobbingUsdMt: number;   // headline origin→vessel figure at the model's reference price
  freightRoute: string;   // freight.json route id (FBX-derived, USD/FEU)
  transitDays:  number;   // port→Antwerp sailing time for the financing leg
  // Signed exchange delivery adjustment vs the reference contract, USD/MT.
  // Negative = the origin delivers at a DISCOUNT (its cost to match the
  // reference is higher by that amount — e.g. Brazil semi-washed tenders to
  // KC at 900 points = 9¢/lb ≈ $198/MT under). Omitted/0 = par growth.
  exchangePremiumUsdMt?: number;
}

// Keyed by origin_prices_history.json origin key (the panel's series keys).
// Fobbing reuses FOBBING_USD; origins without their own research-tab figure
// borrow the closest logistics twin (BR arabica ships the same Santos stack as
// conilon; DRUGAR/WUGAR clear through the same Kampala→Mombasa chain as S15).
// Transit: liner schedules to Antwerp — Santos ~16d, Caribbean ~17d,
// Mombasa/Djibouti ~28d, Ho Chi Minh ~32d.
// exchangePremiumUsdMt: RC has class-based (not origin) allowances — assume
// par class for the robustas. KC origin differentials: Brazil semi-washed
// −900 pts (−$198/MT); Uganda washed and Guatemala are par growths.
export const ORIGIN_EXPORT_COSTS: Record<string, OriginExportCost> = {
  vietnam:        { fobLabel: "VN FAQ",  fobbingUsdMt: FOBBING_USD["VN FAQ"],  freightRoute: "vn-eu", transitDays: 32 },
  brazil_conilon: { fobLabel: "CON T7",  fobbingUsdMt: FOBBING_USD["CON T7"],  freightRoute: "br-eu", transitDays: 16 },
  brazil_arabica: { fobLabel: "CON T7",  fobbingUsdMt: FOBBING_USD["CON T7"],  freightRoute: "br-eu", transitDays: 16,
                    exchangePremiumUsdMt: -198 },
  uganda:         { fobLabel: "UGA S15", fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  uganda_drugar:  { fobLabel: "UGA S15", fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  uganda_wugar:   { fobLabel: "UGA S15", fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  guatemala_estrictamente_duro:
                  { fobLabel: "GT SHB",  fobbingUsdMt: FOBBING_USD["GT SHB"],  freightRoute: "co-eu", transitDays: 17 },
};
