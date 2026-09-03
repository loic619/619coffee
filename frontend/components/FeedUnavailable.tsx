/**
 * FeedUnavailable — the one thing a panel shows when its feed did not load.
 *
 * Most panels used to `return null` when their JSON was missing, so a broken
 * feed produced a silent gap: the section simply was not there, and a reader
 * could not tell "nothing to show" from "the fetch failed". The formatters'
 * `—` convention covers a missing VALUE; this covers a missing FEED. Shared so
 * every panel says the same thing in the same place, and so the message
 * names the file — the first thing anyone debugging it needs.
 */
interface Props {
  /** What the reader would have seen, e.g. "Cecafé daily registrations". */
  what: string;
  /** The data file that did not load, e.g. "cecafe_daily.json". */
  file?: string;
  /** Extra sentence when the cause is known, e.g. "the scraper has not run since Friday". */
  detail?: string;
  className?: string;
}

export default function FeedUnavailable({ what, file, detail, className = "" }: Props) {
  return (
    <div
      role="status"
      className={`rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 py-3 text-xs text-slate-400 ${className}`}
    >
      <span className="font-medium text-slate-300">{what}</span> is unavailable —{" "}
      {file ? <>the feed <span className="font-mono text-slate-300">{file}</span> did not load</> : "its feed did not load"}.
      {detail && <> {detail}</>}
      <span className="block mt-0.5 text-[10px] text-slate-500">
        Not an empty result: the data could not be fetched. Check the freshness bar for the feed&rsquo;s last run.
      </span>
    </div>
  );
}
