"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { chgTone } from "@/lib/formatters";

// What the big roasters say about volume.
//
// A roaster's sales growth splits into how much it SOLD and what it CHARGED.
// Only the first half is a demand signal: in a year when green prices double,
// revenue can rise while volumes fall, and the top line will happily mislead
// you about consumption. Both companies here publish that split on a fixed
// definition every reporting period, which is what makes them trackable:
//
//   Nestle       RIG (Real Internal Growth) = volume and product mix, with
//                pricing reported separately. Organic growth = RIG + pricing.
//   JDE Peet's   Volume/mix vs price, split the same way, per segment.
//
// They are the same quantity under two house styles. A negative reading
// alongside positive organic growth means the category is holding revenue by
// price while losing cups — which is the thing worth knowing.

interface Segment {
  segment: string;
  volume_mix_pct: number | null;   // RIG for Nestle, volume/mix for JDE
  price_pct?: number | null;
  organic_pct?: number | null;
}
interface Period {
  period: string;                  // "2026-H1", "2026-Q2", …
  source_url?: string;
  segments: Segment[];
}
interface Company { key: string; name: string; metric_name: string; periods: Period[] }

// A narrative source is deliberately a different shape from a Company. Strauss
// publishes no volume figure — only a sentence about quantities sold — and the
// moment a direction is given a percentage axis it starts being read as a
// magnitude. Different data, different object, different rendering.
interface NarrativeQuote {
  topic: string;
  label: string;
  quote_he?: string;
  quote_en?: string | null;
  direction?: "up" | "down" | "mixed" | null;
}
interface NarrativePeriod {
  period: string;
  source_url?: string;
  direction?: "up" | "down" | "mixed" | null;
  quotes?: NarrativeQuote[];
}
interface Narrative {
  key: string; name: string; metric_name: string; note?: string;
  periods: NarrativePeriod[];
}
interface Payload { generated_at?: string; companies?: Company[]; narratives?: Narrative[] }

const DIRECTION_STYLE: Record<string, { label: string; cls: string }> = {
  up:    { label: "▲ volumes up",    cls: "text-emerald-300 border-emerald-500/50 bg-emerald-500/10" },
  down:  { label: "▼ volumes down",  cls: "text-red-300 border-red-500/50 bg-red-500/10" },
  mixed: { label: "◆ mixed",         cls: "text-amber-300 border-amber-500/50 bg-amber-500/10" },
};

