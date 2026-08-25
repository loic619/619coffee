// The differential-model factor map — the real chart, node for node, in its
// original disposition: four clusters converging on the diamond that resolves
// Futures Price · Supply & Demand · Exchange Economics into the Differential.
//
// Coordinates are transcribed from the source chart, not re-flowed, so the
// layout IS the source layout. Shared deliberately: the Differential research
// note renders it as its figure, and the research index renders the same
// component with per-node research badges. One chart, one set of coordinates —
// they cannot drift apart.
export type Cluster = "supply" | "demand" | "positioning" | "exchange" | "core";

export const CLUSTER: Record<Cluster, { stroke: string; fill: string; label: string }> = {
  supply:      { stroke: "#3987e5", fill: "rgba(57,135,229,0.13)",  label: "Supply" },
  demand:      { stroke: "#199e70", fill: "rgba(25,158,112,0.13)",  label: "Demand" },
  positioning: { stroke: "#c98500", fill: "rgba(201,133,0,0.13)",   label: "Positioning" },
  exchange:    { stroke: "#94a3b8", fill: "rgba(148,163,184,0.10)", label: "Exchange economics" },
  core:        { stroke: "#e2e8f0", fill: "rgba(226,232,240,0.10)", label: "Resolves into" },
};

export interface N { id: string; t: string; x: number; y: number; w: number; h: number; c: Cluster; big?: boolean }

