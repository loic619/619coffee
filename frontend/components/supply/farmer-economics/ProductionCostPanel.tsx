"use client";
import { useState } from "react";
import type { CostData, CopLineItem } from "./farmerEconomicsData";
import { chgTone } from "@/lib/formatters";

interface Props {
  cost: CostData;
  coffeeType?: "arabica" | "conilon" | "robusta";
  country?: string;
}

// ── Sectioned view (Vietnam / full Excel structure) ────────────────────────────

function LineItemRow({
  item, indent, showTon,
}: {
  item: CopLineItem; indent: number; showTon: boolean;
}) {
  const val  = showTon ? item.usd_per_ton : (item.usd_per_ha ?? null);
  const fVal = showTon ? item.family_usd_per_ton : item.family_usd_per_ha;
  const hVal = showTon ? item.hired_usd_per_ton  : item.hired_usd_per_ha;
  const pl   = indent === 1 ? "pl-3" : "pl-6";

  return (
    <>
      <div className={`flex items-center gap-1 py-[2px] ${pl}`}>
        <div className="flex-1 text-[9px] text-slate-400 truncate">{item.label}</div>
        <div className="text-[9px] font-mono text-slate-300 w-14 text-right">
          {val == null ? "—" : val === 0 ? "—" : `$${Number(val.toFixed(0)).toLocaleString()}`}
        </div>
        {(fVal != null && hVal != null) ? (
          <div className="text-[8px] text-slate-600 w-20 text-right whitespace-nowrap">
            F${Math.round(fVal)} H${Math.round(hVal)}
          </div>
        ) : (
          <div className="w-20" />
        )}
      </div>
      {item.items?.map((sub) => (
        <div key={sub.label} className="flex items-center gap-1 py-[2px] pl-8">
          <div className="flex-1 text-[8px] text-slate-500 truncate">{sub.label}</div>
          <div className="text-[8px] font-mono text-slate-400 w-14 text-right">
            {sub.usd_per_ton === 0 ? "—" : `$${Number((showTon ? sub.usd_per_ton : (sub.usd_per_ha ?? sub.usd_per_ton)).toFixed(1))}`}
          </div>
          <div className="w-20" />
        </div>
      ))}
    </>
  );
}

