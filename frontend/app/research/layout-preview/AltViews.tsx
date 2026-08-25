"use client";
// Two more browse layouts for the Research tab: a quadrant matrix and a
// node-link graph. Same 45-article catalogue as the other options.
//
// Palette: the five category hues are the reference categorical slots 1–5,
// validated with the dataviz validator against THIS app's surface (#0f172a):
// lightness band, chroma floor, CVD separation (worst adjacent ΔE 8.4 protan),
// normal-vision floor and contrast all pass. The CVD worst pair sits just above
// the 8.0 target, so both views carry secondary encoding — a legend is always
// present and every mark is labelled on hover, so identity is never colour-alone.
import { useMemo, useRef, useState } from "react";
import { ARTICLES, CAT_LABEL, type Article, type Cat } from "@/lib/research/catalog";

const CAT_COLOR: Record<Cat, string> = {
  quant:     "#3987e5",
  supply:    "#199e70",
  exchange:  "#c98500",
  logistics: "#d55181",
  demand:    "#d95926",
};
const CATS = Object.keys(CAT_LABEL) as Cat[];
const TODAY = new Date("2026-08-25T00:00:00Z").getTime();
// Hoisted out of the component: recreated per render it would make the
// layout memo's dep list dishonest (or force a needless recompute).
const PAD = { l: 56, r: 16, t: 28, b: 40 };

