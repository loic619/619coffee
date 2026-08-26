"use client";
import { Suspense } from "react";
import dynamic from "next/dynamic";

import NewsFeedList from "@/components/NewsFeedList";
import AgeCohortPanel from "@/components/demand/AgeCohortPanel";
import AjcaPanel from "@/components/demand/AjcaPanel";
// Code-split the certified-stocks panel: it's a ~2,460-line component that eagerly
// parses ~2.7 MB of JSON, so a static import bloated the whole demand bundle even
// on tabs that never open it. Load it only when the Certified tab renders.
const CertifiedStocksPanel = dynamic(
  () => import("@/components/demand/CertifiedStocksPanel"),
  { ssr: false, loading: () => (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 animate-pulse h-64" />
    ) },
);
import GrowthMarketsPanel from "@/components/demand/GrowthMarketsPanel";
import RoasterEarningsPanel from "@/components/demand/RoasterEarningsPanel";
import ArrivalsVsStockChange from "@/components/demand/ArrivalsVsStockChange";
import EarningsTable from "@/components/demand/EarningsTable";
import ImportsStory from "@/components/demand/ImportsStory";
import KaffeesteuerChart from "@/components/demand/KaffeesteuerChart";
import KaffeesteuerReexport from "@/components/demand/KaffeesteuerReexport";
import RoastingMixPanel from "@/components/demand/RoastingMixPanel";
import SpotPanel from "@/components/demand/SpotPanel";
import StocksPanel from "@/components/demand/StocksPanel";
import WorldConsumptionWidget from "@/components/demand/WorldConsumptionWidget";
import PageHeader from "@/components/PageHeader";
import { useUrlState } from "@/lib/useUrlState";

type SubTab = "certified" | "destination" | "spot" | "demand" | "imports" | "earnings" | "listed";

const TABS: { id: SubTab; label: string }[] = [
  { id: "certified",   label: "Certified stocks" },
  { id: "destination", label: "Destination stocks" },
  { id: "spot",        label: "Spot" },
  { id: "demand",      label: "Consumption" },
  { id: "imports",     label: "Imports" },
  { id: "earnings",    label: "Earnings" },
  { id: "listed",      label: "Listed stocks" },
];
const SUB_TABS = TABS.map((t) => t.id) as SubTab[];

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-slate-700 bg-slate-950">{children}</div>;
}

export default function DemandPage() {
  // useUrlState reads `useSearchParams`, which Next 14 requires to live
  // under a Suspense boundary during static prerender (see /futures).
  return (
    <Suspense fallback={<div className="h-full bg-slate-950" />}>
      <DemandPageInner />
    </Suspense>
  );
}

function DemandPageInner() {
  // Deep-linkable sub-tab via `?tab=certified` — bookmarks, share-links,
  // and the browser back button all behave correctly.
  const [tab, setTab] = useUrlState<SubTab>("tab", "certified", (raw) =>
    (SUB_TABS as string[]).includes(raw) ? (raw as SubTab) : "certified",
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Demand"
        subtitle="Certified stocks · Destination stocks · Spot offers · Consumption · Listed companies"
        healthKeys={["ecf", "psd_coffee", "ajca", "population"]}
      />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 flex-wrap px-4 py-2 border-b border-slate-700 bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-slate-800 text-amber-400 border border-slate-700"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Per-sub-tab content. Existing panels move under their tab, no panel
          renders on more than one tab. NewsFeedList stays as a persistent
          footer across all sub-tabs (demand-relevant news is general). */}
      {tab === "certified" && (
        <Section>
          <CertifiedStocksPanel />
        </Section>
      )}

      {tab === "destination" && (
        <>
          <Section><StocksPanel /></Section>
          {/* AJCA (Japan) lives at the bottom of Destination stocks */}
          <Section><AjcaPanel /></Section>
        </>
      )}

      {tab === "spot" && (
        <Section>
          <SpotPanel />
        </Section>
      )}

      {tab === "demand" && (
        <>
          <Section><WorldConsumptionWidget /></Section>
          <Section><GrowthMarketsPanel /></Section>
          <Section><AgeCohortPanel /></Section>
          <Section><RoastingMixPanel /></Section>
          <Section><KaffeesteuerChart /></Section>
          {/* Cross-check: is the tax rise real demand or roasting-for-re-export? */}
          <Section><KaffeesteuerReexport /></Section>
        </>
      )}

      {/* Imports — funnel storyline (see ImportsStory.tsx). */}
      {tab === "imports" && (
        <Section>
          <ImportsStory />
          <ArrivalsVsStockChange />
        </Section>
      )}

      {tab === "earnings" && (
        <Section>
          <RoasterEarningsPanel />
        </Section>
      )}

      {tab === "listed" && (
        <Section>
          <EarningsTable />
        </Section>
      )}

      <div className="flex-1 overflow-hidden">
        <NewsFeedList title="Demand News" category="demand" />
      </div>
    </div>
  );
}
