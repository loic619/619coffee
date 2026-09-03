"use client";
// Admin editor for the world balance sheet's analyst-entered lines.
//
// The statement has two kinds of line and only one of them belongs here:
//   · Production is DERIVED from the per-origin crop-estimate seeds, so the
//     world view can never disagree with an origin tab. Edit it in the ✎
//     crop-estimate editor; this modal shows it read-only, as the fixed part
//     of the balance the entered lines are set against.
//   · Carry-in, consumption by hub and carry-out have no upstream feed. They
//     live in world_balance_sheet.json and are edited here, alongside the
//     Risk & Opps register.
//
// Same write path as the crop estimates: the password is checked server-side
// (/api/admin/world-balance), which dispatches a workflow that re-validates,
// commits and redeploys. Nothing is written from the browser.
import { chgTone } from "@/lib/formatters";
import { Fragment, useEffect, useState } from "react";
import {
  LEGS, LEG_LABEL, LEG_TONE, LINE_BLOCKS, ORIGIN_LABELS,
  addLegs, arabicaAll, emptyLegs, fmt, legTotal, r1,
  type DemandSegmentsDoc, type GradeRow, type Leg, type LineBlock, type Line,
  type OriginGradesDoc, type Risk, type WorldBalanceDoc,
} from "@/lib/worldBalance";

/** Values are held as strings while editing so a partial entry like "6."
 *  doesn't fight the keyboard. Empty = the leg is absent from the line. */
type LegText = Record<Leg, string>;
interface EditLine { key: string; label: string; legs: LegText; isNew?: boolean }
interface EditRisk {
  key: string; driver: string; origin: string; crop: Leg;
  impact: string; probability: string; note: string; isNew?: boolean;
}

/** Depth-3 edit state. Shares are entered and shown as PERCENT — an analyst
 *  reasons in "SHG is 55% of the washed crop", not in 0.55 — and converted
 *  back to shares only at save. */
interface GradeEdit { key: string; label: string; pct: string; isNew?: boolean }
type GradeState = Record<string, Partial<Record<Leg, GradeEdit[]>>>;
/** scope ("default" or a hub key) → leg → segment key → percent text. */
type SegState = Record<string, Partial<Record<Leg, Record<string, string>>>>;

/** The legs a grade ladder can hang off. The legacy unsplit leg is included
 *  only when an origin still carries one, so restating stays visible. */
const GRADE_LEGS: Leg[] = ["arabica_washed", "arabica_natural", "robusta"];

const pctOf = (share: number) => String(Math.round(share * 1000) / 10);
const shareOf = (pct: string) => Math.round((Number(pct) / 100) * 1e4) / 1e4;
const pctSum = (vals: string[]) =>
  Math.round(vals.reduce((a, v) => a + (Number(v) || 0), 0) * 10) / 10;

// Shared with the crop-estimate editor: one unlock covers both, since it is
// one password checked by one server-side comparison.
const PW_KEY = "cropEditPw";
const KEY_RE = /^[a-z0-9_]{1,32}$/;
const SEASON_RE = /^\d{4}\/\d{2}$/;
const MAX_LINES = 24, MAX_RISKS = 40, MAX_MBAGS = 400, MAX_IMPACT = 50;

const emptyText = (): LegText =>
  ({ arabica_washed: "", arabica_natural: "", arabica: "", robusta: "" });

/** "" → absent (0 for arithmetic); anything unparseable → NaN so validation
 *  can catch it rather than silently reading as zero. */
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
const textLegs = (t: LegText) => {
  const out = emptyLegs();
  for (const l of LEGS) { const v = num(t[l]); out[l] = Number.isFinite(v) ? v : 0; }
  return out;
};

const slug = (label: string, taken: Set<string>, fallback: string) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  if (!KEY_RE.test(base)) base = fallback;
  let k = base, n = 2;
  while (taken.has(k)) { k = `${base.slice(0, 29)}_${n++}`; }
  taken.add(k);
  return k;
};

const toEditLine = (l: Line): EditLine => {
  const legs = emptyText();
  for (const leg of LEGS) if (l[leg] != null) legs[leg] = String(l[leg]);
  return { key: l.key, label: l.label, legs };
};
const toEditRisk = (r: Risk): EditRisk => ({
  key: r.key, driver: r.driver, origin: r.origin,
  crop: (LEGS as readonly string[]).includes(r.crop) ? (r.crop as Leg) : "robusta",
  impact: String(r.impact_m_bags), probability: String(Math.round((r.probability ?? 0) * 100)),
  note: r.note ?? "",
});

