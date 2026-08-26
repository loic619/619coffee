// Aggregating the per-origin crop estimates into a world view, by source.
//
// THE CONSTRAINT THAT SHAPES EVERYTHING HERE: sources do not cover the same
// origins. Marex and USDA publish all sixteen. CONAB publishes Brazil. FNC
// publishes Colombia. StoneX publishes Ethiopia. Summing a source across the
// origins it happens to cover and calling the result a world estimate would
// put CONAB's Brazil-only 55 on the same axis as Marex's world 165 — a chart
// that looks like a disagreement about the crop and is actually a difference
// in scope.
//
// So every aggregate carries its coverage, and the world comparison only
// admits sources that estimate the world. The rest are origin specialists and
// are worth reading against each other WITHIN their origin, which is what the
// by-source table does.

import { ORIGIN_FILES } from "@/lib/worldBalance";

export interface SeedSeason {
  season: string;
  forecast?: boolean;
  production?: Record<string, number>;
  production_split?: Record<string, Record<string, number>>;
  production_final?: number;
}
export interface SeedDoc {
  unit?: string;
  sources?: { key: string; label: string; color: string }[];
  seasons?: SeedSeason[];
}

export interface SourceMeta { key: string; label: string; color: string }

/** One source's aggregate for one season, with the coverage behind it. */
export interface SourceAggregate {
  source: string;
  season: string;
  m_bags: number;
  origins: string[];
}

export interface SdBundle {
  /** origin key → its seed */
  seeds: Record<string, SeedDoc>;
  /** every season any seed mentions, chronological */
  seasons: string[];
  /** source key → label/colour, merged across seeds */
  sources: Record<string, SourceMeta>;
  /** source → season → aggregate */
  world: Record<string, Record<string, SourceAggregate>>;
  /** how many origins each source covers, at its best season */
  coverage: Record<string, number>;
  originCount: number;
}

const FALLBACK_COLOR = "#94a3b8";

export async function loadSdBundle(bust = 0): Promise<SdBundle> {
  const entries = await Promise.all(
    Object.entries(ORIGIN_FILES).map(async ([origin, cfg]) => {
      try {
        const r = await fetch(`/data/${cfg.file}?t=${bust}`);
        if (!r.ok) return [origin, null] as const;
        const raw = await r.json();
        const seed: SeedDoc = cfg.subkey ? raw?.[cfg.subkey] : raw;
        return [origin, seed ?? null] as const;
      } catch {
        return [origin, null] as const;
      }
    }),
  );

  const seeds: Record<string, SeedDoc> = {};
  const sources: Record<string, SourceMeta> = {};
  const seasonSet = new Set<string>();
  const world: Record<string, Record<string, SourceAggregate>> = {};

  for (const [origin, seed] of entries) {
    if (!seed) continue;
    seeds[origin] = seed;
    for (const s of seed.sources ?? []) {
      if (!sources[s.key]) {
        sources[s.key] = { key: s.key, label: s.label, color: s.color || FALLBACK_COLOR };
      }
    }
    for (const season of seed.seasons ?? []) {
      seasonSet.add(season.season);
      for (const [src, value] of Object.entries(season.production ?? {})) {
        if (typeof value !== "number") continue;
        const bySeason = (world[src] ??= {});
        const agg = (bySeason[season.season] ??= {
          source: src, season: season.season, m_bags: 0, origins: [],
        });
        agg.m_bags = Math.round((agg.m_bags + value) * 10) / 10;
        agg.origins.push(origin);
      }
    }
  }

  const coverage: Record<string, number> = {};
  for (const [src, bySeason] of Object.entries(world)) {
    coverage[src] = Math.max(...Object.values(bySeason).map(a => a.origins.length), 0);
  }

  return {
    seeds,
    seasons: Array.from(seasonSet).sort(),
    sources,
    world,
    coverage,
    originCount: Object.keys(ORIGIN_FILES).length,
  };
}

/** Sources whose coverage is complete enough to read as a world estimate.
 *  Anything below the threshold is an origin specialist, not a world view. */
export function worldCapableSources(b: SdBundle, minShare = 0.9): string[] {
  const need = b.originCount * minShare;
  return Object.keys(b.world)
    .filter(src => (b.coverage[src] ?? 0) >= need)
    .sort((a, z) => (b.coverage[z] ?? 0) - (b.coverage[a] ?? 0));
}

/** The consensus this repo already uses per origin: analyst Final where set,
 *  otherwise the mean of that origin's sources. Summed to a world figure.
 *
 *  Returns null unless enough origins carry an estimate. Before 2021/22 only
 *  CCS reaches back, and it maps to nine of our sixteen seeds — summing those
 *  nine produced a "consensus" of 132 against CCS's own 162 and drew a cliff
 *  in the line that was pure coverage, not a crop. A gap is better than a
 *  wrong number drawn confidently. */
export function derivedWorld(b: SdBundle, season: string, minShare = 0.9): number | null {
  let total = 0, seen = 0;
  for (const seed of Object.values(b.seeds)) {
    const s = (seed.seasons ?? []).find(x => x.season === season);
    if (!s) continue;
    const vals = Object.values(s.production ?? {});
    const head = s.production_final ?? (vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0);
    if (head > 0) { total += head; seen++; }
  }
  return seen >= Object.keys(b.seeds).length * minShare
    ? Math.round(total * 10) / 10
    : null;
}

/** Per-origin spread across sources for one season — where the houses
 *  disagree, which is more tradeable than where they agree. */
export interface OriginSpread {
  origin: string; label: string;
  min: number; max: number; mean: number; n: number;
  low: string; high: string;          // which source sits at each end
  spreadPct: number;                  // (max-min)/mean
  final?: number | null;
}

export function originSpreads(b: SdBundle, season: string): OriginSpread[] {
  const out: OriginSpread[] = [];
  for (const [origin, seed] of Object.entries(b.seeds)) {
    const s = (seed.seasons ?? []).find(x => x.season === season);
    const entries = Object.entries(s?.production ?? {});
    if (entries.length < 2) continue;   // a spread needs two opinions
    const vals = entries.map(([, v]) => v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    out.push({
      origin,
      label: ORIGIN_FILES[origin]?.label ?? origin,
      min: Math.round(min * 10) / 10,
      max: Math.round(max * 10) / 10,
      mean: Math.round(mean * 10) / 10,
      n: entries.length,
      low: entries.find(([, v]) => v === min)?.[0] ?? "",
      high: entries.find(([, v]) => v === max)?.[0] ?? "",
      spreadPct: mean > 0 ? Math.round(((max - min) / mean) * 1000) / 10 : 0,
      final: s?.production_final ?? null,
    });
  }
  return out.sort((a, z) => z.spreadPct - a.spreadPct);
}
