"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. Returns false during SSR / before mount
 * to avoid hydration mismatches (callers should treat that as desktop-safe default
 * only when paired with CSS that also gates mobile-only chrome).
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();

    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** Tailwind `md` breakpoint (768px) — true when viewport is below md. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
