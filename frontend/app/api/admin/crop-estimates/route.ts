import { NextResponse } from "next/server";
import { passwordOk, dispatchWorkflow } from "@/lib/adminDispatch";

// Password-gated write path for the crop-estimate "edit mode" on the origin
// S&D cards. The admin password never reaches GitHub: it's checked here
// (SHA-256, constant-time), and only the validated seasons payload is
// forwarded as a workflow_dispatch to apply-crop-estimate-edit.yml, which
// re-validates, rewrites the origin's balance-sheet JSON and commits — so
// every edit lives in git history and goes live on the auto-redeploy
// (~2 min). Reuses the same GH_DISPATCH_TOKEN fine-grained PAT as
// /api/refresh-acaphe (Actions: read+write on this repo only).
//
// The stored credential is a SHA-256 hex digest of the admin password —
// set CROP_EDIT_PASSWORD_SHA256 in the Vercel env to rotate it without a
// code change.

const WORKFLOW = "apply-crop-estimate-edit.yml";

const ORIGINS = new Set([
  "brazil", "colombia", "indonesia", "uganda", "vietnam",
  "honduras", "ethiopia", "india", "peru", "mexico",
  "guatemala", "nicaragua", "china", "ivory_coast", "costa_rica", "tanzania",
]);
const SEASON_RE = /^\d{4}\/\d{2}$/;
const UPDATED_RE = /^\d{4}-\d{2}$/;
const SOURCE_KEY_RE = /^[a-z0-9_]{1,20}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_MBAGS = 200;

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SeasonIn {
  season?: unknown;
  forecast?: unknown;
  production?: unknown;
  production_split?: unknown;
  production_final?: unknown;
}

// Crop legs a split may carry. `arabica` is the LEGACY unsplit form kept
// for existing seeds; new edits use the washed/natural pair, and a split
// carries one form or the other — never both, or consumers that sum the
// legs would double-count.
const SPLIT_LEGS = ["arabica_washed", "arabica_natural", "arabica", "robusta"] as const;
type SplitLeg = (typeof SPLIT_LEGS)[number];
type SplitLegs = Partial<Record<SplitLeg, number>>;
interface SeasonOut {
  season: string;
  forecast: boolean;
  production: Record<string, number>;
  production_split?: Record<string, SplitLegs>;
  production_final?: number | null;
}

/** Optional per-source arabica/robusta split ("by source" editor view).
 *  A split must accompany a total for the same key; when both legs are
 *  present they must sum to it (±0.05). Returns legs, null when the field
 *  is absent, or an error string. */
