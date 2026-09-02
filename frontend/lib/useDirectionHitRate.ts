"use client";
import { useMemo } from "react";
import { useFetchJson } from "@/lib/useFetchJson";
import type { HitRate } from "@/components/ModelledBadge";

/**
 * The open-direction model's LIVE track record, from open_direction_history.json.
 *
 * Only `source: "live"` rows count — predictions published before the session
 * and graded afterwards. Backtest rows are the model looking at its own
 * training period and are reported separately by OpenDirectionCalendar; they
 * are not a hit rate in the sense a user needs. "Abstain" calls have hit=null
 * and are excluded, so this is the record of calls the model actually made.
 */
interface HistRow {
  source: string;
  status: string;
  hit: boolean | null;
}

export function useDirectionHitRate(): { hitRate: HitRate | null; loading: boolean } {
  const { data, loading } = useFetchJson<HistRow[]>("/data/open_direction_history.json");
  const hitRate = useMemo<HitRate | null>(() => {
    const graded = (data ?? []).filter(
      (r) => r.source === "live" && r.status === "resolved" && r.hit !== null,
    );
    if (!graded.length) return null;
    return {
      value: graded.filter((r) => r.hit).length / graded.length,
      n: graded.length,
      label: "live calls",
    };
  }, [data]);
  return { hitRate, loading };
}
