"use client";
// Admin-only "edit mode" for the per-origin multi-source crop estimates —
// the *_balance_sheet.json seeds behind the S&D card's equation strip,
// production-spread block and table. A small ✎ button in the card header
// opens a password-gated modal (the password is checked server-side by
// /api/admin/crop-estimates and remembered for the browser session) where
// the per-source numbers of any season can be edited, forecast flags
// flipped, and the next crop year added. Saving dispatches a GitHub
// workflow that validates + commits the JSON, so the edit lands in git
// history and is live for everyone after the auto-redeploy (~2 min).
import { useEffect, useState } from "react";

interface SourceDef { key: string; label: string; color: string }

interface SeasonCol {
  season: string;
  forecast: boolean;
  /** sourceKey → input text; kept as strings while editing so partial
   *  entries like "6." don't fight the keyboard. Empty = source absent. */
  values: Record<string, string>;
  /** Added in this modal session — removable until saved. */
  isNew?: boolean;
}

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
      { key: "mard", label: "MARD", color: "#10b981" },
      { key: "ico",  label: "ICO",  color: "#f59e0b" },
    ],
  },
};

const PW_KEY = "cropEditPw";

function nextSeasonLabel(last: string | undefined): string {
  const start = parseInt(last?.split("/")[0] ?? "", 10);
  const from = Number.isFinite(start) ? start + 1 : new Date().getFullYear();
  return `${from}/${String(from + 1).slice(-2)}`;
}

export default function CropEstimateEditor({ origin }: { origin: string }) {
  const cfg = ORIGIN_FILES[origin];
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
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
        const seasons: { season: string; forecast?: boolean; production?: Record<string, number> }[] =
          seed?.seasons ?? [];
        if (!srcs.length || !seasons.length) { setLoadError(true); return; }
        setSources(srcs);
        setCols(seasons.map(s => ({
          season: s.season,
          forecast: !!s.forecast,
          values: Object.fromEntries(srcs.map(src => [
            src.key,
            s.production?.[src.key] != null ? String(s.production[src.key]) : "",
          ])),
        })));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, pw, cols, cfg]);

  if (!cfg) return null;

  const close = () => {
    if (saving) return;
    setOpen(false); setCols(null); setSaved(false); setSaveError(null);
    setPwInput(""); setPwError(null); setLoadError(false);
    setNewSources([]); setSrcInput(""); setSrcError(null);
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

  const save = async () => {
    if (!cols || !pw || saving) return;
    setSaving(true); setSaveError(null);
    // Build the payload: drop empty cells, require ≥1 value per season.
    const seasons = [];
    for (const c of cols) {
      const production: Record<string, number> = {};
      for (const [k, raw] of Object.entries(c.values)) {
        const t = raw.trim();
        if (!t) continue;
        const v = Number(t);
        if (!Number.isFinite(v) || v <= 0) {
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
      seasons.push({ season: c.season, forecast: c.forecast, production });
    }
    const now = new Date();
    const updated = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Only declare new sources that actually carry a value somewhere — an
    // added-then-abandoned row silently disappears instead of littering
    // the legend (the backend enforces the same rule).
    const usedKeys = new Set(seasons.flatMap(s => Object.keys(s.production)));
    const declaredNew = newSources.filter(s => usedKeys.has(s.key));
    try {
      const res = await fetch("/api/admin/crop-estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save", password: pw, origin, updated, seasons,
          ...(declaredNew.length ? { sources: declaredNew } : {}),
        }),
      });
      if (res.ok) {
        setSaved(true);
      } else if (res.status === 401) {
        // Session password went stale (rotated) — back to the prompt.
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

  const allSources = [...sources, ...newSources];

  const addSeason = () => {
    if (!cols) return;
    const label = nextSeasonLabel(cols[cols.length - 1]?.season);
    if (cols.some(c => c.season === label)) return;
    setCols([...cols, {
      season: label,
      forecast: true,
      values: Object.fromEntries(allSources.map(s => [s.key, ""])),
      isNew: true,
    }]);
  };

  const addSource = () => {
    const label = srcInput.trim();
    if (!label) return;
    if (label.length > 24) { setSrcError("Name too long (max 24 chars)."); return; }
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
    if (!key) { setSrcError("Name needs at least one letter or digit."); return; }
    if (allSources.some(s => s.key === key)) { setSrcError(`"${label}" already exists.`); return; }
    const used = new Set(allSources.map(s => s.color));
    const color = NEW_SOURCE_COLORS.find(c => !used.has(c)) ?? NEW_SOURCE_COLORS[0];
    setNewSources([...newSources, { key, label, color }]);
    setSrcInput(""); setSrcError(null);
  };

  const removeSource = (key: string) => {
    setNewSources(newSources.filter(s => s.key !== key));
    // Drop any values already typed into the removed row.
    setCols(cols?.map(c => {
      if (!(key in c.values)) return c;
      const rest = { ...c.values };
      delete rest[key];
      return { ...c, values: rest };
    }) ?? null);
  };

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
            className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-full max-w-xl max-h-[85vh] overflow-y-auto space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] text-slate-300 uppercase tracking-wide font-bold">
                Edit crop estimates · {origin}
              </div>
              <div className="text-[8px] text-slate-500">million 60-kg bags</div>
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
            ) : saved ? (
              <div className="space-y-3">
                <div className="text-[10px] text-emerald-400 font-semibold">✓ Saved.</div>
                <div className="text-[9px] text-slate-400 leading-relaxed">
                  The edit is being committed to the repo and redeployed — live for
                  everyone in ~2 minutes. Refresh the page then to see the new numbers.
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
                                className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-right text-slate-200 focus:outline-none focus:border-slate-500 placeholder:text-slate-700"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
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
                  Saving commits the edit to the repo (visible in git history) and
                  redeploys. The USDA column is machine-synced twice a year and may
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
