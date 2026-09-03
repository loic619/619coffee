"use client";
import { useUrlPref } from "@/lib/urlPref";
import type { PriceUnit } from "@/lib/units";

const isUnit = (v: string) => v === "cents_lb" || v === "usd_mt";

/**
 * The display unit, shared across tabs: URL (`?u=usd_mt`) first so a link
 * carries the basis it was read in, then the browser's remembered choice,
 * then ¢/lb — the KC convention and what the ticker prints.
 */
export function usePriceUnit(): [PriceUnit, (u: PriceUnit) => void] {
  const [v, set] = useUrlPref("u", "price_unit", isUnit, "cents_lb");
  return [v as PriceUnit, set];
}
