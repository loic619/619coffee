// Ordering for the research index.
//
// The catalogue's own order is roughly how the articles were once laid out in
// JSX — useful to nobody looking for what changed recently, which is the actual
// reason to open the list.

export type SortKey = "updated" | "published";
export type SortDir = "desc" | "asc";

export interface Sortable {
  title: string;
  updated: string | null;
  published: string | null;
}

export const SORT_OPTIONS: { id: string; key: SortKey; dir: SortDir; label: string }[] = [
  { id: "updated-desc",   key: "updated",   dir: "desc", label: "Recently updated" },
  { id: "updated-asc",    key: "updated",   dir: "asc",  label: "Least recently updated" },
  { id: "published-desc", key: "published", dir: "desc", label: "Newest published" },
  { id: "published-asc",  key: "published", dir: "asc",  label: "First published" },
];

export const DEFAULT_SORT = SORT_OPTIONS[0];

export function optionById(id: string) {
  return SORT_OPTIONS.find(o => o.id === id) ?? DEFAULT_SORT;
}

/** ISO date strings compare correctly as strings, so no Date objects are built
 *  — and no timezone can shift a date across midnight on the way. */
function dateOf(a: Sortable, key: SortKey): string | null {
  const v = key === "published" ? a.published : a.updated;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Sort a copy of `rows`. Two rules earn their keep:
 *
 *  1. **Undated articles sink to the bottom in BOTH directions.** A missing
 *     date means "not known", not "the beginning of time". Sorting oldest-first
 *     would otherwise open with 33 articles whose publication date we could not
 *     recover — presenting an absence of data as the answer to the question.
 *  2. **Ties break on title**, so the order is stable and repeatable. Seven
 *     articles share 2026-08-17; without this they would shuffle between
 *     renders depending on the engine's sort.
 */
export function sortArticles<T extends Sortable>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const da = dateOf(a, key);
    const db = dateOf(b, key);
    if (da && db) {
      if (da !== db) return da < db ? -sign : sign;
    } else if (da !== db) {
      return da ? -1 : 1;             // dated first, whichever way we are sorting
    }
    return a.title.localeCompare(b.title);
  });
}

/** How many rows carry the date being sorted on — the honest caption for a
 *  list where a third of the catalogue predates the repository. */
export function datedCount(rows: Sortable[], key: SortKey): number {
  return rows.filter(r => dateOf(r, key) !== null).length;
}