/** Days since the article's `updated` stamp; null when it carries no date. */
function ageDays(a: Article): number | null {
  if (!a.updated) return null;
  const t = Date.parse(`${a.updated}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((TODAY - t) / 86_400_000));
}

/** Applied vs reference, derived from the kicker.
 *
 *  This is a HEURISTIC and the matrix says so on its face. A true Eisenhower
 *  split is a judgement — "does this drive a decision this week" — and the
 *  catalogue has no such field, so the axis is seeded from the one signal the
 *  data does carry: methodology papers describe how something is built,
 *  everything else reports what the market is doing. In edit mode this becomes
 *  an explicit per-article setting and the guesswork goes away. */
function isApplied(a: Article): boolean {
  const k = (a.kicker ?? "").toLowerCase();
  return !/methodology|data methods|fundamentals|model specification|contract rules/.test(k);
}

function Legend({ active, onPick }: { active: Cat | "all"; onPick: (c: Cat | "all") => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {(["all", ...CATS] as (Cat | "all")[]).map(c => (
        <button key={c} onClick={() => onPick(c)}
          className={`flex items-center gap-1.5 text-[10px] transition-opacity ${
            active === "all" || active === c ? "opacity-100" : "opacity-40 hover:opacity-70"}`}>
          <span className="h-2 w-2 rounded-full"
            style={{ background: c === "all" ? "#64748b" : CAT_COLOR[c as Cat] }} />
          <span className="text-slate-400">{c === "all" ? "All" : CAT_LABEL[c as Cat]}</span>
        </button>
      ))}
    </div>
  );
}

function Tip({ a, x, y }: { a: Article; x: number; y: number }) {
  return (
    <div className="pointer-events-none absolute z-20 max-w-xs rounded border border-slate-600 bg-slate-950/95 px-2 py-1.5 shadow-lg"
      style={{ left: Math.min(x + 12, 520), top: y + 12 }}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{a.kicker ?? CAT_LABEL[a.cat]}</div>
      <div className="text-[11px] font-semibold leading-snug text-slate-100">{a.title}</div>
      <div className="mt-0.5 font-mono text-[9px] text-slate-500">
        {CAT_LABEL[a.cat]} · {a.updated ?? "no date"}
      </div>
    </div>
  );
}

/* ── E · Quadrant matrix ──────────────────────────────────────────────────
   Form: the job is position-in-a-2D-space plus identity, so a quadrant
   scatter. X is staleness (a real measured quantity), Y is the applied /
   reference split. The useful quadrant is top-left: things that claim to be
   live and have not been touched in months. */
export function LayoutMatrix() {
  const [cat, setCat] = useState<Cat | "all">("all");
  const [hover, setHover] = useState<{ a: Article; x: number; y: number } | null>(null);
  const W = 860, H = 460;

  const { placed, undated, maxAge } = useMemo(() => {
    const withAge = ARTICLES.map(a => ({ a, age: ageDays(a) }));
    const dated = withAge.filter(r => r.age !== null) as { a: Article; age: number }[];
    const max = Math.max(60, ...dated.map(r => r.age));
    // Deterministic jitter: many articles share a date (2026-07-14 alone has
    // eight), so raw positions would stack into one dot. Hash the id instead of
    // random so the layout is identical on every render.
    const hash = (s: string) => s.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) / 997;
    return {
      maxAge: max,
      placed: dated.map(({ a, age }) => {
        const fx = 1 - age / max;                       // fresh → right
        const applied = isApplied(a);
        const jx = (hash(a.id) - 0.5) * 0.045;
        const jy = (hash(a.id + "y") - 0.5) * 0.62;
        return {
          a,
          x: PAD.l + (PAD.l + (W - PAD.l - PAD.r) * Math.min(1, Math.max(0, fx + jx)) - PAD.l),
          y: PAD.t + (H - PAD.t - PAD.b) * (applied ? 0.27 + jy * 0.35 : 0.73 + jy * 0.35),
          applied,
        };
      }),
      undated: withAge.filter(r => r.age === null).map(r => r.a),
    };
  }, []);

  const dim = (a: Article) => cat !== "all" && a.cat !== cat;
  const midX = PAD.l + (W - PAD.l - PAD.r) * 0.5;
  const midY = PAD.t + (H - PAD.t - PAD.b) * 0.5;
  const QUAD = [
    { x: PAD.l + 8,   y: PAD.t + 14, t: "Applied · ageing",   s: "live claims going stale — the actionable quadrant" },
    { x: midX + 8,    y: PAD.t + 14, t: "Applied · fresh",     s: "current market work" },
    { x: PAD.l + 8,   y: midY + 18,  t: "Reference · ageing",  s: "settled background" },
    { x: midX + 8,    y: midY + 18,  t: "Reference · fresh",   s: "recently documented method" },
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend active={cat} onPick={setCat} />
        <span className="text-[10px] text-slate-500">x = days since last update · y = applied vs reference</span>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
        <svg width={W} height={H} className="block">
          <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b}
            fill="none" stroke="#1e293b" />
          <line x1={midX} y1={PAD.t} x2={midX} y2={H - PAD.b} stroke="#334155" strokeDasharray="3 3" />
          <line x1={PAD.l} y1={midY} x2={W - PAD.r} y2={midY} stroke="#334155" strokeDasharray="3 3" />

          {QUAD.map(q => (
            <g key={q.t}>
              <text x={q.x} y={q.y} className="fill-slate-500" fontSize={10} fontWeight={700}
                style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{q.t}</text>
              <text x={q.x} y={q.y + 12} className="fill-slate-600" fontSize={9}>{q.s}</text>
            </g>
          ))}

          {/* x ticks: age in days, oldest at the left */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const x = PAD.l + (W - PAD.l - PAD.r) * f;
            const days = Math.round(maxAge * (1 - f));
            return (
              <g key={f}>
                <line x1={x} y1={H - PAD.b} x2={x} y2={H - PAD.b + 4} stroke="#334155" />
                <text x={x} y={H - PAD.b + 16} textAnchor="middle" className="fill-slate-600" fontSize={9}>
                  {days === 0 ? "today" : `${days}d`}
                </text>
              </g>
            );
          })}
          <text x={PAD.l - 8} y={PAD.t + (H - PAD.t - PAD.b) * 0.27} textAnchor="end"
            className="fill-slate-500" fontSize={9}>applied</text>
          <text x={PAD.l - 8} y={PAD.t + (H - PAD.t - PAD.b) * 0.73} textAnchor="end"
            className="fill-slate-500" fontSize={9}>reference</text>

          {placed.map(p => (
            <circle key={p.a.id} cx={p.x} cy={p.y} r={5}
              fill={CAT_COLOR[p.a.cat]} stroke="#0f172a" strokeWidth={2}
              opacity={dim(p.a) ? 0.18 : 1}
              onMouseEnter={e => setHover({ a: p.a, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }} />
          ))}
        </svg>
        {hover && <Tip a={hover.a} x={hover.x} y={hover.y} />}
      </div>

      {undated.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2">
          <div className="mb-1 text-[10px] text-slate-500">
            {undated.length} articles carry no update date, so they have no position on the x axis —
            listed rather than guessed at:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {undated.map(a => (
              <span key={a.id} className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400"
                style={{ opacity: dim(a) ? 0.3 : 1 }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: CAT_COLOR[a.cat] }} />
                {a.title.slice(0, 42)}{a.title.length > 42 ? "…" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        The applied/reference axis is <em>derived from the kicker</em> — methodology papers on the bottom,
        everything else on top. It is a starting guess, not a judgement: in edit mode you would set it per
        article (or drag between quadrants) and this heuristic disappears.
      </p>
    </div>
  );
}

/* ── F · Node-link graph ──────────────────────────────────────────────────
   Clusters articles by the kicker's TOPIC prefix ("Options ·", "COT ·",
   "Weather ·"), which is the grouping the current five categories hide: the
   seven Options papers and five COT papers read as one body of work each, but
   today they are just neighbours in a long scroll.

   Layout is a deterministic force simulation — seeded from the index, fixed
   iteration count — so the graph is identical on every load. */
type Node = { id: string; label: string; hub: boolean; cat: Cat | null; a: Article | null; x: number; y: number };

export function LayoutGraph() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Article | null>(null);
  const [hover, setHover] = useState<{ a: Article; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = 860, H = 520;

  const { nodes, edges, topics } = useMemo(() => {
    const topicOf = (a: Article) =>
      (a.kicker ?? CAT_LABEL[a.cat]).split("·")[0].trim() || CAT_LABEL[a.cat];
    const topicList = ARTICLES.map(topicOf).filter((t, i, arr) => arr.indexOf(t) === i);
    const ns: Node[] = [];
    topicList.forEach((t, i) => {
      const ang = (i / topicList.length) * Math.PI * 2;
      ns.push({ id: `hub:${t}`, label: t, hub: true, cat: null, a: null,
                x: W / 2 + Math.cos(ang) * 190, y: H / 2 + Math.sin(ang) * 150 });
    });
    ARTICLES.forEach((a, i) => {
      const t = topicOf(a);
      const hub = ns.find(n => n.id === `hub:${t}`)!;
      const ang = (i / ARTICLES.length) * Math.PI * 2;
      ns.push({ id: a.id, label: a.title, hub: false, cat: a.cat, a,
                x: hub.x + Math.cos(ang) * 40, y: hub.y + Math.sin(ang) * 40 });
    });
    const es = ARTICLES.map(a => ({ s: a.id, t: `hub:${topicOf(a)}` }));

    // force sim — repulsion between every pair, springs along edges, mild pull
    // to centre, linear cooling. 320 iterations settles 60 nodes comfortably.
    const idx = new Map(ns.map((n, i) => [n.id, i]));
    for (let it = 0; it < 320; it++) {
      const cool = 1 - it / 320;
      const fx = new Array(ns.length).fill(0), fy = new Array(ns.length).fill(0);
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          let dx = ns[i].x - ns[j].x, dy = ns[i].y - ns[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = (i % 3) - 1; dy = (j % 3) - 1; }
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
          fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
        }
      }
      for (const e of es) {
        const i = idx.get(e.s)!, j = idx.get(e.t)!;
        const dx = ns[j].x - ns[i].x, dy = ns[j].y - ns[i].y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - 58) * 0.045;
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
      }
      for (let i = 0; i < ns.length; i++) {
        fx[i] += (W / 2 - ns[i].x) * 0.006;
        fy[i] += (H / 2 - ns[i].y) * 0.006;
        ns[i].x = Math.max(24, Math.min(W - 24, ns[i].x + Math.max(-14, Math.min(14, fx[i])) * cool));
        ns[i].y = Math.max(20, Math.min(H - 20, ns[i].y + Math.max(-14, Math.min(14, fy[i])) * cool));
      }
    }
    return { nodes: ns, edges: es, topics: topicList };
  }, []);

  const needle = q.trim().toLowerCase();
  const match = (a: Article | null) =>
    !needle || (a ? `${a.title} ${a.subtitle ?? ""} ${a.kicker ?? ""}`.toLowerCase().includes(needle) : false);
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const nMatch = nodes.filter(n => !n.hub && match(n.a)).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — non-matches fade…"
          className="w-64 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
        <span className="text-[10px] text-slate-500">
          {nMatch} of {ARTICLES.length} · {topics.length} topic clusters
        </span>
      </div>
      <div className="mb-2"><Legend active="all" onPick={() => {}} /></div>

      <div ref={wrap} className="relative overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
        <svg width={W} height={H} className="block">
          {edges.map((e, i) => {
            const s = byId.get(e.s)!, t = byId.get(e.t)!;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke="#1e293b" strokeWidth={1}
              opacity={match(s.a) ? 0.9 : 0.15} />;
          })}
          {nodes.filter(n => n.hub).map(n => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={4} fill="#475569" stroke="#0f172a" strokeWidth={2} />
              <text x={n.x} y={n.y - 9} textAnchor="middle" className="fill-slate-400"
                fontSize={10} fontWeight={700}>{n.label}</text>
            </g>
          ))}
          {nodes.filter(n => !n.hub).map(n => {
            const on = match(n.a);
            const isSel = sel?.id === n.a?.id;
            return (
              <circle key={n.id} cx={n.x} cy={n.y} r={isSel ? 7 : 5}
                fill={CAT_COLOR[n.cat as Cat]} stroke={isSel ? "#e2e8f0" : "#0f172a"} strokeWidth={2}
                opacity={on ? 1 : 0.12} style={{ cursor: "pointer" }}
                onClick={() => setSel(n.a)}
                onMouseEnter={e => setHover({ a: n.a!, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                onMouseLeave={() => setHover(null)} />
            );
          })}
        </svg>
        {hover && <Tip a={hover.a} x={hover.x} y={hover.y} />}
      </div>

      <div className="mt-2 rounded-lg border border-slate-800 p-3">
        {sel ? (
          <>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{sel.kicker ?? CAT_LABEL[sel.cat]}</div>
            <div className="text-sm font-bold text-white">{sel.title}</div>
            {sel.subtitle && <div className="mt-0.5 text-xs text-slate-400">{sel.subtitle}</div>}
            <div className="mt-1 font-mono text-[10px] text-slate-600">
              {CAT_LABEL[sel.cat]} · {sel.updated ?? "no date"} · &lt;{sel.body ?? "?"} /&gt;
            </div>
          </>
        ) : <div className="text-xs text-slate-600">Click a node — the article opens here.</div>}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        Clusters are the kicker&rsquo;s topic prefix, which is the structure the five categories currently hide:
        the seven Options papers and five COT papers are each one body of work, but today they are only
        neighbours in a long scroll. Layout is a deterministic force simulation — same every load.
      </p>
    </div>
  );
}
