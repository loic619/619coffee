"use client";
import { AGRONOMY, DEMOGRAPHICS, DISTRICTS, STONEX_META, TREE_AGE } from "./stonexSurvey";
import { chgTone } from "@/lib/formatters";

const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const chgCls = (v: number) => (chgTone(v));
const chgStr = (v: number) => `${v >= 0 ? "+" : ""}${v}%`;

// blue→amber shading for a 0-100% agronomy adoption cell
function pctBg(v: number) {
  if (v >= 80) return "bg-emerald-900/60 text-emerald-300";
  if (v >= 50) return "bg-emerald-900/30 text-emerald-400";
  if (v >= 20) return "bg-amber-900/30 text-amber-400";
  return "bg-slate-900/60 text-slate-500";
}

function StoneXHeader({ title }: { title: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{title}</div>
      <div className="text-[8px] text-slate-600">{STONEX_META.source} · {STONEX_META.cropYear}</div>
    </div>
  );
}

export default function EthiopiaStoneXFarming() {
  return (
    <div className="space-y-3">
      {/* Surveyed districts */}
      <div className={CARD}>
        <StoneXHeader title="Surveyed Districts — Yield & Cycle" />
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono whitespace-nowrap">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1 pr-2 font-medium">District</th>
                <th className="py-1 px-1 font-medium">Zone / Region</th>
                <th className="py-1 px-1 font-medium">Cycle</th>
                <th className="py-1 px-1 text-right font-medium">Yield 24/25</th>
                <th className="py-1 px-1 text-right font-medium">25/26</th>
                <th className="py-1 px-1 text-right font-medium">YoY</th>
                <th className="py-1 px-1 text-right font-medium">Area ha</th>
                <th className="py-1 pl-1 text-right font-medium">Wet/Dry</th>
              </tr>
            </thead>
            <tbody>
              {DISTRICTS.map(d => (
                <tr key={d.name} className="border-t border-slate-700/50 text-slate-300">
                  <td className="py-0.5 pr-2 text-slate-100">{d.name}</td>
                  <td className="py-0.5 px-1 text-slate-400">{d.zone} / {d.region}</td>
                  <td className={`py-0.5 px-1 ${d.cycle === "high" ? "text-emerald-400" : "text-red-400"}`}>{d.cycle}</td>
                  <td className="py-0.5 px-1 text-right">{d.yield2425.toFixed(0)}</td>
                  <td className="py-0.5 px-1 text-right">{d.yield2526.toFixed(0)}</td>
                  <td className={`py-0.5 px-1 text-right ${chgCls(d.prodChangePct)}`}>{chgStr(d.prodChangePct)}</td>
                  <td className="py-0.5 px-1 text-right">{d.avgAreaHa.toFixed(1)}</td>
                  <td className="py-0.5 pl-1 text-right text-slate-500">{d.wetUnits}/{d.dryUnits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] text-slate-500">
          Yield kg/ha. West &amp; Southwest (Mana, Gimbo, Shishonde) in a full harvest year (+38% to +119%); South (Bensa-Daye, Hambela) in a low cycle (-19% to -26%).
        </div>
      </div>

      {/* Agronomic practices */}
      <div className={CARD}>
        <StoneXHeader title="Agronomic Practices (% of farmers)" />
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-2 text-left font-medium">Practice</th>
                {AGRONOMY.districts.map(d => (
                  <th key={d} className="py-1 px-1 text-center font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AGRONOMY.practices.map(p => (
                <tr key={p.label} className="border-t border-slate-700/50">
                  <td className="py-0.5 pr-2 text-slate-300 text-left">{p.label}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="py-0.5 px-0.5 text-center">
                      <span className={`inline-block w-8 rounded ${pctBg(v)}`}>{v}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] text-slate-500">{AGRONOMY.note}</div>
      </div>

      {/* Demographics + tree age */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={CARD}>
          <StoneXHeader title="Demographics" />
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div>
              <div className="text-slate-500 text-[9px]">Family size</div>
              <div className="text-white font-bold">{DEMOGRAPHICS.avgFamilyMembersRange}</div>
              <div className="text-[9px] text-slate-600">members</div>
            </div>
            <div>
              <div className="text-slate-500 text-[9px]">Head age</div>
              <div className="text-white font-bold">{DEMOGRAPHICS.householdHeadAgeRange}</div>
              <div className="text-[9px] text-slate-600">years</div>
            </div>
            <div>
              <div className="text-slate-500 text-[9px]">Holding</div>
              <div className="text-white font-bold">{DEMOGRAPHICS.typicalHoldingHa}</div>
              <div className="text-[9px] text-slate-600">hectares</div>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 leading-relaxed">{DEMOGRAPHICS.note}</div>
        </div>

        <div className={CARD}>
          <StoneXHeader title="Tree-Age Structure" />
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>
              <div className="text-slate-500 text-[9px]">Mana &gt;25 yr</div>
              <div className="text-amber-400 font-bold">{TREE_AGE.manaOldSharePct}%</div>
              <div className="text-[9px] text-slate-600">aging</div>
            </div>
            <div>
              <div className="text-slate-500 text-[9px]">Bensa-Daye &lt;4 yr</div>
              <div className="text-blue-400 font-bold">{TREE_AGE.bensaYoungSharePct}%</div>
              <div className="text-[9px] text-slate-600">young replants</div>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 leading-relaxed">{TREE_AGE.summary}</div>
        </div>
      </div>
    </div>
  );
}
