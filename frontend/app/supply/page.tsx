"use client";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import PageHeader from "@/components/PageHeader";
import { useUrlState } from "@/lib/useUrlState";

const BrazilTab      = dynamic(() => import("@/components/supply/BrazilTab"),      { ssr: false });
const VietnamTab     = dynamic(() => import("@/components/supply/VietnamTab"),     { ssr: false });
const FertilizersTab = dynamic(() => import("@/components/supply/FertilizersTab"), { ssr: false });
const ColombiaTab    = dynamic(() => import("@/components/supply/ColombiaTab"),    { ssr: false });
const HondurasTab    = dynamic(() => import("@/components/supply/HondurasTab"),    { ssr: false });
const IndonesiaTab   = dynamic(() => import("@/components/supply/IndonesiaTab"),   { ssr: false });
const UgandaTab      = dynamic(() => import("@/components/supply/UgandaTab"),      { ssr: false });
const EthiopiaTab    = dynamic(() => import("@/components/supply/EthiopiaTab"),    { ssr: false });
const TotalExportsTab = dynamic(() => import("@/components/supply/TotalExportsTab"), { ssr: false });
const SupplyEnsoTab  = dynamic(() => import("@/components/supply/SupplyEnsoTab"),  { ssr: false });
const SupplySDTab    = dynamic(() => import("@/components/supply/SupplySDTab"),    { ssr: false });

const TABS = [
  { id: "brazil",       label: "Brazil",       available: true  },
  { id: "colombia",     label: "Colombia",     available: true  },
  { id: "honduras",     label: "Honduras",     available: true  },
  { id: "ethiopia",     label: "Ethiopia",     available: true  },
  { id: "vietnam",      label: "Vietnam",      available: true  },
  { id: "indonesia",    label: "Indonesia",    available: true  },
  { id: "uganda",       label: "Uganda",       available: true  },
  { id: "total",        label: "Total",        available: true  },
  { id: "fertilizers",  label: "Fertilizers",  available: true  },
  { id: "enso",         label: "ENSO",         available: true  },
  { id: "sd",           label: "S&D",          available: true  },
] as const;

type TabId = typeof TABS[number]["id"];

const VALID_TAB_IDS = TABS.map(t => t.id) as readonly string[];

export default function SupplyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <SupplyPageInner />
    </Suspense>
  );
}

function SupplyPageInner() {
  const [tab, setTab] = useUrlState<TabId>("origin", "brazil", (raw) =>
    (VALID_TAB_IDS.includes(raw) ? raw : "brazil") as TabId
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PageHeader
        title="Supply Intelligence"
        subtitle="Production & export data by origin country"
        healthKeys={["weather", "enso", "fertilizer_wb", "fertilizer_comex", "freight"]}
      />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* Sub-tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => t.available && setTab(t.id)}
              disabled={!t.available}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === t.id
                  ? t.id === "fertilizers"
                    ? "bg-emerald-800 text-emerald-100"
                    : "bg-slate-700 text-slate-100"
                  : t.available
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  : "text-slate-600 cursor-not-allowed"
              }`}
            >
              {t.label}
              {!t.available && (
                <span className="ml-1 text-[8px] text-slate-600 align-middle">soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "brazil"      && <BrazilTab />}
        {tab === "vietnam"     && <VietnamTab />}
        {tab === "fertilizers" && <FertilizersTab />}
        {tab === "colombia"    && <ColombiaTab />}
        {tab === "honduras"    && <HondurasTab />}
        {tab === "indonesia"   && <IndonesiaTab />}
        {tab === "uganda"      && <UgandaTab />}
        {tab === "total"       && <TotalExportsTab />}
        {tab === "ethiopia"    && <EthiopiaTab />}
        {tab === "enso"        && <SupplyEnsoTab />}
        {tab === "sd"          && <SupplySDTab />}
      </div>
    </div>
  );
}
