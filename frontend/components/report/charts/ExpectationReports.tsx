"use client";
// Report wrappers for the mid-month expectation vs actual panel (self-fetching).
import ExpectedVsActual from "@/components/supply/ExpectedVsActual";

export function BrazilExpectedVsActual({ isReportMode = true }: { isReportMode?: boolean }) {
  return <ExpectedVsActual origin="brazil" isReportMode={isReportMode} />;
}

export function VietnamExpectedVsActual({ isReportMode = true }: { isReportMode?: boolean }) {
  return <ExpectedVsActual origin="vietnam" isReportMode={isReportMode} />;
}
