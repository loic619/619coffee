"use client";
/**
 * Report wrappers for the Options report (Futures → Options).
 *
 * The tab's own OptionsOIPanel renders arabica LEFT / robusta RIGHT for every
 * section; here each briefing tick renders ONE section across both markets —
 * keeping the arabica/robusta pairing the site (and the briefing) treats as a
 * single visual, while giving each section its own card and note.
 */
import OptionsOIPanel from "@/components/futures/OptionsOIPanel";

export const OptionsTiles       = () => <OptionsOIPanel sections={["tiles"]} isReportMode />;
export const OptionsPositioning = () => <OptionsOIPanel sections={["positioning"]} isReportMode />;
export const OptionsGreeks      = () => <OptionsOIPanel sections={["greeks"]} isReportMode />;
export const OptionsExpiry      = () => <OptionsOIPanel sections={["expiry"]} isReportMode />;
export const OptionsVol         = () => <OptionsOIPanel sections={["vol"]} isReportMode />;
