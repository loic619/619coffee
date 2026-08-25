// Admin overrides for research-article metadata.
//
// The 45 articles are React components with their titles baked into the JSX,
// so "edit an article" cannot mean rewriting the source from a browser. What
// it CAN mean — and what this is — is a thin layer of metadata stored beside
// the catalogue: rename it, re-file it under another category, re-order it,
// or put a note above it. The body stays a component, which is what keeps the
// live charts live.
//
// Stored in Upstash as one hash, `research:overrides`, keyed by the catalogue
// id. Only the fields actually changed are stored, so an article with no
// override renders exactly as the source defines it and a later edit to the
// source still shows through. Reset deletes the key rather than writing the
// source values back, so "reset" means "follow the source again" and not
// "freeze today's source".
import type { Article, Cat } from "./catalog";

export const OVERRIDES_KEY = "research:overrides";

export interface Override {
  title?: string;
  subtitle?: string;
  kicker?: string;
  cat?: Cat;
  tone?: string;
  /** Sort position within the category; unset sorts by catalogue order. */
  order?: number;
  /** Editor's note, rendered above the article body. Plain text. */
  note?: string;
  /** ISO stamp of the last write — shown in the editor, not the article. */
  edited_at?: string;
}

export type OverrideMap = Record<string, Override>;

const CATS = new Set<Cat>(["quant", "supply", "logistics", "exchange", "demand"]);
const TONES = new Set(["amber", "sky", "violet", "emerald", "indigo", "rose", "slate"]);

/** Field caps. Titles and kickers are rendered in fixed-height card headers,
 *  so an unbounded string is a layout bug waiting to happen, not just a long
 *  title. The note is a paragraph or two, not an article. */
export const LIMITS = { title: 160, subtitle: 240, kicker: 60, note: 4000 } as const;

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // Strip control characters; collapse runs of whitespace except newlines,
  // which the note needs for paragraphs.
  const s = Array.from(v)
    .filter(ch => { const c = ch.codePointAt(0) ?? 0; return c >= 0x20 || ch === "\n"; })
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
  return s ? s.slice(0, max) : undefined;
}

/** Accept only the fields we know, coerced and bounded. Anything else is
 *  dropped — the write path is admin-only, but a stored blob that later feeds
 *  React should still never carry surprises. */
export function sanitize(raw: unknown): Override {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Override = {};
  const title = clean(o.title, LIMITS.title);          if (title) out.title = title;
  const subtitle = clean(o.subtitle, LIMITS.subtitle); if (subtitle) out.subtitle = subtitle;
  const kicker = clean(o.kicker, LIMITS.kicker);       if (kicker) out.kicker = kicker;
  const note = clean(o.note, LIMITS.note);             if (note) out.note = note;
  if (typeof o.cat === "string" && CATS.has(o.cat as Cat)) out.cat = o.cat as Cat;
  if (typeof o.tone === "string" && TONES.has(o.tone)) out.tone = o.tone;
  if (typeof o.order === "number" && Number.isFinite(o.order)) {
    out.order = Math.max(0, Math.min(9999, Math.round(o.order)));
  }
  return out;
}

/** The catalogue as the reader should see it: source values, with any stored
 *  override laid on top, sorted by category then explicit order. */
export function applyOverrides(articles: Article[], ov: OverrideMap): (Article & { note?: string; edited?: boolean })[] {
  const merged = articles.map((a, i) => {
    const o = ov[a.id];
    if (!o) return { ...a, _i: i, _pinned: 0 };
    return {
      ...a,
      title:    o.title    ?? a.title,
      subtitle: o.subtitle ?? a.subtitle,
      kicker:   o.kicker   ?? a.kicker,
      cat:      o.cat      ?? a.cat,
      tone:     o.tone     ?? a.tone,
      note:     o.note,
      edited:   true,
      _i:       o.order ?? i,
      // An explicit order and a catalogue index share one number space, so
      // order:0 ties with whatever article already sits at index 0 — and a
      // stable sort then leaves "put this first" not first. An explicit
      // position wins its ties; that is what the admin asked for.
      _pinned:  o.order == null ? 0 : 1,
    };
  });
  return merged
    .sort((x, y) => (x._i as number) - (y._i as number)
                 || (y._pinned as number) - (x._pinned as number))
    .map(({ _i, _pinned, ...rest }) => rest);
}
