"use client";
/**
 * ReportCanvas — the printable column.
 *
 * Rendered VISIBLY on screen (it doubles as the live preview) and used as the
 * react-to-print target. Visibility matters: printing a `display:none` node
 * makes width-measuring charts (e.g. Recharts ResponsiveContainer) collapse to
 * 0px and render blank, so the canvas is always laid out at an explicit width.
 *
 * Each selected visual gets a card + an executive-summary box beneath it. The
 * box is an editable <textarea> on screen and a static <div> in print — cloned
 * <textarea> values don't survive react-to-print, so we swap via Tailwind's
 * `print:` variants instead.
 */
import { forwardRef, useEffect, useState } from "react";
import { REPORT_BY_ID } from "@/lib/report/registry";
import { useReportStore } from "@/lib/report/store";
import { getInsight, getExecutiveSummary } from "@/lib/report/insights";
import Markdown from "@/lib/report/markdown";

/** Reserved comments key for the report-level executive summary. Never collides
 *  with chart note keys (`chartId` / `chartId__part`) and survives per-chart
 *  removal cleanup, which only strips keys derived from the removed id. */
const EXEC_KEY = "__exec";

const PRINT_DATE = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/**
 * A single executive-summary box: editable <textarea> on screen, static rendered
 * Markdown in print (cloned textarea values don't survive react-to-print). An
 * optional label distinguishes split notes (e.g. "NY" vs "London"); in print the
 * label is hidden when the note is empty so blank halves leave no orphaned title.
 *
 * The box is SEEDED with an auto-generated, rule-based comment (see lib/report/
 * insights). While the user hasn't typed anything (store has no entry for this
 * note) the auto text shows and refreshes with the data; once they edit, their
 * text takes over. Clearing back to empty falls through to the auto seed again.
 */
function NoteField({ noteId, label }: { noteId: string; label?: string }) {
  const userNote = useReportStore((s) => s.comments[noteId]); // string | undefined
  const setComment = useReportStore((s) => s.setComment);
  const [auto, setAuto] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getInsight(noteId).then((t) => { if (alive) setAuto(t); });
    return () => { alive = false; };
  }, [noteId]);

  // User text wins; otherwise seed with the auto comment. `undefined` (no store
  // entry) means "untouched" → use auto; an explicit "" means the user cleared it.
  const value = userNote !== undefined ? userNote : (auto ?? "");
  const isAuto = userNote === undefined && !!auto;

  return (
    <div>
      {label && (
        <div className={`text-[9px] uppercase tracking-wider text-slate-500 mb-1 ${value.trim() ? "" : "print:hidden"}`}>
          {label}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => setComment(noteId, e.target.value)}
        placeholder="Add your executive summary… Markdown supported: **bold**, *italic*, `code`, - bullets"
        rows={3}
        className="print:hidden w-full resize-y rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5
                   text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
      />
      {isAuto && (
        <div className="print:hidden text-[8px] text-slate-600 mt-0.5">✨ auto-generated — edit to override</div>
      )}
      {value.trim() && (
        // Rendered Markdown — live preview on screen, the only note shown in
        // print (the editable textarea is print:hidden).
        <Markdown className="text-xs text-slate-200 leading-relaxed space-y-1 mt-2 print:mt-0">
          {value}
        </Markdown>
      )}
    </div>
  );
}

/**
 * Report-level Executive Summary — sits under the briefing header, above the
 * charts. The auto version is SELECTION-AWARE: it re-composes whenever charts
 * are added/removed (one bullet per category, built from each selected chart's
 * headline fact — see getExecutiveSummary). Same editing contract as chart
 * notes: typing takes over, clearing falls back to the auto composition.
 */
