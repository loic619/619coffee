"use client";
/**
 * Report wrappers for per-origin USDA PSD supply & demand balances.
 *
 * SupplyDemandBalance self-fetches /data/demand_stocks.json and keys on origin,
 * but the bare balance is only the USDA backbone. Both wrappers below pass the
 * SAME enrichment their Supply-tab sub-tab does — crop-year framing, realised
 * customs/Cecafé exports overriding PSD, and the multi-source production spread
 * — so a chart in the briefing can never disagree with the same chart on the
 * site. The admin `editOrigin` editor is deliberately NOT passed: it is a
 * write control, not report content.
 */
import { useEffect, useMemo, useState } from "react";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import type { BrazilProjection } from "@/components/supply/BrazilTab/types";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";

/** Shape of the multi-source balance sheet inside vn_farmer_economics.json —
 *  the USDA / MAE / ICO production spread the Supply tab feeds the balance. */
interface VnSeasonRow {
  season: string;
  forecast: boolean;
  production: { usda: number; mard: number; ico: number };
  production_final?: number;
  exports_ico: number;
  consumption: number;
}
interface VnBalanceSheet {
  seasons: VnSeasonRow[];
  sources?: { key: string; label: string; color: string }[];
}

export function BrazilSupplyDemand() {
  const [projection, setProjection] = useState<BrazilProjection | null>(null);
  const [balance, setBalance] = useState<BalanceSheetFile | null>(null);
  const [cecafe, setCecafe] = useState<{ date: string; total: number }[]>([]);

  useEffect(() => {
    fetch("/data/brazil_export_projection.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BrazilProjection | null) => d && setProjection(d))
      .catch(() => { /* non-fatal */ });
    fetch("/data/br_balance_sheet.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalance(d))
      .catch(() => { /* absent → spread block hides gracefully */ });
    fetch("/data/cecafe.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { series?: { date: string; total: number }[] } | null) => setCecafe(d?.series ?? []))
      .catch(() => { /* non-fatal */ });
  }, []);

  // Cecafé ships totals in 60-kg bags; the helper wants kbags.
  const realized = useMemo(
    () => buildRealizedExportsOverlay({
      monthly: cecafe.map((r) => ({ month: r.date, kbags: r.total / 1000 })),
      cropYearStartMonth: 4,           // Brazilian crop year runs Apr → Mar
      sourceLabel: "Cecafé",
    }),
    [cecafe],
  );

  return (
    <SupplyDemandBalance
      origin="brazil"
      label="Brazil"
      projection={projection}
      cropYearMonths="Apr–Mar"
      realizedExports={realized}
      multiSource={toMultiSource(balance)}
    />
  );
}

/**
 * Vietnam gets the SAME enrichment the Supply tab's Supply & Demand sub-tab
 * passes, so the briefing and the tab can't tell different stories: the
 * Oct–Sep crop-year framing, realised customs exports overriding USDA PSD on
 * the crops we actually have monthly data for, and the USDA / MAE / ICO
 * production spread (error bars on the production line, range cells in the
 * table, and the next crop's forecast row USDA doesn't carry yet).
 */
export function VietnamSupplyDemand() {
  const [monthly, setMonthly] = useState<{ month: string; kbags: number }[]>([]);
  const [balance, setBalance] = useState<VnBalanceSheet | null>(null);

  useEffect(() => {
    fetch("/data/vietnam_supply.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { exports?: { monthly?: { month: string; total_k_bags: number }[] } } | null) => {
        const rows = d?.exports?.monthly ?? [];
        setMonthly(rows.map((e) => ({ month: e.month, kbags: e.total_k_bags })));
      })
      .catch(() => { /* non-fatal — falls back to the bare USDA balance */ });
    fetch("/data/vn_farmer_economics.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balance_sheet?: VnBalanceSheet } | null) => {
        if (d?.balance_sheet) setBalance(d.balance_sheet);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  const realized = useMemo(
    () => buildRealizedExportsOverlay({
      monthly,
      cropYearStartMonth: 10,          // Vietnam crop year runs Oct → Sep
      sourceLabel: "Vietnam Customs",
    }),
    [monthly],
  );

  return (
    <SupplyDemandBalance
      origin="vietnam"
      label="Vietnam"
      cropYearMonths="Oct–Sep"
      realizedExports={realized}
      multiSource={balance ? {
        sources: balance.sources ?? [
          { key: "usda", label: "USDA", color: "#3b82f6" },
          // "MAE" since the 2025 ministry merger — the data key stays `mard`.
          { key: "mard", label: "MAE",  color: "#10b981" },
          { key: "ico",  label: "ICO",  color: "#f59e0b" },
        ],
        seasons: balance.seasons.map((s) => ({
          cropYear:   s.season,
          forecast:   s.forecast,
          production: s.production,
          final:      s.production_final,
          exports:    s.exports_ico,
        })),
      } : null}
    />
  );
}
