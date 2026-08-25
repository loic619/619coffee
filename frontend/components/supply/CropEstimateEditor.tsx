"use client";
// Admin-only "edit mode" for the per-origin multi-source crop estimates —
// the *_balance_sheet.json seeds behind the S&D card's equation strip,
// production-spread block and table. A small ✎ button in the card header
// opens a password-gated modal (the password is checked server-side by
// /api/admin/crop-estimates and remembered for the browser session).
//
// Two views:
//   · By origin — one origin's grid: sources × seasons, forecast flags,
//     add-next-season, add-source rows.
//   · By source — one SOURCE across ALL origins × seasons, with an
//     Arabica / Robusta split per cell (or just a Total when the source
//     doesn't split). Built for the "one source document in hand"
//     workflow: pick USDA/StoneX/…, key in every origin, save once.
//     Totals land in `production` (what every chart reads); splits land
//     in the advisory `production_split` field. Saving fans out one
//     validated commit per changed origin.
//
// Saving dispatches a GitHub workflow that validates + commits the JSON,
// so edits live in git history and go live after the auto-redeploy (~2 min).
import { Fragment, useEffect, useState } from "react";

interface SourceDef { key: string; label: string; color: string }

interface SeasonCol {
  season: string;
  forecast: boolean;
  /** sourceKey → input text; kept as strings while editing so partial
   *  entries like "6." don't fight the keyboard. Empty = source absent. */
  values: Record<string, string>;
  /** Analyst "Final" override — the number the S&D card displays.
   *  Empty = default to the average of the source values. */
  finalValue: string;
  /** Added in this modal session — removable until saved. */
  isNew?: boolean;
}

interface SeedSeason {
  season: string;
  forecast?: boolean;
  production?: Record<string, number>;
  production_split?: Record<string, {
    arabica_washed?: number; arabica_natural?: number;
    /** Legacy unsplit arabica — superseded by the washed/natural pair. */
    arabica?: number;
    robusta?: number;
  }>;
  production_final?: number;
}

/** One origin's freshly-loaded seed, as the source view needs it. */
interface OriginDoc { seasons: SeedSeason[]; sources: SourceDef[] }

/** Source-view cell: arabica / robusta / total input strings. */
/** Source-view cell. Arabica is carried as washed + natural; `a` is the
 *  LEGACY unsplit arabica, shown only when a seed still uses it so old
 *  numbers stay visible and editable until they are restated. */
interface SplitCell { w: string; n: string; a: string; r: string; t: string }

// Colors auto-assigned to admin-added sources, first unused wins. Distinct
// from the palette the seeds already use (blue/green/amber family).
const NEW_SOURCE_COLORS = [
  "#a78bfa", "#f472b6", "#22d3ee", "#facc15", "#fb923c", "#e879f9", "#94a3b8", "#4ade80",
];

// Mirror of build_balance_sheets.ORIGINS on the read side. Vietnam's nested
// seed historically carries no `sources` array (its tab hardcodes the
// legend) — mirrored here as a fallback; the file's array wins when the
// first new-source edit materializes it.
const ORIGIN_FILES: Record<string, { file: string; subkey?: string; sources?: SourceDef[] }> = {
  brazil:    { file: "br_balance_sheet.json" },
  colombia:  { file: "co_balance_sheet.json" },
  indonesia: { file: "id_balance_sheet.json" },
  uganda:    { file: "ug_balance_sheet.json" },
  vietnam:   {
    file: "vn_farmer_economics.json",
    subkey: "balance_sheet",
    sources: [
      { key: "usda", label: "USDA", color: "#3b82f6" },
      // MAE since the 2025 ministry merger; the key stays `mard` so the
      // estimates already filed under it keep their history.
      { key: "mard", label: "MAE", color: "#10b981" },
      { key: "ico",  label: "ICO",  color: "#f59e0b" },
    ],
  },
  // Aug 2026: the wider origin set for the global S&D aggregation. All are
  // reachable from the "by source" view; the first five also carry USDA
  // backbones auto-synced by build_balance_sheets.
  honduras:    { file: "hn_balance_sheet.json" },
  ethiopia:    { file: "et_balance_sheet.json" },
  india:       { file: "in_balance_sheet.json" },
  peru:        { file: "pe_balance_sheet.json" },
  mexico:      { file: "mx_balance_sheet.json" },
  guatemala:   { file: "gt_balance_sheet.json" },
  nicaragua:   { file: "ni_balance_sheet.json" },
  china:       { file: "cn_balance_sheet.json" },
  ivory_coast: { file: "ci_balance_sheet.json" },
  costa_rica:  { file: "cr_balance_sheet.json" },
  tanzania:    { file: "tz_balance_sheet.json" },
};
// By-source view layout: origins grouped the way the trade reads them —
// Brazil and Colombia stand alone, the six other Latin American arabica
// origins carry a "MAG 6" subtotal, then Asia, then Africa.
interface OriginGroup {
  label: string;
  origins: string[];
  /** When set, a subtotal block under the group carrying this label. */
  subtotal?: string;
}
const ORIGIN_GROUPS: OriginGroup[] = [
  { label: "Brazil",      origins: ["brazil"] },
  { label: "Colombia",    origins: ["colombia"] },
  { label: "Other LATAM", origins: ["honduras", "guatemala", "nicaragua", "costa_rica", "mexico", "peru"],
    subtotal: "MAG 6" },
  { label: "Asia",        origins: ["vietnam", "indonesia", "india", "china"] },
  { label: "Africa",      origins: ["uganda", "ethiopia", "ivory_coast", "tanzania"] },
];
// Flat order derived from the groups — the fetch/save paths iterate this, so
// adding an origin to a group is enough to wire it in everywhere.
const ORIGIN_ORDER = ORIGIN_GROUPS.flatMap(g => g.origins);
const ORIGIN_LABELS: Record<string, string> = {
  brazil: "Brazil", colombia: "Colombia", indonesia: "Indonesia",
  uganda: "Uganda", vietnam: "Vietnam", honduras: "Honduras",
  ethiopia: "Ethiopia", india: "India", peru: "Peru", mexico: "Mexico",
  guatemala: "Guatemala", nicaragua: "Nicaragua", china: "China",
  ivory_coast: "Ivory Coast", costa_rica: "Costa Rica", tanzania: "Tanzania",
};

