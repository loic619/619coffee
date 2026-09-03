"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A preference that lives in the URL AND in localStorage, without
 * useSearchParams.
 *
 * useUrlState is the right tool for a page's own sub-tab, but it reads
 * useSearchParams, which Next 14 requires to sit under a Suspense boundary
 * during static prerender — and these two preferences (display unit, chosen
 * contract) are read from panels that also render inside the Report Builder
 * on the Brief, outside any boundary. So this reads window.location after
 * mount, writes with router.replace, and keeps a stored copy so the choice
 * follows the reader across tabs where the URL does not carry it.
 */
export function useUrlPref(
  key: string,
  storageKey: string,
  valid: (raw: string) => boolean,
  fallback: string,
): [string, (next: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState<string>(fallback);

  useEffect(() => {
    const read = () => {
      let v: string | null = null;
      try { v = new URLSearchParams(window.location.search).get(key); } catch { /* ssr */ }
      if (!v || !valid(v)) {
        try { v = window.localStorage.getItem(storageKey); } catch { v = null; }
      }
      setValue(v && valid(v) ? v : fallback);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [key, storageKey, valid, fallback]);

  const set = useCallback((next: string) => {
    const clean = valid(next) ? next : fallback;
    setValue(clean);
    try {
      if (clean === fallback) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, clean);
    } catch { /* ignore */ }
    const sp = new URLSearchParams(window.location.search);
    if (clean === fallback) sp.delete(key); else sp.set(key, clean);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}${window.location.hash}` : `${pathname}${window.location.hash}`, { scroll: false });
  }, [router, pathname, key, storageKey, valid, fallback]);

  return [value, set];
}
