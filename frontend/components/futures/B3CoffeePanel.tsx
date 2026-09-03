"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

import { fmtDateLabel, chgTone } from "@/lib/formatters";

// Both files share this shape: brazil_b3_arabica.json (noticiasagricolas
// republisher, US$/saca, deep backfilled history) and brazil_b3_conilon.json
// (B3 DerivativeQuotation API, R$/saca, accumulates daily from first export).
interface B3Contract {
  month:   string;
  price:   number;
  var?:    string;         // arabica file: day-over-day variation string
  symb?:   string;         // conilon file: B3 symbol (CNLF27, …)
  oi?:     number | null;  // conilon file: open contracts
  expiry?: string;         // conilon file: maturity date
}
interface B3Entry {
  date:        string;
  front_month: string | null;
  front_price: number | null;
  contracts:   B3Contract[];
}
interface B3Doc {
  unit?:    string;
  source?:  string;
  history?: B3Entry[];
}

// brazil_conilon_vitoria.json — physical conilon at the CNL delivery point
// (noticiasagricolas, backfilled to 2022). Its quotes[] carries the São
// Gabriel cooperative (Cooabriel) Tipo 7 price alongside the CCCV benchmark.
interface PhysQuote { section: string; tipo: string; price: number }
interface PhysEntry { date: string; benchmark: number | null; quotes?: PhysQuote[] }
interface PhysDoc   { source?: string; history?: PhysEntry[] }

// futures_price_history.json — the NY/London front-contract daily settles.
// Arabica is quoted in US cents/lb; the B3 arabica board is US$/saca, so the
// overlay converts (a saca is 60 kg = 132.2774 lb) and the visible gap between
// the two lines IS the Brazilian differential to New York.
interface PriceHistDoc { arabica?: { date: string; price: number }[] }
const LB_PER_SACA = 60 / 0.45359237;

// cepea_conilon_indicator.json — CEPEA/ESALQ conilon daily indicator.
interface CepeaEntry { date: string; price: number }
interface CepeaDoc   { source?: string; history?: CepeaEntry[] }

// A physical/reference series drawn alongside the futures front line.
interface Overlay {
  key:    string;                            // series field name in the chart rows
  name:   string;                            // legend / tooltip label
  color:  string;
  points: { date: string; value: number }[];
}

type Window = "1M" | "3M" | "6M" | "1Y" | "2Y";
const WINDOW_DAYS: Record<Window, number> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730 };

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function unitSymbol(unit?: string): string {
  return unit?.startsWith("BRL") ? "R$" : "US$";
}

