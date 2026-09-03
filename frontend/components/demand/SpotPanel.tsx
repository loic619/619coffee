"use client";
import { chgTone } from "@/lib/formatters";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  cropTier, fmtVol, History, offerTons, offerVol, originColor, parsePrice,
  SpotData, SpotRow, Snapshot, uniq, Unit, unitLabel,
} from "./spot/spotLib";

const TYPE_COLORS: Record<string, string> = { Arabica: "#22c55e", Robusta: "#a16207" };
const TT = { backgroundColor: "#0f172a", borderColor: "#334155", fontSize: 11, borderRadius: 6 } as const;

interface EcfMonth {
  period: string; value_mt: number;
  robusta_mt?: number; arabica_unwashed_mt?: number; arabica_washed_mt?: number;
}

export default function SpotPanel(
  { section = "all" }: { section?: "all" | "tiles" | "square_map" | "ecf" | "origin_port" } = {},
) {
  const [d, setD] = useState<SpotData | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [ecf, setEcf] = useState<EcfMonth | null>(null);
  const [err, setErr] = useState(false);
  const [unit, setUnit] = useState<Unit>("mt");

  useEffect(() => {
    fetch("/data/spot_coffee.json").then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? setD(j) : setErr(true))).catch(() => setErr(true));
    fetch("/data/spot_coffee_history.json").then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setHist(j)).catch(() => {});
    fetch("/data/ecf_history.json").then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const m = j?.monthly;
        if (Array.isArray(m) && m.length) setEcf(m[m.length - 1]);
      }).catch(() => {});
  }, []);

  const rows = useMemo(() => d?.rows ?? [], [d]);

  // Per-type totals in the active unit.
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.Type] = (t[r.Type] || 0) + offerVol(r, unit);
    return t;
  }, [rows, unit]);
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);

  if (err) return <div className="p-4 text-xs text-slate-500">Spot offer data unavailable.</div>;
  if (!d) return <div className="p-4 text-xs text-slate-500">Loading spot offers…</div>;

  // Report/briefing mode — render a single section without the panel chrome.
  if (section !== "all") {
    if (section === "tiles") {
      return (
        <div className="p-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TotalTile totals={totals} grand={grand} unit={unit} />
          <WowTile snap={hist?.snapshots?.[hist.snapshots.length - 1] ?? null} unit={unit} />
          <OffersTile by={d.by_type} n={d.row_count} />
          <EcfTile totals={totals} ecf={ecf} unit={unit} />
        </div>
      );
    }
    if (section === "square_map") return <div className="p-2"><PortSquareMap rows={rows} unit={unit} /></div>;
    if (section === "ecf") return <div className="p-2"><EcfComparison totals={totals} ecf={ecf} unit={unit} /></div>;
    return <div className="p-2"><OriginPortHeatmap rows={rows} unit={unit} /></div>; // origin_port
  }

  return (
    <div className="p-4 space-y-5">
      {/* Header + unit toggle */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Spot Offers — Physical Market</h2>
          <p className="text-[11px] text-slate-500 max-w-xl">
            Live green-coffee spot offers (ATTE). {d.row_count} offers · updated weekly ·
            as of <span className="font-mono text-slate-300">{d.as_of}</span>.
          </p>
        </div>
        <UnitToggle unit={unit} setUnit={setUnit} />
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TotalTile totals={totals} grand={grand} unit={unit} />
        <WowTile snap={hist?.snapshots?.[hist.snapshots.length - 1] ?? null} unit={unit} />
        <OffersTile by={d.by_type} n={d.row_count} />
        <EcfTile totals={totals} ecf={ecf} unit={unit} />
      </div>

      <Section title="Offered volume over time" hint="Stacked weekly snapshots — accumulates each Monday.">
        <VolumeOverTime snaps={hist?.snapshots ?? []} unit={unit} totalsNow={totals} asOf={d.as_of} />
      </Section>

      <Section title="Port square-map" hint="Each square ≈ 20 t (a 60 t offer = 3 squares). Fill = origin, border = crop-year freshness. Hover a square for the offer; sort by price.">
        <PortSquareMap rows={rows} unit={unit} />
      </Section>

      <Section title="Differential finder" hint="Price differential (¢/lb vs futures) vs offer size. Filter to find the cheapest lots.">
        <DifferentialFinder rows={rows} unit={unit} />
      </Section>

      <Section title="Spot vs ECF European stocks" hint="Offered spot volume as a share of ECF reported port stocks, by type.">
        <EcfComparison totals={totals} ecf={ecf} unit={unit} />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="Origin × Port" hint="Where each origin's offered volume sits in Europe.">
          <OriginPortHeatmap rows={rows} unit={unit} />
        </Section>
        <Section title="Crop-year freshness" hint="Offered volume by crop year.">
          <CropYearFreshness rows={rows} unit={unit} />
        </Section>
      </div>

      <p className="text-[9px] text-slate-600 italic">
        Differentials (±) are ¢/lb vs the relevant futures month; outright prices show their unit.
        Volumes normalise Bags/Tons to {unit === "mt" ? "metric tonnes" : "60-kg bags"} (toggle above).
        Source: ATTE spot list (login-gated) · ECF figures from ecf-coffee.org.
      </p>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">{title}</h3>
        {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function UnitToggle({ unit, setUnit }: { unit: Unit; setUnit: (u: Unit) => void }) {
  return (
    <div className="inline-flex rounded-md border border-slate-700 overflow-hidden text-[11px]">
      {(["mt", "bags"] as Unit[]).map((u) => (
        <button key={u} onClick={() => setUnit(u)}
          className={`px-3 py-1 ${unit === u ? "bg-amber-500/90 text-slate-900 font-semibold" : "bg-slate-900 text-slate-400 hover:text-slate-200"}`}>
          {u === "mt" ? "Tonnes" : "Bags"}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function TotalTile({ totals, grand, unit }: { totals: Record<string, number>; grand: number; unit: Unit }) {
  return (
    <Tile label={`Total offered (${unitLabel(unit)})`}>
      <div className="text-xl font-bold text-slate-100 font-mono">{fmtVol(grand, unit)}</div>
      <div className="flex gap-3 mt-1 text-[10px]">
        {Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([t, v]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[t] ?? "#64748b" }} />
            <span className="text-slate-400">{t}</span>
            <span className="font-mono text-slate-200">{fmtVol(v, unit)}</span>
          </span>
        ))}
      </div>
    </Tile>
  );
}

function WowTile({ snap, unit }: { snap: Snapshot | null; unit: Unit }) {
  const w = snap?.wow;
  const conv = (t: number) => (unit === "mt" ? t : (t * 1000) / 60);
  return (
    <Tile label="Week-on-week">
      {!w ? (
        <div className="text-[11px] text-slate-500 leading-tight pt-1">
          Collecting…<br />needs a 2nd weekly snapshot.
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-emerald-400 font-mono text-sm">+{fmtVol(conv(w.in_tons), unit)}</span>
            <span className="text-rose-400 font-mono text-sm">−{fmtVol(conv(w.out_tons), unit)}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            net <span className={`font-mono ${chgTone(w.net_tons)}`}>
              {w.net_tons >= 0 ? "+" : "−"}{fmtVol(conv(Math.abs(w.net_tons)), unit)} {unitLabel(unit)}
            </span>
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">{w.in_offers} in · {w.out_offers} out · vs {w.prev_date}</div>
        </>
      )}
    </Tile>
  );
}

function OffersTile({ by, n }: { by: Record<string, number>; n: number }) {
  return (
    <Tile label="Offers">
      <div className="text-xl font-bold text-slate-100 font-mono">{n}</div>
      <div className="flex gap-3 mt-1 text-[10px]">
        {Object.entries(by).map(([t, c]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[t] ?? "#64748b" }} />
            <span className="text-slate-400">{t}</span><span className="font-mono text-slate-200">{c}</span>
          </span>
        ))}
      </div>
    </Tile>
  );
}

function ecfByType(ecf: EcfMonth | null): { Arabica: number; Robusta: number; total: number } | null {
  if (!ecf) return null;
  const ar = (ecf.arabica_washed_mt || 0) + (ecf.arabica_unwashed_mt || 0);
  const ro = ecf.robusta_mt || 0;
  return { Arabica: ar, Robusta: ro, total: ecf.value_mt || ar + ro };
}

function EcfTile({ totals, ecf, unit }: { totals: Record<string, number>; ecf: EcfMonth | null; unit: Unit }) {
  const e = ecfByType(ecf);
  // Spot totals are in `unit`; ECF is MT — convert spot back to MT for the ratio.
  const spotMt = (t: string) => (unit === "mt" ? (totals[t] || 0) : ((totals[t] || 0) * 60) / 1000);
  const pct = e && e.total ? ((spotMt("Arabica") + spotMt("Robusta")) / e.total) * 100 : null;
  return (
    <Tile label="vs ECF stocks">
      {pct == null ? <div className="text-[11px] text-slate-500 pt-1">ECF data unavailable</div> : (
        <>
          <div className="text-xl font-bold text-slate-100 font-mono">{pct.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-500 mt-1">of ECF European stocks{ecf ? ` (${ecf.period})` : ""}</div>
        </>
      )}
    </Tile>
  );
}

/* ── volume over time ────────────────────────────────────────────────────── */
function VolumeOverTime({ snaps, unit, totalsNow, asOf }: {
  snaps: Snapshot[]; unit: Unit; totalsNow: Record<string, number>; asOf: string;
}) {
  const data = useMemo(() => {
    const pick = (s: Snapshot, t: string) => (unit === "mt" ? s.tons_by_type[t] : s.bags_by_type[t]) || 0;
    const out = snaps.map((s) => ({ date: s.date, Arabica: pick(s, "Arabica"), Robusta: pick(s, "Robusta") }));
    // Ensure today's live snapshot is present even before the first history write.
    if (!out.some((o) => o.date === asOf)) {
      out.push({ date: asOf, Arabica: totalsNow.Arabica || 0, Robusta: totalsNow.Robusta || 0 });
    }
    return out;
  }, [snaps, unit, totalsNow, asOf]);

  if (data.length <= 1) {
    return (
      <div className="text-[11px] text-slate-500">
        One snapshot so far ({data[0]?.date}). The stacked Arabica/Robusta trend builds as weekly
        snapshots accumulate — today: <span className="font-mono text-slate-300">
          {fmtVol((totalsNow.Arabica || 0) + (totalsNow.Robusta || 0), unit)} {unitLabel(unit)}
        </span> (Arabica {fmtVol(totalsNow.Arabica || 0, unit)} · Robusta {fmtVol(totalsNow.Robusta || 0, unit)}).
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={48} />
        <Tooltip contentStyle={TT} formatter={(v) => `${fmtVol(Number(v), unit)} ${unitLabel(unit)}`} />
        <Area type="monotone" dataKey="Robusta" stackId="1" stroke={TYPE_COLORS.Robusta} fill={TYPE_COLORS.Robusta} fillOpacity={0.55} />
        <Area type="monotone" dataKey="Arabica" stackId="1" stroke={TYPE_COLORS.Arabica} fill={TYPE_COLORS.Arabica} fillOpacity={0.55} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── port square-map ─────────────────────────────────────────────────────── */
type ColorBy = "origin" | "crop" | "type" | "cert";
const CERT_COLOR = (c: string) => (c.trim() ? "#10b981" : "#475569");

function PortSquareMap({ rows, unit }: { rows: SpotRow[]; unit: Unit }) {
  const [colorBy, setColorBy] = useState<ColorBy>("origin");
  const [sortBy, setSortBy] = useState<"price" | "vol" | "origin">("price");
  const [typeF, setTypeF] = useState<"All" | "Arabica" | "Robusta">("All");
  const [hover, setHover] = useState<SpotRow | null>(null);

  // One square = a fixed 20 t parcel: an offer of N t draws round(N / 20)
  // squares (a 60 t offer → 3 squares; rounded when not an exact multiple).
  // In bags-mode the same 20 t is shown as its bag-equivalent (≈333 bags).
  const MT_PER_SQUARE = 20;
  const sqSize = unit === "mt" ? MT_PER_SQUARE : Math.round((MT_PER_SQUARE * 1000) / 60);

  const ports = useMemo(() => {
    const filt = rows.filter((r) => typeF === "All" || r.Type === typeF);
    const byPort: Record<string, SpotRow[]> = {};
    for (const r of filt) (byPort[r.Port || "—"] ||= []).push(r);
    const sortRows = (a: SpotRow, b: SpotRow) => {
      if (sortBy === "vol") return offerTons(b) - offerTons(a);
      if (sortBy === "origin") return (a.Origin || "").localeCompare(b.Origin || "");
      const pa = parsePrice(a.Price).diff, pb = parsePrice(b.Price).diff;
      return (pa ?? 1e9) - (pb ?? 1e9); // cheapest (most negative) first; outrights last
    };
    return Object.entries(byPort)
      .map(([port, rs]) => ({
        port, rows: [...rs].sort(sortRows),
        vol: rs.reduce((a, r) => a + offerVol(r, unit), 0),
      }))
      .sort((a, b) => b.vol - a.vol);
  }, [rows, typeF, sortBy, unit]);

  const fillOf = (r: SpotRow): string => {
    if (colorBy === "origin") return originColor(r.Origin);
    if (colorBy === "crop") return cropTier(r.Crop).color;
    if (colorBy === "type") return TYPE_COLORS[r.Type] ?? "#64748b";
    return CERT_COLOR(r.Certification);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
        <Seg label="Type" val={typeF} set={setTypeF} opts={["All", "Arabica", "Robusta"] as const} />
        <Seg label="Color" val={colorBy} set={setColorBy} opts={["origin", "crop", "type", "cert"] as const} />
        <Seg label="Sort" val={sortBy} set={setSortBy} opts={["price", "vol", "origin"] as const} />
        <span className="text-slate-600">1 □ ≈ {sqSize} {unitLabel(unit)}</span>
      </div>

      {/* Hover detail strip */}
      <div className="h-7 mb-1 text-[10px] flex items-center">
        {hover ? (
          <span className="text-slate-300 truncate">
            <span className="w-2 h-2 inline-block rounded-sm mr-1 align-middle" style={{ background: originColor(hover.Origin) }} />
            <b>{hover.Origin}</b> · {hover.Quality} {hover["Quality cont."]} · {hover.Crop || "crop n/a"} ·{" "}
            {fmtVol(offerVol(hover, unit), unit)} {unitLabel(unit)} · {hover.Port}{hover.Warehouse ? ` / ${hover.Warehouse}` : ""} ·{" "}
            {hover.Terms} · <span className={parsePrice(hover.Price).cls}>{parsePrice(hover.Price).text}</span>
            {hover.Certification ? <span className="text-emerald-300"> · {hover.Certification}</span> : ""}
          </span>
        ) : <span className="text-slate-600">Hover a square for the offer.</span>}
      </div>

      <div className="max-h-[420px] overflow-auto space-y-1 pr-1">
        {ports.map(({ port, rows: prs, vol }) => (
          <div key={port} className="flex items-start gap-2">
            <div className="w-24 shrink-0 text-right">
              <div className="text-[11px] text-slate-300 truncate">{port}</div>
              <div className="text-[9px] text-slate-600 font-mono">{fmtVol(vol, unit)}</div>
            </div>
            <div className="flex flex-wrap gap-[2px] content-start">
              {prs.flatMap((r, ri) => {
                // No cap — every 20 t parcel is drawn so the volume is shown
                // honestly, however large the offer.
                const n = Math.max(1, Math.round(offerVol(r, unit) / sqSize));
                const border = cropTier(r.Crop).color;
                return Array.from({ length: n }).map((_, k) => (
                  <span key={`${ri}-${k}`}
                    onMouseEnter={() => setHover(r)}
                    style={{ background: fillOf(r), borderColor: border }}
                    className="w-[11px] h-[11px] rounded-[2px] border cursor-pointer hover:ring-1 hover:ring-white/60" />
                ));
              })}
            </div>
          </div>
        ))}
      </div>
      <Legend colorBy={colorBy} rows={rows} />
    </div>
  );
}

function Legend({ colorBy, rows }: { colorBy: ColorBy; rows: SpotRow[] }) {
  if (colorBy === "crop") {
    const tiers = [["fresh", "#34d399"], ["recent", "#a3e635"], ["older", "#fbbf24"], ["old", "#fb7185"], ["n/a", "#475569"]];
    return <LegendRow items={tiers.map(([l, c]) => ({ l, c }))} note="fill = crop freshness · border = crop too" />;
  }
  if (colorBy === "type") return <LegendRow items={[{ l: "Arabica", c: TYPE_COLORS.Arabica }, { l: "Robusta", c: TYPE_COLORS.Robusta }]} note="border = crop freshness" />;
  if (colorBy === "cert") return <LegendRow items={[{ l: "certified", c: "#10b981" }, { l: "none", c: "#475569" }]} note="border = crop freshness" />;
  const top = topBy(rows, (r) => r.Origin, (r) => offerTons(r)).slice(0, 12);
  return <LegendRow items={top.map((o) => ({ l: o, c: originColor(o) }))} note="border = crop freshness" />;
}
function LegendRow({ items, note }: { items: { l: string; c: string }[]; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[9px] text-slate-400">
      {items.map((i) => (
        <span key={i.l} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.c }} />{i.l}
        </span>
      ))}
      {note && <span className="text-slate-600 italic">· {note}</span>}
    </div>
  );
}

function Seg<T extends string>({ label, val, set, opts }: { label: string; val: T; set: (v: T) => void; opts: readonly T[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className="inline-flex rounded border border-slate-700 overflow-hidden">
        {opts.map((o) => (
          <button key={o} onClick={() => set(o)}
            className={`px-1.5 py-0.5 capitalize ${val === o ? "bg-slate-600 text-slate-100" : "bg-slate-900 text-slate-400 hover:text-slate-200"}`}>{o}</button>
        ))}
      </span>
    </span>
  );
}

/* ── differential finder ─────────────────────────────────────────────────── */
function DifferentialFinder({ rows, unit }: { rows: SpotRow[]; unit: Unit }) {
  const [typeF, setTypeF] = useState<"All" | "Arabica" | "Robusta">("All");
  const [origin, setOrigin] = useState("ALL");
  const [q, setQ] = useState("");
  const [certOnly, setCertOnly] = useState(false);

  const origins = useMemo(() => uniq(rows.map((r) => r.Origin).filter(Boolean)).sort(), [rows]);

  const pts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeF !== "All" && r.Type !== typeF) return false;
      if (origin !== "ALL" && r.Origin !== origin) return false;
      if (certOnly && !r.Certification.trim()) return false;
      if (needle && !Object.values(r).some((v) => (v || "").toLowerCase().includes(needle))) return false;
      return parsePrice(r.Price).kind === "diff";
    }).map((r) => ({
      x: parsePrice(r.Price).diff as number,
      y: offerVol(r, unit),
      origin: r.Origin, r,
    }));
  }, [rows, typeF, origin, q, certOnly, unit]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
        <Seg label="Type" val={typeF} set={setTypeF} opts={["All", "Arabica", "Robusta"] as const} />
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200">
          <option value="ALL">All origins</option>
          {origins.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="quality / port…"
          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200 placeholder-slate-600 w-36" />
        <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
          <input type="checkbox" checked={certOnly} onChange={(e) => setCertOnly(e.target.checked)} /> certified
        </label>
        <span className="text-slate-600">{pts.length} offers</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
          <CartesianGrid stroke="#1e293b" />
          <XAxis type="number" dataKey="x" name="differential" tick={{ fontSize: 10, fill: "#94a3b8" }}
            label={{ value: "differential (¢/lb)", position: "insideBottom", offset: -6, fontSize: 10, fill: "#64748b" }} />
          <YAxis type="number" dataKey="y" name="volume" width={48} tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <ZAxis range={[28, 28]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={TT} content={<FinderTip unit={unit} />} />
          <Scatter data={pts} fillOpacity={0.8}>
            {pts.map((p, i) => <Cell key={i} fill={originColor(p.origin)} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
function FinderTip({ active, payload, unit }: {
  active?: boolean; payload?: Array<{ payload: { r: SpotRow } }>; unit: Unit;
}) {
  if (!active || !payload?.length) return null;
  const r: SpotRow = payload[0].payload.r;
  const p = parsePrice(r.Price);
  return (
    <div className="bg-slate-900 border border-slate-700 rounded p-2 text-[10px] text-slate-200 max-w-[220px]">
      <div className="font-semibold">{r.Origin} · <span className={p.cls}>{p.text}</span></div>
      <div className="text-slate-400">{r.Quality} {r["Quality cont."]}</div>
      <div className="text-slate-500">{fmtVol(offerVol(r, unit), unit)} {unitLabel(unit)} · {r.Port} · {r.Terms} · {r.Crop || "crop n/a"}{r.Certification ? ` · ${r.Certification}` : ""}</div>
    </div>
  );
}

/* ── ECF comparison ──────────────────────────────────────────────────────── */
function EcfComparison({ totals, ecf, unit }: { totals: Record<string, number>; ecf: EcfMonth | null; unit: Unit }) {
  const e = ecfByType(ecf);
  if (!e) return <div className="text-[11px] text-slate-500">ECF stock data unavailable.</div>;
  const spotMt = (t: string) => (unit === "mt" ? (totals[t] || 0) : ((totals[t] || 0) * 60) / 1000);
  const rowsD = [
    { label: "Arabica", spot: spotMt("Arabica"), ecf: e.Arabica, color: TYPE_COLORS.Arabica },
    { label: "Robusta", spot: spotMt("Robusta"), ecf: e.Robusta, color: TYPE_COLORS.Robusta },
    { label: "Total", spot: spotMt("Arabica") + spotMt("Robusta"), ecf: e.total, color: "#38bdf8" },
  ];
  return (
    <div className="space-y-3">
      {rowsD.map((r) => {
        const pct = r.ecf ? (r.spot / r.ecf) * 100 : 0;
        return (
          <div key={r.label}>
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="text-slate-300">{r.label}</span>
              <span className="text-slate-400">
                spot <span className="font-mono text-slate-200">{Math.round(r.spot).toLocaleString()}</span> t /
                ECF <span className="font-mono text-slate-200">{Math.round(r.ecf).toLocaleString()}</span> t ·
                <span className="font-mono text-amber-300"> {pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-3 bg-slate-800 rounded overflow-hidden relative">
              <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: r.color }} />
            </div>
          </div>
        );
      })}
      <p className="text-[9px] text-slate-600">ECF European port stocks{ecf ? `, ${ecf.period}` : ""}. Bars show spot offered as % of ECF stock.</p>
    </div>
  );
}

/* ── origin × port heatmap ───────────────────────────────────────────────── */
function topBy(rows: SpotRow[], key: (r: SpotRow) => string, val: (r: SpotRow) => number): string[] {
  const m: Record<string, number> = {};
  for (const r of rows) { const k = key(r) || "—"; m[k] = (m[k] || 0) + val(r); }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
function OriginPortHeatmap({ rows, unit }: { rows: SpotRow[]; unit: Unit }) {
  const origins = topBy(rows, (r) => r.Origin, (r) => offerTons(r)).slice(0, 12);
  const ports = topBy(rows, (r) => r.Port, (r) => offerTons(r)).slice(0, 8);
  const cell: Record<string, number> = {};
  let max = 0;
  for (const r of rows) {
    if (!origins.includes(r.Origin) || !ports.includes(r.Port)) continue;
    const k = `${r.Origin}|${r.Port}`;
    cell[k] = (cell[k] || 0) + offerVol(r, unit);
    if (cell[k] > max) max = cell[k];
  }
  return (
    <div className="overflow-auto">
      <table className="text-[9px] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-slate-900/40" />
            {ports.map((p) => <th key={p} className="px-1 py-1 text-slate-400 font-normal -rotate-0 whitespace-nowrap">{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {origins.map((o) => (
            <tr key={o}>
              <td className="sticky left-0 bg-slate-900/40 pr-1 text-right text-slate-300 whitespace-nowrap">
                <span className="w-2 h-2 inline-block rounded-sm mr-1" style={{ background: originColor(o) }} />{o}
              </td>
              {ports.map((p) => {
                const v = cell[`${o}|${p}`] || 0;
                const a = max ? v / max : 0;
                return (
                  <td key={p} title={v ? `${o} · ${p}: ${fmtVol(v, unit)} ${unitLabel(unit)}` : ""}
                    className="text-center font-mono"
                    style={{ background: v ? `rgba(56,189,248,${0.12 + a * 0.7})` : "transparent", color: a > 0.5 ? "#0f172a" : "#94a3b8" }}>
                    {v ? fmtVol(v, unit) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── crop-year freshness ─────────────────────────────────────────────────── */
function CropYearFreshness({ rows, unit }: { rows: SpotRow[]; unit: Unit }) {
  const data = useMemo(() => {
    const m: Record<string, { vol: number; color: string; sort: number }> = {};
    for (const r of rows) {
      const t = cropTier(r.Crop);
      const label = t.year ? r.Crop.trim() || String(t.year) : "n/a";
      const e = (m[label] ||= { vol: 0, color: t.color, sort: t.year ?? -1 });
      e.vol += offerVol(r, unit);
    }
    return Object.entries(m).map(([label, v]) => ({ label, vol: v.vol, color: v.color, sort: v.sort }))
      .sort((a, b) => b.sort - a.sort);
  }, [rows, unit]);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={0} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={48} />
        <Tooltip contentStyle={TT} formatter={(v) => `${fmtVol(Number(v), unit)} ${unitLabel(unit)}`} />
        <Bar dataKey="vol">{data.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
