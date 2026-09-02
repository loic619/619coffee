"use client";
/**
 * /news — the Daily Brief, and the landing page.
 *
 * The daily job lives here: what changed since yesterday (FreshnessGrid), what
 * is publishing next (UpcomingCalendar), what could hurt (RiskRadar), what is
 * being said (HeadlinesDigest, OriginReportsPanel). The Report Builder is a
 * different kind of thing — a tool for assembling a briefing to send to a
 * customer — so it sits at the bottom, below the reading, rather than second
 * from the top where a low-frequency action was occupying the prime slot on a
 * page people open every morning.
 *
 * Six sections is a long scroll on a phone with no map of what is below, so
 * the strip under the header lists them as anchors. Each section degrades
 * gracefully when its data file is missing.
 */
import PageHeader from "@/components/PageHeader";
import FreshnessGrid from "@/components/news/FreshnessGrid";
import UpcomingCalendar from "@/components/news/UpcomingCalendar";
import RiskRadar from "@/components/news/RiskRadar";
import HeadlinesDigest from "@/components/news/HeadlinesDigest";
import OriginReportsPanel from "@/components/news/OriginReportsPanel";
import ReportBuilder from "@/components/report/ReportBuilder";

const SECTIONS = [
  { id: "changed",   label: "What changed" },
  { id: "upcoming",  label: "Coming up" },
  { id: "risk",      label: "Risk radar" },
  { id: "headlines", label: "Headlines" },
  { id: "origins",   label: "Origin reports" },
  { id: "builder",   label: "Report builder" },
] as const;

function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  // scroll-mt keeps the section title clear of the sticky nav after a jump.
  return <div id={id} className="scroll-mt-4">{children}</div>;
}

export default function NewsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PageHeader
        title="Daily Brief"
        subtitle="Today's coffee intel — what changed, what's coming, what's making news"
        healthKeys={["futures", "cot", "ice_certified_daily", "news_sentiment"]}
      />
      <nav
        aria-label="Sections"
        className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4"
      >
        <div className="max-w-7xl mx-auto flex gap-1 overflow-x-auto scrollbar-thin py-1.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded px-2.5 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 whitespace-nowrap"
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Anchor id="changed"><FreshnessGrid /></Anchor>
        <Anchor id="upcoming"><UpcomingCalendar /></Anchor>
        <Anchor id="risk"><RiskRadar /></Anchor>
        <Anchor id="headlines"><HeadlinesDigest /></Anchor>
        <Anchor id="origins"><OriginReportsPanel /></Anchor>
        <Anchor id="builder"><ReportBuilder /></Anchor>
      </div>
    </div>
  );
}
