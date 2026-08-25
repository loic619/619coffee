import { NextResponse } from "next/server";
import { passwordOk, dispatchWorkflow } from "@/lib/adminDispatch";

// Password-gated write path for the world balance sheet's analyst lines
// (carry-in, consumption by hub, carry-out, risk register). Same password and
// dispatch plumbing as the crop-estimate route — both import it from
// lib/adminDispatch so there is one comparison, not two.
//
// Production is deliberately NOT accepted here: the balance sheet derives it
// from the per-origin crop estimates so the world view cannot disagree with
// an origin tab. The applier rejects a payload carrying it as well, so the
// rule holds even if this route is bypassed.

const WORKFLOW = "apply-world-balance-edit.yml";
const LEGS = ["arabica_washed", "arabica_natural", "arabica", "robusta"] as const;
const KEY_RE = /^[a-z0-9_]{1,32}$/;
const SEASON_RE = /^\d{4}\/\d{2}$/;
const UPDATED_RE = /^\d{4}-\d{2}$/;
const MAX_LINES = 24, MAX_RISKS = 40, MAX_MBAGS = 400, MAX_IMPACT = 50;
const MAX_ORIGINS = 32, MAX_GRADES = 8, SHARE_TOL = 0.005;

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Line = Record<string, string | number>;

function validateLines(raw: unknown, block: string): Line[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_LINES) {
    return `${block}: must be a list of at most ${MAX_LINES} lines`;
  }
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return `${block}: each line must be an object`;
    const { key, label } = r;
    if (typeof key !== "string" || !KEY_RE.test(key)) return `${block}: bad key`;
    if (seen.has(key)) return `${block}: duplicate key ${key}`;
    seen.add(key);
    if (typeof label !== "string" || !label.trim() || label.trim().length > 48) {
      return `${block}.${key}: label must be 1–48 chars`;
    }
    const line: Line = { key, label: label.trim() };
    for (const leg of LEGS) {
      const v = r[leg];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_MBAGS) {
        return `${block}.${key}.${leg}: must be 0–${MAX_MBAGS} million bags`;
      }
      if (v) line[leg] = v;
    }
    out.push(line);
  }
  return out;
}

function validateRisks(raw: unknown): Line[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_RISKS) {
    return `risks: must be a list of at most ${MAX_RISKS} entries`;
  }
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return "risks: each entry must be an object";
    const key = r.key;
    if (typeof key !== "string" || !KEY_RE.test(key)) return "risks: bad key";
    if (seen.has(key)) return `risks: duplicate key ${key}`;
    seen.add(key);
    const row: Line = { key };
    for (const f of ["driver", "origin", "crop"] as const) {
      const v = r[f];
      if (typeof v !== "string" || !v.trim() || v.trim().length > 32) {
        return `risks.${key}.${f}: must be 1–32 chars`;
      }
      row[f] = v.trim();
    }
    const imp = r.impact_m_bags;
    if (typeof imp !== "number" || !Number.isFinite(imp) || imp === 0 || Math.abs(imp) > MAX_IMPACT) {
      return `risks.${key}.impact_m_bags: non-zero, within ±${MAX_IMPACT}`;
    }
    row.impact_m_bags = imp;
    const p = r.probability;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return `risks.${key}.probability: must be 0–1`;
    }
    row.probability = p;
    const note = r.note;
    if (note !== undefined && note !== null) {
      if (typeof note !== "string" || note.length > 400) return `risks.${key}.note: max 400 chars`;
      if (note.trim()) row.note = note.trim();
    }
    out.push(row);
  }
  return out;
}

/** {key: share} — must total 1. A mix that doesn't is an entry slip, and
 *  quietly renormalising it would hide the slip rather than surface it. */
