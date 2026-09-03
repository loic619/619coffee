/**
 * AnalystBadge — the third kind of number.
 *
 * Observed numbers come from a market or a report; modelled numbers come out
 * of a model (ModelledBadge). A number an analyst typed in — the "Final" crop
 * figure on the S&D card, a world-balance line edited behind the password —
 * is neither. It is ASSUMED, and it is the app's official view for everyone
 * who opens it, so it must look like what it is: an editorial judgement with
 * a date on it, distinct from both a measurement and a forecast.
 *
 * Edits persist in the repo (the editors POST to a workflow that commits the
 * JSON), which is why "who" is the site and "when" is the commit, not a
 * browser session.
 */
interface Props {
  /** When the override was last set, ISO date, if known. */
  editedOn?: string | null;
  /** What the official (un-overridden) source says, for the tooltip. */
  sourceNote?: string;
  className?: string;
}

export default function AnalystBadge({ editedOn, sourceNote, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-950/40
                  px-2 py-0.5 text-[11px] leading-4 text-amber-200 ${className}`}
      title={
        "This figure was set by an analyst and overrides the source. It is a judgement, not a measurement or a model output."
        + (sourceNote ? ` ${sourceNote}` : "")
      }
    >
      <span className="font-bold uppercase tracking-widest">Analyst estimate</span>
      {editedOn && <span className="text-amber-300/80">· set {editedOn.slice(0, 10)}</span>}
    </span>
  );
}