// Transcribed from the source chart; coordinates are its layout, not a re-flow.
export const NODES: N[] = [
  // ── supply ────────────────────────────────────────────────────────────
  { id: "early_dry",    t: "Early dry weather",        x: 592, y: 10,  w: 92,  h: 34, c: "supply" },
  { id: "harvest_time", t: "Early or late harvest",    x: 546, y: 62,  w: 78,  h: 36, c: "supply" },
  { id: "prehar_price", t: "Matching the pre-harvest market price", x: 640, y: 48, w: 116, h: 46, c: "supply" },
  { id: "other_crops",  t: "Other crops benchmark",    x: 762, y: 46,  w: 156, h: 22, c: "supply" },
  { id: "cost_prod",    t: "Cost of production",       x: 762, y: 74,  w: 156, h: 22, c: "supply" },
  { id: "exp_profit",   t: "Expected Profitability",   x: 744, y: 110, w: 110, h: 36, c: "supply", big: true },
  { id: "ripe_cherry",  t: "Ripe cherry ratio",        x: 548, y: 118, w: 74,  h: 46, c: "supply" },
  { id: "conversion",   t: "Conversion ratio",         x: 548, y: 168, w: 74,  h: 34, c: "supply" },
  { id: "tree_age",     t: "Tree age",                 x: 676, y: 168, w: 90,  h: 24, c: "supply" },
  { id: "acreage",      t: "Acreage allocation",       x: 614, y: 212, w: 80,  h: 38, c: "supply" },
  { id: "tree_density", t: "Tree density",             x: 620, y: 256, w: 70,  h: 42, c: "supply" },
  { id: "tree_yield",   t: "Tree yield",               x: 620, y: 302, w: 70,  h: 42, c: "supply" },
  { id: "weather",      t: "Weather",                  x: 730, y: 288, w: 88,  h: 20, c: "supply" },
  { id: "fertilizer",   t: "Fertilizer",               x: 730, y: 312, w: 88,  h: 20, c: "supply" },
  { id: "irrigation",   t: "Irrigation",               x: 730, y: 336, w: 88,  h: 20, c: "supply" },
  { id: "crop",         t: "Crop",                     x: 484, y: 252, w: 62,  h: 32, c: "supply", big: true },
  { id: "farmer_stock", t: "Farmer's stock",           x: 480, y: 292, w: 74,  h: 34, c: "supply" },
  { id: "farm_finance", t: "Farmers financing",        x: 480, y: 334, w: 74,  h: 34, c: "supply" },
  { id: "farm_price",   t: "Farmers like the price",   x: 480, y: 376, w: 74,  h: 38, c: "supply" },
  { id: "origin_stock", t: "Visible origin stocks",    x: 590, y: 382, w: 70,  h: 46, c: "supply" },
  { id: "dest_stock",   t: "Destination stocks",       x: 590, y: 434, w: 70,  h: 34, c: "supply" },
  { id: "supply",       t: "Supply",                   x: 628, y: 474, w: 92,  h: 26, c: "supply", big: true },
  // ── demand ────────────────────────────────────────────────────────────
  { id: "coffee_cult",  t: "Coffee culture",           x: 1006, y: 24,  w: 90,  h: 40, c: "demand", big: true },
  { id: "inflation",    t: "Inflation",                x: 1086, y: 78,  w: 64,  h: 20, c: "demand" },
  { id: "wages",        t: "Wages",                    x: 1086, y: 102, w: 64,  h: 20, c: "demand" },
  { id: "purch_power",  t: "Purchasing power",         x: 1064, y: 130, w: 86,  h: 36, c: "demand" },
  { id: "product_mix",  t: "Product mix",              x: 1006, y: 168, w: 90,  h: 38, c: "demand", big: true },
  { id: "gram_cup",     t: "Gram per cup",             x: 1012, y: 220, w: 78,  h: 36, c: "demand" },
  { id: "cup_capita",   t: "Cup per capita",           x: 1008, y: 260, w: 84,  h: 36, c: "demand" },
  { id: "blend",        t: "Blend",                    x: 1008, y: 300, w: 84,  h: 28, c: "demand", big: true },
  { id: "population",   t: "Population growth",        x: 1006, y: 332, w: 86,  h: 34, c: "demand" },
  { id: "consumption",  t: "Consumption",              x: 942,  y: 374, w: 104, h: 28, c: "demand" },
  { id: "destination",  t: "Destination",              x: 824,  y: 400, w: 110, h: 28, c: "demand" },
  { id: "origin",       t: "Origin",                   x: 824,  y: 434, w: 110, h: 28, c: "demand" },
  { id: "demand",       t: "Demand",                   x: 754,  y: 474, w: 96,  h: 26, c: "demand", big: true },
  // ── positioning ───────────────────────────────────────────────────────
  { id: "shapley",      t: "Shapley Owen",             x: 12,  y: 328, w: 92,  h: 48, c: "positioning" },
  { id: "radial",       t: "Radial",                   x: 106, y: 328, w: 58,  h: 48, c: "positioning" },
  { id: "coverage",     t: "Roasters and Producers' coverage", x: 166, y: 328, w: 98, h: 48, c: "positioning" },
  { id: "impl_blend",   t: "Implied blend",            x: 266, y: 328, w: 72,  h: 48, c: "positioning" },
  { id: "id_makers",    t: "Identification of market makers",  x: 26, y: 400, w: 120, h: 70, c: "positioning" },
  { id: "id_counter",   t: "Identification of counterparties", x: 148, y: 400, w: 114, h: 70, c: "positioning" },
  { id: "link_fund",    t: "Link with fundamentals",   x: 264, y: 400, w: 122, h: 70, c: "positioning" },
  { id: "opt_curve",    t: "Option curve",             x: 98,  y: 504, w: 92,  h: 46, c: "positioning" },
  { id: "nondir",       t: "Non directional sentiment", x: 98, y: 554, w: 92,  h: 54, c: "positioning" },
  { id: "pos_risk",     t: "Positioning risk, sentiment and conviction", x: 98, y: 612, w: 92, h: 70, c: "positioning" },
  { id: "mkt_state",    t: "Assess the current market state",  x: 214, y: 488, w: 148, h: 56, c: "positioning" },
  { id: "mkt_feeling",  t: "Assess the market's feeling",      x: 214, y: 558, w: 148, h: 44, c: "positioning" },
  { id: "pos_likely",   t: "Assess the likelihood of a position to get bigger/liquidated", x: 214, y: 610, w: 148, h: 64, c: "positioning" },
  { id: "ecy_icy",      t: "E.CY/I.CY",                x: 402, y: 452, w: 150, h: 22, c: "positioning" },
  { id: "pp2",          t: "Purchasing power",         x: 402, y: 478, w: 150, h: 22, c: "positioning" },
  { id: "cpi_wages",    t: "CPI, wages, interests",    x: 402, y: 502, w: 150, h: 22, c: "positioning" },
  { id: "macro",        t: "Macro",                    x: 456, y: 528, w: 96,  h: 28, c: "positioning", big: true },
  { id: "pos_analysis", t: "Positioning analysis",     x: 382, y: 560, w: 112, h: 44, c: "positioning", big: true },
  { id: "trade_sig",    t: "Assess trading signals",   x: 98,  y: 694, w: 124, h: 44, c: "positioning" },
  { id: "funds_motiv",  t: "Funds motivation to adjust positions", x: 300, y: 686, w: 124, h: 58, c: "positioning" },
  { id: "pos_mismatch", t: "Positioning mismatch",     x: 8,   y: 762, w: 100, h: 46, c: "positioning" },
  { id: "ob_os",        t: "OB / OS",                  x: 110, y: 762, w: 68,  h: 46, c: "positioning" },
  { id: "dry_powder",   t: "Dry powder",               x: 180, y: 762, w: 86,  h: 46, c: "positioning" },
  { id: "chg_speed",    t: "Potential change speed",   x: 268, y: 762, w: 110, h: 46, c: "positioning" },
  { id: "fund_perf",    t: "Funds performance",        x: 380, y: 762, w: 110, h: 46, c: "positioning" },
  { id: "risk_premia",  t: "Risk premia",              x: 492, y: 762, w: 78,  h: 46, c: "positioning" },
  { id: "cta",          t: "CTA",                      x: 572, y: 762, w: 52,  h: 46, c: "positioning" },
  // ── exchange economics ────────────────────────────────────────────────
  { id: "logistic",     t: "Logistic cost",            x: 1082, y: 368, w: 150, h: 22, c: "exchange" },
  { id: "prem_disc",    t: "Premium/discount",         x: 1082, y: 394, w: 150, h: 22, c: "exchange" },
  { id: "warehouse",    t: "Warehousing cost",         x: 1082, y: 418, w: 150, h: 22, c: "exchange" },
  { id: "tender_par",   t: "Tenderable parity",        x: 1016, y: 448, w: 120, h: 22, c: "exchange" },
  { id: "structure",    t: "Structure",                x: 1016, y: 474, w: 120, h: 22, c: "exchange" },
  { id: "afloat",       t: "Coffee afloat to grading ports", x: 1140, y: 450, w: 136, h: 46, c: "exchange" },
  { id: "motiv_grade",  t: "Motivation to grade coffee",     x: 948, y: 504, w: 126, h: 54, c: "exchange" },
  { id: "motiv_squeeze", t: "Motivation to squeeze",         x: 948, y: 562, w: 126, h: 54, c: "exchange" },
  { id: "motiv_stop",   t: "Motivation to stop coffee (spread)", x: 948, y: 620, w: 126, h: 72, c: "exchange" },
  { id: "stocks_vol",   t: "Stocks volume",            x: 1110, y: 508, w: 122, h: 24, c: "exchange" },
  { id: "pos_limit",    t: "Position limit",           x: 1110, y: 534, w: 122, h: 24, c: "exchange" },
  { id: "oi_repart",    t: "OI repartition",           x: 1110, y: 564, w: 122, h: 24, c: "exchange" },
  { id: "new_rule",     t: "New rule",                 x: 1110, y: 590, w: 122, h: 24, c: "exchange" },
  { id: "ageing",       t: "Ageing",                   x: 1258, y: 552, w: 88,  h: 24, c: "exchange" },
  { id: "quality",      t: "Quality",                  x: 1258, y: 580, w: 88,  h: 24, c: "exchange" },
  { id: "poison",       t: "Poison pill",              x: 1108, y: 618, w: 92,  h: 24, c: "exchange" },
  { id: "exp_comm",     t: "Expected commercial value", x: 1104, y: 644, w: 102, h: 48, c: "exchange" },
  { id: "exp_disc",     t: "Expected discount",        x: 1206, y: 622, w: 84,  h: 46, c: "exchange" },
  // ── the diamond ───────────────────────────────────────────────────────
  { id: "sd",           t: "SUPPLY & DEMAND",          x: 646, y: 510, w: 184, h: 36, c: "core", big: true },
  { id: "futures",      t: "FUTURES PRICE",            x: 558, y: 558, w: 104, h: 60, c: "core", big: true },
  { id: "exch_econ",    t: "EXCHANGE ECONOMICS",       x: 826, y: 556, w: 100, h: 52, c: "core", big: true },
  { id: "differential", t: "DIFFERENTIAL",             x: 646, y: 740, w: 184, h: 54, c: "core", big: true },
];