function NarrativeBlock({ n }: { n: Narrative }) {
  const periods = [...n.periods].reverse();   // newest first: the quote people want
  return (
    <div className="bg-slate-900/50 rounded border border-slate-700 p-2.5 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-[11px] font-semibold text-slate-100">{n.name}</div>
        <div className="text-[9px] font-mono text-slate-500">{n.metric_name}</div>
      </div>
      {n.note && <p className="text-[10px] text-slate-400">{n.note}</p>}

      <div className="space-y-2">
        {periods.map(p => {
          const d = p.direction ? DIRECTION_STYLE[p.direction] : null;
          return (
            <div key={p.period} className="border-l-2 border-slate-700 pl-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-slate-300">{p.period}</span>
                {d && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${d.cls}`}>{d.label}</span>
                )}
                {p.source_url && (
                  <a href={p.source_url} target="_blank" rel="noreferrer"
                     className="text-[9px] text-slate-500 underline hover:text-slate-300">source</a>
                )}
              </div>
              {/* One block per explanation cell. Labelled, because "sales
                  fell on FX" and "volumes rose" come from different rows and
                  mean different things — merging them would blur exactly the
                  distinction that makes these quotes worth showing. */}
              {(p.quotes ?? []).map(q => (
                <div key={q.topic} className="space-y-0.5">
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">{q.label}</div>
                  {q.quote_en ? (
                    <p className="text-[10px] text-slate-300 italic">&ldquo;{q.quote_en}&rdquo;</p>
                  ) : (
                    <p className="text-[9px] text-slate-600">Translation pending — Hebrew below, unaltered.</p>
                  )}
                  {q.quote_he && (
                    <p dir="rtl" lang="he" className="text-[10px] text-slate-500 leading-snug">
                      {q.quote_he}
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-[9px] text-slate-500 italic">
        Strauss files in Hebrew only, so the English is a working translation, not the
        company&rsquo;s own wording — the original is shown alongside so it can be checked. The
        arrow is a direction, not a rate: no volume figure is published.
      </p>
    </div>
  );
}

function CompanyBlock({ c }: { c: Company }) {
  const latest = c.periods.at(-1);
  const chart = useMemo(
    () => (latest?.segments ?? [])
      .filter(s => s.volume_mix_pct != null)
      .map(s => ({ segment: s.segment, value: s.volume_mix_pct as number })),
    [latest],
  );
  if (!latest) return null;

  const segments = Array.from(new Set(c.periods.flatMap(p => p.segments.map(s => s.segment))));

  return (
    <div className="bg-slate-900/50 rounded border border-slate-700 p-2.5 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-[11px] font-semibold text-slate-100">{c.name}</div>
        <div className="text-[9px] font-mono text-slate-500">
          {c.metric_name} · {latest.period}
          {latest.source_url && (
            <> · <a href={latest.source_url} target="_blank" rel="noreferrer"
                    className="underline hover:text-slate-300">source</a></>
          )}
        </div>
      </div>

      {chart.length > 0 && (
        <div style={{ height: Math.max(120, chart.length * 26 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="segment" width={128} interval={0}
                tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} />
              <ReferenceLine x={0} stroke="#475569" />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
                formatter={(v: unknown) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`, c.metric_name]} />
              <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                {chart.map(d => <Cell key={d.segment} fill={d.value >= 0 ? "#16a34a" : "#dc2626"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* The trend matters more than any single print. */}
      {c.periods.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[9px] text-slate-500 uppercase border-b border-slate-700">
                <th className="text-left px-1 py-0.5">Segment</th>
                {c.periods.map(p => <th key={p.period} className="text-right px-1 py-0.5">{p.period}</th>)}
              </tr>
            </thead>
            <tbody>
              {segments.map(seg => (
                <tr key={seg} className="border-b border-slate-800/70">
                  <td className="px-1 py-0.5 text-slate-300">{seg}</td>
                  {c.periods.map(p => {
                    const v = p.segments.find(s => s.segment === seg)?.volume_mix_pct;
                    return (
                      <td key={p.period} className={`px-1 py-0.5 text-right font-mono ${
                        v == null ? "text-slate-600" : chgTone(v)}`}>
                        {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RoasterEarningsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/data/roaster_earnings.json")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setMissing(true));
  }, []);

  const companies = data?.companies ?? [];
  const narratives = data?.narratives ?? [];

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-white">Roaster volume growth</h3>
        <p className="text-[10px] text-slate-400">
          Sales growth splits into volume and price, and only the volume half says anything about
          consumption. Nestlé calls it RIG, JDE Peet&rsquo;s calls it volume/mix — the same quantity.
          Negative volume alongside positive organic growth means the category is holding revenue by
          price while losing cups.
        </p>
      </div>

      {companies.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {companies.map(c => <CompanyBlock key={c.key} c={c} />)}
        </div>
      ) : (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-[10px] text-slate-300 space-y-1">
          <div className="font-semibold text-amber-300">No figures loaded yet</div>
          <p>
            {missing
              ? "roaster_earnings.json has not been published yet."
              : "roaster_earnings.json is present but carries no companies."}
            {" "}RIG and volume/mix appear only in the results releases — no financial data API
            carries them — so they need a dedicated scrape rather than a ticker feed.
          </p>
          <p className="text-slate-400">
            Showing nothing rather than a placeholder is deliberate: an invented demand signal is
            worse than an empty panel.
          </p>
        </div>
      )}

      {narratives.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 border-t border-slate-700 pt-2">
            Said, not counted — companies that describe volume without publishing it
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {narratives.map(n => <NarrativeBlock key={n.key} n={n} />)}
          </div>
        </div>
      )}

      {data?.generated_at && (
        <div className="text-[9px] text-slate-500 italic">
          Read from the &ldquo;Sales growth bridge by segment&rdquo; table in each results release —
          the Vol/Mix column, as published, not restated or blended. Last refreshed{" "}
          {data.generated_at.slice(0, 10)}.
          {!companies.some(c => /nestl/i.test(c.name)) && (
            <> Nestlé is absent, not omitted: their site refuses datacentre traffic outright
            (403 to a bot, a browser user-agent and a real headless browser alike), so RIG cannot be
            scraped from CI.</>
          )}
        </div>
      )}
    </div>
  );
}