// The three rows every origin / subtotal block renders.
const LEGS = [
  { leg: "w" as const, name: "Arabica washed",  cls: "text-amber-300" },
  { leg: "n" as const, name: "Arabica natural", cls: "text-orange-400" },
  { leg: "r" as const, name: "Robusta",         cls: "text-emerald-400" },
  { leg: "t" as const, name: "Total",           cls: "text-slate-300" },
] as const;
/** Legacy unsplit-arabica row, appended only for origins whose seed still
 *  carries it — so restating into washed/natural is a visible migration
 *  rather than a silent data loss. */
const LEGACY_LEG = { leg: "a" as const, name: "Arabica (unsplit)", cls: "text-amber-600" } as const;

const PW_KEY = "cropEditPw";

function nextSeasonLabel(last: string | undefined): string {
  const start = parseInt(last?.split("/")[0] ?? "", 10);
  const from = Number.isFinite(start) ? start + 1 : new Date().getFullYear();
  return `${from}/${String(from + 1).slice(-2)}`;
}

const seasonSort = (a: string, b: string) =>
  (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);

/** "" → null; positive finite number → value; anything else → NaN. */
function parseCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function deriveKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
}

const currentStamp = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export default function CropEstimateEditor({ origin }: { origin: string }) {
  const cfg = ORIGIN_FILES[origin];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"origin" | "source">("origin");
  const [pw, setPw] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // ── By-origin view state ──────────────────────────────────────────────
  const [sources, setSources] = useState<SourceDef[]>([]);
  // Admin-added source rows, kept separate so they're removable and only
  // the ones that end up carrying values get declared to the backend.
  const [newSources, setNewSources] = useState<SourceDef[]>([]);
  const [srcInput, setSrcInput] = useState("");
  const [srcError, setSrcError] = useState<string | null>(null);
  const [cols, setCols] = useState<SeasonCol[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── By-source view state ──────────────────────────────────────────────
  const [docs, setDocs] = useState<Record<string, OriginDoc> | null>(null);
  const [docsError, setDocsError] = useState(false);
  const [selSrc, setSelSrc] = useState<string>("usda");
  const [xNewSources, setXNewSources] = useState<SourceDef[]>([]);
  const [xSrcInput, setXSrcInput] = useState("");
  const [xSrcError, setXSrcError] = useState<string | null>(null);
  /** cellsBySource[sourceKey][origin][season] — edits cached per source so
   *  switching sources doesn't lose work before saving. */
  const [cellsBySource, setCellsBySource] = useState<Record<string, Record<string, Record<string, SplitCell>>>>({});
  const [xSeasons, setXSeasons] = useState<string[]>([]);
  const [xStatus, setXStatus] = useState<Record<string, string> | null>(null);
  const [xSaving, setXSaving] = useState(false);
  const [xDone, setXDone] = useState(false);

  // Session-remembered password (verified server-side before it's stored).
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PW_KEY);
      if (stored) setPw(stored);
    } catch { /* storage blocked — prompt every time */ }
  }, []);

  // Fresh load on every open: edits must start from what's live, not from
  // whatever the tab fetched at mount.
  useEffect(() => {
    if (!open || !pw || cols || !cfg) return;
    let cancelled = false;
    fetch(`/data/${cfg.file}?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null))
      .then((doc) => {
        if (cancelled) return;
        const seed = cfg.subkey ? doc?.[cfg.subkey] : doc;
        const srcs: SourceDef[] = seed?.sources ?? cfg.sources ?? [];
        const seasons: SeedSeason[] = seed?.seasons ?? [];
        if (!srcs.length || !seasons.length) { setLoadError(true); return; }
        setSources(srcs);
        setCols(seasons.map(s => ({
          season: s.season,
          forecast: !!s.forecast,
          values: Object.fromEntries(srcs.map(src => [
            src.key,
            s.production?.[src.key] != null ? String(s.production[src.key]) : "",
          ])),
          finalValue: s.production_final != null ? String(s.production_final) : "",
        })));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, pw, cols, cfg]);

  // Source view needs every origin's seed. Loaded once per modal open,
  // fresh from the wire.
  useEffect(() => {
    if (!open || !pw || view !== "source" || docs) return;
    let cancelled = false;
    Promise.all(ORIGIN_ORDER.map(async (o) => {
      const c = ORIGIN_FILES[o];
      const r = await fetch(`/data/${c.file}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`${c.file}: ${r.status}`);
      const doc = await r.json();
      const seed = c.subkey ? doc?.[c.subkey] : doc;
      return [o, {
        seasons: (seed?.seasons ?? []) as SeedSeason[],
        sources: (seed?.sources ?? c.sources ?? []) as SourceDef[],
      }] as const;
    }))
      .then((pairs) => {
        if (cancelled) return;
        const d = Object.fromEntries(pairs);
        setDocs(d);
        setXSeasons(
          Array.from(new Set(Object.values(d).flatMap(v => v.seasons.map(s => s.season)))).sort(seasonSort),
        );
      })
      .catch(() => { if (!cancelled) setDocsError(true); });
    return () => { cancelled = true; };
  }, [open, pw, view, docs]);

  if (!cfg) return null;

  const close = () => {
    if (saving || xSaving) return;
    setOpen(false); setView("origin");
    setCols(null); setSaved(false); setSaveError(null);
    setPwInput(""); setPwError(null); setLoadError(false);
    setNewSources([]); setSrcInput(""); setSrcError(null);
    setDocs(null); setDocsError(false); setCellsBySource({});
    setXNewSources([]); setXSrcInput(""); setXSrcError(null);
    setXStatus(null); setXDone(false);
  };

  const unlock = async () => {
    if (!pwInput || checking) return;
    setChecking(true); setPwError(null);
    try {
      const res = await fetch("/api/admin/crop-estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", password: pwInput }),
      });
      if (res.ok) {
        setPw(pwInput);
        try { sessionStorage.setItem(PW_KEY, pwInput); } catch { /* fine */ }
      } else {
        setPwError(res.status === 401 ? "Wrong password." : `Check failed (${res.status}).`);
      }
    } catch {
      setPwError("Network error — try again.");
    } finally {
      setChecking(false);
    }
  };

  const postSave = (body: Record<string, unknown>) =>
    fetch("/api/admin/crop-estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", password: pw, ...body }),
    });

  // ── By-origin save ────────────────────────────────────────────────────
  const allSources = [...sources, ...newSources];

  const save = async () => {
    if (!cols || !pw || saving) return;
    setSaving(true); setSaveError(null);
    const seasons = [];
    for (const c of cols) {
      const production: Record<string, number> = {};
      for (const [k, raw] of Object.entries(c.values)) {
        const v = parseCell(raw);
        if (v === null) continue;
        if (Number.isNaN(v)) {
          setSaveError(`${c.season} · ${k}: "${raw}" is not a positive number.`);
          setSaving(false);
          return;
        }
        production[k] = v;
      }
      if (!Object.keys(production).length) {
        setSaveError(`${c.season}: needs at least one source value (or remove the column).`);
        setSaving(false);
        return;
      }
      // Final override: number when filled, explicit null when empty so a
      // cleared cell removes the stored override (display reverts to avg).
      const fv = parseCell(c.finalValue);
      if (Number.isNaN(fv)) {
        setSaveError(`${c.season} · Final: "${c.finalValue}" is not a positive number.`);
        setSaving(false);
        return;
      }
      seasons.push({
        season: c.season, forecast: c.forecast, production,
        production_final: fv,
      });
    }
    // Only declare new sources that actually carry a value somewhere — an
    // added-then-abandoned row silently disappears instead of littering
    // the legend (the backend enforces the same rule).
    const usedKeys = new Set(seasons.flatMap(s => Object.keys(s.production)));
    const declaredNew = newSources.filter(s => usedKeys.has(s.key));
    try {
      const res = await postSave({
        origin, updated: currentStamp(), seasons,
        ...(declaredNew.length ? { sources: declaredNew } : {}),
      });
      if (res.ok) {
        setSaved(true);
      } else if (res.status === 401) {
        setPw(null);
        try { sessionStorage.removeItem(PW_KEY); } catch { /* fine */ }
        setPwError("Password no longer valid — enter it again.");
      } else {
        const detail = await res.json().catch(() => null);
        setSaveError(`Save failed (${res.status}${detail?.detail ? `: ${detail.detail}` : detail?.error ? `: ${detail.error}` : ""}).`);
      }
    } catch {
      setSaveError("Network error — nothing was saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const addSeason = () => {
    if (!cols) return;
    const label = nextSeasonLabel(cols[cols.length - 1]?.season);
    if (cols.some(c => c.season === label)) return;
    setCols([...cols, {
      season: label,
      forecast: true,
      values: Object.fromEntries(allSources.map(s => [s.key, ""])),
      finalValue: "",
      isNew: true,
    }]);
  };

  const addSource = () => {
    const label = srcInput.trim();
    if (!label) return;
    if (label.length > 24) { setSrcError("Name too long (max 24 chars)."); return; }
    const key = deriveKey(label);
    if (!key) { setSrcError("Name needs at least one letter or digit."); return; }
    if (allSources.some(s => s.key === key)) { setSrcError(`"${label}" already exists.`); return; }
    const used = new Set(allSources.map(s => s.color));
    const color = NEW_SOURCE_COLORS.find(c => !used.has(c)) ?? NEW_SOURCE_COLORS[0];
    setNewSources([...newSources, { key, label, color }]);
    setSrcInput(""); setSrcError(null);
  };

  const removeSource = (key: string) => {
    setNewSources(newSources.filter(s => s.key !== key));
    setCols(cols?.map(c => {
      if (!(key in c.values)) return c;
      const rest = { ...c.values };
      delete rest[key];
      return { ...c, values: rest };
    }) ?? null);
  };

  // ── By-source helpers ─────────────────────────────────────────────────
  const unionSources: SourceDef[] = (() => {
    const seen = new Map<string, SourceDef>();
    for (const o of ORIGIN_ORDER) {
      for (const s of docs?.[o]?.sources ?? []) {
        if (!seen.has(s.key)) seen.set(s.key, s);
      }
    }
    for (const s of xNewSources) if (!seen.has(s.key)) seen.set(s.key, s);
    return Array.from(seen.values());
  })();
  const selSrcDef = unionSources.find(s => s.key === selSrc);

  /** Grid for the selected source: stored edits win, else seed values. */
  const cellFor = (o: string, season: string): SplitCell => {
    const stored = cellsBySource[selSrc]?.[o]?.[season];
    if (stored) return stored;
    const s = docs?.[o]?.seasons.find(x => x.season === season);
    const t = s?.production?.[selSrc];
    const sp = s?.production_split?.[selSrc];
    return {
      w: sp?.arabica_washed  != null ? String(sp.arabica_washed)  : "",
      n: sp?.arabica_natural != null ? String(sp.arabica_natural) : "",
      a: sp?.arabica         != null ? String(sp.arabica)         : "",
      r: sp?.robusta         != null ? String(sp.robusta)         : "",
      t: t != null ? String(t) : "",
    };
  };

  const setCell = (o: string, season: string, patch: Partial<SplitCell>) => {
    setCellsBySource(prev => ({
      ...prev,
      [selSrc]: {
        ...prev[selSrc],
        [o]: { ...prev[selSrc]?.[o], [season]: { ...cellFor(o, season), ...patch } },
      },
    }));
  };

  const addXSeason = () => {
    const label = nextSeasonLabel(xSeasons[xSeasons.length - 1]);
    if (!xSeasons.includes(label)) setXSeasons([...xSeasons, label]);
  };

  const addXSource = () => {
    const label = xSrcInput.trim();
    if (!label) return;
    if (label.length > 24) { setXSrcError("Name too long (max 24 chars)."); return; }
    const key = deriveKey(label);
    if (!key) { setXSrcError("Name needs at least one letter or digit."); return; }
    if (unionSources.some(s => s.key === key)) {
      setSelSrc(key); setXSrcInput(""); setXSrcError(null);
      return;
    }
    const used = new Set(unionSources.map(s => s.color));
    const color = NEW_SOURCE_COLORS.find(c => !used.has(c)) ?? NEW_SOURCE_COLORS[0];
    setXNewSources([...xNewSources, { key, label, color }]);
    setSelSrc(key); setXSrcInput(""); setXSrcError(null);
  };

  /** Effective total for a cell: the sum of whatever crop legs are filled
   *  (washed + natural + legacy arabica + robusta), else the typed Total. */
  const cellTotal = (c: SplitCell): number | null => {
    const parts = [parseCell(c.w), parseCell(c.n), parseCell(c.a), parseCell(c.r)];
    if (parts.some(v => Number.isNaN(v))) return NaN;
    if (parts.some(v => v !== null)) {
      return round2(parts.reduce<number>((acc, v) => acc + (v ?? 0), 0));
    }
    return parseCell(c.t);
  };

  /** Rows to render for an origin: the current legs, plus the legacy
   *  unsplit-arabica row only while that origin still carries a value in
   *  it for the selected source (so the old number stays visible and
   *  editable until it is restated as washed/natural). */
  const legsFor = (o: string): readonly (typeof LEGS[number] | typeof LEGACY_LEG)[] => {
    const hasLegacy = xSeasons.some(season => cellFor(o, season).a.trim() !== "");
    if (!hasLegacy) return LEGS;
    // Keep the legacy line adjacent to the arabica pair, above Robusta.
    return [LEGS[0], LEGS[1], LEGACY_LEG, LEGS[2], LEGS[3]];
  };

  /** Total arabica in a cell, however it is expressed. */
  const cellArabica = (c: SplitCell): number => {
    const parts = [parseCell(c.w), parseCell(c.n), parseCell(c.a)];
    return round2(parts.reduce<number>((acc, v) => acc + (v && !Number.isNaN(v) ? v : 0), 0));
  };

  /** Live Arabica / Robusta / Total sums over a set of origins for one
   *  season. Reads the same edited cells the inputs render, so subtotals
   *  and the world totals update as you type rather than only after save.
   *  An origin with only a Total (no split) contributes to Total alone —
   *  it is never guessed into one of the legs. */
  const sumFor = (origins: readonly string[], season: string) => {
    let w = 0, n = 0, a = 0, r = 0, t = 0, ara = 0;
    for (const o of origins) {
      const c = cellFor(o, season);
      const add = (raw: string) => {
        const v = parseCell(raw);
        return v !== null && !Number.isNaN(v) ? v : 0;
      };
      w += add(c.w); n += add(c.n); a += add(c.a); r += add(c.r);
      ara += cellArabica(c);
      const tv = cellTotal(c);
      if (tv !== null && !Number.isNaN(tv)) t += tv;
    }
    return {
      w: round2(w), n: round2(n), a: round2(a), r: round2(r),
      t: round2(t), arabica: round2(ara),
    };
  };

  /** A read-only Arabica/Robusta/Total block — used for the MAG 6 subtotal
   *  and the world totals. */
  const SUM_LEGS = [
    { leg: "w" as const,       name: "Arabica washed",  cls: "text-amber-300" },
    { leg: "n" as const,       name: "Arabica natural", cls: "text-orange-400" },
    { leg: "arabica" as const, name: "Arabica (all)",   cls: "text-amber-500" },
    { leg: "r" as const,       name: "Robusta",         cls: "text-emerald-400" },
    { leg: "t" as const,       name: "Total",           cls: "text-slate-300" },
  ] as const;

  const sumRows = (label: string, origins: readonly string[], tone: string, border: string) =>
    SUM_LEGS.map((row, ri) => (
      <tr key={`${label}-${row.leg}`}
        className={ri === 0 ? `border-t-2 ${border}` : "border-t border-slate-700/20"}>
        <td className={`py-0.5 pr-2 font-bold whitespace-nowrap sticky left-0 bg-slate-800 ${tone}`}>
          {ri === 0 ? label : ""}
        </td>
        <td className={`py-0.5 pr-2 ${row.cls}`}>{row.name}</td>
        {xSeasons.map(season => {
          const v = sumFor(origins, season)[row.leg];
          return (
            <td key={season} className="px-1 py-0.5 text-center">
              <span className={`inline-block w-14 text-right pr-1 font-bold ${v > 0 ? tone : "text-slate-700"}`}>
                {v > 0 ? v.toFixed(1) : "–"}
              </span>
            </td>
          );
        })}
      </tr>
    ));

  const saveSource = async () => {
    if (!docs || !pw || xSaving || !selSrcDef) return;
    setXSaving(true); setXStatus(null);

    // Build one payload per origin whose values for this source changed.
    const payloads: { origin: string; body: Record<string, unknown> }[] = [];
    for (const o of ORIGIN_ORDER) {
      const d = docs[o];
      const bySeason = new Map(d.seasons.map(s => [s.season, s]));
      const labels = Array.from(new Set(d.seasons.map(s => s.season).concat(xSeasons))).sort(seasonSort);
      let changed = false;
      const seasonsOut = [];
      for (const label of labels) {
        const prior = bySeason.get(label);
        const cell = cellFor(o, label);
        const total = cellTotal(cell);
        if (total !== null && Number.isNaN(total)) {
          setXStatus({ [o]: `✗ ${label}: not a positive number` });
          setXSaving(false);
          return;
        }
        const w = parseCell(cell.w), n = parseCell(cell.n);
        const a = parseCell(cell.a), r = parseCell(cell.r);
        const production = { ...(prior?.production ?? {}) };
        const splitAll = { ...(prior?.production_split ?? {}) };
        if (total !== null) production[selSrc] = total;
        else delete production[selSrc];
        // Restating a legacy `arabica` value into washed/natural drops the
        // legacy leg — the backend rejects a split carrying both forms.
        const usesPair = w !== null || n !== null;
        if (w !== null || n !== null || a !== null || r !== null) {
          splitAll[selSrc] = {
            ...(w !== null ? { arabica_washed: w } : {}),
            ...(n !== null ? { arabica_natural: n } : {}),
            ...(!usesPair && a !== null ? { arabica: a } : {}),
            ...(r !== null ? { robusta: r } : {}),
          };
        } else {
          delete splitAll[selSrc];
        }
        const priorTotal = prior?.production?.[selSrc];
        const priorSplit = prior?.production_split?.[selSrc];
        if (priorTotal !== total && !(priorTotal === undefined && total === null)) changed = true;
        if (JSON.stringify(priorSplit ?? null) !==
            JSON.stringify(splitAll[selSrc] ?? null)) changed = true;
        if (!Object.keys(production).length) continue; // season existed only for this source
        seasonsOut.push({
          season: label,
          forecast: prior ? !!prior.forecast : true,
          production,
          // Always sent in source view — authoritative, so clears stick.
          production_split: splitAll,
        });
      }
      if (!changed || !seasonsOut.length) continue;
      const isDeclared = d.sources.some(s => s.key === selSrc);
      payloads.push({
        origin: o,
        body: {
          origin: o, updated: currentStamp(), seasons: seasonsOut,
          ...(!isDeclared ? { sources: [selSrcDef] } : {}),
        },
      });
    }

    if (!payloads.length) {
      setXStatus({ _: "Nothing changed." });
      setXSaving(false);
      return;
    }

    const status: Record<string, string> = Object.fromEntries(
      payloads.map(p => [p.origin, "saving…"]));
    setXStatus({ ...status });
    let allOk = true;
    for (const p of payloads) {
      try {
        const res = await postSave(p.body);
        if (res.ok) {
          // "queued", not "committed": all we know is that GitHub accepted
          // the dispatch. The run still validates, commits and redeploys —
          // and a failure or cancellation alerts on Telegram rather than
          // here, so claiming success at this point would be a lie the UI
          // has no way to take back.
          status[p.origin] = "✓ queued";
        } else if (res.status === 401) {
          setPw(null);
          try { sessionStorage.removeItem(PW_KEY); } catch { /* fine */ }
          status[p.origin] = "✗ password no longer valid";
          allOk = false;
          break;
        } else {
          const detail = await res.json().catch(() => null);
          status[p.origin] = `✗ ${res.status}${detail?.detail ? `: ${detail.detail}` : ""}`;
          allOk = false;
        }
      } catch {
        status[p.origin] = "✗ network error";
        allOk = false;
      }
      setXStatus({ ...status });
    }
    setXSaving(false);
    if (allOk) setXDone(true);
  };

  // ── Render ────────────────────────────────────────────────────────────
  const inputCls =
    "w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-right text-slate-200 " +
    "focus:outline-none focus:border-slate-500 placeholder:text-slate-700";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Edit crop estimates (admin)"
        className="text-[9px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors"
      >
        ✎
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div
            className={`bg-slate-800 border border-slate-600 rounded-lg p-4 w-full ${view === "source" ? "max-w-4xl" : "max-w-xl"} max-h-[85vh] overflow-y-auto space-y-3`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] text-slate-300 uppercase tracking-wide font-bold">
                Edit crop estimates{view === "origin" ? ` · ${ORIGIN_LABELS[origin] ?? origin}` : ""}
              </div>
              <div className="flex items-center gap-2">
                {pw && (
                  <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                    {(["origin", "source"] as const).map(v => (
                      <button key={v} onClick={() => setView(v)}
                        className={`text-[9px] px-2 py-0.5 transition-colors ${
                          view === v ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                        }`}
                        title={v === "source"
                          ? "One source across every origin and year (with A/R split)"
                          : "This origin's sources and seasons"}>
                        {v === "origin" ? "By origin" : "By source"}
                      </button>
                    ))}
                  </div>
                )}
                <div className="text-[8px] text-slate-500">million 60-kg bags</div>
              </div>
            </div>

            {!pw ? (
              <div className="space-y-2">
                <div className="text-[9px] text-slate-400">Admin password required.</div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={pwInput}
                    onChange={e => setPwInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") unlock(); }}
                    autoFocus
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
                    placeholder="Password"
                  />
                  <button
                    onClick={unlock}
                    disabled={checking || !pwInput}
                    className="text-[10px] px-3 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50 transition-colors"
                  >
                    {checking ? "…" : "Unlock"}
                  </button>
                </div>
                {pwError && <div className="text-[9px] text-red-400">{pwError}</div>}
              </div>
            ) : view === "source" ? (
              /* ── By source: every origin × season for one source ─────── */
              xDone ? (
                <div className="space-y-3">
                  <div className="text-[10px] text-emerald-400 font-semibold">✓ Submitted.</div>
                  <div className="text-[9px] text-slate-400 leading-relaxed space-y-0.5">
                    {Object.entries(xStatus ?? {}).map(([o, st]) => (
                      <div key={o}>{ORIGIN_LABELS[o] ?? o}: {st}</div>
                    ))}
                  </div>
                  <div className="text-[9px] text-slate-400 leading-relaxed">
                    One commit per origin is being pushed and redeployed — live for
                    everyone in ~2 minutes. Reload the page then and check the numbers
                    landed: this screen confirms the edits were accepted for processing,
                    not that they are committed. Anything that fails or is cancelled
                    raises a Telegram alert.
                  </div>
                  <div className="flex justify-end">
                    <button onClick={close} className="text-[10px] px-3 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors">
                      Close
                    </button>
                  </div>
                </div>
              ) : docsError ? (
                <div className="text-[9px] text-red-400">Could not load the estimate files.</div>
              ) : !docs ? (
                <div className="text-[9px] text-slate-500 animate-pulse py-4 text-center">Loading all origins…</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selSrc}
                      onChange={e => setSelSrc(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-slate-500"
                    >
                      {unionSources.map(s => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                    {selSrcDef && (
                      <span className="text-[9px] font-bold" style={{ color: selSrcDef.color }}>
                        ● {selSrcDef.label}
                      </span>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                      <input
                        type="text"
                        value={xSrcInput}
                        onChange={e => { setXSrcInput(e.target.value); setXSrcError(null); }}
                        onKeyDown={e => { if (e.key === "Enter") addXSource(); }}
                        placeholder="New source (e.g. StoneX)"
                        className="w-36 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[9px] text-slate-200 focus:outline-none focus:border-slate-500 placeholder:text-slate-600"
                      />
                      <button
                        onClick={addXSource}
                        disabled={!xSrcInput.trim()}
                        className="text-[9px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        + Add source
                      </button>
                    </div>
                  </div>
                  {xSrcError && <div className="text-[9px] text-red-400">{xSrcError}</div>}

                  <div className="overflow-x-auto">
                    <table className="text-[9px] font-mono w-full">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-left py-1 pr-2 font-medium sticky left-0 bg-slate-800">Origin</th>
                          <th className="text-left py-1 pr-2 font-medium"></th>
                          {xSeasons.map(season => (
                            <th key={season} className="px-1 py-1 font-medium text-center whitespace-nowrap text-slate-300">
                              {season}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ORIGIN_GROUPS.map(g => (
                          <Fragment key={g.label}>
                            <tr className="border-t-2 border-slate-500/50">
                              <td colSpan={2 + xSeasons.length}
                                className="pt-2 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-slate-500 sticky left-0 bg-slate-800">
                                {g.label}
                              </td>
                            </tr>
                            {g.origins.map(o => legsFor(o).map((row, ri) => (
                              <tr key={`${o}-${row.leg}`}
                                className={ri === 0 ? "border-t border-slate-700/60" : "border-t border-slate-700/20"}>
                                <td className="py-0.5 pr-2 font-bold text-slate-200 whitespace-nowrap sticky left-0 bg-slate-800">
                                  {ri === 0 ? (ORIGIN_LABELS[o] ?? o) : ""}
                                </td>
                                <td className={`py-0.5 pr-2 ${row.cls}`}>{row.name}</td>
                                {xSeasons.map(season => {
                                  const cell = cellFor(o, season);
                                  if (row.leg === "t") {
                                    const hasSplit = cell.a.trim() !== "" || cell.r.trim() !== "";
                                    const total = cellTotal(cell);
                                    return (
                                      <td key={season} className="px-1 py-0.5 text-center">
                                        {hasSplit ? (
                                          <span className="inline-block w-14 text-right pr-1 text-slate-400"
                                            title="Computed from Arabica + Robusta">
                                            {total !== null && !Number.isNaN(total) ? total : "–"}
                                          </span>
                                        ) : (
                                          <input
                                            type="text" inputMode="decimal"
                                            value={cell.t}
                                            onChange={e => setCell(o, season, { t: e.target.value })}
                                            placeholder="—"
                                            className={inputCls}
                                          />
                                        )}
                                      </td>
                                    );
                                  }
                                  return (
                                    <td key={season} className="px-1 py-0.5 text-center">
                                      <input
                                        type="text" inputMode="decimal"
                                        value={cell[row.leg]}
                                        onChange={e => setCell(o, season, { [row.leg]: e.target.value })}
                                        placeholder="—"
                                        className={inputCls}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            )))}
                            {g.subtotal && sumRows(g.subtotal, g.origins, "text-sky-300", "border-sky-900/60")}
                          </Fragment>
                        ))}
                        {/* Grand totals across every origin above. */}
                        {sumRows("World", ORIGIN_ORDER, "text-emerald-300", "border-emerald-800/60")}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={addXSeason}
                      className="text-[9px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                    >
                      + Add {nextSeasonLabel(xSeasons[xSeasons.length - 1])}
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={close} disabled={xSaving}
                        className="text-[10px] px-3 py-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors">
                        Cancel
                      </button>
                      <button onClick={saveSource} disabled={xSaving}
                        className="text-[10px] px-3 py-1 rounded bg-emerald-700 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                        {xSaving ? "Saving…" : "Save all origins"}
                      </button>
                    </div>
                  </div>
                  {xStatus && !xDone && (
                    <div className="text-[9px] space-y-0.5">
                      {Object.entries(xStatus).map(([o, st]) => (
                        <div key={o} className={st.startsWith("✗") ? "text-red-400" : "text-slate-400"}>
                          {o === "_" ? st : `${ORIGIN_LABELS[o] ?? o}: ${st}`}
                        </div>
                      ))}
                    </div>
                  )}
                  {pwError && <div className="text-[9px] text-red-400">{pwError}</div>}
                  <div className="text-[8px] text-slate-600 leading-relaxed">
                    Enter Arabica + Robusta (Total computes itself) or just a Total when the
                    source doesn&apos;t split. Empty cells mean no estimate. Typing a value in a
                    season an origin doesn&apos;t have yet creates it (as a forecast). Edits are
                    kept per source while the modal is open — switch sources freely, then
                    Save commits one change per origin.
                  </div>
                </div>
              )
            ) : saved ? (
              <div className="space-y-3">
                <div className="text-[10px] text-emerald-400 font-semibold">✓ Submitted.</div>
                <div className="text-[9px] text-slate-400 leading-relaxed">
                  The edit is being committed to the repo and redeployed — live for
                  everyone in ~2 minutes. Refresh the page then and check the number
                  landed: this confirms the edit was accepted for processing, not that
                  it is committed. A failure raises a Telegram alert.
                </div>
                <div className="flex justify-end">
                  <button onClick={close} className="text-[10px] px-3 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors">
                    Close
                  </button>
                </div>
              </div>
            ) : loadError ? (
              <div className="text-[9px] text-red-400">Could not load the current estimates file.</div>
            ) : !cols ? (
              <div className="text-[9px] text-slate-500 animate-pulse py-4 text-center">Loading current estimates…</div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="text-[9px] font-mono w-full">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="text-left py-1 pr-2 font-medium">Source</th>
                        {cols.map((c, i) => (
                          <th key={c.season} className="px-1 py-1 font-medium text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-slate-300">{c.season}</span>
                              {c.isNew && (
                                <button
                                  onClick={() => setCols(cols.filter((_, j) => j !== i))}
                                  title="Remove this season"
                                  className="text-slate-600 hover:text-red-400"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            <label className="flex items-center justify-center gap-1 text-[8px] text-slate-500 font-normal cursor-pointer mt-0.5">
                              <input
                                type="checkbox"
                                checked={c.forecast}
                                onChange={e => setCols(cols.map((x, j) => j === i ? { ...x, forecast: e.target.checked } : x))}
                                className="accent-slate-500 h-2.5 w-2.5"
                              />
                              forecast
                            </label>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allSources.map(src => (
                        <tr key={src.key} className="border-t border-slate-700/50">
                          <td className="py-1 pr-2 font-bold whitespace-nowrap" style={{ color: src.color }}>
                            {src.label}
                            {newSources.some(s => s.key === src.key) && (
                              <button
                                onClick={() => removeSource(src.key)}
                                title="Remove this source"
                                className="ml-1 text-slate-600 hover:text-red-400 font-normal"
                              >
                                ×
                              </button>
                            )}
                          </td>
                          {cols.map((c, i) => (
                            <td key={c.season} className="px-1 py-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={c.values[src.key] ?? ""}
                                onChange={e => setCols(cols.map((x, j) =>
                                  j === i ? { ...x, values: { ...x.values, [src.key]: e.target.value } } : x))}
                                placeholder="—"
                                className={inputCls}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                      {/* Analyst "Final" — the number the S&D card displays.
                          Placeholder shows the live average of the column's
                          source values (the default when left empty). */}
                      <tr className="border-t-2 border-slate-600/70">
                        <td className="py-1 pr-2 font-bold whitespace-nowrap text-emerald-300"
                          title="The displayed production figure. Empty = average of the sources.">
                          Final
                        </td>
                        {cols.map((c, i) => {
                          const nums = Object.values(c.values)
                            .map(v => Number(v.trim()))
                            .filter(v => Number.isFinite(v) && v > 0);
                          const avg = nums.length
                            ? (nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(1)
                            : "—";
                          return (
                            <td key={c.season} className="px-1 py-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={c.finalValue}
                                onChange={e => setCols(cols.map((x, j) =>
                                  j === i ? { ...x, finalValue: e.target.value } : x))}
                                placeholder={avg}
                                title={`Displayed figure — empty defaults to the avg (${avg})`}
                                className={`${inputCls} placeholder:text-slate-600 border-emerald-900/60`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={srcInput}
                    onChange={e => { setSrcInput(e.target.value); setSrcError(null); }}
                    onKeyDown={e => { if (e.key === "Enter") addSource(); }}
                    placeholder="New source (e.g. StoneX)"
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[9px] text-slate-200 focus:outline-none focus:border-slate-500 placeholder:text-slate-600"
                  />
                  <button
                    onClick={addSource}
                    disabled={!srcInput.trim()}
                    className="text-[9px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    + Add source
                  </button>
                </div>
                {srcError && <div className="text-[9px] text-red-400">{srcError}</div>}

                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={addSeason}
                    className="text-[9px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                  >
                    + Add {nextSeasonLabel(cols[cols.length - 1]?.season)}
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={close} disabled={saving}
                      className="text-[10px] px-3 py-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors">
                      Cancel
                    </button>
                    <button onClick={save} disabled={saving}
                      className="text-[10px] px-3 py-1 rounded bg-emerald-700 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
                {saveError && <div className="text-[9px] text-red-400">{saveError}</div>}
                {pwError && <div className="text-[9px] text-red-400">{pwError}</div>}
                <div className="text-[8px] text-slate-600 leading-relaxed">
                  Empty cells mean the source hasn&apos;t published for that season. A new
                  source row is only saved if at least one of its cells has a value.
                  The <span className="text-emerald-400">Final</span> row is the number the
                  S&amp;D card displays — leave it empty to default to the average of the
                  sources. Saving commits the edit to the repo (visible in git history)
                  and redeploys. The USDA column is machine-synced twice a year and may
                  overwrite manual USDA edits.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