function validateSplit(
  raw: unknown, label: string, production: Record<string, number>,
): Record<string, SplitLegs> | null | string {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${label}: production_split must be an object`;
  }
  const out: Record<string, SplitLegs> = {};
  for (const [k, sp] of Object.entries(raw as Record<string, unknown>)) {
    if (!SOURCE_KEY_RE.test(k)) return `${label}: bad split key ${JSON.stringify(k)}`;
    if (!(k in production)) return `${label}.${k}: split without a total`;
    if (!sp || typeof sp !== "object" || Array.isArray(sp)) return `${label}.${k}: split must be an object`;
    const legs: SplitLegs = {};
    for (const leg of SPLIT_LEGS) {
      const v = (sp as Record<string, unknown>)[leg];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_MBAGS) {
        return `${label}.${k}.${leg}: value must be in (0, ${MAX_MBAGS}] million bags`;
      }
      legs[leg] = v;
    }
    const present = Object.keys(legs) as SplitLeg[];
    if (present.length === 0) {
      return `${label}.${k}: split needs at least one of ${SPLIT_LEGS.join(", ")}`;
    }
    if (legs.arabica !== undefined &&
        (legs.arabica_washed !== undefined || legs.arabica_natural !== undefined)) {
      return `${label}.${k}: use arabica_washed/arabica_natural OR legacy arabica, not both`;
    }
    const sum = present.reduce((a, leg) => a + (legs[leg] ?? 0), 0);
    if (sum > production[k] + 0.051) {
      return `${label}.${k}: split exceeds the total`;
    }
    // Two or more legs means the split is meant to be complete.
    if (present.length >= 2 && Math.abs(sum - production[k]) > 0.051) {
      return `${label}.${k}: split does not sum to the total`;
    }
    out[k] = legs;
  }
  return out;
}

/** Returns a normalized seasons array, or a string describing the problem. */
function validateSeasons(seasons: unknown): SeasonOut[] | string {
  if (!Array.isArray(seasons) || seasons.length < 1 || seasons.length > 40) {
    return "seasons must be a list of 1–40 entries";
  }
  const out: SeasonOut[] = [];
  const seen = new Set<string>();
  for (const raw of seasons as SeasonIn[]) {
    const label = raw?.season;
    if (typeof label !== "string" || !SEASON_RE.test(label)) {
      return `bad season label ${JSON.stringify(label)}`;
    }
    if (seen.has(label)) return `duplicate season ${label}`;
    seen.add(label);
    const prod = raw?.production;
    if (!prod || typeof prod !== "object" || Array.isArray(prod)) {
      return `${label}: production must be an object`;
    }
    const entries = Object.entries(prod as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 10) {
      return `${label}: production needs 1–10 source values`;
    }
    const production: Record<string, number> = {};
    for (const [k, v] of entries) {
      if (!SOURCE_KEY_RE.test(k)) return `${label}: bad source key ${JSON.stringify(k)}`;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_MBAGS) {
        return `${label}.${k}: value must be in (0, ${MAX_MBAGS}] million bags`;
      }
      production[k] = v;
    }
    const split = validateSplit(raw?.production_split, label, production);
    if (typeof split === "string") return split;
    // Analyst "Final" override: number in range, or null to clear. Field
    // presence is meaningful downstream (authoritative vs preserve).
    let finalOut: { production_final: number | null } | undefined;
    if (raw !== null && typeof raw === "object" && "production_final" in raw) {
      const fv = raw.production_final;
      if (fv === null) {
        finalOut = { production_final: null };
      } else if (typeof fv === "number" && Number.isFinite(fv) && fv > 0 && fv <= MAX_MBAGS) {
        finalOut = { production_final: fv };
      } else {
        return `${label}: production_final must be in (0, ${MAX_MBAGS}] million bags or null`;
      }
    }
    out.push({
      season: label,
      forecast: raw?.forecast === true,
      production,
      // Field presence is meaningful downstream (authoritative vs preserve),
      // so an explicitly-sent empty split {} is forwarded as-is.
      ...(split !== null ? { production_split: split } : {}),
      ...(finalOut ?? {}),
    });
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
    // Flat delay keeps a brute-force loop slow without leaking which part
    // of the check failed.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const action = body.action ?? "save";
  if (action === "verify") {
    return NextResponse.json({ ok: true });
  }
  if (action !== "save") {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const origin = body.origin;
  if (typeof origin !== "string" || !ORIGINS.has(origin)) {
    return NextResponse.json({ error: "unknown_origin" }, { status: 400 });
  }
  const updated = body.updated;
  if (typeof updated !== "string" || !UPDATED_RE.test(updated)) {
    return NextResponse.json({ error: "bad_updated_stamp" }, { status: 400 });
  }
  const seasons = validateSeasons(body.seasons);
  if (typeof seasons === "string") {
    return NextResponse.json({ error: "invalid_seasons", detail: seasons }, { status: 400 });
  }

  // Optional new-source declarations ("add row" in the editor). The applier
  // script appends them to the file's legend only when a season actually
  // carries a value for them.
  const sources: { key: string; label: string; color: string }[] = [];
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.length > 10) {
      return NextResponse.json({ error: "invalid_sources" }, { status: 400 });
    }
    for (const raw of body.sources as { key?: unknown; label?: unknown; color?: unknown }[]) {
      const { key, label, color } = raw ?? {};
      if (typeof key !== "string" || !SOURCE_KEY_RE.test(key) ||
          typeof label !== "string" || label.trim().length < 1 || label.trim().length > 24 ||
          typeof color !== "string" || !COLOR_RE.test(color)) {
        return NextResponse.json(
          { error: "invalid_sources", detail: `bad source ${JSON.stringify(key)}` },
          { status: 400 },
        );
      }
      sources.push({ key, label: label.trim(), color });
    }
  }

  const payload = JSON.stringify(
    sources.length ? { origin, updated, seasons, sources } : { origin, updated, seasons },
  );
  if (payload.length > 60_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  // `origin` rides alongside the payload so the workflow can key its
  // concurrency group per origin — a single group cancelled most of a
  // by-source save, because a group holds only one queued run.
  const res = await dispatchWorkflow(WORKFLOW, payload, { origin });
  // `queued`, not `saved`: a 204 means GitHub accepted the dispatch. The
  // run still has to validate, commit and redeploy.
  if (res.ok) return NextResponse.json({ ok: true, queued: true, repo: res.repo });
  return NextResponse.json(
    { error: res.error, ...(res.body ? { body: res.body } : {}) },
    { status: res.status },
  );
}