export const BY_ID = new Map(NODES.map(n => [n.id, n]));
export const cx = (n: N) => n.x + n.w / 2;
export const cy = (n: N) => n.y + n.h / 2;

// Edges — the chart's flow. Not every hairline from the source, but every
// structural path: what feeds what, and how the four clusters reach the diamond.
export const EDGES: [string, string][] = [
  ["early_dry","harvest_time"],["harvest_time","ripe_cherry"],["ripe_cherry","conversion"],
  ["other_crops","exp_profit"],["cost_prod","exp_profit"],["exp_profit","prehar_price"],
  ["prehar_price","acreage"],["exp_profit","acreage"],["tree_age","tree_density"],
  ["acreage","crop"],["tree_density","crop"],["tree_yield","crop"],["conversion","crop"],
  ["weather","tree_yield"],["fertilizer","tree_yield"],["irrigation","tree_yield"],
  ["crop","farmer_stock"],["farmer_stock","origin_stock"],["farm_finance","origin_stock"],
  ["farm_price","origin_stock"],["origin_stock","dest_stock"],["origin_stock","supply"],
  ["dest_stock","supply"],
  ["inflation","purch_power"],["wages","purch_power"],["purch_power","product_mix"],
  ["coffee_cult","product_mix"],["product_mix","gram_cup"],["product_mix","cup_capita"],
  ["product_mix","blend"],["product_mix","population"],["gram_cup","consumption"],
  ["cup_capita","consumption"],["blend","consumption"],["population","consumption"],
  ["consumption","destination"],["consumption","origin"],["destination","demand"],["origin","demand"],
  ["shapley","id_makers"],["radial","id_makers"],["coverage","id_counter"],["impl_blend","link_fund"],
  ["id_makers","mkt_state"],["id_counter","mkt_state"],["link_fund","mkt_state"],
  ["opt_curve","mkt_state"],["nondir","mkt_feeling"],["pos_risk","pos_likely"],
  ["mkt_state","pos_analysis"],["mkt_feeling","pos_analysis"],["pos_likely","pos_analysis"],
  ["ecy_icy","macro"],["pp2","macro"],["cpi_wages","macro"],["macro","pos_analysis"],
  ["pos_mismatch","trade_sig"],["ob_os","trade_sig"],["dry_powder","trade_sig"],
  ["chg_speed","funds_motiv"],["fund_perf","funds_motiv"],["risk_premia","funds_motiv"],["cta","funds_motiv"],
  ["trade_sig","mkt_feeling"],["funds_motiv","pos_likely"],
  ["logistic","tender_par"],["prem_disc","tender_par"],["warehouse","tender_par"],
  ["afloat","tender_par"],["tender_par","motiv_grade"],["structure","motiv_grade"],
  ["stocks_vol","motiv_grade"],["pos_limit","motiv_squeeze"],["oi_repart","motiv_squeeze"],
  ["new_rule","motiv_squeeze"],["ageing","stocks_vol"],["quality","oi_repart"],
  ["poison","motiv_stop"],["exp_comm","motiv_stop"],["exp_disc","exp_comm"],
  ["motiv_grade","exch_econ"],["motiv_squeeze","exch_econ"],["motiv_stop","exch_econ"],
  ["supply","sd"],["demand","sd"],["pos_analysis","futures"],
];


// The source chart's own extent — used as the viewBox so the transcribed
// coordinates render at the original proportions rather than a re-fit.
export const MAP_W = 1380;
export const MAP_H = 820;
