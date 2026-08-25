"use client";
// Throwaway comparison page for choosing the Research tab's browse layout.
//
// The complaint it exists to answer: the current vertical stack of full-width
// cards fits about five articles on a screen, so finding one of 45 means
// scrolling and remembering. Each layout below renders the REAL catalogue —
// same 45 titles, kickers, categories and dates — so the choice is made on
// actual density and actual title lengths, not on lorem ipsum.
//
// Article bodies are deliberately NOT rendered: this is about finding, not
// reading. Delete this route once the layout is picked.
import { useMemo, useState } from "react";
import { ARTICLES, CAT_LABEL, type Article, type Cat } from "@/lib/research/catalog";

const TONE_DOT: Record<string, string> = {
  amber: "bg-amber-400", sky: "bg-sky-400", violet: "bg-violet-400",
  emerald: "bg-emerald-400", indigo: "bg-indigo-400", rose: "bg-rose-400",
  slate: "bg-slate-400",
};
const dot = (t: string | null) => TONE_DOT[t ?? "slate"] ?? "bg-slate-400";
const CATS = Object.keys(CAT_LABEL) as Cat[];

/** Substring match across title, subtitle and kicker — the fields you'd
 *  actually remember an article by. */
function useFiltered(q: string, cat: Cat | "all") {
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ARTICLES.filter(a => {
      if (cat !== "all" && a.cat !== cat) return false;
      if (!needle) return true;
      return `${a.title} ${a.subtitle ?? ""} ${a.kicker ?? ""}`.toLowerCase().includes(needle);
    });
  }, [q, cat]);
}

function Toolbar({ q, setQ, cat, setCat, n }: {
  q: string; setQ: (v: string) => void; cat: Cat | "all"; setCat: (c: Cat | "all") => void; n: number;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles, subtitles, kickers…"
          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
        <span className="whitespace-nowrap text-[10px] text-slate-500">{n} of {ARTICLES.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {(["all", ...CATS] as (Cat | "all")[]).map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              cat === c ? "bg-slate-800 text-amber-400 border border-slate-700"
                        : "border border-transparent text-slate-500 hover:text-slate-300"}`}>
            {c === "all" ? "All" : CAT_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── A · Compact searchable index ─────────────────────────────────────── */
function LayoutIndex() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState<Cat | "all">("all");
  const list = useFiltered(q, cat);
  return (
    <div>
      <Toolbar q={q} setQ={setQ} cat={cat} setCat={setCat} n={list.length} />
      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
        {list.map(a => (
          <div key={a.id} className="flex items-baseline gap-2 px-3 py-1.5 hover:bg-slate-900/60 cursor-pointer">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(a.tone)}`} />
            <span className="truncate text-xs text-slate-200">{a.title}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">{a.kicker ?? "—"}</span>
            <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-600">{a.updated ?? "—"}</span>
          </div>
        ))}
        {!list.length && <div className="px-3 py-6 text-center text-xs text-slate-600">No match.</div>}
      </div>
    </div>
  );
}

/* ── B · Two-pane, index left / article right ─────────────────────────── */
function LayoutTwoPane() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState<Cat | "all">("all");
  const list = useFiltered(q, cat);
  const [sel, setSel] = useState<Article | null>(ARTICLES[0] ?? null);
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(260px,340px)_1fr]">
      <div>
        <Toolbar q={q} setQ={setQ} cat={cat} setCat={setCat} n={list.length} />
        <div className="max-h-[560px] divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
          {list.map(a => (
            <button key={a.id} onClick={() => setSel(a)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-slate-900/60 ${
                sel?.id === a.id ? "bg-slate-800/70" : ""}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(a.tone)}`} />
              <span className="truncate text-xs text-slate-200">{a.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-slate-800 p-4">
        {sel ? (
          <>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{sel.kicker ?? CAT_LABEL[sel.cat]}</div>
            <h3 className="mt-1 text-base font-bold text-white">{sel.title}</h3>
            {sel.subtitle && <p className="mt-1 text-xs text-slate-400">{sel.subtitle}</p>}
            <div className="mt-3 text-[10px] text-slate-600">
              {CAT_LABEL[sel.cat]} · updated {sel.updated ?? "—"} · renders <span className="font-mono">&lt;{sel.body ?? "?"} /&gt;</span>
            </div>
            <div className="mt-4 flex h-56 items-center justify-center rounded border border-dashed border-slate-800 text-[11px] text-slate-600">
              article body renders here
            </div>
          </>
        ) : <div className="text-xs text-slate-600">Pick an article.</div>}
      </div>
    </div>
  );
}

/* ── C · Card grid ────────────────────────────────────────────────────── */
function LayoutGrid() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState<Cat | "all">("all");
  const list = useFiltered(q, cat);
  return (
    <div>
      <Toolbar q={q} setQ={setQ} cat={cat} setCat={setCat} n={list.length} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map(a => (
          <div key={a.id} className="cursor-pointer rounded-lg border border-slate-800 bg-slate-900/40 p-3 hover:border-slate-600">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${dot(a.tone)}`} />
              <span className="truncate text-[9px] uppercase tracking-wider text-slate-500">{a.kicker ?? CAT_LABEL[a.cat]}</span>
            </div>
            <div className="mt-1 line-clamp-3 text-xs font-semibold leading-snug text-slate-200">{a.title}</div>
            <div className="mt-2 font-mono text-[10px] text-slate-600">{a.updated ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── D · Today, for reference ─────────────────────────────────────────── */
function LayoutCurrent() {
  const [cat, setCat] = useState<Cat>("quant");
  const list = ARTICLES.filter(a => a.cat === cat);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {CATS.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              cat === c ? "bg-slate-800 text-amber-400 border border-slate-700"
                        : "border border-transparent text-slate-500 hover:text-slate-300"}`}>
            {CAT_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {list.map(a => (
          <div key={a.id} className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{a.kicker ?? "—"}</div>
            <h3 className="mt-1 text-base font-bold text-white">{a.title}</h3>
            {a.subtitle && <p className="mt-1 text-xs text-slate-400">{a.subtitle}</p>}
            <div className="mt-2 text-right text-[10px] text-slate-600">▾ Read more · updated {a.updated ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: "index",   label: "A · Compact index",  note: "one line each · search + filters", el: <LayoutIndex /> },
  { id: "twopane", label: "B · Two-pane",       note: "index stays put while you read",   el: <LayoutTwoPane /> },
  { id: "grid",    label: "C · Card grid",      note: "tiles, 3–4 across",                el: <LayoutGrid /> },
  { id: "current", label: "D · Today",          note: "for comparison",                   el: <LayoutCurrent /> },
];

export default function LayoutPreview() {
  const [tab, setTab] = useState("index");
  const active = TABS.find(t => t.id === tab) ?? TABS[0];
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-400">Prototype · not linked from the nav</div>
      <h1 className="text-lg font-bold text-white">Research browse — pick a layout</h1>
      <p className="mb-4 mt-1 text-xs text-slate-400">
        All four render the real catalogue: {ARTICLES.length} articles, real titles, kickers, categories and dates.
        Bodies are stubbed — this is about <em>finding</em>, not reading. Try searching &ldquo;gamma&rdquo;,
        &ldquo;COT&rdquo; or &ldquo;ENSO&rdquo; in each.
      </p>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              tab === t.id ? "bg-slate-800 text-amber-400 border border-slate-700"
                           : "border border-transparent text-slate-500 hover:text-slate-300"}`}>
            {t.label}
            <span className="ml-1.5 text-[10px] text-slate-600">{t.note}</span>
          </button>
        ))}
      </div>
      {active.el}
    </div>
  );
}
