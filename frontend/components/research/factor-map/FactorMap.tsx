"use client";
// Renderer for the differential-model factor map. Pure: it takes the node
// geometry from nodes.ts and draws it. Two callers, one chart —
//
//   • DifferentialModelNote renders it plain, as the note's figure. The note
//     previously shipped only a four-cluster-box abstraction of this map; the
//     detailed chart it describes in prose did not exist anywhere in the app.
//   • The research index renders the same component with per-node badges, so
//     research is reached by its place in the model rather than by a list.
//
// Because both go through this file, the figure in the paper and the map you
// browse cannot drift apart.
import { CLUSTER, NODES, BY_ID, EDGES, MAP_W, MAP_H, cx, cy, type Cluster, type N } from "./nodes";

export interface FactorMapProps {
  /** node id → badge count. Absent = plain figure, no badges. */
  badges?: Map<string, number>;
  /** Hide nodes with no badge (the diamond always stays). */
  onlyBadged?: boolean;
  /** Node ids to keep at full opacity; everything else dims. */
  lit?: Set<string> | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** Minimum rendered width before the container scrolls. */
  minWidth?: number;
}

export default function FactorMap({
  badges, onlyBadged = false, lit = null, selected = null, onSelect, minWidth = 1040,
}: FactorMapProps) {
  const visible = (n: N) => !onlyBadged || n.c === "core" || (badges?.has(n.id) ?? false);
  const isLit = (n: N) => (lit ? lit.has(n.id) : true);

  const sd = BY_ID.get("sd")!, fu = BY_ID.get("futures")!,
        ee = BY_ID.get("exch_econ")!, df = BY_ID.get("differential")!;
  const P = (n: N) => `${cx(n)},${cy(n)}`;

  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block w-full" style={{ minWidth }}
      role="img"
      aria-label="Differential model factor map: supply, demand, positioning and exchange-economics clusters converging on the diamond that resolves futures price, supply and demand, and exchange economics into the differential">
      {EDGES.map(([s, t], i) => {
        const a = BY_ID.get(s), b = BY_ID.get(t);
        if (!a || !b || !visible(a) || !visible(b)) return null;
        return <line key={i} x1={cx(a)} y1={cy(a)} x2={cx(b)} y2={cy(b)}
          stroke={CLUSTER[a.c].stroke} strokeOpacity={0.3} strokeWidth={1} />;
      })}

      {/* The diamond, exactly as the source draws it: the four-way frame plus
          the dashed futures↔exchange leg and the vertical S&D→Differential. */}
      <polygon points={`${P(sd)} ${P(fu)} ${P(df)} ${P(ee)}`} fill="none" stroke="#64748b" strokeWidth={1.4} />
      <line x1={cx(fu)} y1={cy(fu)} x2={cx(ee)} y2={cy(ee)} stroke="#64748b" strokeWidth={1.4} strokeDasharray="6 4" />
      <line x1={cx(sd)} y1={cy(sd)} x2={cx(df)} y2={cy(df)} stroke="#64748b" strokeWidth={1.4} />

      {NODES.filter(visible).map(n => {
        const count = badges?.get(n.id) ?? 0;
        const C = CLUSTER[n.c as Cluster];
        const sel = selected === n.id;
        return (
          <g key={n.id} opacity={isLit(n) ? 1 : 0.2}
            style={{ cursor: count && onSelect ? "pointer" : "default" }}
            onClick={() => count && onSelect?.(n.id)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={3}
              fill={C.fill} stroke={sel ? "#e2e8f0" : C.stroke}
              strokeWidth={sel ? 2 : n.big ? 1.6 : 1} />
            <foreignObject x={n.x + 2} y={n.y + 1} width={n.w - 4} height={n.h - 2}>
              <div style={{
                height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                textAlign: "center", lineHeight: 1.1,
                fontSize: n.big ? 9.5 : 8.5, fontWeight: n.big ? 700 : 500,
                color: n.big ? "#f1f5f9" : "#cbd5e1",
                letterSpacing: n.c === "core" ? "0.04em" : undefined,
              }}>{n.t}</div>
            </foreignObject>
            {count > 0 && (
              <>
                <circle cx={n.x + n.w - 1} cy={n.y + 1} r={7} fill="#0f172a" stroke={C.stroke} strokeWidth={1.4} />
                <text x={n.x + n.w - 1} y={n.y + 4.2} textAnchor="middle"
                  fontSize={8} fontWeight={700} fill="#e2e8f0">{count}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function FactorMapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {(Object.keys(CLUSTER) as Cluster[]).map(k => (
        <span key={k} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-2 w-2 rounded-sm" style={{ background: CLUSTER[k].stroke }} />
          {CLUSTER[k].label}
        </span>
      ))}
    </div>
  );
}
