"use client";
/**
 * /news — the daily-newspaper landing page.
 *
 * Three sections, top-to-bottom:
 *   1. FreshnessGrid     — what changed since yesterday, by category
 *   2. UpcomingCalendar  — what's publishing in the next 30 days
 *   3. HeadlinesDigest   — recent stories from /data/news.json, grouped
 *
 * Each is independent and degrades gracefully when its data file is
 * missing. The page is plain composition over existing primitives.
 */
import PageHeader from "@/components/PageHeader";
import FreshnessGrid from "@/components/news/FreshnessGrid";
import UpcomingCalendar from "@/components/news/UpcomingCalendar";
import RiskRadar from "@/components/news/RiskRadar";
import HeadlinesDigest from "@/components/news/HeadlinesDigest";
import OriginReportsPanel from "@/components/news/OriginReportsPanel";
import ReportBuilder from "@/components/report/ReportBuilder";

export default function NewsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PageHeader
        title="Daily Brief"
        subtitle="Today's coffee intel — what changed, what's coming, what's making news"
      />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <FreshnessGrid />
        <ReportBuilder />
        <UpcomingCalendar />
        <RiskRadar />
        <HeadlinesDigest />
        <OriginReportsPanel />
      </div>
    </div>
  );
}
