"use client";
import { usePriceUnit } from "@/lib/usePriceUnit";
import { UNIT_LABEL, type PriceUnit } from "@/lib/units";

/** ¢/lb | USD/MT — one basis for the whole screen. Sits in a PageHeader
 *  rightSlot; the choice persists across tabs via usePriceUnit. */
export default function UnitToggle() {
  const [unit, setUnit] = usePriceUnit();
  return (
    <div
      className="flex items-center rounded-md border border-slate-700 overflow-hidden"
      role="group"
      aria-label="Price unit"
      title="Display every convertible price in one unit. ¢/lb is the arabica convention, USD/MT the robusta one; the toggle applies to both tables and the arbitrage panel."
    >
      {(["cents_lb", "usd_mt"] as PriceUnit[]).map((u) => (
        <button
          key={u}
          onClick={() => setUnit(u)}
          aria-pressed={unit === u}
          className={`px-2 py-1 text-[11px] font-medium transition-colors ${
            unit === u ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {UNIT_LABEL[u]}
        </button>
      ))}
    </div>
  );
}
