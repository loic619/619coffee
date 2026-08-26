"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup as LeafletLayerGroup, Map as LeafletMap } from "leaflet";
import { RISK_META, type EnsoRiskPin, type RiskLevel } from "@/lib/enso";

const LEVELS: RiskLevel[] = ["high", "moderate", "low"];

const PHASE_LABEL: Record<string, string> = {
  flowering: "flowering",
  fruit_fill: "cherry fill",
  harvest: "harvest",
};
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct–Dec" for a run, "Jun" for one month — windows are already in
 *  chronological order, so a Nov–Jan harvest reads correctly. */
const MONTHS = (ms: number[]) =>
  ms.length === 0 ? "" : ms.length === 1 ? MON[ms[0]] : `${MON[ms[0]]}–${MON[ms[ms.length - 1]]}`;

// Phase 3 buoys layer — pulled lazily from /data/enso_thermocline.json
// (same file the EnsoThermoclineCard reads). We re-derive the marker
// styling from the buoy's kelvin_signal so the map and the card stay
// visually consistent without a shared component prop.
interface BuoyPin {
  station_id:    string;
  label:         string;
  lat:           number;
  lon:           number;
  latest_temp_c: number | null;
  latest_depth_m: number | null;
  delta_30d_c:   number | null;
  kelvin_signal: "warm-kelvin-wave" | "cold-kelvin-wave" | "neutral" | "no-data";
}
interface ThermoclineMinimal {
  thermocline: { depth_m: number; lead_weeks: string; buoys: BuoyPin[] };
}
const BUOY_COLOR: Record<BuoyPin["kelvin_signal"], string> = {
  "warm-kelvin-wave": "#ef4444",
  "cold-kelvin-wave": "#3b82f6",
  "neutral":          "#94a3b8",
  "no-data":          "#64748b",
};

