"use client";
import { useState } from "react";
// Shared typography + layout helpers for the Research "methodology paper"
// components. Dark-theme, mirrors the inline helpers in ResearchView.tsx so the
// new papers read identically to the existing ones.

export function H2({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-bold text-slate-100 mt-7 mb-1 pb-1 border-b border-slate-700">{children}</h3>;
}
export function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1 mb-2">{children}</ul>;
}
export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;
}
// Block-level formula / pseudo-code, monospace on a tinted panel.
export function Fml({ children }: { children: React.ReactNode }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-slate-800/70 border border-slate-700/60 rounded px-3 py-2 my-2 text-amber-200 whitespace-pre-wrap">
      {children}
    </pre>
  );
}
export function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border-l-4 border-amber-400/70 rounded-r p-3 my-3 text-xs text-slate-300 italic leading-relaxed">
      {children}
    </div>
  );
}

// ── Unified research card shell ──────────────────────────────────────────────
// Every research article/tool renders through this shell so the collapsed
// ("pre-Read-more") state is identical across the whole Research tab: one-line
// kicker (sub-category colour), one-line title, one-line subtitle, the toggle,
// and the last-edited date. `tone` colour-codes the former sub-category the
// piece belongs to. Bump `updated` whenever an article's CONTENT changes.
export type Tone = "amber" | "sky" | "emerald" | "violet" | "rose" | "teal" | "lime" | "cyan" | "orange" | "green" | "indigo";
const TONES: Record<Tone, { kicker: string; border: string }> = {
  amber:   { kicker: "text-amber-500/90",   border: "border-l-amber-400/60" },
  sky:     { kicker: "text-sky-400/90",     border: "border-l-sky-400/60" },
  emerald: { kicker: "text-emerald-400/90", border: "border-l-emerald-400/60" },
  violet:  { kicker: "text-violet-400/90",  border: "border-l-violet-400/60" },
  rose:    { kicker: "text-rose-400/90",    border: "border-l-rose-400/60" },
  teal:    { kicker: "text-teal-400/90",    border: "border-l-teal-400/60" },
  lime:    { kicker: "text-lime-400/90",    border: "border-l-lime-400/60" },
  cyan:    { kicker: "text-cyan-400/90",    border: "border-l-cyan-400/60" },
  orange:  { kicker: "text-orange-400/90",  border: "border-l-orange-400/60" },
  green:   { kicker: "text-green-400/90",   border: "border-l-green-400/60" },
  indigo:  { kicker: "text-indigo-400/90",  border: "border-l-indigo-400/60" },   // Options
};

export function ResearchCard({ tone = "amber", kicker, title, subtitle, updated, defaultOpen = false, bare = false, children }: {
  tone?: Tone; kicker: string; title: string; subtitle?: string; updated?: string;
  defaultOpen?: boolean; bare?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONES[tone];
  const header = (
    <button onClick={() => setOpen(o => !o)}
      className="group w-full flex items-start justify-between gap-3 text-left p-4">
      <div className="min-w-0">
        <div className={`text-[10px] uppercase tracking-[0.25em] ${t.kicker} mb-1`}>{kicker}</div>
        <h3 className="text-base font-bold text-slate-100 leading-tight truncate">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="shrink-0 text-right mt-0.5">
        <span className="block text-[11px] text-amber-400/80 group-hover:text-amber-400 whitespace-nowrap">
          {open ? "▲ Less" : "▼ Read more"}
        </span>
        {updated && <span className="block text-[9px] text-slate-600 mt-1 whitespace-nowrap">updated {updated}</span>}
      </div>
    </button>
  );
  if (bare) {
    // Tool/dashboard mode: the child renders its own panels below the header card.
    return (
      <div>
        <div className={`bg-slate-900 border border-slate-800 border-l-2 ${t.border} rounded-xl`}>{header}</div>
        {open && <div className="mt-3">{children}</div>}
      </div>
    );
  }
  return (
    <div className={`bg-slate-900 border border-slate-800 border-l-2 ${t.border} rounded-xl`}>
      {header}
      {open && <div className="px-4 pb-4 sm:px-5 sm:pb-5"><div className="max-w-3xl">{children}</div></div>}
    </div>
  );
}

// Outer card for a methodology paper — thin alias over the unified shell.
export function Paper({ kicker, title, subtitle, tone, updated, defaultOpen = false, children }: {
  kicker: string; title: string; subtitle?: string; tone?: Tone; updated?: string;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <ResearchCard tone={tone} kicker={kicker} title={title} subtitle={subtitle} updated={updated} defaultOpen={defaultOpen}>
      {children}
    </ResearchCard>
  );
}

// Simple 2- or 3-column reference table.
export function RefTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
            {head.map((h, i) => (
              <th key={i} className={`pb-1.5 pr-4${i > 0 ? " text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-800">
              {r.map((c, ci) => (
                <td key={ci} className={`py-1.5 pr-4 ${ci === 0 ? "text-slate-200 font-semibold" : "text-right font-mono text-slate-300"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
