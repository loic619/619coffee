// Deriving a contents list from a research article's own headings.
//
// The articles are long — the ICE publish-times paper runs six sections, the
// failure taxonomy eight — and a reader arriving from the index usually wants
// one of them, not the whole thing. There is no per-article section metadata,
// and adding some to 51 articles would rot the first time anyone edited a
// heading.
//
// It cannot be done by splitting the React children either, which is the
// obvious approach and the one tried first: most articles render as a SINGLE
// component, so their headings live inside that component's own output rather
// than as siblings a wrapper could see. The only thing all 51 genuinely share
// is the DOM they produce.
//
// So the section list is read off the rendered headings. The pure parts — which
// heading level is the section level, and what each one's id should be — live
// here and are tested; the DOM reading and the scrolling live in the component.

/** Which heading tag marks a section boundary.
 *
 *  Articles that use h3 for sections and h4 for sub-headings must split on h3
 *  only, or every sub-heading becomes a top-level entry and the contents bar is
 *  worse than none. Articles with no h3 at all split on h4. One heading is not
 *  a structure, hence the "at least twice".
 */
export function dominantTag(tags: string[]): string | null {
  const counts: Record<string, number> = {};
  tags.forEach(t => {
    const k = (t || "").toLowerCase();
    counts[k] = (counts[k] ?? 0) + 1;
  });
  const order = ["h2", "h3", "h4"];
  for (let i = 0; i < order.length; i += 1) {
    if ((counts[order[i]] ?? 0) >= 2) return order[i];
  }
  return null;
}

/** A stable DOM id for a section heading.
 *
 *  Derived from the text, so it stays meaningful in a URL fragment and survives
 *  re-ordering. The numeric prefix most headings carry ("3 · Method") is kept —
 *  it is how the articles cross-reference themselves.
 */
export function slugify(title: string): string {
  const s = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

/** Make ids unique within one article, so two "Method" headings still resolve. */
export function uniqueId(slug: string, taken: Set<string>): string {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i += 1;
  const id = `${slug}-${i}`;
  taken.add(id);
  return id;
}

export interface PlannedSection {
  id: string;
  title: string;
  /** Position in the ORIGINAL heading list, so the caller can find the element
   *  again by index instead of re-matching on text. */
  index: number;
}

/**
 * Turn the article's headings into a contents plan.
 *
 * Headings below the section level, or with no text, are skipped rather than
 * producing a blank entry — a contents bar with an unlabelled chip in it is
 * worse than one entry short.
 */
export function sectionPlan(
  headings: { tag: string; text: string }[],
): { tag: string | null; sections: PlannedSection[] } {
  const tag = dominantTag(headings.map(h => h.tag));
  if (!tag) return { tag: null, sections: [] };
  const taken = new Set<string>();
  const sections: PlannedSection[] = [];
  headings.forEach((h, index) => {
    const title = (h.text || "").trim();
    if ((h.tag || "").toLowerCase() !== tag || !title) return;
    sections.push({ id: uniqueId(slugify(title), taken), title, index });
  });
  return { tag, sections };
}
