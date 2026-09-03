"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cachedFetchStatic } from "@/lib/api";
import { fobbingUsdMt } from "@/lib/originCosts";
import { KC_CENTS_TO_USD_MT } from "@/lib/units";

type TickerCategory = "futures" | "physical" | "fx";

interface TickerItem {
  label: string;
  value: string;
  category: TickerCategory;
}

interface AcapheContract {
  month: string;
  last: number | null;
  change: number;
  vol: number | null;
  oi: number | null;
}

interface AcapheData {
  fetched_at: string;
  robusta: AcapheContract[];
  arabica: AcapheContract[];
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function stalenessColor(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "text-emerald-500";
  if (hours < 24) return "text-yellow-500";
  return "text-red-500";
}

// Pick the active front month: highest open interest (persists outside trading hours)
function frontByOI(contracts: AcapheContract[]): AcapheContract | null {
  if (!contracts.length) return null;
  return contracts.reduce((best, c) =>
    (c.oi ?? 0) > (best.oi ?? 0) ? c : best, contracts[0]);
}

// "AN 07/26" → "KCN26", "RN 07/26" → "RMN26"
function acapheLabel(month: string, prefix: "KC" | "RM" | "RC"): string {
  const parts = month.trim().split(/\s+/);
  if (parts.length < 2) return prefix;
  const letter = parts[0].slice(-1);   // last char of "AN" / "RN"
  const year   = parts[1].slice(-2);   // last 2 chars of "07/26" → "26"
  return `${prefix}${letter}${year}`;
}

async function fetchAcaphe(): Promise<AcapheData | null> {
  try {
    const r = await fetch("/api/live");
    if (r.ok) {
      const d = await r.json();
      if (!d.error && d.robusta && d.arabica) return d as AcapheData;
    }
  } catch { /* fall through */ }
  try {
    const r = await fetch(`/data/acaphe_live.json?_=${Date.now()}`);
    if (r.ok) return await r.json() as AcapheData;
  } catch { /* ignore */ }
  return null;
}

// Origin FOBbing cost (USD/tonne) is the single source of truth in
// lib/originCosts; it's added to the physical spot before computing the N±diff
// so all tickers are comparable at port/exchange parity.

interface ChainContract { symbol: string; last: number; oi: number }
interface ChainData {
  robusta: { contracts: ChainContract[] } | null;
  arabica: { contracts: ChainContract[] } | null;
}

// Physical labels that are Arabica and therefore quote their N±diff against
// NY 'C' (KC), not RC. The ¢/lb → USD/MT factor comes from lib/units.
const ARABICA_PHYSICAL = new Set(["GT SHB"]);

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const pathname = usePathname();
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [acaphe, setAcaphe] = useState<AcapheData | null>(null);
  const [chain, setChain] = useState<ChainData | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () => {
      // The ticker is global (every tab); don't poll while the tab is
      // backgrounded — resume on visibilitychange below.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      return Promise.all([
        // Shared cache: latest_prices.json is also read by CoffeeMap — one
        // request serves both within the 5-min window.
        cachedFetchStatic<{ tickers?: TickerItem[]; generated_at?: string }>("/data/latest_prices.json").catch(() => null),
        fetchAcaphe(),
        // Barchart daily chain — the physical N±diff references this (the
        // settled exchange curve), not the intraday Acaphe quote.
        cachedFetchStatic<ChainData>("/data/futures_chain.json").catch(() => null),
      ]).then(([prices, live, chainData]) => {
        setTickers(prices?.tickers ?? []);
        setGeneratedAt(prices?.generated_at ?? null);
        if (live?.arabica && live?.robusta) setAcaphe(live);
        if (chainData?.robusta || chainData?.arabica) setChain(chainData);
      });
    };
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    const tick = setInterval(() => setTick(n => n + 1), 60_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval); clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Futures tickers: live Acaphe when available, else fall back to static
  const futureTickers: TickerItem[] = (() => {
    if (!acaphe) return tickers.filter(t => t.category === "futures");

    const kc = frontByOI(acaphe.arabica);
    const rc = frontByOI(acaphe.robusta);
    const out: TickerItem[] = [];

    if (kc?.last != null) {
      const sign = kc.change >= 0 ? "+" : "";
      out.push({
        label: acapheLabel(kc.month, "KC"),
        value: `${kc.last.toFixed(2)} (${sign}${kc.change.toFixed(2)})`,
        category: "futures",
      });
    }
    if (rc?.last != null) {
      const sign = rc.change >= 0 ? "+" : "";
      out.push({
        label: acapheLabel(rc.month, "RC"),
        value: `${Math.round(rc.last).toLocaleString()} (${sign}${Math.round(rc.change)})`,
        category: "futures",
      });
    }

    return out.length ? out : tickers.filter(t => t.category === "futures");
  })();

  const otherTickers = tickers.filter(t => t.category !== "futures");
  const allTickers = [...futureTickers, ...otherTickers];

  // RC reference = Barchart robusta contract with the highest open interest (the
  // active front the physical diffs are quoted against), not necessarily the
  // nearest expiry. Fall back to the live/static quote only if the chain isn't
  // available.
  const rcFront = (() => {
    const cs = chain?.robusta?.contracts;
    if (!cs?.length) return null;
    return cs.reduce((best, c) => (c.oi ?? 0) > (best.oi ?? 0) ? c : best, cs[0]);
  })();
  const rcLetter: string = (() => {
    const m = rcFront?.symbol.match(/^R[CM]([FGHJKMNQUVXZ])\d{2}$/i);
    return m ? m[1].toUpperCase() : "N";
  })();
  const rcPrice: number | null = (() => {
    if (rcFront?.last != null) return Math.round(rcFront.last);
    if (acaphe) {
      const rc = frontByOI(acaphe.robusta);
      if (rc?.last != null) return Math.round(rc.last);
    }
    const rm = futureTickers.find(t => /^R[MC]/.test(t.label));
    if (rm) {
      const m = rm.value.match(/^([0-9,]+)/);
      if (m) return parseInt(m[1].replace(/,/g, ""), 10);
    }
    return null;
  })();

  // KC reference (NY 'C') = Barchart arabica contract with the highest OI, in
  // USD/MT. Arabica physical origins (Guatemala) quote their N±diff against this.
  const kcFront = (() => {
    const cs = chain?.arabica?.contracts;
    if (!cs?.length) return null;
    return cs.reduce((best, c) => (c.oi ?? 0) > (best.oi ?? 0) ? c : best, cs[0]);
  })();
  const kcLetter: string = (() => {
    const m = kcFront?.symbol.match(/^KC([FGHJKMNQUVXZ])\d{2}$/i);
    return m ? m[1].toUpperCase() : "N";
  })();
  const kcPrice: number | null = kcFront?.last != null
    ? Math.round(kcFront.last * KC_CENTS_TO_USD_MT) : null;

  // Rewrite physical value strings to show the at-port USD (spot + FOBbing) and
  // its differential vs the relevant front. The differential is quoted in the
  // front contract's native metric: USD/MT for robusta origins (RC is quoted
  // per tonne) and US¢/lb for arabica origins (KC / NY 'C' is quoted per lb),
  // so a Guatemala diff reads like a real trade differential, not a ~22× USD/MT
  // figure. "$3,522, N-72" / "$5,708, KC+24.3¢".
  const formatPhysical = (value: string, label: string): string => {
    const isArabica = ARABICA_PHYSICAL.has(label);
    const ref    = isArabica ? kcPrice  : rcPrice;   // both USD/MT
    const letter = isArabica ? kcLetter : rcLetter;
    if (ref == null) return value;
    const usdMatch = value.match(/\$([0-9,]+)/);
    if (!usdMatch) return value;
    const usd = parseInt(usdMatch[1].replace(/,/g, ""), 10);
    const atPort = Math.round(usd + fobbingUsdMt(label, usd));
    const diffUsdMt = atPort - ref;
    // Arabica: express the NY differential in US¢/lb (KC's native unit).
    const diff = isArabica
      ? `${diffUsdMt >= 0 ? "+" : "-"}${(Math.abs(diffUsdMt) / KC_CENTS_TO_USD_MT).toFixed(1)}¢`
      : `${diffUsdMt >= 0 ? "+" : ""}${diffUsdMt}`;
    return value.replace(/\$[0-9,]+(?=\))/, `$${atPort.toLocaleString()}, ${letter}${diff}`);
  };

  const futuresTs  = acaphe?.fetched_at ?? null;
  const staticTs   = generatedAt;
  // Use acaphe ts for KC/RC, static ts for FX/physical
  const hasFutures = futureTickers.length > 0 && futuresTs;

  // The name gate is a standalone page — no app chrome.
  if (pathname === "/welcome") return null;

  if (allTickers.length === 0) return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 flex items-center shrink-0 px-3">
      <span className="text-indigo-400 text-xs font-bold border-r border-slate-700 pr-3 mr-3 shrink-0">MARKETS</span>
      <span className="text-slate-600 text-xs italic">No market data — waiting for scraper</span>
    </div>
  );

  const COLOR: Record<TickerCategory, string> = {
    futures:  "text-yellow-400",
    physical: "text-yellow-600",
    fx:       "text-sky-400",
  };

  const ORDER: TickerCategory[] = ["futures", "physical", "fx"];
  const groups = ORDER
    .map(cat => allTickers.filter(t => t.category === cat))
    .filter(g => g.length > 0);

  const tickerContent = groups.flatMap((group, gi) => {
    const items = group.map((t, i) => (
      <span key={`${t.label}-${i}`} className={`${COLOR[t.category]} font-mono`}>
        {t.label}: {t.category === "physical" ? formatPhysical(t.value, t.label) : t.value}
        {i < group.length - 1 && <span className="text-slate-500">{"   ·   "}</span>}
      </span>
    ));
    if (gi < groups.length - 1) {
      items.push(<span key={`sep-${gi}`} className="text-slate-500 mx-4">{"  |  "}</span>);
    }
    return items;
  });

  return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 overflow-hidden flex items-center shrink-0">
      {/* Fixed label — two staleness stamps, one per source */}
      <span className="flex flex-col justify-center px-3 shrink-0 border-r border-slate-700 mr-2 leading-none gap-0.5">
        <span className="text-indigo-400 text-xs font-bold tracking-wide">MARKETS</span>
        <span className="text-[8px] font-mono flex gap-1.5">
          {hasFutures && (
            <span className={stalenessColor(futuresTs!)}
              title={`KC/RC via Acaphe — ${futuresTs}`}>
              KC/RC {timeAgo(futuresTs!)}
            </span>
          )}
          {hasFutures && staticTs && (
            <span className="text-slate-600">·</span>
          )}
          {staticTs && (
            <span className={stalenessColor(staticTs)}
              title={`FX & physical via scraper — ${staticTs}`}>
              FX {timeAgo(staticTs)}
            </span>
          )}
        </span>
      </span>

      {/* Scrolling band — content duplicated for seamless loop */}
      <div
        className="overflow-hidden flex-1 relative"
        style={{ cursor: "default" }}
        onMouseEnter={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "paused";
        }}
        onMouseLeave={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "running";
        }}
      >
        <span className="ticker-track text-xs whitespace-nowrap">
          {/* Two identical copies — animation moves -50% so the seam is invisible */}
          <span className="inline-block pr-16">{tickerContent}</span>
          <span className="inline-block pr-16" aria-hidden="true">{tickerContent}</span>
        </span>
      </div>
    </div>
  );
}