export default function EnsoRiskMap({ pins }: { pins: EnsoRiskPin[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Record<RiskLevel, LeafletLayerGroup | null>>({ high: null, moderate: null, low: null });
  const buoyLayerRef = useRef<LeafletLayerGroup | null>(null);
  const [hidden, setHidden] = useState<Set<RiskLevel>>(() => new Set());
  const [buoysHidden, setBuoysHidden] = useState(false);
  const [buoyData, setBuoyData] = useState<BuoyPin[]>([]);

  // Pull thermocline buoys from the same JSON the card reads. Silent
  // fallback when missing — map still shows the crop-risk pins.
  useEffect(() => {
    fetch("/data/enso_thermocline.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ThermoclineMinimal | null) => {
        if (d?.thermocline?.buoys) setBuoyData(d.thermocline.buoys);
      })
      .catch(() => { /* no buoy layer, map degrades silently */ });
  }, []);

  const summary = useMemo(() => {
    const s: Record<RiskLevel, number> = { high: 0, moderate: 0, low: 0 };
    for (const p of pins) s[p.level] += 1;
    return s;
  }, [pins]);

  // Build the map once.
  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current || (mapRef.current as unknown as Record<string, unknown>)._leaflet_id) return;
      // @ts-expect-error — leaflet CSS has no type declarations
      import("leaflet/dist/leaflet.css");
      const Leaflet: typeof L = ((L as unknown as { default?: typeof L }).default) || L;

      const map = Leaflet.map(mapRef.current!, { zoomControl: false, worldCopyJump: true }).setView([8, 0], 2);
      mapInstanceRef.current = map;
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19 }
      ).addTo(map);
      Leaflet.control.zoom({ position: "topright" }).addTo(map);

      const groups: Record<RiskLevel, LeafletLayerGroup> = {
        high: Leaflet.layerGroup(),
        moderate: Leaflet.layerGroup(),
        low: Leaflet.layerGroup(),
      };
      for (const p of pins) {
        const radius = p.level === "high" ? 9 : p.level === "moderate" ? 7 : 5;
        Leaflet.circleMarker([p.lat, p.lon], {
          radius,
          color: p.color,
          fillColor: p.color,
          fillOpacity: 0.55,
          weight: 1.5,
        })
          .bindPopup(
            [
              `<b>${p.region}</b> · ${p.country}`,
              `Risk: <b style="color:${p.color}">${RISK_META[p.level].label}</b>`,
              p.driver,
              // The evidence behind the colour. A pin that cannot show which
              // crop phase it is worried about, and on what measured record,
              // is just an assertion with a hex code.
              ...(p.phase_hits ?? [])
                .filter((h) => h.severity > 0)
                .map(
                  (h) =>
                    `<span style="opacity:.75">${MONTHS(h.months)} · ${PHASE_LABEL[h.phase] ?? h.phase} (${h.cycle}) — ` +
                    `${h.anomaly_pct != null ? `${h.anomaly_pct > 0 ? "+" : ""}${h.anomaly_pct.toFixed(0)}% rain, ` : ""}` +
                    `${h.n} past events</span>`
                ),
              p.lag_months != null
                ? `<span style="opacity:.55">ENSO leads rainfall here by ${p.lag_months} mo</span>`
                : "",
            ]
              .filter(Boolean)
              .join("<br/>")
          )
          .addTo(groups[p.level]);
      }
      LEVELS.forEach((lvl) => groups[lvl].addTo(map));
      layersRef.current = groups;

      // Buoy layer is empty at map-build time; populated by the
      // separate effect once /data/enso_thermocline.json arrives.
      const buoyLayer = Leaflet.layerGroup().addTo(map);
      buoyLayerRef.current = buoyLayer;
    });

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [pins]);

  // Populate / refresh the buoy layer whenever the JSON loads.
  // Squares (not circles) distinguish buoys from the round risk pins;
  // popup shows the latest T-150m + 30-day delta + Kelvin classification.
  useEffect(() => {
    const layer = buoyLayerRef.current;
    if (!layer || buoyData.length === 0) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled) return;
      const Leaflet: typeof L = ((L as unknown as { default?: typeof L }).default) || L;
      layer.clearLayers();
      for (const b of buoyData) {
        const color = BUOY_COLOR[b.kelvin_signal];
        // Square marker via divIcon — clearly distinct from the
        // circle risk pins at the same zoom level.
        Leaflet.marker([b.lat, b.lon], {
          icon: Leaflet.divIcon({
            className: "",
            html: `<div style="width:10px;height:10px;background:${color};border:1.5px solid #1e293b;box-shadow:0 0 0 1px ${color};"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
        })
          .bindPopup(
            `<b>TAO ${b.station_id}</b> · ${b.label}<br/>` +
            (b.latest_temp_c != null
              ? `T-${b.latest_depth_m?.toFixed(0) ?? "150"}m: <b>${b.latest_temp_c.toFixed(2)} °C</b><br/>`
              : `<i>No recent telemetry</i><br/>`) +
            (b.delta_30d_c != null
              ? `Δ30d: <b style="color:${color}">${b.delta_30d_c >= 0 ? "+" : ""}${b.delta_30d_c.toFixed(2)} °C</b><br/>`
              : "") +
            `Signal: <b style="color:${color}">${b.kelvin_signal.replace(/-/g, " ")}</b>`
          )
          .addTo(layer);
      }
    });
    return () => { cancelled = true; };
  }, [buoyData]);

  // Toggle level layers on/off.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    LEVELS.forEach((lvl) => {
      const group = layersRef.current[lvl];
      if (!group) return;
      const isHidden = hidden.has(lvl);
      if (isHidden && map.hasLayer(group)) map.removeLayer(group);
      if (!isHidden && !map.hasLayer(group)) group.addTo(map);
    });
  }, [hidden]);

  // Toggle buoy layer.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = buoyLayerRef.current;
    if (!map || !layer) return;
    if (buoysHidden && map.hasLayer(layer)) map.removeLayer(layer);
    if (!buoysHidden && !map.hasLayer(layer)) layer.addTo(map);
  }, [buoysHidden]);

  const toggle = (lvl: RiskLevel) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  const developing = pins.filter((p) => p.status === "emerging").length;
  // A region with no measured response is a gap in the record, not a safe
  // region. Say so rather than letting it sit green and unexplained.
  const unmeasured = pins.filter((p) => p.measured === false).length;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Crop-risk map · click a region for the ENSO driver
          {developing > 0 && (
            // Derived from the pins themselves rather than plumbed in, so the
            // map cannot disagree with what it is drawing.
            <span
              className="ml-2 normal-case text-amber-400/90"
              title="NOAA confirms an ENSO event four to five months after onset. These pins read the observed ocean state and are capped at amber until the event is confirmed."
            >
              · {developing} region{developing === 1 ? "" : "s"} on a developing event (capped at amber)
            </span>
          )}
          {unmeasured > 0 && (
            <span
              className="ml-2 normal-case text-slate-500"
              title="These regions are in the origin list but their weather history has not been rebuilt under the current belt names, so there is nothing to score them against."
            >
              · {unmeasured} region{unmeasured === 1 ? "" : "s"} not yet measured
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {LEVELS.map((lvl) => {
            const off = hidden.has(lvl);
            return (
              <button
                key={lvl}
                onClick={() => toggle(lvl)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border transition ${
                  off ? "border-slate-700 text-slate-600" : "border-slate-600 text-slate-200"
                }`}
                title={off ? `Show ${RISK_META[lvl].label}` : `Hide ${RISK_META[lvl].label}`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: off ? "transparent" : RISK_META[lvl].color, border: `1px solid ${RISK_META[lvl].color}` }}
                />
                {RISK_META[lvl].label} ({summary[lvl]})
              </button>
            );
          })}
          {/* Buoy toggle — only shown when the JSON loaded */}
          {buoyData.length > 0 && (
            <button
              onClick={() => setBuoysHidden((b) => !b)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border transition ${
                buoysHidden ? "border-slate-700 text-slate-600" : "border-slate-600 text-slate-200"
              }`}
              title={buoysHidden ? "Show TAO buoys" : "Hide TAO buoys"}
            >
              <span
                className="inline-block w-2.5 h-2.5"
                style={{ background: buoysHidden ? "transparent" : "#94a3b8", border: `1px solid #94a3b8` }}
              />
              TAO buoys ({buoyData.length})
            </button>
          )}
        </div>
      </div>
      <div ref={mapRef} className="w-full rounded-md overflow-hidden" style={{ height: 360, background: "#0f172a" }} />
    </div>
  );
}

