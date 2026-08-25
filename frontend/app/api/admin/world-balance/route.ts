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

  const json = JSON.stringify(payload);
  if (json.length > 60_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  const res = await dispatchWorkflow(WORKFLOW, json);
  if (res.ok) return NextResponse.json({ ok: true, repo: res.repo });
  return NextResponse.json(
    { error: res.error, ...(res.body ? { body: res.body } : {}) },
    { status: res.status },
  );
}
