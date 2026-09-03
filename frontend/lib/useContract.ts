"use client";
import { useUrlPref } from "@/lib/urlPref";
import { parseContract } from "@/lib/fnd";

const isContract = (v: string) => parseContract(v) !== null;

/**
 * The contract the reader is looking at, shared across tabs.
 *
 * Pick KCZ26 on Futures and it used to evaporate the moment you tapped COT or
 * Signals — every tab had its own notion of "the contract". This is one
 * `?c=KCZ26` that travels: in the URL so a link carries it, in localStorage
 * so it survives the tab change, normalised through parseContract so a typo
 * or a non-contract never reaches a consumer.
 */
export function useContract(): [string | null, (sym: string | null) => void] {
  const [v, set] = useUrlPref("c", "contract", isContract, "");
  return [v ? v.toUpperCase() : null, (s) => set(s ? s.toUpperCase() : "")];
}

/** "arabica" | "robusta" for a contract symbol, or null. */
export function contractMarket(sym: string | null): "arabica" | "robusta" | null {
  const c = sym ? parseContract(sym) : null;
  return c ? (c.product === "KC" ? "arabica" : "robusta") : null;
}
