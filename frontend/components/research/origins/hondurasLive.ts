// Live series behind the Honduras profile's vintage check.
//
// The 2021 dossier is a historical document and stays frozen as constants in
// the component. Everything that answers "is this still true?" has to be the
// opposite — read from the app's own nightly JSON, so the check ages with the
// data instead of becoming a second thing to re-verify by hand in a year.
//
// Every number this module returns is derived here and rendered as-is; the
// component does no arithmetic of its own on live data.
import { cachedFetchStatic } from "@/lib/api";

/** PSD reports Honduras in tonnes; the dossier and the app talk in bags. */
const MT_PER_K_BAGS = 60;
export const kBags = (mt: number) => mt / MT_PER_K_BAGS;

export interface PsdYear {
  /** Season start year, e.g. 2020 for 2020-21. PSD labels rows this way. */
  y: number;
  init: number; prod: number; imp: number; exp: number; dom: number; end: number;
  /** init + prod + imp − exp − dom − end. See `psdResidualNote`. */
  resid: number;
}

export interface Estimate { season: string; usda: number | null; marex: number | null; forecast: boolean }

export interface DiffRow { grade: string; certified: boolean; cents: number; port: string }

export interface GradeStat { grade: string; n: number; median: number; lo: number; hi: number }

export interface VhiRow { region: string; week: string; vhi: number; severity: string }

export interface MonthIndex { m: number; index: number; n: number }

export interface HondurasLive {
  asOf: { psd: string | null; spot: string | null; vhi: string | null; port: string | null };
  psd: PsdYear[];
  estimates: Estimate[];
  /** Median differential by grade, conventional offers only. */
  conventional: GradeStat[];
  /** Median differential by grade, certified offers only. */
  certified: GradeStat[];
  offersTotal: number;
  offersQuoted: number;
  portShare: { port: string; n: number }[];
  vhi: VhiRow[];
  /** App region weights, sourced from IHCAFE 2024 departmental output. */
  appRegions: { name: string; weight: number }[];
  /** Container-export seasonality at Puerto Cortés, 100 = average month. */
  cortes: MonthIndex[];
  /** Pearson r between the port index and the dossier's harvest share, by lag. */
  cortesLag: { lag: number; r: number }[];
  cortesYears: { year: number; springX: number; autumnX: number }[];
}

// ── helpers ────────────────────────────────────────────────────────────────

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den ? num / den : NaN;
}

/** "plus 49" / "minus 94" → ±49. Outright quotes ("€/kg 7,1") return null:
 *  they are a price, not a differential, and averaging the two would be
 *  meaningless. */
export function parseDiff(raw: unknown): number | null {
  const m = /^(plus|minus)\s+(\d+(?:[.,]\d+)?)$/i.exec(String(raw ?? "").trim());
  if (!m) return null;
  const v = Number(m[2].replace(",", "."));
  if (!Number.isFinite(v)) return null;
  return m[1].toLowerCase() === "plus" ? v : -v;
}

function stat(grade: string, rows: DiffRow[]): GradeStat | null {
  if (!rows.length) return null;
  const v = rows.map(r => r.cents).sort((a, b) => a - b);
  return { grade, n: v.length, median: median(v), lo: v[0], hi: v[v.length - 1] };
}

// ── shapes of the JSON we read (only the fields used) ──────────────────────

interface RawProducerYear {
  year: string; begin_stocks_mt: number; production_mt: number; imports_mt: number;
  exports_mt: number; consumption_mt: number; stocks_mt: number;
}
interface RawSpotRow { Origin?: string; Quality?: string; Certification?: string; Port?: string; Price?: string }
interface RawPortDay { date: string; export_container?: number }

const GRADES = ["SHG", "HG", "Stocklot"];

/** The dossier's harvest pace, keyed by calendar month — the series the port
 *  index is tested against. Duplicated from the component deliberately: this
 *  module must be testable without importing React. */
