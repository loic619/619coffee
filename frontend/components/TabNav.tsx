"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { tierAllowsTab, TIER_VIEW_COOKIE, type Tier } from "@/lib/gate";

const TABS = [
  { href: "/news",    label: "News" },
  { href: "/futures", label: "Futures Exchange" },
  { href: "/cot",     label: "COT" },
  { href: "/freight", label: "Freight" },
  { href: "/supply",  label: "Supply" },
  { href: "/demand",  label: "Demand" },
  { href: "/macro",   label: "Macro" },
  { href: "/map",     label: "Map" },
  // Hidden from the tab band (still reachable by direct URL, admin tier only):
  //   { href: "/data-map", label: "Data Map" },
  //   { href: "/research", label: "Research" },
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

  const tabs = TABS.filter((t) => tierAllowsTab(tier, t.href));
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
