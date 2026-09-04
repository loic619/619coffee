"use client";
// Contents bar for a research article, read off its rendered headings.
//
// Sits above the article body in the list view. Scans the container for the
// article's own section headings, gives them ids, and offers two things: jump
// to a section, and collapse everything so the article becomes its own table of
// contents.
//
// It reads the DOM rather than the React tree on purpose — most of the 51
// articles render as a single component, so their headings are not children a
// wrapper could split. See lib/research/sections.ts.
import { useCallback, useEffect, useState } from "react";
import { sectionPlan, type PlannedSection } from "@/lib/research/sections";

/** Everything between one section heading and the next. */
function bodyOf(heading: HTMLElement, tag: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = heading.nextElementSibling;
  while (el && el.tagName.toLowerCase() !== tag) {
    out.push(el as HTMLElement);
    el = el.nextElementSibling;
  }
  return out;
}

export default function SectionNav({
  container, articleId,
}: { container: HTMLElement | null; articleId: string }) {
  const [sections, setSections] = useState<PlannedSection[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  // Re-scan when the article changes. A short delay lets data-driven articles
  // paint their headings first — several fetch their payload and render the
  // body only once it lands, so an immediate scan finds nothing.
  useEffect(() => {
    setClosed(new Set());
    setSections([]);
    setTag(null);
    if (!container) return;
    let alive = true;
    const cleanups: Array<() => void> = [];
    const scan = () => {
      if (!alive || !container) return;
      const found = Array.from(container.querySelectorAll("h2, h3, h4")) as HTMLElement[];
      const plan = sectionPlan(found.map(h => ({
        tag: h.tagName, text: h.textContent || "",
      })));
      if (!plan.tag || plan.sections.length < 2) return;
      plan.sections.forEach(s => {
        const h = found[s.index];
        h.id = s.id;
        // Make the heading itself the per-section toggle — that is where a
        // reader reaches for it, and it needs no extra chrome on the page.
        if (!h.querySelector("[data-caret]")) {
          const caret = document.createElement("span");
          caret.setAttribute("data-caret", "");
          caret.textContent = "▾";
          caret.style.cssText = "margin-right:.45rem;font-size:.7em;opacity:.55";
          h.insertBefore(caret, h.firstChild);
          h.style.cursor = "pointer";
          h.title = "Click to collapse or expand this section";
          h.addEventListener("click", () => {
            setClosed(prev => {
              const next = new Set(prev);
              if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
              return next;
            });
          });
          cleanups.push(() => {
            caret.remove();
            h.style.cursor = "";
            h.removeAttribute("title");
          });
        }
      });
      setTag(plan.tag);
      setSections(plan.sections);
    };
    scan();
    const t = window.setTimeout(scan, 600);
    return () => {
      alive = false;
      window.clearTimeout(t);
      cleanups.forEach(fn => fn());
    };
  }, [container, articleId]);

  const setHidden = useCallback((ids: Set<string>) => {
    if (!container || !tag) return;
    sections.forEach(s => {
      const h = container.querySelector(`#${CSS.escape(s.id)}`) as HTMLElement | null;
      if (!h) return;
      const hide = ids.has(s.id);
      // INLINE display, not the `hidden` attribute. `hidden` only sets
      // display:none from the UA stylesheet, so any element carrying a
      // Tailwind `grid` or `flex` class beats it and stays visible — which is
      // exactly what the calendar section did on the first attempt.
      bodyOf(h, tag).forEach(el => { el.style.display = hide ? "none" : ""; });
      const caret = h.querySelector("[data-caret]");
      if (caret) caret.textContent = hide ? "▸" : "▾";
    });
  }, [container, tag, sections]);

  useEffect(() => { setHidden(closed); }, [closed, setHidden]);

  if (sections.length < 2) return null;

  const allClosed = closed.size === sections.length;

  const jump = (id: string) => {
    // Open it first — scrolling to a collapsed heading lands the reader on a
    // title with nothing under it, which reads as a broken link.
    setClosed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    window.requestAnimationFrame(() => {
      const el = container?.querySelector(`#${CSS.escape(id)}`);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  return (
    <nav aria-label="Article sections"
      className="mb-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {sections.length} sections
        </span>
        <button type="button"
          onClick={() => setClosed(allClosed ? new Set() : new Set(sections.map(s => s.id)))}
          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200">
          {allClosed ? "Expand all" : "Collapse all"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {sections.map(s => (
          <button key={s.id} type="button" onClick={() => jump(s.id)}
            title={s.title}
            className="max-w-[22ch] truncate rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-300 transition hover:bg-slate-700 hover:text-slate-100">
            {s.title}
          </button>
        ))}
      </div>
    </nav>
  );
}
