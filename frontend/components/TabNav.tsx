"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { tierAllowsTab, TIER_VIEW_COOKIE, type Tier } from "@/lib/gate";

// Labels are the page titles, verbatim. The nav is a horizontally-scrolling
// strip on a phone: when the word you tapped is not the word you land on, you
// lose the thread. "Daily Brief" is what the page is, so the nav says so.
const TABS = [
  { href: "/news",    label: "Daily Brief" },
  { href: "/futures", label: "Futures" },
  { href: "/cot",     label: "COT" },
  { href: "/freight", label: "Freight" },
  { href: "/supply",  label: "Supply" },
  { href: "/demand",  label: "Demand" },
  { href: "/macro",   label: "Macro" },
  { href: "/map",     label: "Map" },
  // Research is for `user` (members) and up; Data Map is admin-only. The tier
  // filter below hides what a tier may not open (lib/gate.ts pathAllowed) and
  // the middleware refuses the route outright, so nothing here is enforcement.
  { href: "/research", label: "Research" },
  { href: "/data-map", label: "Data Map", adminOnly: true },
];

/** Read the cosmetic tier cookie (`tierv`). Enforcement lives in the
 *  middleware (signed `tid` cookie) — this only trims the visible tabs. */
function readTier(): Tier | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${TIER_VIEW_COOKIE}=([^;]+)`));
  const v = m ? decodeURIComponent(m[1]) : "";
  return v === "admin" || v === "user" || v === "basic" ? v : null;
}

export default function TabNav() {
  const pathname = usePathname();
  // Cookie is only readable client-side; render the full band on the server
  // pass and trim after mount (middleware blocks any early click anyway).
  const [tier, setTier] = useState<Tier | null>(null);
  useEffect(() => setTier(readTier()), [pathname]);

  // The login gate is a standalone page — no app chrome.
  if (pathname === "/welcome") return null;

  // `tierAllowsTab` renders everything while the tier is unknown (the cookie is
  // client-only, so the server pass has nothing to go on) and lets the
  // middleware do the enforcing. That default is right for the ordinary tabs —
  // but an admin-only tab would flash for a `basic` visitor before the trim,
  // advertising a surface they can't reach. Data Map waits for a confirmed
  // admin instead: unknown means hidden, and the owner sees it a tick later.
  // Research is gated the ordinary way — members may open it.
  const tabs = TABS.filter((t) =>
    t.adminOnly ? tier === "admin" : tierAllowsTab(tier, t.href));
  return (
    <nav className="relative border-b border-slate-700 bg-slate-900">
      <div className="flex overflow-x-auto px-4 scrollbar-thin">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                active
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 h-full w-6 bg-gradient-to-l from-slate-900 to-transparent lg:hidden" />
    </nav>
  );
}
