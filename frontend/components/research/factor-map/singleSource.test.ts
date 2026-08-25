/** The factor map must stay ONE object.
 *
 * It is rendered in two places — the Differential research note (as its
 * figure) and the research tab's map view (as the index). The whole point of
 * the shared component is that adding a factor to the model shows up in both
 * with a single edit. That guarantee is invisible: nothing stops someone
 * pasting a second copy of the node table into a component "just for this
 * view", and the two would then drift silently for months before anyone
 * noticed the figure and the index disagreed.
 *
 * So assert it structurally: exactly one module defines the geometry, and
 * every renderer goes through it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NODES, EDGES, BY_ID } from "./nodes";

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("factor map is a single source of truth", () => {
  const files = walk(join(ROOT, "components")).concat(walk(join(ROOT, "app")));

  it("only nodes.ts declares the node table", () => {
    const definers = files.filter(f => /\bNODES\s*:\s*N\[\]\s*=/.test(readFileSync(f, "utf8")));
    expect(definers.map(f => f.replace(ROOT, ""))).toEqual(
      ["/components/research/factor-map/nodes.ts"]);
  });

  it("no component hard-codes factor coordinates of its own", () => {
    // A second copy would show up as a long literal array of {x,y,w,h} nodes.
    const offenders = files
      .filter(f => !f.includes("factor-map"))
      .filter(f => (readFileSync(f, "utf8").match(/\bx:\s*\d+,\s*y:\s*\d+,\s*w:\s*\d+/g) ?? []).length > 3);
    expect(offenders.map(f => f.replace(ROOT, ""))).toEqual([]);
  });

  it("every renderer imports the shared component", () => {
    const renderers = files.filter(f => /<FactorMap[\s/>]/.test(readFileSync(f, "utf8")));
    expect(renderers.length).toBeGreaterThanOrEqual(2);   // the note + the index
    for (const f of renderers) {
      expect(readFileSync(f, "utf8")).toMatch(/from\s+["'][^"']*factor-map\/FactorMap["']/);
    }
  });

  it("the node table is internally consistent", () => {
    expect(new Set(NODES.map(n => n.id)).size).toBe(NODES.length);   // unique ids
    for (const [s, t] of EDGES) {                                    // no dangling edges
      expect(BY_ID.has(s)).toBe(true);
      expect(BY_ID.has(t)).toBe(true);
    }
    for (const id of ["sd", "futures", "exch_econ", "differential"]) {
      expect(BY_ID.has(id)).toBe(true);                              // the diamond
    }
  });

  it("every article→node pin points at a node that exists", async () => {
    const { PINS, TOPIC_NODES } = await import("./articleNodes");
    for (const ids of [...Object.values(PINS), ...Object.values(TOPIC_NODES)]) {
      for (const id of ids) expect(BY_ID.has(id)).toBe(true);
    }
  });
});