function validateShares(raw: unknown, label: string, allowed: string[] | null): Record<string, number> | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${label}: must be an object of key → share`;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_RE.test(k)) return `${label}: bad key ${k}`;
    if (allowed && !allowed.includes(k)) return `${label}.${k}: not a declared segment`;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      return `${label}.${k}: share must be 0–1`;
    }
    out[k] = Math.round(v * 1e4) / 1e4;
  }
  const keys = Object.keys(out);
  if (!keys.length) return `${label}: empty`;
  const tot = keys.reduce((s, k) => s + out[k], 0);
  if (Math.abs(tot - 1) > SHARE_TOL) return `${label}: shares total ${tot.toFixed(3)}, must total 1`;
  return out;
}

/** {origin: {leg: [{key,label,share}]}} — the per-origin quality ladders. */
function validateGrades(raw: unknown): Record<string, unknown> | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "origin_grades: must be an object";
  const origins = Object.entries(raw as Record<string, unknown>);
  if (origins.length > MAX_ORIGINS) return `origin_grades: at most ${MAX_ORIGINS} origins`;
  const out: Record<string, unknown> = {};
  for (const [origin, legs] of origins) {
    if (!KEY_RE.test(origin)) return `origin_grades: bad origin key ${origin}`;
    if (!legs || typeof legs !== "object") return `origin_grades.${origin}: must be an object`;
    const cleaned: Record<string, unknown> = {};
    for (const [leg, ladder] of Object.entries(legs as Record<string, unknown>)) {
      if (!(LEGS as readonly string[]).includes(leg)) return `origin_grades.${origin}: unknown leg ${leg}`;
      if (!Array.isArray(ladder) || !ladder.length || ladder.length > MAX_GRADES) {
        return `origin_grades.${origin}.${leg}: 1–${MAX_GRADES} grades`;
      }
      const seen = new Set<string>();
      const rows: { key: string; label: string; share: number }[] = [];
      let total = 0;
      for (const g of ladder as Record<string, unknown>[]) {
        if (!g || typeof g !== "object") return `origin_grades.${origin}.${leg}: bad grade`;
        const { key, label, share } = g;
        if (typeof key !== "string" || !KEY_RE.test(key)) return `origin_grades.${origin}.${leg}: bad grade key`;
        if (seen.has(key)) return `origin_grades.${origin}.${leg}: duplicate grade ${key}`;
        seen.add(key);
        if (typeof label !== "string" || !label.trim() || label.trim().length > 32) {
          return `origin_grades.${origin}.${leg}.${key}: label must be 1–32 chars`;
        }
        if (typeof share !== "number" || !Number.isFinite(share) || share < 0 || share > 1) {
          return `origin_grades.${origin}.${leg}.${key}: share must be 0–1`;
        }
        total += share;
        rows.push({ key, label: label.trim(), share: Math.round(share * 1e4) / 1e4 });
      }
      if (Math.abs(total - 1) > SHARE_TOL) {
        return `origin_grades.${origin}.${leg}: shares total ${total.toFixed(3)}, must total 1`;
      }
      cleaned[leg] = rows;
    }
    if (Object.keys(cleaned).length) out[origin] = cleaned;
  }
  return out;
}

/** {leg: {segment: share}} for one hub (or the default). */
function validateMix(raw: unknown, label: string, declared: string[] | null): Record<string, unknown> | string {
  if (!raw || typeof raw !== "object") return `${label}: must be an object of leg → mix`;
  const out: Record<string, unknown> = {};
  for (const [leg, shares] of Object.entries(raw as Record<string, unknown>)) {
    if (!(LEGS as readonly string[]).includes(leg)) return `${label}: unknown leg ${leg}`;
    const res = validateShares(shares, `${label}.${leg}`, declared);
    if (typeof res === "string") return res;
    out[leg] = res;
  }
  return out;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!passwordOk(body.password)) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if ((body.action ?? "save") === "verify") return NextResponse.json({ ok: true });

  const payload: Record<string, unknown> = {};
  const cropYear = body.crop_year;
  if (typeof cropYear !== "string" || !SEASON_RE.test(cropYear)) {
    return NextResponse.json({ error: "bad_crop_year" }, { status: 400 });
  }
  payload.crop_year = cropYear;
  const updated = body.updated;
  if (typeof updated !== "string" || !UPDATED_RE.test(updated)) {
    return NextResponse.json({ error: "bad_updated_stamp" }, { status: 400 });
  }
  payload.updated = updated;

  for (const block of ["carry_in", "demand_hubs", "carry_out"] as const) {
    if (body[block] === undefined) continue;
    const res = validateLines(body[block], block);
    if (typeof res === "string") {
      return NextResponse.json({ error: "invalid_lines", detail: res }, { status: 400 });
    }
    payload[block] = res;
  }
  if (body.risks !== undefined) {
    const res = validateRisks(body.risks);
    if (typeof res === "string") {
      return NextResponse.json({ error: "invalid_risks", detail: res }, { status: 400 });
    }
    payload.risks = res;
  }

  // Depth level 3. The segment taxonomy itself is structural and stays in
  // the file; only the mix across it is writable, so `declared` is whatever
  // the caller says it is and the applier re-checks it against the file.
  if (body.origin_grades !== undefined) {
    const res = validateGrades(body.origin_grades);
    if (typeof res === "string") {
      return NextResponse.json({ error: "invalid_grades", detail: res }, { status: 400 });
    }
    payload.origin_grades = res;
  }
  if (body.demand_segments !== undefined) {
    const raw = body.demand_segments as Record<string, unknown>;
    const declared = Array.isArray(body.segment_keys)
      ? (body.segment_keys as unknown[]).filter((k): k is string => typeof k === "string")
      : null;
    const seg: Record<string, unknown> = {};
    if (raw?.default_mix !== undefined) {
      const res = validateMix(raw.default_mix, "demand_segments.default_mix", declared);
      if (typeof res === "string") {
        return NextResponse.json({ error: "invalid_segments", detail: res }, { status: 400 });
      }
      seg.default_mix = res;
    }
    if (raw?.hub_mix !== undefined) {
      const hubs = raw.hub_mix as Record<string, unknown>;
      if (!hubs || typeof hubs !== "object" || Object.keys(hubs).length > MAX_LINES) {
        return NextResponse.json(
          { error: "invalid_segments", detail: `demand_segments.hub_mix: at most ${MAX_LINES} hubs` },
          { status: 400 });
      }
      const cleaned: Record<string, unknown> = {};
      for (const [hub, mix] of Object.entries(hubs)) {
        if (!KEY_RE.test(hub)) {
          return NextResponse.json(
            { error: "invalid_segments", detail: `demand_segments.hub_mix: bad hub key ${hub}` },
            { status: 400 });
        }
        const res = validateMix(mix, `demand_segments.hub_mix.${hub}`, declared);
        if (typeof res === "string") {
          return NextResponse.json({ error: "invalid_segments", detail: res }, { status: 400 });
        }
        cleaned[hub] = res;
      }
      seg.hub_mix = cleaned;
    }
    if (Object.keys(seg).length) payload.demand_segments = seg;
  }

  const json = JSON.stringify(payload);
  if (json.length > 120_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  const res = await dispatchWorkflow(WORKFLOW, json);
  if (res.ok) return NextResponse.json({ ok: true, repo: res.repo });
  return NextResponse.json(
    { error: res.error, ...(res.body ? { body: res.body } : {}) },
    { status: res.status },
  );
}
