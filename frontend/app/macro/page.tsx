"use client";
import PageHeader from "@/components/PageHeader";
import CurrencyIndexSection from "@/components/macro/CurrencyIndexSection";
import FxTimeSeriesPanel from "@/components/macro/FxTimeSeriesPanel";
import CrossCommodityPanel from "@/components/macro/CrossCommodityPanel";
import FertilizerInputsPanel from "@/components/macro/FertilizerInputsPanel";
import FreightContextPanel from "@/components/macro/FreightContextPanel";
import InflationSection from "@/components/macro/InflationSection";
import TreasuryYieldsPanel from "@/components/macro/TreasuryYieldsPanel";
import PriceDirectionSection from "@/components/signals/PriceDirectionSection";
import OpenDirectionCalendar from "@/components/signals/OpenDirectionCalendar";
import RobustaForecastSection from "@/components/signals/RobustaForecastSection";
import VietnamDiffSection from "@/components/signals/VietnamDiffSection";
import SentimentSection from "@/components/signals/SentimentSection";

// Origin Farmgate Prices was moved to /futures (Price tab) — physical pricing
// now sits next to the futures chain. The derived signals & forecasts (ML
// price-direction, robusta regression, Vietnam differential and the news
// sentiment / calibration block) were folded in here from the former standalone
// Signals tab, so all the analytical/macro reads live in one place.
export default function MacroPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Macro"
        subtitle="FX · inflation · cross-commodity · freight · derived signals · NLP news sentiment"
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
        {/* Derived signals & forecasts (formerly the standalone Signals tab). */}
        <PriceDirectionSection />
        <OpenDirectionCalendar />
        <RobustaForecastSection />
        <VietnamDiffSection />
        <SentimentSection />
      </div>
    </div>
  );
}
