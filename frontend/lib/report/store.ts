"use client";
/**
 * Report "cart" store — the Dynamic Briefing Engine's state layer.
 *
 * A single module-level Zustand store (no Context/Provider needed): because it
 * lives outside the React tree, the selection survives tab navigation, so a
 * future "📌 pin to report" button on any tab can call `add(id)` and the item
 * shows up in the News-tab builder. `persist` mirrors it to localStorage so a
 * refresh doesn't empty the cart.
 *
 *   selectedIds — ordered list of registry chart IDs in the report
 *   comments    — per-chart executive-summary text, keyed by chart ID
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ReportState {
  selectedIds: string[];
  comments: Record<string, string>;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  addMany: (ids: string[]) => void;
  removeMany: (ids: string[]) => void;
  setComment: (id: string, text: string) => void;
  /** Drop the user's override for a note so the auto-generated comment returns
   *  (a stored "" means "deliberately blank" and survives until reset). */
  resetComment: (id: string) => void;
  /** Replace the selection ORDER (same membership) — the canvas computes the
   *  new arrangement so it can reorder within a category group. Guarded: any
   *  id not already selected is ignored, and missing ones are appended, so a
   *  stale caller can never drop or duplicate a chart. */
  setOrder: (ids: string[]) => void;
  clear: () => void;
}

export const useReportStore = create<ReportState>()(
  persist(
    (set) => ({
      selectedIds: [],
      comments: {},
      toggle: (id) =>
        set((s) =>
          s.selectedIds.includes(id)
            ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
            : { selectedIds: [...s.selectedIds, id] },
        ),
      add: (id) =>
        set((s) => (s.selectedIds.includes(id) ? s : { selectedIds: [...s.selectedIds, id] })),
      remove: (id) =>
        set((s) => {
          // Drop the chart's notes too so removed charts leave none orphaned —
          // both the single note (keyed by id) and any split notes (`${id}__*`).
          const rest = Object.fromEntries(
            Object.entries(s.comments).filter(([k]) => k !== id && !k.startsWith(`${id}__`)),
          );
          return { selectedIds: s.selectedIds.filter((x) => x !== id), comments: rest };
        }),
      // Bulk variants used by the report-package presets — a single store write
      // (and one re-render) instead of looping add/remove per id.
      addMany: (ids) =>
        set((s) => {
          const have = new Set(s.selectedIds);
          const next = [...s.selectedIds];
          for (const id of ids) if (!have.has(id)) next.push(id);
          return { selectedIds: next };
        }),
      removeMany: (ids) =>
        set((s) => {
          const drop = new Set(ids);
          // Drop each removed chart's notes too (single + split `${id}__*`).
          const rest = Object.fromEntries(
            Object.entries(s.comments).filter(
              ([k]) => !ids.some((id) => k === id || k.startsWith(`${id}__`)),
            ),
          );
          return { selectedIds: s.selectedIds.filter((x) => !drop.has(x)), comments: rest };
        }),
      setComment: (id, text) => set((s) => ({ comments: { ...s.comments, [id]: text } })),
      setOrder: (ids) =>
        set((s) => {
          const have = new Set(s.selectedIds);
          const next = ids.filter((id) => have.has(id));
          const seen = new Set(next);
          for (const id of s.selectedIds) if (!seen.has(id)) next.push(id);
          return { selectedIds: next };
        }),
      resetComment: (id) =>
        set((s) => {
          const rest = { ...s.comments };
          delete rest[id];
          return { comments: rest };
        }),
      clear: () => set({ selectedIds: [], comments: {} }),
    }),
    { name: "coffee-intel-report-cart" },
  ),
);
