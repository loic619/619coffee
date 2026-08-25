"use client";
// Admin edit panel for one research article.
//
// Scope is metadata plus an editor's note, deliberately: the bodies are React
// components computing from nightly JSON, so making them editable text would
// mean freezing ~30 live charts at whatever they read the day they were
// converted. Renaming, re-filing and annotating gets the useful part of
// "editable" without paying that.
import { useEffect, useState } from "react";
import { CAT_LABEL, type Article, type Cat } from "@/lib/research/catalog";
import { LIMITS, type Override } from "@/lib/research/overrides";

const TONES = ["amber", "sky", "violet", "emerald", "indigo", "rose", "slate"];
const CATS = Object.keys(CAT_LABEL) as Cat[];

function Field({ label, value, onChange, max, placeholder, rows }: {
  label: string; value: string; onChange: (v: string) => void;
  max: number; placeholder?: string; rows?: number;
}) {
  const over = value.length > max;
  return (
    <label className="block">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`font-mono text-[9px] ${over ? "text-rose-400" : "text-slate-600"}`}>
          {value.length}/{max}
        </span>
      </div>
      {rows ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
          placeholder={placeholder}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
      )}
    </label>
  );
}

export default function EditPanel({ article, override, onSaved, onClose }: {
  article: Article;                 // the SOURCE article, not the merged one
  override: Override | undefined;
  onSaved: (id: string, ov: Override | null) => void;
  onClose: () => void;
}) {
  // Seeded from the override where one exists, else from source — so the
  // fields show what is rendering, and clearing one falls back to source
  // rather than to blank.
  const [title, setTitle] = useState(override?.title ?? article.title);
  const [subtitle, setSubtitle] = useState(override?.subtitle ?? article.subtitle ?? "");
  const [kicker, setKicker] = useState(override?.kicker ?? article.kicker ?? "");
  const [cat, setCat] = useState<Cat>(override?.cat ?? article.cat);
  const [tone, setTone] = useState(override?.tone ?? article.tone ?? "slate");
  const [order, setOrder] = useState(override?.order?.toString() ?? "");
  const [note, setNote] = useState(override?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTitle(override?.title ?? article.title);
    setSubtitle(override?.subtitle ?? article.subtitle ?? "");
    setKicker(override?.kicker ?? article.kicker ?? "");
    setCat(override?.cat ?? article.cat);
    setTone(override?.tone ?? article.tone ?? "slate");
    setOrder(override?.order?.toString() ?? "");
    setNote(override?.note ?? "");
    setErr(null);
  }, [article, override]);

  // Only send what actually differs from source. Storing a value equal to the
  // source would pin the article to today's wording — a later edit to the JSX
  // would then be silently overridden by a "change" nobody made.
  function patch() {
    const p: Record<string, unknown> = {};
    p.title    = title    !== article.title            ? title    : "";
    p.subtitle = subtitle !== (article.subtitle ?? "") ? subtitle : "";
    p.kicker   = kicker   !== (article.kicker ?? "")   ? kicker   : "";
    p.note     = note;
    if (cat !== article.cat) p.cat = cat;
    if (tone !== (article.tone ?? "slate")) p.tone = tone;
    if (order.trim()) p.order = Number(order);
    return p;
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/research/overrides", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: article.id, patch: patch() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      onSaved(article.id, j.override);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/research/overrides?id=${encodeURIComponent(article.id)}`,
        { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      onSaved(article.id, null);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-700/60 bg-amber-950/20 p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Editing</span>
        <span className="font-mono text-[10px] text-slate-500">{article.id}</span>
        {override?.edited_at && (
          <span className="text-[10px] text-slate-600">
            last edited {override.edited_at.slice(0, 10)}
          </span>
        )}
        <button onClick={onClose} className="ml-auto text-[10px] text-slate-400 hover:text-slate-200">
          close
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Title" value={title} onChange={setTitle} max={LIMITS.title} />
        <Field label="Kicker" value={kicker} onChange={setKicker} max={LIMITS.kicker}
          placeholder="Topic · sub-topic" />
      </div>
      <div className="mt-2">
        <Field label="Subtitle" value={subtitle} onChange={setSubtitle} max={LIMITS.subtitle} />
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="block">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Category</div>
          <select value={cat} onChange={e => setCat(e.target.value as Cat)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200">
            {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Tone</div>
          <select value={tone} onChange={e => setTone(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200">
            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Order</div>
          <input value={order} onChange={e => setOrder(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="—" className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600" />
        </label>
        <span className="text-[10px] text-slate-600">blank order = catalogue position</span>
      </div>

      <div className="mt-2">
        <Field label="Editor's note — renders above the article" value={note} onChange={setNote}
          max={LIMITS.note} rows={3}
          placeholder="e.g. Superseded by the 2026-08 audit — the dsr trade-off is now explicit." />
      </div>

      {err && <p className="mt-2 text-[10px] text-rose-400">Save failed: {err}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button onClick={save} disabled={busy}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-500 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={reset} disabled={busy || !override}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40">
          Reset to source
        </button>
        <span className="text-[10px] text-slate-600">
          only fields differing from source are stored, so later source edits still show through
        </span>
      </div>
    </div>
  );
}