export const HARVEST_BY_MONTH: Record<number, number> =
  { 9: 1, 10: 6, 11: 18, 12: 32, 1: 28, 2: 10, 3: 3 };

export function cortesSeasonality(days: RawPortDay[]): {
  index: MonthIndex[]; lags: { lag: number; r: number }[];
  years: { year: number; springX: number; autumnX: number }[];
} {
  const tot = new Map<string, number>();
  const obs = new Map<string, number>();
  for (const d of days) {
    const ym = String(d.date ?? "").slice(0, 7);
    if (ym.length !== 7) continue;
    tot.set(ym, (tot.get(ym) ?? 0) + (d.export_container ?? 0));
    obs.set(ym, (obs.get(ym) ?? 0) + 1);
  }
  // A month observed for under 27 days is a truncated first/last month; its
  // total is low for a calendar reason, not a trade one.
  const full: string[] = [];
  obs.forEach((n, ym) => { if (n >= 27) full.push(ym); });
  full.sort();
  if (full.length < 12) return { index: [], lags: [], years: [] };

  const mean = full.reduce((s, ym) => s + (tot.get(ym) ?? 0), 0) / full.length;
  const byMonth = new Map<number, number[]>();
  for (const ym of full) {
    const m = Number(ym.slice(5, 7));
    const arr = byMonth.get(m) ?? [];
    arr.push(((tot.get(ym) ?? 0) / mean) * 100);
    byMonth.set(m, arr);
  }
  const index: MonthIndex[] = [];
  byMonth.forEach((v, m) => {
    index.push({ m, index: v.reduce((s, x) => s + x, 0) / v.length, n: v.length });
  });
  index.sort((a, b) => a.m - b.m);

  // Shipping cannot precede picking, so only non-negative lags are tested —
  // and the lag is read off where r peaks, not assumed.
  const lags: { lag: number; r: number }[] = [];
  for (let lag = 0; lag <= 4; lag++) {
    const xs: number[] = [], ys: number[] = [];
    for (const row of index) {
      const src = ((row.m - lag - 1 + 12) % 12) + 1;
      xs.push(row.index);
      ys.push(HARVEST_BY_MONTH[src] ?? 0);
    }
    lags.push({ lag, r: pearson(xs, ys) });
  }

  // Per-year check: one pooled correlation can be carried by a single season.
  const years: { year: number; springX: number; autumnX: number }[] = [];
  const yrs: number[] = [];
  full.forEach(ym => { const y = Number(ym.slice(0, 4)); if (!yrs.includes(y)) yrs.push(y); });
  for (const y of yrs) {
    const ms = new Map<number, number>();
    for (const ym of full) if (ym.slice(0, 4) === String(y)) ms.set(Number(ym.slice(5, 7)), tot.get(ym) ?? 0);
    if (ms.size < 10) continue;                    // a part-year proves nothing
    let sum = 0; ms.forEach(v => { sum += v; });
    const avg = sum / ms.size;
    const pick = (a: number[]) => {
      const got = a.map(m => ms.get(m)).filter((x): x is number => x != null);
      return got.length ? got.reduce((s, x) => s + x, 0) / got.length / avg : NaN;
    };
    years.push({ year: y, springX: pick([3, 4]), autumnX: pick([10, 11]) });
  }
  return { index, lags, years };
}

// ── load ───────────────────────────────────────────────────────────────────

/** One missing file must not take the whole section down: an origin profile
 *  that renders four checks out of five is worth more than one that renders
 *  an error. The fallback carries the declared shape so the caller's narrowing
 *  survives. */
function soft<T>(path: string, fallback: T): Promise<T> {
  return cachedFetchStatic<T>(path).catch(() => fallback);
}

type RawSupply = { producers?: Record<string, { annual?: RawProducerYear[] }> };
type RawBalance = { updated?: string; seasons?: { season: string; forecast?: boolean;
  production?: { usda?: number; marex?: number } }[] };