function MarketCard({ title, doc, color, window: win, overlays, altUnit }: {
  title: string; doc: B3Doc | null; color: string; window: Window;
  overlays?: Overlay[];
  /** Optional second quoting convention, toggled from the card header. */
  altUnit?: { label: string; sym: string; suffix: string; factor: number };
}) {
  const hist = useMemo(() => doc?.history ?? [], [doc]);
  const shown = useMemo(() => (overlays ?? []).filter(o => o.points.length > 0), [overlays]);
  const [useAlt, setUseAlt] = useState(false);

  // One scalar rescales every number on the card — headline, chart, overlays
  // and curve table alike. That is what keeps the KC overlay honest: it is
  // stored converted to US$/saca, so switching to ¢/lb divides it straight
  // back to the quote New York actually prints, with no second conversion.
  const alt = useAlt && altUnit ? altUnit : null;
  const scale = alt ? alt.factor : 1;
  const sym = alt ? alt.sym : unitSymbol(doc?.unit);
  const suffix = alt ? alt.suffix : "/saca";

  // Union of futures + overlay dates in-window; each row carries whichever
  // series has a value that day so the deep physical history draws even where
  // the young futures series has no points yet.
  const series = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS[win]);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const rows = new Map<string, { date: string; label: string; [k: string]: string | number | undefined }>();
    const row = (date: string) => {
      const r = rows.get(date) ?? { date, label: fmtDateLabel(date) };
      rows.set(date, r);
      return r;
    };
    for (const e of hist) {
      if (e.date >= cutoffIso && e.front_price != null) row(e.date).price = e.front_price * scale;
    }
    for (const o of shown) {
      for (const p of o.points) {
        if (p.date >= cutoffIso) row(p.date)[o.key] = p.value * scale;
      }
    }
    return Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [hist, shown, win, scale]);

  const last = hist.length ? hist[hist.length - 1] : null;
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const chg = last?.front_price != null && prev?.front_price != null
    ? last.front_price - prev.front_price : null;
  const chgPct = chg != null && prev?.front_price ? (chg / prev.front_price) * 100 : null;

  if (!last && series.length === 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
        <div className="text-slate-200 text-[11px] font-bold mb-1">{title}</div>
        <div className="text-[10px] text-slate-500 italic">
          No data yet — the series starts accumulating with the next daily export.
        </div>
      </div>
    );
  }

  const showOi = (last?.contracts ?? []).some(c => c.oi != null);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-slate-200 text-[11px] font-bold">{title}</div>
          <div className="text-[9px] text-slate-500">{doc?.source}{last ? ` · ${last.date}` : ""}</div>
          {altUnit && (
            <div className="mt-1 inline-flex overflow-hidden rounded border border-slate-600 text-[9px]">
              {[false, true].map(v => (
                <button key={String(v)} onClick={() => setUseAlt(v)}
                  className={`px-1.5 py-px transition ${useAlt === v
                    ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                  {v ? altUnit.label : `${unitSymbol(doc?.unit)}/saca`}
                </button>
              ))}
            </div>
          )}
        </div>
        {last && (
          <div className="text-right">
            <div className="text-base font-bold font-mono text-slate-100">
              {sym} {last.front_price != null
                ? (last.front_price * scale).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : "—"}
              <span className="text-[9px] text-slate-500 font-normal"> {suffix}</span>
            </div>
            <div className="text-[10px] font-mono">
              <span className="text-slate-400">{last.front_month}</span>
              {chg != null && (
                <span className={chgTone(chg)}>
                  {"  "}{chg >= 0 ? "+" : ""}{(chg * scale).toFixed(2)}{chgPct != null ? ` (${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(1)}%)` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 8 }} minTickGap={24} />
            <YAxis stroke="#64748b" tick={{ fontSize: 8 }} domain={["auto", "auto"]} width={44}
              tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8", fontSize: 10 }}
              formatter={(v) => typeof v === "number" ? `${sym} ${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}${suffix}` : "—"} />
            {shown.map(o => (
              <Line key={o.key} type="monotone" dataKey={o.key} name={o.name} stroke={o.color}
                strokeWidth={1.2} strokeDasharray="4 3" dot={false} connectNulls />
            ))}
            {/* Dots while the series is young: a 1–2 session line with
                dot=false renders as almost nothing next to deep overlays. */}
            <Line type="monotone" dataKey="price" name={`${title} front`} stroke={color}
              strokeWidth={1.5} connectNulls
              dot={series.filter(r => r.price != null).length <= 15
                ? { r: 2.5, fill: color, strokeWidth: 0 } : false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[9px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{series.length} sessions in window</span>
        {shown.map(o => (
          <span key={o.key} style={{ color: o.color }}>┅ {o.name}</span>
        ))}
      </div>

      {/* Latest curve */}
      {last && (
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="font-normal">Contract</th>
              <th className="font-normal text-right">{sym}{suffix}</th>
              <th className="font-normal text-right">{showOi ? "OI" : "Δ"}</th>
            </tr>
          </thead>
          <tbody>
            {last.contracts.map((c, i) => (
              <tr key={c.symb ?? `${c.month}-${i}`} className="text-slate-300">
                <td>{c.month}</td>
                <td className="text-right">{(c.price * scale).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="text-right text-slate-400">{showOi ? (c.oi ?? "—") : (c.var || "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function B3CoffeePanel() {
  const [arabica, setArabica] = useState<B3Doc | null>(null);
  const [conilon, setConilon] = useState<B3Doc | null>(null);
  const [vitoria, setVitoria] = useState<PhysDoc | null>(null);
  const [cepea,   setCepea]   = useState<CepeaDoc | null>(null);
  const [ny,      setNy]      = useState<PriceHistDoc | null>(null);
  const [window,  setWindow]  = useState<Window>("6M");

  useEffect(() => {
    fetch("/data/brazil_b3_arabica.json")
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setArabica(d); })
      .catch(() => { /* card shows empty state */ });
    fetch("/data/brazil_b3_conilon.json")
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setConilon(d); })
      .catch(() => { /* card shows empty state */ });
    // Physical conilon at the CNL delivery point — carries the Cooabriel
    // (Coop. São Gabriel) Tipo 7 quote, deep history to 2022.
    fetch("/data/brazil_conilon_vitoria.json")
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setVitoria(d); })
      .catch(() => { /* futures-only */ });
    // CEPEA/ESALQ conilon daily indicator.
    fetch("/data/cepea_conilon_indicator.json")
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setCepea(d); })
      .catch(() => { /* futures-only */ });
    // NY KC front settles — overlaid on the arabica board for the differential.
    fetch("/data/futures_price_history.json")
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setNy(d); })
      .catch(() => { /* B3-only */ });
  }, []);

  // NY KC on the B3 arabica card, restated in US$/saca so both lines share an
  // axis — the spread between them is the Brazil differential.
  const arabicaOverlays = useMemo<Overlay[]>(() => [{
    // Name carries no unit: the card can be toggled to ¢/lb, where this line
    // is New York's native quote rather than a conversion.
    key: "kc", name: "NY KC front", color: "#38bdf8",
    points: (ny?.arabica ?? [])
      .filter(p => p.price != null)
      .map(p => ({ date: p.date, value: p.price * LB_PER_SACA / 100 })),
  }], [ny]);

  // Conilon references drawn with the CNL front (solid emerald): the CCCV
  // T7/8 delivery-spec physical (grey — the deep history the young futures
  // series cannot provide itself) + CEPEA indicator + Cooabriel CON7.
  const conilonOverlays = useMemo<Overlay[]>(() => [
    {
      key: "cccv", name: "Vitória disponível T7/8", color: "#64748b",
      points: (vitoria?.history ?? [])
        .filter(e => e.benchmark != null)
        .map(e => ({ date: e.date, value: e.benchmark as number })),
    },
    {
      key: "cepea", name: "CEPEA/ESALQ indicator", color: "#38bdf8",
      points: (cepea?.history ?? [])
        .filter(e => e.price != null)
        .map(e => ({ date: e.date, value: e.price })),
    },
    {
      key: "con7", name: "Cooabriel CON7", color: "#fb7185",
      points: (vitoria?.history ?? []).flatMap(e => {
        const q = (e.quotes ?? []).find(x =>
          x.tipo.trim() === "Tipo 7" && /S[ãa]o Gabriel/i.test(x.section));
        return q ? [{ date: e.date, value: q.price }] : [];
      }),
    },
  ], [cepea, vitoria]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">B3 (Brazil) Coffee Futures</h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Front-contract settlement on Brazil&apos;s own exchange: Arábica 4/5 (ICF, US$/saca) and
            Conilon tipo 7/8 (CNL, R$/saca — physical delivery Vitória-ES). The domestic curve vs
            NY/London shows how much of the move is Brazil-specific vs global.
          </p>
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
          {(["1M","3M","6M","1Y","2Y"] as Window[]).map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-2.5 py-1.5 transition ${window === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MarketCard title="B3 Arábica 4/5 (Pregão Regular)" doc={arabica} color="#f59e0b" window={window}
          overlays={arabicaOverlays}
          altUnit={{ label: "¢/lb", sym: "¢", suffix: "/lb", factor: 100 / LB_PER_SACA }} />
        <MarketCard title="B3 Conilon 7/8 (CNL)"            doc={conilon} color="#34d399" window={window}
          overlays={conilonOverlays} />
      </div>
    </div>
  );
}
