"use client";
/**
 * Mounts the global data-fetch guard (retry + last-known-good fallback for
 * /data/*.json) app-wide. The import's module side-effect installs the fetch
 * wrapper during client bundle evaluation — before hydration, so it is in
 * place before any component effect fires a data fetch. Renders nothing.
 */
import "@/lib/dataFetchGuard";

export default function DataFetchGuard() {
  return null;
}
