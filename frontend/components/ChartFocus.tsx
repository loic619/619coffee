"use client";
import { ReactNode, useEffect, useState } from "react";

// Generic chart focus mode: wraps any chart container, adds an expand button
// (top-right) that re-renders the same children in a full-screen overlay.
// Charts built on Recharts' ResponsiveContainer redraw at the larger size
// automatically, so any card chart becomes focusable by swapping its fixed
// height <div> for <ChartFocus height="h-64" title="...">.
export default function ChartFocus({ title, height, children }: {
  title: string; height: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div className={`relative ${height}`}>
        <button
          aria-label="Focus chart"
          title="Focus chart"
          onClick={() => setOpen(true)}
          className="absolute -top-1 right-0 z-10 text-slate-600 hover:text-slate-200 text-[13px] leading-none p-1"
        >
          ⛶
        </button>
        {children}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 p-2 sm:p-6 flex flex-col"
          onClick={() => setOpen(false)}
        >
          <div className="flex items-center justify-between mb-2 shrink-0"
            onClick={e => e.stopPropagation()}>
            <div className="text-[11px] sm:text-xs text-slate-300 uppercase tracking-wide pr-2">
              {title}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-300 hover:text-white text-[11px] border border-slate-600 rounded px-2 py-1"
            >
              ✕ close
            </button>
          </div>
          <div
            className="flex-1 min-h-0 bg-slate-900 border border-slate-700 rounded-lg p-2 sm:p-4"
            onClick={e => e.stopPropagation()}
          >
            {children}
          </div>
        </div>
      )}
    </>
  );
}
