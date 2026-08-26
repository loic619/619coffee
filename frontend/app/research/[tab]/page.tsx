import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ResearchView from "@/components/research/ResearchView";

// Top-level research categories.
const VALID_TABS = ["quant", "supply", "logistics", "exchange", "demand", "admin"] as const;
type Cat = typeof VALID_TABS[number];

// Old per-topic tab ids now redirect to the category that absorbed them, so
// existing deep links keep working. (supply / logistics / demand map to
// themselves and fall through to VALID_TABS.)
// One line per category. Previously every route showed the COT/intraweek
// subtitle, which was wrong on four of the five and became more obviously so
// once all five started rendering the same view.
const SUBTITLE: Record<Cat, string> = {
  quant:     "Positioning, signals and the models behind the market view",
  supply:    "Production, weather, agronomy and farmer economics",
  logistics: "Origin cost stacks, freight and destination in-store cost",
  exchange:  "Certified stocks, options, contract rules and the differential",
  demand:    "Consumption modelling, saturation ceilings and demand data",
  admin:     "How the platform feeds itself \u2014 scraper behaviour, cost and reliability",
};

const LEGACY_REDIRECT: Record<string, Cat> = {
  cot: "quant", signals: "quant", sentiment: "quant", futures: "quant", macro: "quant",
  weather: "supply", farmer: "supply", fertilizer: "supply", agronomy: "supply",
  destination: "logistics", freight: "logistics",
  certstocks: "exchange", parity: "exchange", contracts: "exchange", delivery: "exchange",
};

export default async function ResearchTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab: rawTab } = await params;
  const tab = rawTab.toLowerCase() as Cat;
  if (!VALID_TABS.includes(tab)) {
    const dest = LEGACY_REDIRECT[rawTab.toLowerCase()];
    if (dest) redirect(`/research/${dest}`);
    notFound();
  }
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Research" subtitle={SUBTITLE[tab]} />
      <div className="p-4 sm:p-6">
        <ResearchView initialTab={tab} />
      </div>
    </div>
  );
}