function ExecutiveSummary({ selectedIds }: { selectedIds: string[] }) {
  const userText = useReportStore((s) => s.comments[EXEC_KEY]); // string | undefined
  const setComment = useReportStore((s) => s.setComment);
  const [auto, setAuto] = useState<string | null>(null);

  const selKey = selectedIds.join(",");
  useEffect(() => {
    let alive = true;
    getExecutiveSummary(selectedIds).then((t) => { if (alive) setAuto(t); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selKey is selectedIds' identity
  }, [selKey]);

  const value = userText !== undefined ? userText : (auto ?? "");
  const isAuto = userText === undefined && !!auto;

  return (
    <section
      className="rounded-lg border border-amber-700/40 bg-amber-500/5 px-3 py-2 mb-3"
      style={{ breakInside: "avoid" }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400">Executive Summary</h2>
        {isAuto && (
          <span className="print:hidden text-[8px] text-slate-500">✨ auto-composed from selection — edit to override</span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setComment(EXEC_KEY, e.target.value)}
        placeholder="Auto-composes from the selected visuals once their data loads… or write your own. Markdown supported."
        rows={Math.min(10, Math.max(3, value.split("\n").length + 1))}
        className="print:hidden mt-1.5 w-full resize-y rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5
                   text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
      />
      {value.trim() && (
        // Live preview on screen; the only rendering that survives into print.
        <Markdown className="text-xs text-slate-200 leading-relaxed space-y-1 mt-2 print:mt-1.5">
          {value}
        </Markdown>
      )}
    </section>
  );
}

const ReportCanvas = forwardRef<HTMLDivElement>(function ReportCanvas(_props, ref) {
  const selectedIds = useReportStore((s) => s.selectedIds);

  return (
    // Fixed ~A4 content width (700px) at ALL viewports — the parent is
    // overflow-x-auto, so on a phone the preview scrolls horizontally instead of
    // shrinking. max-w-full used to cap it to the phone width (~360px), which
    // made the Recharts containers measure half their intended size and render
    // squeezed SVGs that then stretched to A4 in the printed PDF.
    <div ref={ref} id="report-canvas" className="bg-slate-950 text-slate-100 mx-auto w-[700px]">
      {/* Auto-injected briefing header */}
      <header className="border-b border-slate-700 pb-2 mb-3">
        <h1 className="text-base font-semibold text-amber-400">Coffee Intel Map — Market Briefing</h1>
        <p className="text-[10px] text-slate-400">{PRINT_DATE()}</p>
      </header>

      {selectedIds.length > 0 && <ExecutiveSummary selectedIds={selectedIds} />}

      {selectedIds.length === 0 ? (
        <div className="text-xs text-slate-500 italic border border-dashed border-slate-700 rounded-lg px-3 py-10 text-center">
          Tick visuals on the left to build your briefing. Each one appears here with a note box.
        </div>
      ) : (
        // flex-wrap so half-width visuals pack two-up; full-width ones take the
        // whole row. gap-3 (12px) → half = calc(50% - 6px) keeps the pair flush.
        <div className="flex flex-wrap items-start gap-3">
          {selectedIds.map((id) => {
            const def = REPORT_BY_ID[id];
            if (!def) return null;
            const Visual = def.Component;
            const splitNotes = def.notes && def.notes.length > 1 ? def.notes : null;
            const half = def.width === "half";
            return (
              // break-inside-avoid keeps a chart + its note on one printed page.
              <section
                key={id}
                className="rounded-lg border border-slate-700 bg-slate-900/60 overflow-hidden"
                style={{ breakInside: "avoid", width: half ? "calc(50% - 6px)" : "100%" }}
              >
                <div className="px-2 py-1 border-b border-slate-800">
                  <h2 className="text-xs font-semibold text-slate-100">{def.label}</h2>
                </div>
                <div className="p-2 overflow-x-auto">
                  <Visual isReportMode />
                </div>
                <div className="px-3 pb-3">
                  {splitNotes ? (
                    // One note per sub-chart, laid out to align under the chart's
                    // columns (the multi-part visuals render their parts 2-up).
                    <div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: `repeat(${splitNotes.length}, minmax(0,1fr))` }}
                    >
                      {splitNotes.map((n) => (
                        <NoteField key={n.key} noteId={`${id}__${n.key}`} label={n.label} />
                      ))}
                    </div>
                  ) : (
                    <NoteField noteId={id} />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ReportCanvas;
