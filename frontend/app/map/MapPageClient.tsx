"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import NewsSidebar from "@/components/map/NewsSidebar";
import NewsFeed from "@/components/map/NewsFeed";
import MapLegend from "@/components/map/MapLegend";
import AgronomicTicker from "@/components/map/AgronomicTicker";
import {
  fetchMapCountries, fetchMapFactories, fetchNews,
  type CountryPin, type FactoryPin, type FactoryType, type NewsItem,
} from "@/lib/api";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
      Loading map...
    </div>
  ),
});

export default function MapPageClient() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [countries, setCountries] = useState<CountryPin[]>([]);
  const [factories, setFactories] = useState<FactoryPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<NewsItem | null>(null);
  const [showFeed, setShowFeed] = useState(false);
  // Per-type factory filter. Empty Set = all visible. Toggled via MapLegend.
  const [hiddenFactoryTypes, setHiddenFactoryTypes] = useState<Set<FactoryType>>(() => new Set());
  const toggleFactoryType = useCallback((t: FactoryType) => {
    setHiddenFactoryTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchNews(), fetchMapCountries(), fetchMapFactories()])
      .then((results) => {
        if (cancelled) return;
        const [newsRes, countriesRes, factoriesRes] = results;
        const failures: string[] = [];
        if (newsRes.status === "fulfilled") setNews(newsRes.value);
        else { console.error("[map] fetchNews failed", newsRes.reason); failures.push("news"); }
        if (countriesRes.status === "fulfilled") setCountries(countriesRes.value);
        else { console.error("[map] fetchMapCountries failed", countriesRes.reason); failures.push("countries"); }
        if (factoriesRes.status === "fulfilled") setFactories(factoriesRes.value);
        else { console.error("[map] fetchMapFactories failed", factoriesRes.reason); failures.push("factories"); }
        // Only surface the error on non-localhost deploys — locally the backend
        // simply may not be running, which is fine (map loads without pins/news).
        const isLocal = typeof window !== "undefined" && (
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1"
        );
        if (!isLocal && failures.length > 0) {
          setError(failures.length === results.length
            ? "Couldn't reach the API. Check NEXT_PUBLIC_API_URL and that the backend is online."
            : `Some data failed to load: ${failures.join(", ")}.`
          );
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Every other tab had a header and a freshness bar; the map — until
          September 2026 the landing page — had neither. Its purpose is stated
          here rather than left to be inferred from the pins. */}
      <PageHeader
        title="Map"
        subtitle="Where coffee is grown, shipped and roasted — origin pins, ports, factories, and the latest news placed where it happened"
        healthKeys={["port_activity", "weather", "origin_prices"]}
      />
      {error && (
        <div className="bg-red-900/40 border-b border-red-700 text-red-200 text-xs px-4 py-2">
          {error}
        </div>
      )}
      <div className="flex-1 relative min-h-0">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            Loading data…
          </div>
        ) : (
          <>
            <CoffeeMap
              onPinClick={setSelectedPin}
              countries={countries}
              factories={factories}
              news={news}
              hiddenFactoryTypes={hiddenFactoryTypes}
            />
            <AgronomicTicker />
            <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
            <MapLegend
              hiddenFactoryTypes={hiddenFactoryTypes}
              onToggleFactoryType={toggleFactoryType}
            />
            <button
              onClick={() => setShowFeed(f => !f)}
              className="absolute bottom-2 right-2 z-[1000] bg-slate-800/90 border border-slate-600 text-slate-300 hover:text-white text-xs sm:text-[10px] px-3 py-2 sm:px-2 sm:py-1 rounded shadow"
            >
              {showFeed ? "▼ Hide table" : "▲ Show table"}
            </button>
          </>
        )}
      </div>
      {showFeed && !loading && <NewsFeed initialNews={news} />}
    </div>
  );
}
