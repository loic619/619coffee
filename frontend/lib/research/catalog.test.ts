/** The catalogue and the body registry must agree.
 *
 * An article is two halves that live in different files: a row in ARTICLES
 * (title, category, kicker — what the index shows) and an entry in the BODY
 * map inside ResearchView (the component that actually renders). Nothing
 * couples them but a matching string, and the failure is quiet: add the
 * catalogue row, forget the BODY entry, and the article appears in the index,
 * is searchable, is filterable, and renders "No body registered for …" when
 * clicked. It looks shipped from every angle except the one that matters.
 *
 * BODY is declared inside a heavy client component, so read it as source
 * rather than importing it — the keys are literal strings, which is enough.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES } from "./catalog";

const VIEW = join(__dirname, "..", "..", "components", "research", "ResearchView.tsx");

/** Keys of the `const BODY: Record<string, React.ReactNode> = { … }` literal. */
function bodyKeys(): string[] {
  const src = readFileSync(VIEW, "utf8");
  const start = src.indexOf("const BODY: Record<string, React.ReactNode> = {");
  expect(start, "BODY registry not found — did it get renamed?").toBeGreaterThan(-1);
  // The literal's values are JSX elements, never `};` at line start, so the
  // first line-anchored `};` after the opening brace closes it.
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  const keys: string[] = [];
  const re = /^\s*"([^"]+)":/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) keys.push(m[1]);
  return keys;
}

describe("catalogue ↔ body registry", () => {
  const keys = bodyKeys();

  it("finds the registry at all", () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it("every catalogued article has a registered body", () => {
    const have = new Set(keys);
    const missing = ARTICLES.filter(a => !have.has(a.id)).map(a => a.id);
    expect(missing, "catalogue rows with no BODY entry — these render an error card").toEqual([]);
  });

  it("every registered body is reachable from the catalogue", () => {
    const ids = new Set(ARTICLES.map(a => a.id));
    const orphans = keys.filter(k => !ids.has(k));
    expect(orphans, "BODY entries no article points at — dead render code").toEqual([]);
  });

  it("catalogue ids are unique", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const a of ARTICLES) {
      if (seen.has(a.id)) dupes.push(a.id);
      seen.add(a.id);
    }
    expect(dupes).toEqual([]);
  });
});
