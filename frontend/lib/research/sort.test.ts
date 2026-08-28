import { describe, expect, it } from "vitest";
import { ARTICLES } from "./catalog";
import { datedCount, optionById, sortArticles, SORT_OPTIONS, type Sortable } from "./sort";

const row = (title: string, updated: string | null, published: string | null): Sortable =>
  ({ title, updated, published });

describe("sortArticles", () => {
  it("orders by the requested date, newest first", () => {
    const out = sortArticles([
      row("b", "2026-08-10", null),
      row("a", "2026-08-20", null),
      row("c", "2026-08-15", null),
    ], "updated", "desc");
    expect(out.map(r => r.title)).toEqual(["a", "c", "b"]);
  });

  it("reverses cleanly", () => {
    const out = sortArticles([
      row("b", "2026-08-10", null),
      row("a", "2026-08-20", null),
    ], "updated", "asc");
    expect(out.map(r => r.title)).toEqual(["b", "a"]);
  });

  it("sinks undated rows to the bottom in BOTH directions", () => {
    // A missing date means "not known", not "the beginning of time". Sorting
    // oldest-first must not open with the 33 articles that predate the repo.
    const rows = [
      row("undated", null, null),
      row("older", "2026-08-01", null),
      row("newer", "2026-08-20", null),
    ];
    expect(sortArticles(rows, "updated", "desc").map(r => r.title))
      .toEqual(["newer", "older", "undated"]);
    expect(sortArticles(rows, "updated", "asc").map(r => r.title))
      .toEqual(["older", "newer", "undated"]);
  });

  it("breaks ties on title so the order is stable", () => {
    // Seven real articles share 2026-08-17.
    const rows = [row("zeta", "2026-08-17", null), row("alpha", "2026-08-17", null)];
    expect(sortArticles(rows, "updated", "desc").map(r => r.title)).toEqual(["alpha", "zeta"]);
    expect(sortArticles(rows, "updated", "asc").map(r => r.title)).toEqual(["alpha", "zeta"]);
  });

  it("sorts on published independently of updated", () => {
    const rows = [
      row("a", "2026-08-28", "2026-08-09"),   // old article, freshly revised
      row("b", "2026-08-09", "2026-08-27"),   // new article, not revised since
    ];
    expect(sortArticles(rows, "updated", "desc").map(r => r.title)).toEqual(["a", "b"]);
    expect(sortArticles(rows, "published", "desc").map(r => r.title)).toEqual(["b", "a"]);
  });

  it("does not mutate the input", () => {
    const rows = [row("b", "2026-08-10", null), row("a", "2026-08-20", null)];
    sortArticles(rows, "updated", "desc");
    expect(rows.map(r => r.title)).toEqual(["b", "a"]);
  });

  it("ignores malformed dates rather than ordering on them", () => {
    const rows = [row("bad", "not-a-date", null), row("good", "2026-08-01", null)];
    expect(sortArticles(rows, "updated", "desc").map(r => r.title)).toEqual(["good", "bad"]);
  });
});

describe("the real catalogue", () => {
  it("every article carries a published field, null where unknown", () => {
    for (const a of ARTICLES) {
      expect(a).toHaveProperty("published");
      if (a.published !== null) expect(a.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("no publication date predates the repository, which is where they came from", () => {
    // 2026-08-08 is the repo's first commit. A component whose first appearance
    // is that commit existed BEFORE the repo, so its date is the import — those
    // are recorded null. Anything stamped on or before it would be fabricated.
    for (const a of ARTICLES) {
      if (a.published) expect(a.published > "2026-08-08").toBe(true);
    }
  });

  it("reports how much of the catalogue each sort can actually order", () => {
    const upd = datedCount(ARTICLES, "updated");
    const pub = datedCount(ARTICLES, "published");
    expect(upd).toBeGreaterThan(0);
    expect(pub).toBeGreaterThan(0);
    // Publication is recoverable for strictly fewer articles than revision is:
    // `updated` was curated by hand across the whole catalogue, `published`
    // only reaches back to the repo's first commit. The UI has to say so.
    expect(pub).toBeLessThan(upd);
    expect(upd).toBeLessThanOrEqual(ARTICLES.length);
  });

  it("sorting keeps every article, never drops one", () => {
    for (const o of SORT_OPTIONS) {
      expect(sortArticles(ARTICLES, o.key, o.dir)).toHaveLength(ARTICLES.length);
    }
  });

  it("falls back to the default for an unknown sort id", () => {
    expect(optionById("nonsense").id).toBe("updated-desc");
  });
});
