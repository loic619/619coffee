import { describe, expect, it } from "vitest";
import { dominantTag, sectionPlan, slugify, uniqueId } from "./sections";

describe("dominantTag", () => {
  it("picks h3 when the article uses h3 for sections", () => {
    expect(dominantTag(["h3", "h3", "h4", "h4", "h4"])).toBe("h3");
  });

  it("falls back to h4 for articles with no h3 at all", () => {
    // The older articles head their sections with the amber h4.
    expect(dominantTag(["h4", "h4", "h4"])).toBe("h4");
  });

  it("does NOT split on a sub-heading level when a senior one exists", () => {
    // Splitting on h4 here would make every sub-heading a top-level entry,
    // which is worse than having no contents bar.
    expect(dominantTag(["h3", "h4", "h4", "h4", "h4", "h3"])).toBe("h3");
  });

  it("one heading is not a structure", () => {
    expect(dominantTag(["h3"])).toBeNull();
    expect(dominantTag([])).toBeNull();
  });

  it("is case-insensitive about tag names", () => {
    expect(dominantTag(["H3", "H3"])).toBe("h3");
  });
});

describe("slugify", () => {
  it("keeps the section number, which is how articles cross-reference", () => {
    expect(slugify("3 · Method")).toBe("3-method");
  });

  it("collapses punctuation and trims dashes", () => {
    expect(slugify("  What this does *not* license!  ")).toBe("what-this-does-not-license");
  });

  it("never returns an empty id", () => {
    expect(slugify("···")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("uniqueId", () => {
  it("disambiguates repeated headings", () => {
    const taken = new Set<string>();
    expect(uniqueId("method", taken)).toBe("method");
    expect(uniqueId("method", taken)).toBe("method-2");
    expect(uniqueId("method", taken)).toBe("method-3");
  });
});

describe("sectionPlan", () => {
  const article = [
    { tag: "h3", text: "1 · Method" },
    { tag: "h4", text: "a sub-heading" },
    { tag: "h3", text: "2 · Results" },
    { tag: "h3", text: "3 · What this licenses" },
  ];

  it("lists only the section-level headings", () => {
    const { tag, sections } = sectionPlan(article);
    expect(tag).toBe("h3");
    expect(sections.map(s => s.title))
      .toEqual(["1 · Method", "2 · Results", "3 · What this licenses"]);
  });

  it("gives every section a usable id", () => {
    expect(sectionPlan(article).sections.map(s => s.id))
      .toEqual(["1-method", "2-results", "3-what-this-licenses"]);
  });

  it("records where each heading sat, so the caller need not re-match text", () => {
    expect(sectionPlan(article).sections.map(s => s.index)).toEqual([0, 2, 3]);
  });

  it("skips blank headings rather than making an unlabelled chip", () => {
    const { sections } = sectionPlan([
      { tag: "h3", text: "Real" }, { tag: "h3", text: "   " }, { tag: "h3", text: "Also real" },
    ]);
    expect(sections.map(s => s.title)).toEqual(["Real", "Also real"]);
  });

  it("an article with no structure gets no contents bar", () => {
    expect(sectionPlan([{ tag: "h3", text: "Only one" }]).sections).toHaveLength(0);
    expect(sectionPlan([]).tag).toBeNull();
  });

  it("duplicate headings still get distinct ids", () => {
    const { sections } = sectionPlan([
      { tag: "h3", text: "Method" }, { tag: "h3", text: "Method" },
    ]);
    expect(sections.map(s => s.id)).toEqual(["method", "method-2"]);
  });
});
