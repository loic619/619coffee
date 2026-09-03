"use client";
import type { Contract } from "./types";

// ─── KC/RC ¢/lb middle panel ──────────────────────────────────────────────────

const KC_TO_RC_LETTER: Record<string, string> = { H:"H", K:"K", N:"N", U:"U", Z:"F" };

export default function KcRcCentsPanel({ arabica, robusta }: { arabica: Contract[]; robusta: Contract[] }) {
  // Key: letter+2-digit-year e.g. "K26", "F27"
  const rcByKey = new Map<string, number>();
  robusta.forEach(c => {
    const m = c.symbol.match(/^R[CM]([FGHJKMNQUVXZ])(\d{2})$/i);
    if (m) {
      const key = m[1].toUpperCase() + m[2];
      if (!rcByKey.has(key)) rcByKey.set(key, c.last);
    }
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-x-auto self-start">
      <div className="px-1.5 sm:px-3 py-2 bg-slate-800 border-b border-slate-700 text-center min-h-[40px] flex items-center justify-center">
        <span className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider sm:tracking-widest whitespace-nowrap">
          <span className="sm:hidden">Arb</span>
          <span className="hidden sm:inline">Arbitrage</span>
        </span>
      </div>
      <table className="text-[10px] sm:text-[11px] font-mono w-full">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="px-1 sm:px-1.5 py-1 text-left whitespace-nowrap">Pair</th>
            <th className="px-1 sm:px-1.5 py-1 text-right whitespace-nowrap">
              <span className="sm:hidden">×</span>
              <span className="hidden sm:inline">¢/lb (×)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {arabica.map((c, i) => {
            const km = c.symbol.match(/^KC([FGHJKMNQUVXZ])(\d{2})$/i);
            if (!km) return null;
            const kcLetter = km[1].toUpperCase();
            const kcYr     = km[2];
            const rcLetter = KC_TO_RC_LETTER[kcLetter] ?? kcLetter;
            const rcYr     = kcLetter === "Z" ? String(parseInt(kcYr) + 1).slice(-2) : kcYr;
            const rc       = rcByKey.get(rcLetter + rcYr);
            // Guard against a 0/absent RC leg (far months print 0) — otherwise
            // the ratio is Infinity, which both misleads and widens the column.
            const hasRc    = rc != null && rc > 0;
            const spread   = hasRc ? c.last - rc / 22.046 : null;
            const ratio    = hasRc ? (c.last * 22.046 / rc).toFixed(2) : null;
            const rcSym    = `RC${rcLetter}${rcYr}`;
            const isFront  = i === 0;
            return (
              <tr key={c.symbol} className={`border-t border-slate-700 ${isFront ? "bg-slate-800/60" : ""}`}>
                <td className={`px-1 sm:px-1.5 py-1.5 whitespace-nowrap ${isFront ? "text-slate-200" : "text-slate-500"}`}>
                  {/* Phone: compact key (e.g. "K26"); wider: full "KCK26-RCK26". */}
                  <span className="sm:hidden">{kcLetter}{kcYr}</span>
                  <span className="hidden sm:inline">{c.symbol}-{rcSym}</span>
                </td>
                <td className={`px-1 sm:px-1.5 py-1.5 text-right whitespace-nowrap ${isFront ? "text-sky-300" : "text-slate-500"}`}>
                  {/* Phone: ratio only (×N); wider: spread + ratio. */}
                  {ratio != null && spread != null ? (
                    <>
                      <span className="sm:hidden">×{ratio}</span>
                      <span className="hidden sm:inline">{spread.toFixed(1)} (×{ratio})</span>
                    </>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

