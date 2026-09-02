"use client";
import PageHeader from "@/components/PageHeader";
import PriceDirectionSection from "@/components/signals/PriceDirectionSection";
import OpenDirectionCalendar from "@/components/signals/OpenDirectionCalendar";
import RobustaForecastSection from "@/components/signals/RobustaForecastSection";
import VietnamDiffSection from "@/components/signals/VietnamDiffSection";
import SentimentSection from "@/components/signals/SentimentSection";

// Signals is the MODELLED tab. Everything here is a model's output — a
// direction call, a regression, a classification — and each panel carries a
// ModelledBadge with its live track record where one exists.
//
// These sections were folded into Macro in August so "all the analytical
// reads live in one place". That produced the least coherent tab in the app:
// twelve stacked sections, a subtitle listing seven things, and the
// highest-risk content (ML, NLP) rendered in the same chrome as observed FX
// and CPI. Splitting it back is not tidiness — it is the observed-vs-modelled
// boundary made structural. Macro keeps what was measured; this keeps what was
// predicted.
export default function SignalsPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Signals"
        subtitle="Modelled output — ML direction calls, regression forecasts and NLP news sentiment, each with its track record"
        healthKeys={["open_direction", "news_sentiment", "macro_cot"]}
      />
      <div className="flex flex-col divide-y divide-slate-800">
        <PriceDirectionSection />
        <OpenDirectionCalendar />
        <RobustaForecastSection />
        <VietnamDiffSection />
        <SentimentSection />
      </div>
    </div>
  );
}
