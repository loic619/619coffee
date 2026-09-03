"use client";
/**
 * The count of feeds with new data on a tab, sub-tab or section since the
 * reader last opened it. Renders nothing when there is nothing new, or when
 * the scope is the one being viewed (opening it is what clears it).
 */
import { useNewBadge } from "@/lib/notify";

export default function NewBadge({ scope, keys, active, tone = "amber", className = "" }: {
  scope: string; keys: string[]; active: boolean; tone?: "amber" | "slate"; className?: string;
}) {
  const { count, keys: fresh } = useNewBadge(scope, keys, active);
  if (!count) return null;
  const cls = tone === "amber"
    ? "bg-amber-500/20 text-amber-300 border-amber-600/50"
    : "bg-slate-700 text-slate-200 border-slate-600";
  return (
    <span
      title={`New since you last opened this: ${fresh.join(", ")}`}
      className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full border text-[9px] font-bold leading-none ${cls} ${className}`}
      aria-label={`${count} feeds updated since your last visit`}
    >
      {count}
    </span>
  );
}
