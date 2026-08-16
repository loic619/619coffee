"use client";
/**
 * FocusableChart — a drop-in replacement for Recharts' ResponsiveContainer that
 * adds a "focus view": every chart gets a small ⤢ control in its top-right
 * corner which reopens the same chart full-screen, where a dense series is
 * actually readable (especially on a phone).
 *
 * Why a swapped import rather than a wrapper at each call site: there are ~140
 * charts across ~90 files. Re-wrapping each one by hand would be ~90 chances to
 * break a layout; changing which module ResponsiveContainer is imported from is
 * a single mechanical edit per file, and the chart JSX is untouched.
 *
 *     -import { LineChart, ResponsiveContainer } from "recharts";
 *     +import { LineChart } from "recharts";
 *     +import { ResponsiveContainer } from "@/components/ui/FocusableChart";
 *
 * The focused copy is a SECOND render of the same `children` element, not a
 * moved DOM node — charts are pure functions of their props, so this stays
 * within React rather than fighting it.
 */
import {
  useCallback, useEffect, useRef, useState,
  type ComponentProps, type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { ResponsiveContainer as RechartsContainer } from "recharts";

type Props = ComponentProps<typeof RechartsContainer> & {
  /** Heading for the focus view; falls back to a generic label. */
  focusTitle?: string;
};

export function ResponsiveContainer({ children, focusTitle, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();   // return focus where it came from
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    // Freeze the page behind the overlay so a scroll gesture on a phone acts
    // on the focused chart, not the page under it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  // Recharts defaults height to "100%". Only mirror that on the wrapper when
  // the chart itself fills its parent — a pixel height must stay content-sized
  // or the extra element would collapse inside an auto-height parent.
  const fills = (props.height ?? "100%") === "100%";

  return (
    <div style={{ position: "relative", width: "100%", height: fills ? "100%" : undefined }}>
      <RechartsContainer {...props}>{children as ReactElement}</RechartsContainer>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={focusTitle ? `Expand ${focusTitle}` : "Expand chart"}
        title="Expand"
        // print:hidden — the report builder prints these same charts to PDF and
        // the control must not appear in the export.
        className="print:hidden absolute top-0 right-0 z-10 rounded border border-slate-600/60
                   bg-slate-900/75 px-1.5 py-0.5 text-[10px] leading-none text-slate-400
                   opacity-50 transition hover:opacity-100 hover:text-white hover:border-slate-400
                   focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        ⤢
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={focusTitle ?? "Chart focus view"}
          onClick={close}
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/85
                     p-2 sm:p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[1500px] flex-col rounded-lg border
                       border-slate-700 bg-slate-900 p-3 shadow-2xl sm:p-5"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="truncate text-[11px] font-semibold text-slate-300 sm:text-sm">
                {focusTitle ?? "Focus view"}
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close focus view"
                className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300
                           transition hover:border-slate-400 hover:text-white focus:outline-none
                           focus:ring-1 focus:ring-sky-500"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <RechartsContainer width="100%" height="100%">
                {children as ReactElement}
              </RechartsContainer>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default ResponsiveContainer;
