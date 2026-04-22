"use client";
// /aio has been retired. The live WS tracker stream folded into /feed
// under the "For You" and "Alpha" tabs. Any bookmark or legacy link
// that still points here gets redirected to /feed on mount.

import { useEffect } from "react";

export default function AioRedirect() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.location.replace("/feed");
    }
  }, []);
  return null;
}
