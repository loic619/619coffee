"use client";
import { Suspense, useState } from "react";
import AcapheLiveQuotes from "@/components/futures/AcapheLiveQuotes";
import OIFndChart from "@/components/futures/OIFndChart";
import OriginPricesPanel from "@/components/macro/OriginPricesPanel";
import B3CoffeePanel from "@/components/futures/B3CoffeePanel";
import BrazilArbitragePanel from "@/components/futures/BrazilArbitragePanel";
import OptionsOIPanel from "@/components/futures/OptionsOIPanel";
import TradedTapePanel from "@/components/futures/TradedTapePanel";
import PageHeader from "@/components/PageHeader";
import ChainTable from "@/components/futures/ChainTable";
import KcRcCentsPanel from "@/components/futures/KcRcCentsPanel";
import QuotationTab from "@/components/futures/QuotationTab";
import type { ChainData } from "@/components/futures/types";
import UnitToggle from "@/components/UnitToggle";
import { useFetchJson } from "@/lib/useFetchJson";
import { useUrlState } from "@/lib/useUrlState";
import NewBadge from "@/components/NewBadge";
import { FUTURES_TAB_FEEDS } from "@/lib/notify";

type FuturesTab = "price" | "options" | "quotation";
const FUTURES_TABS: FuturesTab[] = ["price", "options", "quotation"];

// The chain table, the KC/RC cents panel and the quotation build-up each live
// in components/futures/ now. This file is the page: tabs, data loading and
// layout — nothing else.

// ─── Page ─────────────────────────────────────────────────────────────────────

interface FuturesChainJson {
  arabica: ChainData | null;
  robusta: ChainData | null;
}

export default function FuturesPage() {
  return (
    <Suspense fallback={<div className="h-full bg-slate-950" />}>
      <FuturesPageInner />
    </Suspense>
  );
}

function FuturesPageInner() {
  const [tab, setTab] = useUrlState<FuturesTab>("tab", "price", (raw) =>
    (FUTURES_TABS as string[]).includes(raw) ? (raw as FuturesTab) : "price"
  );
  // Phone-only: reveal the Barchart Daily Quotes secondary columns (FND, Exp,
  // spreads, OI, Vol). On by default at lg+, so this toggle only matters on
  // phones where the compact 3-up hides them.
  const [showAllBarchart, setShowAllBarchart] = useState(false);

  // Static JSON, no backend needed. useFetchJson handles AbortController +
  // error states; on fetch failure we fall back to an empty chain so the
  // page still renders.
  const { data: chainData, error: chainError } =
    useFetchJson<FuturesChainJson>("/data/futures_chain.json");
  const chainJson: FuturesChainJson | null =
    chainError ? { arabica: null, robusta: null } : chainData;

  const { data: vnFaqData } =
    useFetchJson<{ vn_faq?: { usd_per_mt?: number } }>("/data/vn_physical_prices.json");
  const vnFaqUsdMt = vnFaqData?.vn_faq?.usd_per_mt ?? null;

  const arabicaChain = chainJson?.arabica ?? null;
  const robustaChain = chainJson?.robusta ?? null;
  const loading      = chainJson === null;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Futures"
        subtitle="ICE Arabica (KC) · ICE Robusta (RC) — chain, quotation, arbitrage & origin farmgate prices"
        healthKeys={["futures", "cot", "macro_cot", "origin_prices"]}
        rightSlot={<UnitToggle />}
      />
      <div className="p-6 space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-700 flex-wrap">
        {(["price", "options", "quotation"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t capitalize transition-colors ${
              tab === t
                ? "bg-slate-800 text-white border border-b-transparent border-slate-700 -mb-px"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
            <NewBadge scope={`futures:${t}`} keys={FUTURES_TAB_FEEDS[t] ?? []} active={tab === t} />
          </button>
        ))}
      </div>

      {/* Price tab — live + daily exchange quotes, OI rollover, and the
          origin farmgate-price overlay moved here from the Macro tab so
          futures and physical pricing sit on the same page. */}
      {tab === "price" && (
        <>
          {/* Live quotes — acaphe.com (run acaphe_poller.py locally for real-time updates) */}
          <AcapheLiveQuotes />

          {/* Daily quotes separator */}
          <div className="border-t border-slate-800 pt-4 flex items-center justify-between mb-3">
            <h2 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
              Daily Quotes · Barchart
            </h2>
            {/* Phone-only: reveal FND/Exp/spreads/OI/Vol (stacks the tables so
                each gets full width to scroll). Hidden at lg+ where all show. */}
            <button
              onClick={() => setShowAllBarchart(v => !v)}
              className="lg:hidden text-[10px] text-slate-300 hover:text-white flex items-center gap-1 border border-slate-600 rounded px-1.5 py-0.5"
              aria-expanded={showAllBarchart}
            >
              {showAllBarchart ? "Compact" : "Show all"}<span className="text-[8px]">{showAllBarchart ? "◀" : "▶"}</span>
            </button>
          </div>

          {loading && (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-800 rounded-lg" />
              ))}
            </div>
          )}

          {!loading && !robustaChain && !arabicaChain && (
            <p className="text-slate-500 text-sm italic">
              No futures data yet — check back after the next scrape run.
            </p>
          )}
          <div className={`grid gap-1.5 lg:gap-4 items-start ${showAllBarchart ? "grid-cols-1 lg:grid-cols-[1fr_auto_1fr]" : "grid-cols-[1fr_auto_1fr]"}`}>
            {arabicaChain && <ChainTable market="arabica" data={arabicaChain} showAll={showAllBarchart} />}
            {arabicaChain && robustaChain && (
              <KcRcCentsPanel
                arabica={arabicaChain.contracts}
                robusta={robustaChain.contracts}
              />
            )}
            {robustaChain && <ChainTable market="robusta" data={robustaChain} showAll={showAllBarchart} />}
          </div>
          {/* OI Evolution to FND — NY + LDN side-by-side; each chart shows
              OI buildup over the trading days leading into First Notice Day
              (operational view for roll timing) overlaid with the front
              calendar spread. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <h2 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">
              OI Evolution to FND
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OIFndChart market="arabica" />
              <OIFndChart market="robusta" />
            </div>
          </div>

          {/* Origin Farmgate Prices — moved from /macro so the physical
              side of the price story sits next to the futures chain. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <OriginPricesPanel />
          </div>

          {/* B3 (Brazil) coffee futures — domestic-exchange arabica (ICF) and
              conilon (CNL) curves below the international picture. */}
          {/* Traded tape — per-session order flow from acaphe's tick tape:
              lifted vs hit lots, VWAPs, and calendar-spread sizing. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <TradedTapePanel />
          </div>

          {/* Brazil's internal arabica/conilon arbitrage — the substitution
              spread that steers domestic blends and frees (or absorbs) conilon
              for export. Sits with the B3 domestic-exchange section. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <BrazilArbitragePanel />
          </div>

          <div className="border-t border-slate-800 pt-4 mt-4">
            <B3CoffeePanel />
          </div>
        </>
      )}

      {/* Options tab — per-strike OI / ΔOI / IV boards, ITM-into-expiry
          countdown and ATM-IV history for the nearest KC/RM option expiries
          (daily Barchart snapshot + boards archive). */}
      {tab === "options" && <OptionsOIPanel />}

      {/* Quotation tab */}
      {tab === "quotation" && (
        <QuotationTab
          contracts={robustaChain?.contracts ?? []}
          vnFaqUsdMt={vnFaqUsdMt}
        />
      )}

      </div>
    </div>
  );
}
