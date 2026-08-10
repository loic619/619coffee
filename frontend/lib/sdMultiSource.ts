// Shared schema for per-origin balance-sheet seed files
// (br_balance_sheet.json, id_balance_sheet.json, ug_balance_sheet.json).
// Each carries the multi-source production estimates the
// SupplyDemandBalance card surfaces via its `multiSource` prop —
// equation strip, range cells on the table, error bars on the
// production line, and the per-source spread block.
//
// The shape mirrors Vietnam's vn_farmer_economics.json `balance_sheet`
// (which predates these seeds) so a per-origin wrapper script can
// eventually consolidate them all.

import type { MultiSourceOverlay } from "@/components/supply/SupplyDemandBalance";

export interface BalanceSheetSeason {
  /** "YYYY/YY" — full 4+2 form, e.g. "2025/26". */
  season:   string;
  forecast: boolean;
  /** sourceKey → million 60-kg bags. Missing keys mean that source
   *  didn't publish a number for that crop. */
  production: Record<string, number>;
  /** Analyst override for the DISPLAYED production figure (million
   *  bags), set via the editor's "Final" row. Absent = show the avg. */
  production_final?: number;
  /** Optional — million 60-kg bags. Currently unused (the S&D card
   *  prefers customs-realised exports), kept on the type so the
   *  JSON can carry the field without loose-type warnings. */
  exports?:     number;
  /** Optional — million 60-kg bags. Currently unused (consumption
   *  flows from USDA PSD to match the Demand tab's chart). */
  consumption?: number;
}

export interface BalanceSheetFile {
  unit:    string;
  note:    string;
  updated: string;
  sources: { key: string; label: string; color: string }[];
  seasons: BalanceSheetSeason[];
}

/** Project a balance-sheet seed file into the `multiSource` shape
 *  SupplyDemandBalance expects. Returns null when the file is missing
 *  so caller can `multiSource={toMultiSource(file)}` safely. */
export function toMultiSource(file: BalanceSheetFile | null): MultiSourceOverlay | null {
  if (!file?.sources?.length || !file?.seasons?.length) return null;
  return {
    sources: file.sources,
    seasons: file.seasons.map(s => ({
      cropYear:   s.season,
      forecast:   s.forecast,
      production: s.production,
      final:      s.production_final,
      // Exports / consumption deliberately not forwarded — the card
      // pulls them from customs-realised + USDA PSD respectively, so
      // duplicating them via the balance sheet would just risk drift.
    })),
  };
}
