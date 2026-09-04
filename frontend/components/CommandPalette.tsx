"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * ⌘K / Ctrl-K — go anywhere by typing.
 *
 * Nine tabs, two Supply selectors, seven Demand sub-tabs, three Futures
 * sub-tabs and six Research categories is a lot of navigation for a desk user
 * who knows exactly where they want to go. Every destination here is already
 * URL state, so this is a routing table and a keybinding — no dependency.
 * Type "cert" → Demand · Certified stocks. Arrows move, Enter goes, Esc closes.
 */
interface Dest { label: string; href: string; keys?: string; }

const DESTS: Dest[] = [
  { label: "Daily Brief", href: "/news", keys: "news home today changed" },
  { label: "Daily Brief · Report builder", href: "/news#builder", keys: "pdf briefing export customer" },
  { label: "Futures · Price", href: "/futures?tab=price", keys: "chain kc rc arabica robusta settle fnd" },
  { label: "Futures · Options", href: "/futures?tab=options", keys: "oi open interest strikes" },
  { label: "Futures · Quotation", href: "/futures?tab=quotation", keys: "differential basis pricelist grade" },
  { label: "COT", href: "/cot", keys: "cftc positioning commercials managed money" },
  { label: "Freight", href: "/freight", keys: "fbx container dry bulk bdry lanes" },
  { label: "Supply · Brazil", href: "/supply?origin=brazil", keys: "cecafe conab safra" },
  { label: "Supply · Vietnam", href: "/supply?origin=vietnam", keys: "customs dak lak" },
  { label: "Supply · Colombia", href: "/supply?origin=colombia", keys: "fnc dane" },
  { label: "Supply · Indonesia", href: "/supply?origin=indonesia" },
  { label: "Supply · Ethiopia", href: "/supply?origin=ethiopia" },
  { label: "Supply · Honduras", href: "/supply?origin=honduras" },
  { label: "Supply · Uganda", href: "/supply?origin=uganda", keys: "ucda" },
  { label: "Supply · All origins", href: "/supply?origin=total", keys: "exports total" },
  { label: "Supply · S&D balance", href: "/supply?origin=sd", keys: "balance sheet world production consumption" },
  { label: "Supply · ENSO", href: "/supply?origin=enso", keys: "el nino la nina oni" },
  { label: "Supply · Fertilizers", href: "/supply?origin=fertilizers", keys: "urea comex" },
  { label: "Demand · Certified stocks", href: "/demand?tab=certified", keys: "ice warehouse antwerp grading" },
  { label: "Demand · Destination stocks", href: "/demand?tab=destination", keys: "ecf ajca ports europe japan" },
  { label: "Demand · Spot", href: "/demand?tab=spot", keys: "offers differentials" },
  { label: "Demand · Consumption", href: "/demand?tab=demand", keys: "psd ico world" },
  { label: "Demand · Imports", href: "/demand?tab=imports", keys: "eu us customs" },
  { label: "Demand · Earnings", href: "/demand?tab=earnings", keys: "roasters results" },
  { label: "Demand · Listed stocks", href: "/demand?tab=listed", keys: "equities shares" },
  { label: "Macro", href: "/macro", keys: "fx inflation cpi rates cross commodity currency index" },
  { label: "Signals", href: "/signals", keys: "model forecast direction sentiment nlp" },
  { label: "Map", href: "/map", keys: "origins ports factories" },
  { label: "Research · Quant & positioning", href: "/research/quant" },
  { label: "Research · Supply", href: "/research/supply" },
  { label: "Research · Logistics", href: "/research/logistics" },
  { label: "Research · Exchange & certified stocks", href: "/research/exchange" },
  { label: "Research · Demand", href: "/research/demand" },
  { label: "Data Map", href: "/data-map", keys: "admin workflows pipeline architecture" },
  { label: "Data Map · Pipelines", href: "/data-map?tab=pipelines", keys: "diagram flow source json visual mermaid" },
  { label: "Data Map · Workflows", href: "/data-map?tab=workflows", keys: "cadence cron transport resiliency drift inventory yaml" },
  { label: "Data Map · Activity", href: "/data-map?tab=activity", keys: "runs last 7 days failures duration" },
  { label: "Data Map · Downloads", href: "/data-map?tab=downloads", keys: "csv export dataset" },
];

function score(d: Dest, q: string): number {
  const hay = `${d.label} ${d.keys ?? ""}`.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  let s = 0;
  for (const t of terms) {
    if (!hay.includes(t)) return 0;
    s += d.label.toLowerCase().startsWith(t) ? 3 : d.label.toLowerCase().includes(t) ? 2 : 1;
  }
  return s;
}

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const results = useMemo(
    () => DESTS.map((d) => ({ d, s: score(d, q) })).filter((r) => r.s > 0)
              .sort((a, b) => b.s - a.s).slice(0, 12).map((r) => r.d),
    [q],
  );

  if (pathname === "/welcome" || !open) return null;

  const go = (d: Dest) => { setOpen(false); router.push(d.href); };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 flex items-start justify-center pt-[12vh] px-4"
         onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Go to">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && results[idx]) go(results[idx]);
          }}
          placeholder="Go to… (type a tab, an origin, a sub-tab)"
          className="w-full bg-transparent px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none border-b border-slate-800"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-3 text-xs text-slate-500">Nothing matches.</li>
          )}
          {results.map((d, i) => (
            <li key={d.href}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(d)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between ${
                  i === idx ? "bg-slate-800 text-white" : "text-slate-300"
                }`}
              >
                <span>{d.label}</span>
                <span className="text-[11px] font-mono text-slate-500">{d.href}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500 flex gap-4">
          <span>↑↓ move</span><span>↵ go</span><span>esc close</span><span className="ml-auto">⌘K / Ctrl-K</span>
        </div>
      </div>
    </div>
  );
}
