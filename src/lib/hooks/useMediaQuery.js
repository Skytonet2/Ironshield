"use client";
// useMediaQuery — subscribe to a CSS media query. Returns `true` when
// the query matches, `false` otherwise. Reacts to viewport changes
// without triggering per-resize re-renders (uses addEventListener on
// the MediaQueryList, not resize).
//
// Usage: const isMobile = useMediaQuery("(max-width: 899px)");

import { useEffect, useState } from "react";

export default function useMediaQuery(query) {
  // Always start false — on the server there's no window, and on the first
  // client render we MUST match the server output so hydration doesn't
  // bail. The useEffect below syncs the real value after mount, which
  // triggers a second render on mobile without a hydration mismatch.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