type RawSpot = { as_of?: string; rows?: RawSpotRow[] };
type RawVhi = { generated_at?: string; provinces?: Record<string, {
  vhi_latest?: { iso_week?: string; vhi?: number; severity?: string } }> };
type RawWeather = { provinces?: { name: string; weight: number }[] };
type RawPort = { end?: string; series?: RawPortDay[] };

export async function loadHondurasLive(): Promise<HondurasLive> {
  const [supply, bs, spot, vhi, wx, port] = await Promise.all([
    soft<RawSupply>("/data/demand_stocks.json", {}),
    soft<RawBalance>("/data/hn_balance_sheet.json", {}),
    soft<RawSpot>("/data/spot_coffee.json", {}),
    soft<RawVhi>("/data/vhi_honduras.json", {}),
    soft<RawWeather>("/data/honduras_weather.json", {}),
    soft<RawPort>("/data/port_activity/cortes.json", {}),
  ]);

  const annual = supply.producers?.honduras?.annual ?? [];
  const psd: PsdYear[] = annual
    .filter(r => Number(r.year) >= 2010)
    .map(r => {
      const o = {
        y: Number(r.year),
        init: kBags(r.begin_stocks_mt), prod: kBags(r.production_mt),
        imp: kBags(r.imports_mt), exp: kBags(r.exports_mt),
        dom: kBags(r.consumption_mt), end: kBags(r.stocks_mt),
      };
      return { ...o, resid: o.init + o.prod + o.imp - o.exp - o.dom - o.end };
    });

  const estimates: Estimate[] = (bs.seasons ?? []).map(s => ({
    season: s.season,
    usda: s.production?.usda ?? null,
    marex: s.production?.marex ?? null,
    forecast: Boolean(s.forecast),
  }));

  const rows = (spot.rows ?? []).filter(r => String(r.Origin ?? "").toUpperCase() === "HONDURAS");
  const offers: DiffRow[] = [];
  for (const r of rows) {
    const c = parseDiff(r.Price);
    if (c == null) continue;
    offers.push({
      grade: String(r.Quality ?? "").trim(),
      certified: Boolean(String(r.Certification ?? "").trim()),
      cents: c,
      port: String(r.Port ?? "").trim(),
    });
  }
  const pick = (cert: boolean) => GRADES
    .map(g => stat(g, offers.filter(o => o.grade === g && o.certified === cert)))
    .filter((s): s is GradeStat => s != null);

  const portCount = new Map<string, number>();
  for (const r of rows) {
    const p = String(r.Port ?? "").trim() || "—";
    portCount.set(p, (portCount.get(p) ?? 0) + 1);
  }
  const portShare: { port: string; n: number }[] = [];
  portCount.forEach((n, port) => portShare.push({ port, n }));
  portShare.sort((a, b) => b.n - a.n);

  const vhiRows: VhiRow[] = [];
  const provs = vhi.provinces ?? {};
  for (const name of Object.keys(provs)) {
    const L = provs[name]?.vhi_latest;
    if (!L || typeof L.vhi !== "number") continue;
    vhiRows.push({ region: name, week: L.iso_week ?? "—", vhi: L.vhi, severity: L.severity ?? "—" });
  }
  vhiRows.sort((a, b) => a.vhi - b.vhi);

  const cortes = cortesSeasonality(port.series ?? []);

  return {
    asOf: {
      psd: bs.updated ?? null, spot: spot.as_of ?? null,
      vhi: vhi.generated_at?.slice(0, 10) ?? null, port: port.end ?? null,
    },
    psd, estimates,
    conventional: pick(false), certified: pick(true),
    offersTotal: rows.length, offersQuoted: offers.length,
    portShare, vhi: vhiRows,
    appRegions: (wx.provinces ?? []).map(p => ({ name: p.name, weight: p.weight })),
    cortes: cortes.index, cortesLag: cortes.lags, cortesYears: cortes.years,
  };
}
