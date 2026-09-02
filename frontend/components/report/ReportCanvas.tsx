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
import { REPORT_BY_ID, REPORT_CATEGORIES } from "@/lib/report/registry";
import { PRODUCT_NAME } from "@/lib/brand";
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
 * text takes over — INCLUDING deleting everything, which is a deliberate
 * "blank note" (so a chart can print without a comment). The ↺ restore-auto
 * button drops the override and brings the auto comment back.
 */
function NoteField({ noteId, label }: { noteId: string; label?: string }) {
  const userNote = useReportStore((s) => s.comments[noteId]); // string | undefined
  const setComment = useReportStore((s) => s.setComment);
  const resetComment = useReportStore((s) => s.resetComment);
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
  const isOverridden = userNote !== undefined;

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
        placeholder="Add your note… Markdown supported: **bold**, *italic*, `code`, - bullets"
        rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
        className="print:hidden w-full resize-y rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5
                   text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
      />
      {isAuto && (
        <div className="print:hidden text-[8px] text-slate-600 mt-0.5">✨ auto-generated — edit to override</div>
      )}
      {isOverridden && (
        <div className="print:hidden flex items-center gap-2 text-[8px] text-slate-600 mt-0.5">
          <span>✎ edited{value.trim() === "" ? " (blank — nothing prints)" : ""}</span>
          {auto && (
            <button
              onClick={() => resetComment(noteId)}
              className="px-1 py-px rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              title="Discard your edit and restore the auto-generated comment"
            >
              ↺ restore auto
            </button>
          )}
        </div>
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
  const resetComment = useReportStore((s) => s.resetComment);
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
    // Grey-tone editorial panel: hairline frame + a stronger left rule (the
    // exec-accent class gets a darker print override in printStyles).
    <section
      className="exec-accent rounded-md border border-slate-700 border-l-2 border-l-slate-400 bg-slate-900/50 px-3 py-2 mb-4"
      style={{ breakInside: "avoid" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-300">Executive Summary</h2>
        {isAuto && (
          <span className="print:hidden text-[8px] text-slate-500">✨ auto-composed from selection — edit to override</span>
        )}
        {userText !== undefined && (
          <span className="print:hidden flex items-center gap-2 text-[8px] text-slate-500">
            <span>✎ edited{(userText ?? "").trim() === "" ? " (blank)" : ""}</span>
            {auto && (
              <button
                onClick={() => resetComment(EXEC_KEY)}
                className="px-1 py-px rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                title="Discard your edit and restore the auto-composed summary"
              >
                ↺ restore auto
              </button>
            )}
          </span>
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
  const setOrder = useReportStore((s) => s.setOrder);

  /**
   * Reorder a chart WITHIN its category block. The block's ids are a
   * subsequence of selectedIds, so we rearrange that subsequence and write it
   * back into the same slots — cross-category order (fixed by
   * REPORT_CATEGORIES) is untouched. Lets you re-tick a chart and lift it back
   * to 2nd/3rd place instead of having to clear the whole cart.
   */
  const moveWithin = (groupIds: string[], from: number, to: number) => {
    if (to < 0 || to >= groupIds.length || from === to) return;
    const nextGroup = [...groupIds];
    const [moved] = nextGroup.splice(from, 1);
    nextGroup.splice(to, 0, moved);
    const member = new Set(groupIds);
    let j = 0;
    setOrder(selectedIds.map((id) => (member.has(id) ? nextGroup[j++] : id)));
  };

  return (
    // Fixed ~A4 content width (700px) at ALL viewports — the parent is
    // overflow-x-auto, so on a phone the preview scrolls horizontally instead of
    // shrinking. max-w-full used to cap it to the phone width (~360px), which
    // made the Recharts containers measure half their intended size and render
    // squeezed SVGs that then stretched to A4 in the printed PDF.
    // tabular-nums keeps figures column-aligned across the whole briefing.
    <div
      ref={ref}
      id="report-canvas"
      className="bg-slate-950 text-slate-100 mx-auto w-[700px]"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {/* Masthead — editorial two-tier: grey kicker, strong title, right-set
          date, then the classic thick+thin double rule. The masthead-rule class
          gets a near-black print override in printStyles. */}
      <header className="mb-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.32em] text-slate-500">
              {PRODUCT_NAME}
            </div>
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-slate-100">
              Market Briefing
            </h1>
          </div>
          <div className="text-right pb-0.5">
            <div className="text-[10px] font-medium text-slate-300">{PRINT_DATE()}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500">
              {selectedIds.length} visual{selectedIds.length === 1 ? "" : "s"} · auto-annotated
            </div>
          </div>
        </div>
        <div className="masthead-rule mt-2 border-t-2 border-slate-300" />
        <div className="border-t border-slate-700 mt-[3px]" />
      </header>

      {selectedIds.length > 0 && <ExecutiveSummary selectedIds={selectedIds} />}

      {selectedIds.length === 0 ? (
        <div className="text-xs text-slate-500 italic border border-dashed border-slate-700 rounded-lg px-3 py-10 text-center">
          Tick visuals on the left to build your briefing. Each one appears here with a note box.
        </div>
      ) : (
        // Charts grouped by report category (registry order), each group under a
        // numbered grey section header. Selection order is preserved within a
        // group. Group wrappers are <div>s on purpose: the print CSS keeps every
        // <section> (chart card) unbroken across pages, and a whole category
        // must stay free to flow across them.
        REPORT_CATEGORIES
          .map((cat) => ({ cat, ids: selectedIds.filter((id) => REPORT_BY_ID[id]?.category === cat) }))
          .filter((g) => g.ids.length > 0)
          .map((g, gi) => (
            <div key={g.cat} className="mb-4">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[10px] font-bold text-slate-500">{String(gi + 1).padStart(2, "0")}</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">{g.cat}</span>
                <span className="flex-1 self-center border-t border-slate-800" />
                <span className="text-[9px] text-slate-600">{g.ids.length} visual{g.ids.length === 1 ? "" : "s"}</span>
              </div>
              {/* flex-wrap so half-width visuals pack two-up; gap-3 (12px) →
                  half = calc(50% - 6px) keeps the pair flush. */}
              <div className="flex flex-wrap items-start gap-3">
                {g.ids.map((id, idx) => {
                  const def = REPORT_BY_ID[id];
                  if (!def) return null;
                  const Visual = def.Component;
                  const splitNotes = def.notes && def.notes.length > 1 ? def.notes : null;
                  const half = def.width === "half";
                  return (
                    // break-inside-avoid keeps a chart + its note on one printed page.
                    <section
                      key={id}
                      className="rounded-md border border-slate-800 bg-slate-900/40 overflow-hidden"
                      style={{ breakInside: "avoid", width: half ? "calc(50% - 6px)" : "100%" }}
                    >
                      <div className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 border-b border-slate-800 bg-slate-900/60">
                        <h2 className="text-xs font-semibold tracking-tight text-slate-200">{def.label}</h2>
                        <div className="flex items-baseline gap-2 shrink-0">
                          {/* Reorder within this section (screen only). */}
                          <div className="print:hidden flex items-center gap-0.5">
                            <button
                              onClick={() => moveWithin(g.ids, idx, 0)}
                              disabled={idx === 0}
                              title="Move to top of section"
                              className="px-1 rounded text-[10px] leading-4 text-slate-500 enabled:hover:text-slate-200 enabled:hover:bg-slate-800 disabled:opacity-25"
                            >⤒</button>
                            <button
                              onClick={() => moveWithin(g.ids, idx, idx - 1)}
                              disabled={idx === 0}
                              title="Move up"
                              className="px-1 rounded text-[10px] leading-4 text-slate-500 enabled:hover:text-slate-200 enabled:hover:bg-slate-800 disabled:opacity-25"
                            >↑</button>
                            <button
                              onClick={() => moveWithin(g.ids, idx, idx + 1)}
                              disabled={idx === g.ids.length - 1}
                              title="Move down"
                              className="px-1 rounded text-[10px] leading-4 text-slate-500 enabled:hover:text-slate-200 enabled:hover:bg-slate-800 disabled:opacity-25"
                            >↓</button>
                            <span className="ml-0.5 text-[8.5px] font-mono text-slate-600">{idx + 1}/{g.ids.length}</span>
                          </div>
                          <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                            {def.group ? `${def.group}${def.subgroup ? ` · ${def.subgroup}` : ""}` : g.cat}
                          </span>
                        </div>
                      </div>
                      <div className="p-2 overflow-x-auto">
                        <Visual isReportMode />
                      </div>
                      <div className="px-3 pb-3">
                        {splitNotes ? (
                          // One note per sub-chart, aligned under the chart's columns.
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
            </div>
          ))
      )}
    </div>
  );
});

export default ReportCanvas;
