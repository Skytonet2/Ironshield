"use client";
// useMediaQuery — subscribe to a CSS media query. Returns `true` when
// the query matches, `false` otherwise. Reacts to viewport changes
// without triggering per-resize re-renders (uses addEventListener on
// the MediaQueryList, not resize).
//
// Usage: const isMobile = useMediaQuery("(max-width: 899px)");

import { useEffect, useState } from "react";

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    // Re-sync on mount (client renders may differ from SSR initial).
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
