"use client";
// G · The factor map AS the research index.
//
// Instead of browsing a list, you browse the model: every node of the
// differential-model factor map carries the research that bears on it, so
// "what do we know about squeeze motivation?" is a place on a chart rather
// than a search term.
//
// The map itself lives in components/research/factor-map — the same component
// the Differential note now renders as its figure, so the paper's chart and
// this index are the same object.
import { useMemo, useState } from "react";
import { ARTICLES, type Article } from "@/lib/research/catalog";
import FactorMap, { FactorMapLegend } from "@/components/research/factor-map/FactorMap";
import { BY_ID } from "@/components/research/factor-map/nodes";
import { nodesForArticle } from "@/components/research/factor-map/articleNodes";

// The article→node mapping is shared with the live research view —
// components/research/factor-map/articleNodes.ts. One definition, so a
// pin added there shows up in both without a second edit.

export function LayoutFactorMap() {
  const [onlyBadged, setOnlyBadged] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  const byNode = useMemo(() => {
    const m = new Map<string, Article[]>();
    for (const a of ARTICLES) for (const n of nodesForArticle(a)) {
      if (!m.has(n)) m.set(n, []);
      m.get(n)!.push(a);
    }
    return m;
  }, []);
  const badges = useMemo(() => {
    const m = new Map<string, number>();
    byNode.forEach((v, k) => m.set(k, v.length));   // ES5 target: no Map spread
    return m;
  }, [byNode]);

  const needle = q.trim().toLowerCase();
  const lit = useMemo(() => {
    if (!needle) return null;
    const s = new Set<string>();
    for (const a of ARTICLES) {
      if (`${a.title} ${a.subtitle ?? ""} ${a.kicker ?? ""}`.toLowerCase().includes(needle))
        for (const n of nodesForArticle(a)) s.add(n);
    }
    return s;
  }, [needle]);

  const selArticles = sel ? byNode.get(sel) ?? [] : [];
  const selNode = sel ? BY_ID.get(sel) : null;
  const unmapped = ARTICLES.filter(a => !nodesForArticle(a).length).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search research — matching nodes stay lit…"
          className="w-72 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
        <button onClick={() => setOnlyBadged(v => !v)}
          className={`rounded border px-2 py-1 text-[10px] ${onlyBadged
            ? "border-slate-600 bg-slate-800 text-amber-400" : "border-slate-700 text-slate-400"}`}>
          {onlyBadged ? `Only the ${byNode.size} nodes with research` : "Showing the full map"}
        </button>
        <div className="ml-auto"><FactorMapLegend /></div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
        <FactorMap badges={badges} onlyBadged={onlyBadged} lit={lit}
          selected={sel} onSelect={id => setSel(s => (s === id ? null : id))} />
      </div>

      <div className="mt-2 rounded-lg border border-slate-800 p-3">
        {selNode ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-white">{selNode.t}</span>
              <span className="text-[10px] text-slate-500">
                {selArticles.length} article{selArticles.length === 1 ? "" : "s"} bear on this node
              </span>
            </div>
            <div className="mt-2 divide-y divide-slate-800">
              {selArticles.map(a => (
                <div key={a.id} className="flex items-baseline gap-2 py-1">
                  <span className="truncate text-xs text-slate-200">{a.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">{a.kicker}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-600">{a.updated ?? "—"}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-600">
            Click any badged node — its research lists here. {unmapped} of {ARTICLES.length} articles
            map to no node yet.
          </div>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        <strong className="text-slate-400">Draft.</strong> The chart is the differential model&rsquo;s factor map,
        node for node, at the source coordinates. Research attaches by topic plus a few pins — rule-based, not
        curated, so some placements are approximate. Two things to judge: whether ~85 nodes stays legible enough
        to browse (the density toggle exists because it might not), and whether &ldquo;where does this sit in the
        model&rdquo; is how you want to reach a paper.
      </p>
    </div>
  );
}
