// Coffee crop layer — shared types and the colour scale.
//
// Kept out of CoffeeMap.tsx so the scale can be reasoned about (and reused by a
// legend) without touching Leaflet wiring.
//
// Encoding: coffee hectares is a MAGNITUDE, so this is a sequential ramp — one
// hue, light→dark — never a rainbow. The anchor is flipped for the map's dark
// surface: near-zero is the darkest step so it recedes into the basemap, and
// more coffee reads as brighter. Steps are the reference blue ramp; verified
// monotonic in luminance (the actual check for a sequential ramp) with the
// lowest step at 2.20:1 against the map surface #0f172a.

export type CropMunicipality = {
  geocode: string;
  name: string;
  state: string;
  uf: string;
  series: number[];
};

export type CropArea = {
  updated: string;
  source: string;
  unit: string;
  caveat: string;
  years: number[];
  brazil_total: number[];
  states: { state: string; series: number[] }[];
  municipalities: CropMunicipality[];
};

// Upper bound (hectares) → fill. Ascending; last entry catches the rest.
// Breaks are roughly log-spaced because coffee area spans 1 → ~41,000 ha, so
// linear buckets would put almost every municipality in the bottom class.
export const CROP_BUCKETS: { max: number; color: string; label: string }[] = [
  { max: 100, color: "#184f95", label: "<100" },
  { max: 500, color: "#256abf", label: "100–500" },
  { max: 2_000, color: "#3987e5", label: "500–2k" },
  { max: 5_000, color: "#6da7ec", label: "2k–5k" },
  { max: 15_000, color: "#9ec5f4", label: "5k–15k" },
  { max: Infinity, color: "#cde2fb", label: "15k+" },
];

/** Fill for a hectare value; null when there is no coffee to draw. */
export function cropColor(ha: number): string | null {
  if (!ha || ha <= 0) return null;
  for (const b of CROP_BUCKETS) if (ha <= b.max) return b.color;
  return CROP_BUCKETS[CROP_BUCKETS.length - 1].color;
}

// ── Footprint (raster-derived ~1.1 km cells) ────────────────────────────────
// A cell tops out around 120 ha, versus ~41,000 for a whole municipality, so
// it needs its own breaks. Same hue ramp on purpose: the two views are shown
// one at a time, never stacked, so "brighter = more coffee" carries across
// both rather than competing for the reader's attention.
export type CoffeeFootprint = {
  updated: string;
  source: string;
  year: number;
  cell_degrees: number;
  total_ha: number;
  note: string;
  cells: [number, number, number][]; // [lon, lat, hectares] — SW corner
};

export const FOOTPRINT_BUCKETS: { max: number; color: string }[] = [
  { max: 10, color: "#184f95" },
  { max: 25, color: "#256abf" },
  { max: 45, color: "#3987e5" },
  { max: 70, color: "#6da7ec" },
  { max: 95, color: "#9ec5f4" },
  { max: Infinity, color: "#cde2fb" },
];

export function footprintColor(ha: number): string {
  for (const b of FOOTPRINT_BUCKETS) if (ha <= b.max) return b.color;
  return FOOTPRINT_BUCKETS[FOOTPRINT_BUCKETS.length - 1].color;
}

export function formatHa(ha: number): string {
  if (ha >= 1000) return `${(ha / 1000).toFixed(ha >= 10_000 ? 0 : 1)}k ha`;
  return `${Math.round(ha)} ha`;
}

/** geocode → hectares for one year, for O(1) styling of ~1,600 polygons. */
export function areaByGeocode(area: CropArea, year: number): Map<string, number> {
  const idx = area.years.indexOf(year);
  const out = new Map<string, number>();
  if (idx < 0) return out;
  for (const m of area.municipalities) out.set(m.geocode, m.series[idx] ?? 0);
  return out;
}
