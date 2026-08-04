"use client";
import { useEffect, useMemo, useState } from "react";

// ── Sucafina weekly origin reports (sucafina_reports.json) ──────────────────
// One PDF per week, parsed into per-origin market notes by the 1.17 workflow.
// Replaces the removed Daily Coffee News RSS source as the origin-news feed.
// If heading detection failed for a week (parse_ok=false) the raw text ships,
// and the source-PDF link is always present.

interface Report {
  date: string; label: string; url: string;
  origins: Record<string, string>;
  full_text?: string;
  parse_ok: boolean;
}
interface Doc { scraped_at: string; source: string; reports: Report[] }

// Display order: market-wide sections first, then origins alphabetically.
const LEAD = ["Global", "Market", "Macro", "Outlook"];

export default function OriginReportsPanel() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [week, setWeek] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/data/sucafina_reports.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j?.reports?.length) { setDoc(j); setWeek(j.reports[0].date); }
        else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, []);

  const report = useMemo(
    () => doc?.reports.find(r => r.date === week) ?? null,
    [doc, week]);

  const sections = useMemo(() => {
    if (!report) return [];
    const keys = Object.keys(report.origins);
    const lead = LEAD.filter(k => keys.includes(k));
    const rest = keys.filter(k => !LEAD.includes(k)).sort();
    return [...lead, ...rest].map(k => [k, report.origins[k]] as const);
  }, [report]);

  if (missing) return null;   // panel appears once the first weekly run lands
  if (!doc || !report) return <div className="bg-slate-900 rounded-lg h-24 animate-pulse" />;

  return (
    <section className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded">
          Origin reports
        </span>
        <h2 className="text-sm font-bold text-white">Weekly notes from origin</h2>
        <span className="text-[10px] text-slate-500">Sucafina EMEA · from-source updates by sister companies</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={week ?? ""}
            onChange={e => { setWeek(e.target.value); setOpen({}); }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
          >
            {doc.reports.map(r => (
              <option key={r.date} value={r.date}>{r.label}</option>
            ))}
          </select>
          <a href={report.url} target="_blank" rel="noopener noreferrer"
             className="text-[10px] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white">
            PDF ↗
          </a>
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="space-y-1.5">
          {sections.map(([name, text]) => (
            <div key={name} className="border border-slate-800 rounded">
              <button
                onClick={() => setOpen(o => ({ ...o, [name]: !o[name] }))}
                aria-expanded={!!open[name]}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/60"
              >
                <span className={`text-slate-500 text-[10px] transition-transform ${open[name] ? "rotate-90" : ""}`}>▸</span>
                <span className="text-[12px] font-semibold text-slate-200">{name}</span>
                {!open[name] && (
                  <span className="text-[11px] text-slate-500 truncate flex-1">{text.slice(0, 110)}…</span>
                )}
              </button>
              {open[name] && (
                <p className="px-3 pb-3 pl-8 text-[12px] leading-relaxed text-slate-300 whitespace-pre-line">
                  {text}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 leading-relaxed">
          {report.full_text
            ? <p className="whitespace-pre-line max-h-64 overflow-y-auto">{report.full_text}</p>
            : <p>This week&rsquo;s report couldn&rsquo;t be text-parsed — open the PDF above.</p>}
        </div>
      )}
    </section>
  );
}
