"use client";
// Global call state — one LiveKit room lives above the page router so
// you can walk from Feed → Dashboard → Governance (and anywhere else in
// the SPA) without dropping the call. If there is an active call and you
// click an EXTERNAL route (e.g. /rooms/), the router opens it in a new
// tab so this tab keeps the connection alive.

import { createContext, useContext, useMemo, useState, useCallback } from "react";

const CallCtx = createContext(null);

export function CallProvider({ children }) {
  const [call, setCall] = useState({
    open: false,
    minimized: false,
    kind: null,           // 'dm' for now; room calls are on /rooms/ and self-manage
    conversationId: null,
    peer: null,
  });

  const openCall = useCallback(({ kind = "dm", conversationId, peer }) => {
    setCall({ open: true, minimized: false, kind, conversationId, peer });
  }, []);

  const minimize = useCallback(() => {
    setCall(c => c.open ? { ...c, minimized: true } : c);
  }, []);

  const restore = useCallback(() => {
    setCall(c => c.open ? { ...c, minimized: false } : c);
  }, []);

  const endCall = useCallback(() => {
    setCall({ open: false, minimized: false, kind: null, conversationId: null, peer: null });
  }, []);

  const value = useMemo(() => ({ call, openCall, minimize, restore, endCall }), [call, openCall, minimize, restore, endCall]);
  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}

export function useCall() {
  const v = useContext(CallCtx);
  // Graceful fallback if a component renders outside the provider
  // (e.g. storybook). Returns an inert object so callers don't crash.
  return v || {
    call: { open: false, minimized: false, kind: null, conversationId: null, peer: null },
    openCall: () => {},
    minimize: () => {},
    restore: () => {},
    endCall: () => {},
  };
}