function SectionedCopView({ cost, coffeeType, country }: { cost: CostData; coffeeType: string; country?: string }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showTon, setShowTon] = useState(true);

  const sections    = cost.sections!;
  const farmGate    = sections.filter(s => s.usd_per_ha != null);
  const postGate    = sections.filter(s => s.usd_per_ha == null);
  const total       = cost.total_usd_per_ton!;
  const fobTotal    = cost.fob_total_usd_per_ton ?? null;
  const totalHa     = farmGate.reduce((s, sec) => s + (sec.usd_per_ha ?? 0), 0);
  const isRobusta   = coffeeType === "conilon" || coffeeType === "robusta";
  const spot        = isRobusta ? (cost.rc_spot ?? null) : (cost.kc_spot ?? null);
  const margin      = spot != null ? spot - total : null;

  const toggle = (n: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });

  const renderSection = (s: (typeof sections)[0]) => {
    const displayVal = showTon ? s.usd_per_ton : (s.usd_per_ha ?? null);
    const sharePct   = Math.round((s.usd_per_ton / total) * 100);
    return (
      <div key={s.number} className="border-b border-slate-700/50 last:border-0">
        <div
          className={`flex items-center gap-1 px-2 py-1.5 ${s.items.length > 0 ? "cursor-pointer hover:bg-slate-700/30" : ""}`}
          onClick={() => s.items.length > 0 && toggle(s.number)}
        >
          <div className="w-1.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
          <div className="flex-1 text-[10px] font-semibold text-slate-200">
            {s.number}. {s.label}
          </div>
          <div className="text-[10px] font-mono text-slate-100 w-14 text-right">
            {displayVal == null ? <span className="text-slate-500">$/t only</span>
              : `$${Number(displayVal.toFixed(0)).toLocaleString()}`}
          </div>
          <div className="text-[9px] text-slate-500 w-8 text-right">
            {sharePct > 0 ? `${sharePct}%` : "—"}
          </div>
          <div className="w-4 text-center text-[9px] text-slate-500">
            {s.items.length > 0 ? (expanded.has(s.number) ? "▼" : "▶") : ""}
          </div>
        </div>
        {expanded.has(s.number) && s.items.length > 0 && (
          <div className="bg-slate-900/60 pb-1">
            {s.items.map((item) => (
              <LineItemRow key={item.label} item={item} indent={1} showTon={showTon} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      {/* Header */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
          {country && <span className="text-slate-500">{country} · </span>}Production Cost · {coffeeType === "arabica" ? "Arabica" : coffeeType === "robusta" ? "Robusta" : "Conilon"} — {cost.season_label}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-extrabold text-slate-100">
            ${total.toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">/ MT farm gate</span>
          <span className={`text-xs font-semibold ${cost.yoy_pct >= 0 ? "text-red-400" : "text-green-400"}`}>
            {cost.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(cost.yoy_pct).toFixed(1)}% YoY
          </span>
        </div>
        {cost.total_usd_per_ton_excl_family != null && (
          <div className="text-[9px] text-slate-600 mt-0.5">
            Cash basis ${cost.total_usd_per_ton_excl_family.toLocaleString()}/MT · excl. family labour
            {fobTotal != null && <span className="ml-2 text-sky-700">· FOB total ${fobTotal.toLocaleString()}/MT</span>}
          </div>
        )}
      </div>

      {/* Stacked bar — farm-gate sections only */}
      <div>
        <div className="flex h-4 rounded overflow-hidden mb-1">
          {farmGate.filter((s) => s.usd_per_ton > 0).map((s) => (
            <div
              key={s.number}
              style={{ width: `${(s.usd_per_ton / total) * 100}%`, background: s.color }}
              title={`${s.label}: $${s.usd_per_ton}/MT`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {farmGate.filter((s) => s.usd_per_ton > 0).map((s) => (
            <div key={s.number} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
              <span className="text-[9px] text-slate-500">
                {s.label.split(" ")[0]} {Math.round((s.usd_per_ton / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Unit toggle */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-slate-600 mr-1">Unit:</span>
        {(["$/MT", "$/ha"] as const).map((u) => (
          <button
            key={u}
            onClick={() => setShowTon(u === "$/MT")}
            className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
              (u === "$/MT") === showTon
                ? "bg-slate-600 text-slate-100"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {u}
          </button>
        ))}
      </div>

      {/* Section table */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <div className="flex items-center gap-1 px-2 py-1 bg-slate-700/50 border-b border-slate-700">
          <div className="flex-1 text-[8px] text-slate-500 uppercase tracking-wide">Category</div>
          <div className="text-[8px] text-slate-500 uppercase w-14 text-right">{showTon ? "$/MT" : "$/ha"}</div>
          <div className="text-[8px] text-slate-500 uppercase w-8 text-right">Share</div>
          <div className="w-4" />
        </div>

        {/* Farm-gate sections */}
        {farmGate.map(renderSection)}

        {/* Farm Gate Total */}
        <div className="flex items-center gap-1 px-2 py-1.5 bg-slate-700/40 border-t-2 border-slate-500">
          <div className="w-1.5 flex-shrink-0" />
          <div className="flex-1 text-[10px] font-bold text-slate-100">Farm Gate Total</div>
          <div className="text-[10px] font-bold font-mono text-slate-50 w-14 text-right">
            ${Number((showTon ? total : totalHa).toFixed(0)).toLocaleString()}
          </div>
          <div className="text-[9px] text-slate-400 w-8 text-right">100%</div>
          <div className="w-4" />
        </div>

        {/* Post-farm-gate sections (10+) */}
        {postGate.length > 0 && (
          <>
            <div className="flex items-center gap-1 px-2 py-1 bg-slate-900/60 border-t border-slate-600">
              <div className="flex-1 text-[8px] text-sky-600 uppercase tracking-wide">Farm Gate → FOB</div>
              <div className="text-[8px] text-slate-500 uppercase w-14 text-right">$/MT</div>
              <div className="text-[8px] text-slate-500 uppercase w-8 text-right"></div>
              <div className="w-4" />
            </div>
            {postGate.map(renderSection)}
            {fobTotal != null && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-sky-900/30 border-t-2 border-sky-700">
                <div className="w-1.5 flex-shrink-0" />
                <div className="flex-1 text-[10px] font-bold text-sky-200">FOB Total</div>
                <div className="text-[10px] font-bold font-mono text-sky-100 w-14 text-right">
                  ${fobTotal.toLocaleString()}
                </div>
                <div className="text-[9px] text-sky-600 w-8 text-right">FOB</div>
                <div className="w-4" />
              </div>
            )}
          </>
        )}
      </div>

      {/* RC/KC spot margin (vs farm gate) */}
      {spot != null && (
        <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
          {isRobusta ? "RC" : "KC"} spot{" "}
          <span className="text-green-400 font-bold">${spot.toLocaleString()}/MT</span>
          {margin != null && (
            <>
              {" "}→ farmer margin ~
              <span className={`font-bold ml-1 ${chgTone(margin)}`}>
                ${Math.round(margin).toLocaleString()}/MT
              </span>
              <span className="text-slate-600 ml-1">(vs farm gate)</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Legacy flat view (Brazil / per-bag) ──────────────────────────────────────

export default function ProductionCostPanel({ cost, coffeeType = "arabica", country }: Props) {
  if (cost.sections?.length) {
    return <SectionedCopView cost={cost} coffeeType={coffeeType} country={country} />;
  }

  const isRobusta = coffeeType === "conilon" || coffeeType === "robusta";
  const perTon = cost.total_usd_per_ton != null;
  const totalCost = perTon ? cost.total_usd_per_ton! : cost.total_usd_per_bag;
  const unitLabel = perTon ? "/ MT" : "/ 60kg bag";
  const spot = isRobusta ? (cost.rc_spot ?? null) : (cost.kc_spot ?? null);
  const spotUnit  = perTon ? "$/MT" : isRobusta ? "$/bag (RC×0.06)" : "$/bag";
  const margin = spot != null ? spot - totalCost : null;
  const marginUnit = perTon ? "/MT" : "/bag";
  const inputsUsd = cost.components.find((c) => c.label === "Inputs")?.usd
    ?? cost.inputs_detail.reduce((s, d) => s + d.usd, 0);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
          {country && <span className="text-slate-500">{country} · </span>}Production Cost{coffeeType === "arabica" ? " · Arabica" : coffeeType === "robusta" ? " · Robusta" : " · Conilon"} — {cost.season_label ?? "CONAB Custos"}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-slate-100">${totalCost}</span>
          <span className="text-xs text-slate-500">{unitLabel}</span>
          <span className={`text-xs font-semibold ${cost.yoy_pct >= 0 ? "text-red-400" : "text-green-400"}`}>
            {cost.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(cost.yoy_pct).toFixed(1)}% YoY
          </span>
        </div>
      </div>

      <div>
        <div className="text-[10px] text-slate-500 mb-1">Cost breakdown</div>
        <div className="flex h-5 rounded overflow-hidden mb-2">
          {cost.components.map((c) => (
            <div key={c.label} style={{ width: `${c.share * 100}%`, background: c.color }}
              className="flex items-center justify-center text-[7px] font-bold text-white overflow-hidden">
              {c.share >= 0.1 ? c.label.split(" ")[0] : ""}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {cost.components.map((c) => (
            <div key={c.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-[10px] text-slate-400">
                {c.label} ${c.usd} ({Math.round(c.share * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-l-2 border-blue-500 pl-3 bg-slate-900 rounded-r-lg p-3">
        <div className="text-[10px] text-blue-400 uppercase tracking-wide mb-2">
          🌱 Inputs detail — ${inputsUsd}{perTon ? "/MT" : "/bag"} total
        </div>
        <div className="space-y-1.5">
          {cost.inputs_detail.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="text-[10px] text-slate-400 w-40 flex-shrink-0">{item.label}</div>
              <div className="flex-1 bg-slate-800 rounded h-1.5">
                <div className="h-full rounded bg-blue-400" style={{ width: `${item.share * 100}%` }} />
              </div>
              <div className="text-[10px] text-slate-300 font-semibold w-8 text-right">
                {Math.round(item.share * 100)}%
              </div>
              <div className="text-[10px] text-slate-500 w-8 text-right">${item.usd}</div>
            </div>
          ))}
        </div>
      </div>

      {spot != null && (
        <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
          {isRobusta ? "RC" : "KC"} spot{" "}
          <span className="text-green-400 font-bold">${spot} {spotUnit}</span>
          {margin != null && (
            <>
              {" "}→ farmer margin ~
              <span className={`font-bold ml-1 ${chgTone(margin)}`}>
                ${margin.toFixed(1)}{marginUnit}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
