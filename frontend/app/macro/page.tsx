"use client";
import PageHeader from "@/components/PageHeader";
import CurrencyIndexSection from "@/components/macro/CurrencyIndexSection";
import FxTimeSeriesPanel from "@/components/macro/FxTimeSeriesPanel";
import CrossCommodityPanel from "@/components/macro/CrossCommodityPanel";
import FertilizerInputsPanel from "@/components/macro/FertilizerInputsPanel";
import FreightContextPanel from "@/components/macro/FreightContextPanel";
import InflationSection from "@/components/macro/InflationSection";
import TreasuryYieldsPanel from "@/components/macro/TreasuryYieldsPanel";

// Macro is the OBSERVED context: FX, inflation, rates, cross-commodity,
// fertilizer inputs and a freight summary — numbers measured from a market or
// a statistics office. The derived signals (ML direction call, OLS forecast,
// NLP sentiment) that were folded in here in August now live on /signals, so
// a reader can tell at the tab level which numbers were measured and which
// were predicted. Origin farmgate prices sit on /futures next to the chain.
export default function MacroPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Macro"
        subtitle="Observed context — FX, inflation, rates, cross-commodity, fertilizer inputs and freight"
        healthKeys={["macro_cot", "freight", "quant_currency_index", "us_cpi", "retail_cpi", "fx_history", "treasury_yields"]}
      />
      <div className="flex flex-col divide-y divide-slate-800">
        <CurrencyIndexSection />
        <FxTimeSeriesPanel />
        <CrossCommodityPanel />
        <InflationSection />
        <TreasuryYieldsPanel />
        <FertilizerInputsPanel />
        <FreightContextPanel />
      </div>
    </div>
  );
}
