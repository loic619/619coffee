"use client";
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { AlignedPoint, EnsoAnalog } from "@/lib/enso";

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

const ANALOG_COLORS = ["#f59e0b", "#a855f7", "#14b8a6"];

function offsetLabel(o: number): string {
  if (o === 0) return "now";
  return o > 0 ? `+${o}` : `${o}`;
}

export default function EnsoAnalogChart({
  current,
  analogs,
}: {
  current: AlignedPoint[];
  analogs: EnsoAnalog[];
}) {
  const { rows, hasAnalogs, hasProjection } = useMemo(() => {
    const offsets = new Set<number>();
    for (const p of current) offsets.add(p.offset);
    for (const a of analogs) for (const p of a.series) offsets.add(p.offset);
    const sorted = Array.from(offsets).sort((x, y) => x - y);

    const curByOffset = new Map(current.map((p) => [p.offset, p.value]));
    const analogMaps = analogs.map((a) => new Map(a.series.map((p) => [p.offset, p.value])));

    // Project the "current" line into the future from the analog years —
    // the technique meteorologists use for analog forecasting, where the
    // closest historical years vote on what comes next.
    //
    // The vote is on each analog's CHANGE from its own anchor month, not on
    // its absolute ONI. Analogs are picked for the shape of their
    // trajectory, and they routinely sit at a different level from the
    // current year: today the analogs average 0.86 at offset 0 while ONI is
    // 1.39, so averaging raw levels made the dotted line drop to 1.09 at
    // +1 — a visible step down at "now", and backwards, since all three
    // analogs are RISING there. Averaging deltas anchors the projection on
    // the last observation by construction, so it always joins the solid
    // line and then evolves with the analogs' shape.
    const lastObs = current.length ? current[current.length - 1] : null;
    const projByOffset = new Map<number, number>();
    if (lastObs) {
      projByOffset.set(lastObs.offset, lastObs.value);
      for (const o of sorted) {
        if (o <= lastObs.offset) continue;
        const deltas: number[] = [];
        for (const m of analogMaps) {
          const v = m.get(o);
          const base = m.get(lastObs.offset);
          // Both ends required: an analog with no value at the anchor
          // month has no defined change to contribute.
          if (typeof v === "number" && typeof base === "number") deltas.push(v - base);
        }
        if (deltas.length === 0) continue;
        const meanDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length;
        projByOffset.set(o, lastObs.value + meanDelta);
      }
    }

    const rows = sorted.map((o) => {
      const row: Record<string, number | string | null> = { offset: o, label: offsetLabel(o) };
      row.current = curByOffset.has(o) ? (curByOffset.get(o) as number) : null;
      row.currentProj = projByOffset.has(o) ? Number(projByOffset.get(o)!.toFixed(2)) : null;
      analogs.forEach((a, i) => {
        row[`y${a.year}`] = analogMaps[i].has(o) ? (analogMaps[i].get(o) as number) : null;
      });
      return row;
    });
    return {
      rows,
      hasAnalogs: analogs.length > 0,
      hasProjection: projByOffset.size > 1,  // anchor + ≥1 projected point
    };
  }, [current, analogs]);

  if (!current || current.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 text-xs text-slate-500">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">ONI trajectory &amp; historical analogs</div>
        ONI history unavailable.
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          ONI trajectory &amp; closest historical analogs (offset 0 = latest month)
        </div>
        {hasAnalogs && (
          <div className="text-[10px] text-slate-400">
            Closest years:{" "}
            {analogs.map((a, i) => (
              <span key={a.year} style={{ color: ANALOG_COLORS[i % ANALOG_COLORS.length] }} className="font-mono">
                {a.year}
                {i < analogs.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 9 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={TT_STYLE}
              labelStyle={{ color: "#94a3b8", fontSize: 10 }}
              formatter={(v) => (typeof v === "number" ? v.toFixed(2) : "—")}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <ReferenceLine y={0.5} stroke="#dc2626" strokeDasharray="3 3" strokeOpacity={0.4} />
            <ReferenceLine y={-0.5} stroke="#3b82f6" strokeDasharray="3 3" strokeOpacity={0.4} />
            <ReferenceLine x="now" stroke="#475569" strokeDasharray="3 3" />
            {analogs.map((a, i) => (
              <Line
                key={a.year}
                type="monotone"
                dataKey={`y${a.year}`}
                name={`${a.year}`}
                stroke={ANALOG_COLORS[i % ANALOG_COLORS.length]}
                strokeWidth={1}
                strokeOpacity={0.45}
                dot={false}
                connectNulls
              />
            ))}
            <Line
              type="monotone"
              dataKey="current"
              name="Current"
              stroke="#e2e8f0"
              strokeWidth={2.5}
              dot={{ r: 2 }}
              connectNulls
            />
            {hasProjection && (
              <Line
                type="monotone"
                dataKey="currentProj"
                name="Current proj. (analog mean)"
                stroke="#e2e8f0"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
