/**
 * ModelledBadge — the one visual that separates a number we MEASURED from a
 * number we PREDICTED.
 *
 * Every derived panel (ML direction call, OLS forecast, NLP sentiment) used to
 * render in the same chrome as certified stocks or ICE settlements. Nothing in
 * the shared UI said which was which. Trade users forgive a wrong forecast;
 * they do not forgive not being told it was one. This badge is applied to
 * every panel whose headline number comes out of a model, and it carries the
 * only thing that makes a forecast usable: its track record.
 *
 * `hitRate` is the live, out-of-sample record — predictions that were made
 * ahead of time and then graded. In-sample fit (R², test accuracy on the
 * training split) is NOT a hit rate and is labelled separately by the caller.
 * When there is no live record yet, say so rather than show nothing: "no live
 * track record" is information; an absent badge is not.
 */

export interface HitRate {
  /** Fraction correct, 0..1. */
  value: number;
  /** Number of graded predictions behind the value. */
  n: number;
  /** What was graded, e.g. "live calls" or "acted calls". */
  label?: string;
}

interface Props {
  /** One or two words on the method: "ML", "OLS", "NLP". */
  method: string;
  /** Live graded record, or null when none exists yet. Omit to hide the slot. */
  hitRate?: HitRate | null;
  /** Short extra qualifier, e.g. "in-sample R² 0.42". */
  note?: string;
  className?: string;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default function ModelledBadge({ method, hitRate, note, className = "" }: Props) {
  // Colour is deliberately the one hue no observed-data chrome uses — violet —
  // so the eye can pick out modelled panels while scrolling.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border border-violet-500/40 bg-violet-950/50
                  px-2 py-0.5 text-[11px] leading-4 text-violet-200 ${className}`}
      title="This panel's headline number is produced by a model, not observed from a market or a report."
    >
      <span className="font-bold uppercase tracking-widest">Modelled</span>
      <span className="text-violet-300/80">· {method}</span>
      {hitRate !== undefined && (
        hitRate && hitRate.n > 0 ? (
          <span className="text-violet-100">
            · hit rate <span className="font-mono font-semibold">{pct(hitRate.value)}</span>
            <span className="text-violet-300/70"> ({hitRate.n} {hitRate.label ?? "graded"})</span>
          </span>
        ) : (
          <span className="text-violet-300/70">· no live track record yet</span>
        )
      )}
      {note && <span className="text-violet-300/70">· {note}</span>}
    </span>
  );
}