const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function WorldBalanceEditor({
  production, onSaved,
}: {
  /** Derived production for the statement's crop year — read-only context
   *  so the analyst sees the balance move as they type. */
  production: Record<Leg, number>;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"lines" | "risks" | "depth">("lines");
  const [depthTab, setDepthTab] = useState<"grades" | "segments">("grades");
  const [pw, setPw] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [cropYear, setCropYear] = useState("");
  const [blocks, setBlocks] = useState<Record<LineBlock, EditLine[]> | null>(null);
  const [risks, setRisks] = useState<EditRisk[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Depth level 3 — loaded lazily with the statement, absent files are
  // non-fatal (the tab just says there is nothing filed yet).
  const [gradesDoc, setGradesDoc] = useState<OriginGradesDoc | null>(null);
  const [segsDoc, setSegsDoc]     = useState<DemandSegmentsDoc | null>(null);
  const [gradeState, setGradeState] = useState<GradeState>({});
  const [segState, setSegState]     = useState<SegState>({});
  const [gradesDirty, setGradesDirty] = useState(false);
  const [segDirty, setSegDirty] = useState<Set<string>>(new Set());
  const [selOrigin, setSelOrigin] = useState("brazil");
  const [selLeg, setSelLeg] = useState<Leg>("robusta");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PW_KEY);
      if (stored) setPw(stored);
    } catch { /* storage blocked — prompt every time */ }
  }, []);

  // Fresh load on every open: edits must start from what is live, not from
  // whatever the statement fetched at mount.
  useEffect(() => {
    if (!open || !pw || blocks) return;
    let cancelled = false;
    fetch(`/data/world_balance_sheet.json?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null))
      .then((doc: WorldBalanceDoc | null) => {
        if (cancelled) return;
        if (!doc) { setLoadError(true); return; }
        setCropYear(doc.crop_year ?? "");
        setBlocks({
          carry_in:    (doc.carry_in    ?? []).map(toEditLine),
          demand_hubs: (doc.demand_hubs ?? []).map(toEditLine),
          carry_out:   (doc.carry_out   ?? []).map(toEditLine),
        });
        setRisks((doc.risks ?? []).map(toEditRisk));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });

    fetch(`/data/origin_grades.json?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null))
      .then((g: OriginGradesDoc | null) => {
        if (cancelled || !g) return;
        setGradesDoc(g);
        const st: GradeState = {};
        for (const [o, legs] of Object.entries(g.origins ?? {})) {
          st[o] = {};
          for (const [leg, ladder] of Object.entries(legs)) {
            st[o][leg as Leg] = (ladder as GradeRow[]).map(x => ({
              key: x.key, label: x.label, pct: pctOf(x.share),
            }));
          }
        }
        setGradeState(st);
      })
      .catch(() => { /* no ladders filed — the tab says so */ });

    fetch(`/data/demand_segments.json?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: DemandSegmentsDoc | null) => {
        if (cancelled || !d) return;
        setSegsDoc(d);
        const st: SegState = { default: {} };
        const fill = (scope: string, mix: Record<string, Record<string, number>>) => {
          st[scope] = {};
          for (const leg of LEGS) {
            const m = mix?.[leg];
            if (!m) continue;
            st[scope][leg] = Object.fromEntries(
              d.segments.map(sg => [sg.key, pctOf(m[sg.key] ?? 0)]));
          }
        };
        fill("default", (d.default_mix ?? {}) as Record<string, Record<string, number>>);
        for (const [hub, mix] of Object.entries(d.hub_mix ?? {})) {
          fill(hub, mix as Record<string, Record<string, number>>);
        }
        setSegState(st);
      })
      .catch(() => { /* no mixes filed — the tab says so */ });

    return () => { cancelled = true; };
  }, [open, pw, blocks]);

  const close = () => {
    if (saving) return;
    setOpen(false); setView("lines");
    setBlocks(null); setRisks(null); setLoadError(false);
    setGradesDoc(null); setSegsDoc(null); setGradeState({}); setSegState({});
    setGradesDirty(false); setSegDirty(new Set()); setDepthTab("grades");
    setSaved(false); setSaveError(null); setPwInput(""); setPwError(null);
  };

  const unlock = async () => {
    if (!pwInput || checking) return;
    setChecking(true); setPwError(null);
    try {
      const res = await fetch("/api/admin/world-balance", {
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

  // ── Line editing ────────────────────────────────────────────────────────
  const setLine = (block: LineBlock, i: number, patch: Partial<EditLine>) =>
    setBlocks(b => b && ({ ...b, [block]: b[block].map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const setLeg = (block: LineBlock, i: number, leg: Leg, v: string) =>
    setBlocks(b => b && ({
      ...b,
      [block]: b[block].map((l, j) => (j === i ? { ...l, legs: { ...l.legs, [leg]: v } } : l)),
    }));
  const addLine = (block: LineBlock) =>
    setBlocks(b => b && ({ ...b, [block]: [...b[block], { key: "", label: "", legs: emptyText(), isNew: true }] }));
  const dropLine = (block: LineBlock, i: number) =>
    setBlocks(b => b && ({ ...b, [block]: b[block].filter((_, j) => j !== i) }));

  const setRisk = (i: number, patch: Partial<EditRisk>) =>
    setRisks(rs => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRisk = () =>
    setRisks(rs => rs && [...rs, {
      key: "", driver: "", origin: "", crop: "robusta",
      impact: "", probability: "", note: "", isNew: true,
    }]);
  const dropRisk = (i: number) => setRisks(rs => rs && rs.filter((_, j) => j !== i));

  // ── Grade ladders ───────────────────────────────────────────────────────
  const ladder = (o: string, leg: Leg): GradeEdit[] => gradeState[o]?.[leg] ?? [];
  const setLadder = (o: string, leg: Leg, rows: GradeEdit[]) => {
    setGradesDirty(true);
    setGradeState(st => ({ ...st, [o]: { ...(st[o] ?? {}), [leg]: rows } }));
  };
  const setGrade = (o: string, leg: Leg, i: number, patch: Partial<GradeEdit>) =>
    setLadder(o, leg, ladder(o, leg).map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGrade = (o: string, leg: Leg) =>
    setLadder(o, leg, [...ladder(o, leg), { key: "", label: "", pct: "", isNew: true }]);
  const dropGrade = (o: string, leg: Leg, i: number) =>
    setLadder(o, leg, ladder(o, leg).filter((_, j) => j !== i));

  // ── Consumption mix ─────────────────────────────────────────────────────
  /** A hub with no override reads the default, so the grid always shows a
   *  full column; typing in it is what turns the default into an override. */
  const segPct = (scope: string, leg: Leg, seg: string): string =>
    segState[scope]?.[leg]?.[seg] ?? segState.default?.[leg]?.[seg] ?? "";
  const setSegPct = (scope: string, leg: Leg, seg: string, v: string) => {
    setSegDirty(prev => new Set(prev).add(scope));
    setSegState(st => {
      const legMix = { ...(st[scope]?.[leg] ?? st.default?.[leg] ?? {}), [seg]: v };
      return { ...st, [scope]: { ...(st[scope] ?? {}), [leg]: legMix } };
    });
  };

  // ── Live totals ─────────────────────────────────────────────────────────
  const blockTotal = (ls: EditLine[]) =>
    ls.reduce((acc, l) => addLegs(acc, textLegs(l.legs)), emptyLegs());
  const carryIn  = blocks ? blockTotal(blocks.carry_in)    : emptyLegs();
  const demand   = blocks ? blockTotal(blocks.demand_hubs) : emptyLegs();
  const carryOut = blocks ? blockTotal(blocks.carry_out)   : emptyLegs();
  const supply   = addLegs(addLegs(emptyLegs(), production), carryIn);
  const outflow  = addLegs(addLegs(emptyLegs(), demand), carryOut);
  const residual = emptyLegs();
  for (const l of LEGS) residual[l] = r1(supply[l] - outflow[l]);

  // The legacy unsplit column shows while anything still uses it — the
  // entered lines OR the derived production. Zero every cell and it goes.
  const legacyInUse =
    production.arabica > 0 ||
    !!blocks && LINE_BLOCKS.some(b => blocks[b.key].some(l => num(l.legs.arabica) > 0));
  const cols: readonly Leg[] = legacyInUse ? LEGS : LEGS.filter(l => l !== "arabica");

  // ── Save ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!blocks || !risks || !pw || saving) return;
    setSaveError(null);

    if (!SEASON_RE.test(cropYear)) { setSaveError("Crop year must look like 2025/26."); return; }

    const body: Record<string, unknown> = { crop_year: cropYear, updated: nowStamp() };
    for (const b of LINE_BLOCKS) {
      const rows = blocks[b.key];
      if (rows.length > MAX_LINES) { setSaveError(`${b.label}: at most ${MAX_LINES} lines.`); return; }
      const taken = new Set(rows.filter(l => !l.isNew).map(l => l.key));
      const out: Line[] = [];
      for (const l of rows) {
        const label = l.label.trim();
        if (!label) { setSaveError(`${b.label}: every line needs a label.`); return; }
        if (label.length > 48) { setSaveError(`${b.label}: "${label}" — label max 48 chars.`); return; }
        const key = l.isNew ? slug(label, taken, `line_${out.length + 1}`) : l.key;
        const line: Line = { key, label };
        for (const leg of LEGS) {
          const raw = l.legs[leg];
          if (raw.trim() === "") continue;
          const v = Number(raw);
          if (!Number.isFinite(v) || v < 0 || v > MAX_MBAGS) {
            setSaveError(`${label} · ${LEG_LABEL[leg]}: must be 0–${MAX_MBAGS} million bags.`);
            return;
          }
          if (v) line[leg] = r1(v);
        }
        out.push(line);
      }
      body[b.key] = out;
    }

    if (risks.length > MAX_RISKS) { setSaveError(`At most ${MAX_RISKS} risk entries.`); return; }
    const rTaken = new Set(risks.filter(r => !r.isNew).map(r => r.key));
    const rOut: Risk[] = [];
    for (const r of risks) {
      const driver = r.driver.trim(), origin = r.origin.trim();
      if (!driver || !origin) { setSaveError("Every risk needs a driver and an origin."); return; }
      if (driver.length > 32 || origin.length > 32) {
        setSaveError(`${driver || origin}: driver and origin max 32 chars.`); return;
      }
      const impact = Number(r.impact);
      if (!Number.isFinite(impact) || impact === 0 || Math.abs(impact) > MAX_IMPACT) {
        setSaveError(`${driver}: impact must be non-zero, within ±${MAX_IMPACT} m bags (negative = risk).`);
        return;
      }
      const pct = Number(r.probability);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setSaveError(`${driver}: probability must be 0–100%.`); return;
      }
      if (r.note.length > 400) { setSaveError(`${driver}: note max 400 chars.`); return; }
      const row: Risk = {
        key: r.isNew ? slug(driver + "_" + origin, rTaken, `risk_${rOut.length + 1}`) : r.key,
        driver, origin, crop: r.crop,
        impact_m_bags: r1(impact),
        probability: Math.round(pct) / 100,
      };
      if (r.note.trim()) row.note = r.note.trim();
      rOut.push(row);
    }
    body.risks = rOut;

    // ── Depth level 3 ──────────────────────────────────────────────────
    // Only sent when actually touched: re-sending an untouched block would
    // let a display rounding turn into a spurious commit.
    if (gradesDirty) {
      const out: Record<string, Record<string, { key: string; label: string; share: number }[]>> = {};
      for (const [o, legs] of Object.entries(gradeState)) {
        const cleaned: Record<string, { key: string; label: string; share: number }[]> = {};
        for (const leg of LEGS) {
          const rows = legs[leg];
          if (!rows?.length) continue;
          const taken = new Set(rows.filter(g => !g.isNew).map(g => g.key));
          const built: { key: string; label: string; share: number }[] = [];
          for (const g of rows) {
            const label = g.label.trim();
            if (!label) { setSaveError(`${ORIGIN_LABELS[o] ?? o} · ${LEG_LABEL[leg]}: every grade needs a name.`); return; }
            const pct = Number(g.pct);
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
              setSaveError(`${ORIGIN_LABELS[o] ?? o} · ${label}: share must be 0–100%.`); return;
            }
            built.push({
              key: g.isNew ? slug(label, taken, `g${built.length + 1}`) : g.key,
              label, share: shareOf(g.pct),
            });
          }
          const tot = pctSum(rows.map(g => g.pct));
          if (Math.abs(tot - 100) > 0.5) {
            setSaveError(`${ORIGIN_LABELS[o] ?? o} · ${LEG_LABEL[leg]}: grades total ${tot}%, must total 100%.`);
            return;
          }
          cleaned[leg] = built;
        }
        if (Object.keys(cleaned).length) out[o] = cleaned;
      }
      body.origin_grades = out;
    }

    if (segDirty.size && segsDoc) {
      const buildMix = (scope: string) => {
        const mix: Record<string, Record<string, number>> = {};
        for (const leg of LEGS) {
          const vals = segsDoc.segments.map(sg => segPct(scope, leg, sg.key));
          if (vals.every(v => v.trim() === "")) continue;
          const tot = pctSum(vals);
          if (Math.abs(tot - 100) > 0.5) {
            throw new Error(`${scope === "default" ? "Default" : scope} · ${LEG_LABEL[leg]}: mix totals ${tot}%, must total 100%.`);
          }
          mix[leg] = Object.fromEntries(
            segsDoc.segments.map((sg, i) => [sg.key, shareOf(vals[i])]));
        }
        return mix;
      };
      try {
        const seg: Record<string, unknown> = {};
        if (segDirty.has("default")) seg.default_mix = buildMix("default");
        // Every hub that already had an override keeps one, plus any the
        // analyst just diverged from the default.
        const hubs = new Set([
          ...Object.keys(segsDoc.hub_mix ?? {}),
          ...Array.from(segDirty).filter(k => k !== "default"),
        ]);
        if (hubs.size) {
          seg.hub_mix = Object.fromEntries(Array.from(hubs).map(h => [h, buildMix(h)]));
        }
        body.demand_segments = seg;
        body.segment_keys = segsDoc.segments.map(sg => sg.key);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Bad consumption mix.");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/world-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", password: pw, ...body }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved?.();
      } else if (res.status === 401) {
        setPw(null);
        try { sessionStorage.removeItem(PW_KEY); } catch { /* fine */ }
        setSaveError("Password no longer valid — unlock again.");
      } else {
        const j = await res.json().catch(() => ({}));
        setSaveError(j.detail ?? j.error ?? `Save failed (${res.status}).`);
      }
    } catch {
      setSaveError("Network error — nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const numCls =
    "w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-right text-slate-200 " +
    "focus:outline-none focus:border-slate-500 placeholder:text-slate-700";
  const textCls =
    "bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 " +
    "focus:outline-none focus:border-slate-500 placeholder:text-slate-700";

  const TotalRow = ({ label, legs, tone }: { label: string; legs: Record<Leg, number>; tone: string }) => (
    <tr className="border-t border-slate-700">
      <td className={`py-1 pr-2 font-bold ${tone}`}>{label}</td>
      {cols.map(l => (
        <td key={l} className={`py-1 px-1 text-right font-mono font-bold ${tone}`}>{fmt(legs[l])}</td>
      ))}
      <td className={`py-1 pl-2 text-right font-mono font-bold ${tone}`}>{fmt(legTotal(legs))}</td>
      <td />
    </tr>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Edit the analyst-entered lines (stocks, demand, transit) and the risk register"
        className="text-[9px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors"
      >
        ✎
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-full max-w-4xl max-h-[85vh] overflow-y-auto space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] text-slate-300 uppercase tracking-wide font-bold">
                Edit world balance sheet
              </div>
              <div className="flex items-center gap-2">
                {pw && blocks && (
                  <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                    {([
                      ["lines", "Balance lines", "Carry-in, consumption by hub, carry-out"],
                      ["depth", "Grades & segments", "Quality ladders per origin; the consumption mix per hub"],
                      ["risks", "Risk & Opps", "Risk & opportunity register"],
                    ] as const).map(([v, label, tip]) => (
                      <button key={v} onClick={() => setView(v)}
                        className={`text-[9px] px-2 py-0.5 transition-colors ${
                          view === v ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                        }`}
                        title={tip}>
                        {label}
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
            ) : loadError ? (
              <div className="text-[10px] text-red-400">
                Could not load world_balance_sheet.json — nothing to edit.
              </div>
            ) : saved ? (
              <div className="space-y-3">
                <div className="text-[10px] text-emerald-400 font-semibold">✓ Submitted.</div>
                <div className="text-[9px] text-slate-400 leading-relaxed">
                  The commit is being pushed and redeployed — live for everyone in ~2 minutes.
                  This confirms the edit was accepted for processing, not that it is
                  committed; a failure raises a Telegram alert.
                  Production stays derived from the crop estimates, so the balance you just set
                  will move again when an origin estimate changes.
                </div>
                <div className="flex justify-end">
                  <button onClick={close} className="text-[10px] px-3 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors">
                    Close
                  </button>
                </div>
              </div>
            ) : !blocks || !risks ? (
              <div className="text-[10px] text-slate-500 animate-pulse py-8 text-center">Loading…</div>
            ) : view === "lines" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[9px] text-slate-400">
                  <span>Crop year</span>
                  <input value={cropYear} onChange={e => setCropYear(e.target.value)}
                    className={`${textCls} w-20 text-[10px]`} placeholder="2025/26" />
                  <span className="text-slate-600">
                    · production is derived from this season&apos;s crop estimates and is not editable here
                  </span>
                </div>

                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left py-1 pr-2 font-medium">Line</th>
                      {cols.map(l => (
                        <th key={l} className={`text-right py-1 px-1 font-medium ${LEG_TONE[l]}`}>{LEG_LABEL[l]}</th>
                      ))}
                      <th className="text-right py-1 pl-2 font-medium">Total</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={cols.length + 3} className="pt-1 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-emerald-500">
                        Supply
                      </td>
                    </tr>
                    <tr className="border-t border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-500 italic">Production (derived)</td>
                      {cols.map(l => (
                        <td key={l} className="py-1 px-1 text-right font-mono text-slate-500">{fmt(production[l])}</td>
                      ))}
                      <td className="py-1 pl-2 text-right font-mono text-slate-500">{fmt(legTotal(production))}</td>
                      <td />
                    </tr>

                    {LINE_BLOCKS.map(b => (
                      <BlockRows key={b.key} block={b} rows={blocks[b.key]} cols={cols}
                        numCls={numCls} textCls={textCls}
                        onLabel={(i, v) => setLine(b.key, i, { label: v })}
                        onLeg={(i, leg, v) => setLeg(b.key, i, leg, v)}
                        onDrop={i => dropLine(b.key, i)}
                        onAdd={() => addLine(b.key)}
                        total={b.key === "carry_in" ? carryIn : b.key === "demand_hubs" ? demand : carryOut} />
                    ))}

                    <TotalRow label="TOTAL SUPPLY" legs={supply} tone="text-emerald-300" />
                    <TotalRow label="TOTAL DEMAND" legs={outflow} tone="text-red-300" />
                    <tr className="border-t-2 border-slate-500">
                      <td className="py-1.5 pr-2 font-bold text-slate-200">Balance</td>
                      {cols.map(l => (
                        <td key={l} className={`py-1.5 px-1 text-right font-mono font-bold ${
                          legacyInUse && l !== "robusta" ? "text-slate-700"
                            : residual[l] >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          title={legacyInUse && l !== "robusta"
                            ? "Not comparable while some production is unsplit"
                            : undefined}>
                          {legacyInUse && l !== "robusta"
                            ? "–"
                            : `${residual[l] >= 0 ? "+" : ""}${fmt(residual[l])}`}
                        </td>
                      ))}
                      <td className={`py-1.5 pl-2 text-right font-mono font-bold ${
                        chgTone(legTotal(residual))}`}>
                        {legTotal(residual) >= 0 ? "+" : ""}{fmt(legTotal(residual))}
                      </td>
                      <td />
                    </tr>
                    <tr>
                      <td className="py-1 pr-2 text-[9px] text-amber-600">Arabica (all)</td>
                      <td colSpan={cols.length} className="py-1 px-1 text-right font-mono text-[9px] text-amber-500">
                        supply {fmt(arabicaAll(supply))} · demand {fmt(arabicaAll(outflow))}
                      </td>
                      <td className={`py-1 pl-2 text-right font-mono font-bold text-[9px] ${
                        chgTone(arabicaAll(residual))}`}>
                        {arabicaAll(residual) >= 0 ? "+" : ""}{fmt(arabicaAll(residual))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                <div className="text-[8px] text-slate-600 leading-relaxed">
                  The balance updates as you type. It is a residual, not a constraint — leaving
                  it non-zero is a legitimate statement about your assumptions. Blank a leg to
                  drop it from the line; the <span className="text-amber-700/80">Ar. unsplit</span> column
                  disappears once nothing uses it.
                </div>

                <Footer saving={saving} error={saveError} onCancel={close} onSave={save} />
              </div>
            ) : view === "depth" ? (
              <div className="space-y-3">
                <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                  {([
                    ["grades", "Quality grades", "Each origin's own ladder — SHG/HG/Standard, G1/G2/G3, fine cup/GC/Rio"],
                    ["segments", "Consumption mix", "How each hub's leg splits across retail formats and the coffee shop"],
                  ] as const).map(([k, label, tip]) => (
                    <button key={k} onClick={() => setDepthTab(k)} title={tip}
                      className={`text-[9px] px-2 py-0.5 transition-colors ${
                        depthTab === k ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>

                {depthTab === "grades" ? (
                  !gradesDoc ? (
                    <div className="text-[10px] text-slate-500">
                      No grade ladders filed yet (origin_grades.json).
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[9px] text-slate-400">
                        <span>Origin</span>
                        <select value={selOrigin} onChange={e => setSelOrigin(e.target.value)}
                          className={`${textCls} text-[10px]`}>
                          {Object.keys(ORIGIN_LABELS).map(o => (
                            <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>
                          ))}
                        </select>
                        <span className="text-slate-600">
                          · grade names are this origin&apos;s own — nothing is harmonised across origins
                        </span>
                      </div>

                      {GRADE_LEGS.concat(
                        ladder(selOrigin, "arabica").length ? ["arabica" as Leg] : [],
                      ).map(leg => {
                        const rows = ladder(selOrigin, leg);
                        const total = pctSum(rows.map(g => g.pct));
                        const off = rows.length > 0 && Math.abs(total - 100) > 0.5;
                        return (
                          <div key={leg} className="space-y-1">
                            <div className="flex items-baseline justify-between">
                              <div className={`text-[9px] uppercase tracking-wide font-bold ${LEG_TONE[leg]}`}>
                                {LEG_LABEL[leg]}
                              </div>
                              {rows.length > 0 && (
                                <div className={`text-[9px] font-mono ${off ? "text-red-400" : "text-slate-500"}`}>
                                  {total}%
                                </div>
                              )}
                            </div>
                            {rows.length === 0 ? (
                              <div className="text-[9px] text-slate-600">
                                No ladder — this leg shows as one ungraded row in the statement.
                              </div>
                            ) : (
                              <table className="w-full text-[10px]">
                                <tbody>
                                  {rows.map((g, i) => (
                                    <tr key={g.key || `new_${i}`} className="border-t border-slate-800/60">
                                      <td className="py-1 pr-2">
                                        <input value={g.label}
                                          onChange={e => setGrade(selOrigin, leg, i, { label: e.target.value })}
                                          className={`${textCls} w-40`} placeholder="Grade name" />
                                      </td>
                                      <td className="py-1 px-1 text-right w-20">
                                        <input value={g.pct}
                                          onChange={e => setGrade(selOrigin, leg, i, { pct: e.target.value })}
                                          className={numCls} placeholder="%" />
                                      </td>
                                      <td className="py-1 pl-1 w-6 text-right">
                                        <button onClick={() => dropGrade(selOrigin, leg, i)} title="Remove grade"
                                          className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">✕</button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <button onClick={() => addGrade(selOrigin, leg)}
                              className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
                              + grade
                            </button>
                          </div>
                        );
                      })}

                      <div className="text-[8px] text-slate-600 leading-relaxed">
                        Grades are shares of the leg, not bags: production is derived from the crop
                        estimates, so a share keeps the grade rows re-summing to the leg exactly and
                        stops them drifting when an estimate moves. Each leg must total 100%.
                      </div>
                    </div>
                  )
                ) : !segsDoc ? (
                  <div className="text-[10px] text-slate-500">
                    No consumption mix filed yet (demand_segments.json).
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                        {GRADE_LEGS.map(l => (
                          <button key={l} onClick={() => setSelLeg(l)}
                            className={`text-[9px] px-2 py-0.5 transition-colors ${
                              selLeg === l ? `bg-slate-700 ${LEG_TONE[l]}` : "text-slate-500 hover:text-slate-300"
                            }`}>
                            {LEG_LABEL[l]}
                          </button>
                        ))}
                      </div>
                      <span className="text-[9px] text-slate-600">
                        · a hub with no mix of its own reads the default until you type in it
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="text-left py-1 pr-2 font-medium">Format</th>
                            {["default", ...(blocks?.demand_hubs ?? []).map(h => h.key)].map(scope => (
                              <th key={scope} className="text-right py-1 px-1 font-medium whitespace-nowrap">
                                {scope === "default"
                                  ? "Default"
                                  : (blocks?.demand_hubs ?? []).find(h => h.key === scope)?.label ?? scope}
                                {scope !== "default" && !segState[scope] && (
                                  <span className="ml-1 text-slate-700">(def)</span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {segsDoc.channels.map(ch => (
                            <Fragment key={ch.key}>
                              <tr>
                                <td colSpan={2 + (blocks?.demand_hubs?.length ?? 0)}
                                  className="pt-2 pb-0.5 text-[8px] uppercase tracking-wider font-bold text-slate-500">
                                  {ch.label}
                                </td>
                              </tr>
                              {segsDoc.segments.filter(sg => sg.channel === ch.key).map(sg => (
                                <tr key={sg.key} className="border-t border-slate-800/60">
                                  <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{sg.label}</td>
                                  {["default", ...(blocks?.demand_hubs ?? []).map(h => h.key)].map(scope => (
                                    <td key={scope} className="py-1 px-1 text-right">
                                      <input value={segPct(scope, selLeg, sg.key)}
                                        onChange={e => setSegPct(scope, selLeg, sg.key, e.target.value)}
                                        className={`${numCls} w-12`} placeholder="%" />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                          <tr className="border-t border-slate-600">
                            <td className="py-1 pr-2 font-bold text-slate-300">Total</td>
                            {["default", ...(blocks?.demand_hubs ?? []).map(h => h.key)].map(scope => {
                              const t = pctSum(segsDoc.segments.map(sg => segPct(scope, selLeg, sg.key)));
                              return (
                                <td key={scope}
                                  className={`py-1 px-1 text-right font-mono font-bold ${
                                    Math.abs(t - 100) > 0.5 ? "text-red-400" : "text-slate-400"}`}>
                                  {t}%
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="text-[8px] text-slate-600 leading-relaxed">
                      Shares of each hub&apos;s leg, so the segment rows always re-sum to the hub and a
                      change to a hub total flows straight through. Every column must total 100%.
                      Typing into a hub that reads <span className="text-slate-500">(def)</span> gives
                      it a mix of its own.
                    </div>
                  </div>
                )}

                <Footer saving={saving} error={saveError} onCancel={close} onSave={save} />
              </div>
            ) : (
              <div className="space-y-3">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left py-1 pr-2 font-medium">Driver</th>
                      <th className="text-left py-1 pr-2 font-medium">Origin</th>
                      <th className="text-left py-1 pr-2 font-medium">Crop</th>
                      <th className="text-right py-1 px-1 font-medium">Impact</th>
                      <th className="text-right py-1 px-1 font-medium">Prob %</th>
                      <th className="text-left py-1 pl-2 font-medium">Note</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {risks.map((r, i) => (
                      <tr key={r.key || `new_${i}`} className="border-t border-slate-800/60">
                        <td className="py-1 pr-2">
                          <input value={r.driver} onChange={e => setRisk(i, { driver: e.target.value })}
                            className={`${textCls} w-24`} placeholder="El Niño" />
                        </td>
                        <td className="py-1 pr-2">
                          <input value={r.origin} onChange={e => setRisk(i, { origin: e.target.value })}
                            className={`${textCls} w-20`} placeholder="Vietnam" />
                        </td>
                        <td className="py-1 pr-2">
                          <select value={r.crop} onChange={e => setRisk(i, { crop: e.target.value as Leg })}
                            className={`${textCls} w-24 ${LEG_TONE[r.crop]}`}>
                            {LEGS.map(l => <option key={l} value={l}>{LEG_LABEL[l]}</option>)}
                          </select>
                        </td>
                        <td className="py-1 px-1">
                          <input value={r.impact} onChange={e => setRisk(i, { impact: e.target.value })}
                            className={numCls} placeholder="-2.5" title="Million bags; negative = risk, positive = opportunity" />
                        </td>
                        <td className="py-1 px-1">
                          <input value={r.probability} onChange={e => setRisk(i, { probability: e.target.value })}
                            className={numCls} placeholder="35" />
                        </td>
                        <td className="py-1 pl-2">
                          <input value={r.note} onChange={e => setRisk(i, { note: e.target.value })}
                            className={`${textCls} w-full min-w-[10rem]`} placeholder="Why this could happen" />
                        </td>
                        <td className="py-1 text-right">
                          <button onClick={() => dropRisk(i)} title="Remove"
                            className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">✕</button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={7} className="pt-1">
                        <button onClick={addRisk}
                          className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
                          + risk / opportunity
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="text-[8px] text-slate-600 leading-relaxed">
                  Impact is signed: negative for a risk to the crop, positive for an
                  opportunity. Expected impact — what the register ranks on — is impact ×
                  probability, so these are scenario weights sitting on top of the balance
                  sheet, not part of it. The balance only moves once an event is written into
                  the estimates themselves.
                </div>

                <Footer saving={saving} error={saveError} onCancel={close} onSave={save} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** One editable block — its lines, an add button, and its subtotal. */
function BlockRows({
  block, rows, cols, numCls, textCls, onLabel, onLeg, onDrop, onAdd, total,
}: {
  block: (typeof LINE_BLOCKS)[number];
  rows: EditLine[]; cols: readonly Leg[];
  numCls: string; textCls: string;
  onLabel: (i: number, v: string) => void;
  onLeg: (i: number, leg: Leg, v: string) => void;
  onDrop: (i: number) => void;
  onAdd: () => void;
  total: Record<Leg, number>;
}) {
  return (
    <>
      <tr>
        <td colSpan={cols.length + 3} className={`pt-2 pb-0.5 text-[8px] uppercase tracking-wider font-bold ${
          block.side === "supply" ? "text-emerald-500" : "text-red-400"}`}>
          {block.label}
        </td>
      </tr>
      {rows.map((l, i) => (
        <tr key={l.key || `new_${i}`} className="border-t border-slate-800/60">
          <td className="py-1 pr-2">
            <input value={l.label} onChange={e => onLabel(i, e.target.value)}
              className={`${textCls} w-40`} placeholder="Line name" />
          </td>
          {cols.map(leg => (
            <td key={leg} className="py-1 px-1 text-right">
              <input value={l.legs[leg]} onChange={e => onLeg(i, leg, e.target.value)}
                className={numCls} placeholder="–" />
            </td>
          ))}
          <td className="py-1 pl-2 text-right font-mono text-slate-400">
            {fmt(legTotal(textLegs(l.legs)))}
          </td>
          <td className="py-1 text-right">
            <button onClick={() => onDrop(i)} title="Remove line"
              className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">✕</button>
          </td>
        </tr>
      ))}
      <tr>
        <td className="pt-0.5 pb-1">
          <button onClick={onAdd}
            className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
            + line
          </button>
        </td>
        {cols.map(leg => (
          <td key={leg} className="pt-0.5 pb-1 px-1 text-right font-mono text-slate-300">{fmt(total[leg])}</td>
        ))}
        <td className="pt-0.5 pb-1 pl-2 text-right font-mono font-bold text-slate-300">{fmt(legTotal(total))}</td>
        <td />
      </tr>
    </>
  );
}

function Footer({ saving, error, onCancel, onSave }: {
  saving: boolean; error: string | null; onCancel: () => void; onSave: () => void;
}) {
  return (
    <>
      {error && <div className="text-[9px] text-red-400">{error}</div>}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[8px] text-slate-600">
          Saving commits the file to git and redeploys — live in ~2 minutes.
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={saving}
            className="text-[10px] px-3 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving}
            className="text-[10px] px-3 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
