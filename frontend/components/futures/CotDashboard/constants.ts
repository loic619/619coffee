// Lookup tables, palettes, and shared style tokens for the CoT dashboard.

// ── Macro COT (cross-commodity) palettes ──────────────────────────────────────

export const SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;
export type SectorKey = typeof SECTORS[number];

export const SECTOR_COLORS: Record<string, string> = {
  energy: "#f97316",
  metals: "#6366f1",
  grains: "#f59e0b",
  meats:  "#ef4444",
  softs:  "#10b981",
  micros: "#8b5cf6",
};

export const ENERGY_SYMBOLS = new Set(["wti", "brent", "natgas", "heating_oil", "rbob", "lsgo"]);

export const SOFT_SYMBOLS: { key: string; label: string; color: string }[] = [
  { key: "arabica",     label: "Arabica Coffee",  color: "#f59e0b" },
  { key: "robusta",     label: "Robusta Coffee",  color: "#78350f" },
  { key: "sugar11",     label: "Sugar No. 11",    color: "#a3e635" },
  { key: "white_sugar", label: "White Sugar",     color: "#d1fae5" },
  { key: "cotton",      label: "Cotton",          color: "#60a5fa" },
  { key: "cocoa_ny",    label: "Cocoa NY",        color: "#a78bfa" },
  { key: "cocoa_ldn",   label: "Cocoa London",    color: "#7c3aed" },
  { key: "oj",          label: "Orange Juice",    color: "#fb923c" },
];

// Per-sector contract lists for the "MM Exposure — by Contract" detail panels.
// Keys match MacroCotEntry symbols; sector membership mirrors COMMODITY_SPECS
// in backend/scraper/sources/macro_cot.py ("hard" split into energy vs metals).
export const SECTOR_CONTRACTS: Record<SectorKey, { key: string; label: string; color: string }[]> = {
  softs: SOFT_SYMBOLS,
  energy: [
    { key: "wti",         label: "WTI Crude",     color: "#f97316" },
    { key: "brent",       label: "Brent Crude",   color: "#fbbf24" },
    { key: "natgas",      label: "Natural Gas",   color: "#38bdf8" },
    { key: "heating_oil", label: "Heating Oil",   color: "#f87171" },
    { key: "rbob",        label: "RBOB Gasoline", color: "#c084fc" },
    { key: "lsgo",        label: "Gasoil",        color: "#94a3b8" },
  ],
  metals: [
    { key: "gold",      label: "Gold",      color: "#facc15" },
    { key: "silver",    label: "Silver",    color: "#cbd5e1" },
    { key: "copper",    label: "Copper",    color: "#ea580c" },
    { key: "platinum",  label: "Platinum",  color: "#5eead4" },
  ],
  grains: [
    { key: "corn",      label: "Corn",         color: "#facc15" },
    { key: "wheat",     label: "Wheat (SRW)",  color: "#d6a760" },
    { key: "wheat_hrw", label: "Wheat (HRW)",  color: "#f87171" },
    { key: "soybeans",  label: "Soybeans",     color: "#84cc16" },
    { key: "soy_meal",  label: "Soybean Meal", color: "#a16207" },
    { key: "soy_oil",   label: "Soybean Oil",  color: "#fde68a" },
  ],
  meats: [
    { key: "live_cattle",   label: "Live Cattle",   color: "#ef4444" },
    { key: "feeder_cattle", label: "Feeder Cattle", color: "#fb923c" },
    { key: "lean_hogs",     label: "Lean Hogs",     color: "#f9a8d4" },
  ],
  micros: [
    { key: "oats",       label: "Oats",       color: "#a3e635" },
    { key: "lumber",     label: "Lumber",     color: "#a16207" },
  ],
};

// ── Step 5 (Dry Powder) categories ────────────────────────────────────────────

export const CAT_ITEMS = [
  { k: "pmpu",   l: "PMPU",          c: "#3b82f6" },
  { k: "mm",     l: "Managed Money", c: "#f59e0b" },
  { k: "swap",   l: "Swap/Index",    c: "#10b981" },
  { k: "other",  l: "Other Rept",    c: "#64748b" },
  { k: "nonrep", l: "Non Rept",      c: "#94a3b8" },
];

// ── Steps 2 & 3 (Heatmap & Gauges) per-category colors ────────────────────────

export const HM_CAT_COLORS: Record<string, string> = {
  "PMPU": "#92400e", "Swap": "#10b981", "MM": "#1e40af",
  "Other Rpt": "#38bdf8", "Non-Rep": "#64748b",
};

// ── Step 1 attribution table ──────────────────────────────────────────────────

export const SECTOR_ORDER_ATTR = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

export const SECTOR_LABELS_ATTR: Record<string, string> = {
  energy: "Energy", metals: "Metals", grains: "Grains",
  meats: "Meats", softs: "Softs", micros: "Micros",
};

// ── Shared style tokens ───────────────────────────────────────────────────────

export const CHART_STYLE = { backgroundColor: "#0f172a", borderColor: "#334155" };
