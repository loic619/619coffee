"use client";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import PageHeader from "@/components/PageHeader";
import { useUrlState } from "@/lib/useUrlState";
import NewBadge from "@/components/NewBadge";
import { SUPPLY_FEEDS } from "@/lib/notify";

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

/**
 * Two selectors, not one row of eleven pills.
 *
 * Eleven pills wrapped to three rows on a phone before any content appeared,
 * and they listed origins and cross-cutting views (Total, Fertilizers, ENSO,
 * S&D) as if they were the same kind of thing. Origins are ordered by export
 * volume — the list reads as a hierarchy — and `depth` states how much each
 * tab actually holds, because a flat row promised a parity the content does
 * not deliver: Brazil has a dozen panels, Indonesia has one.
 */
type Depth = "deep" | "standard" | "light";

const ORIGINS = [
  { id: "brazil",    label: "Brazil",    depth: "deep"     as Depth },
  { id: "vietnam",   label: "Vietnam",   depth: "standard" as Depth },
  { id: "colombia",  label: "Colombia",  depth: "standard" as Depth },
  { id: "indonesia", label: "Indonesia", depth: "light"    as Depth },
  { id: "ethiopia",  label: "Ethiopia",  depth: "standard" as Depth },
  { id: "honduras",  label: "Honduras",  depth: "standard" as Depth },
  { id: "uganda",    label: "Uganda",    depth: "deep"     as Depth },
] as const;

const CROSS = [
  { id: "total",       label: "All origins",  depth: "standard" as Depth },
  { id: "sd",          label: "S&D balance",  depth: "deep"     as Depth },
  { id: "enso",        label: "ENSO",         depth: "standard" as Depth },
  { id: "fertilizers", label: "Fertilizers",  depth: "deep"     as Depth },
] as const;

type TabId = typeof ORIGINS[number]["id"] | typeof CROSS[number]["id"];
const VALID_TAB_IDS: readonly string[] = [...ORIGINS, ...CROSS].map(t => t.id);

const DEPTH_DOT: Record<Depth, { cls: string; title: string }> = {
  deep:     { cls: "bg-emerald-400",  title: "Deep coverage — several panels and history" },
  standard: { cls: "bg-slate-400",    title: "Standard coverage — exports plus one or two views" },
  light:    { cls: "bg-slate-600",    title: "Light coverage — a single panel so far" },
};

function Pill({ id, label, depth, active, onClick, accent }: {
  id: string; label: string; depth: Depth; active: boolean; onClick: () => void; accent?: string;
}) {
  const d = DEPTH_DOT[depth];
  return (
    <button
      key={id}
      onClick={onClick}
      title={d.title}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        active ? (accent ?? "bg-slate-700 text-slate-100") : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
      }`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${d.cls}`} aria-hidden />
      {label}
      <NewBadge scope={`supply:${id}`} keys={SUPPLY_FEEDS[id] ?? []} active={active} />
    </button>
  );
}

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
        title="Supply"
        subtitle="Production, exports and growing conditions by origin — plus fertilizer, ENSO and the global S&D"
        healthKeys={["brazil_exports", "vietnam_exports", "colombia_exports", "weather", "enso", "fertilizer_wb", "fertilizer_comex"]}
      />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 flex-wrap">
            <span className="px-2 text-[11px] uppercase tracking-wider text-slate-500 select-none">Origin</span>
            {ORIGINS.map(t => (
              <Pill key={t.id} id={t.id} label={t.label} depth={t.depth}
                    active={tab === t.id} onClick={() => setTab(t.id)} />
            ))}
          </div>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 flex-wrap">
            <span className="px-2 text-[11px] uppercase tracking-wider text-slate-500 select-none">Across origins</span>
            {CROSS.map(t => (
              <Pill key={t.id} id={t.id} label={t.label} depth={t.depth}
                    active={tab === t.id} onClick={() => setTab(t.id)}
                    accent={t.id === "fertilizers" ? "bg-emerald-800 text-emerald-100" : undefined} />
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-600 -mt-3">
          Dot = depth of coverage: <span className="text-emerald-400">●</span> deep ·
          <span className="text-slate-400"> ●</span> standard ·
          <span className="text-slate-600"> ●</span> light. Origins in export-volume order.
        </p>

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
