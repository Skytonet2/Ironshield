"use client";
// feedStore — the ephemeral feed pipeline.
//
// Nothing here survives a refresh. The WS client pushes FeedEvent objects
// in; the feed UI reads `items` (filtered) and `queue` (incoming while
// the user is paused). We cap `items` at 1000 FIFO so a long-running tab
// can't OOM the renderer.
//
// Filters are a Set<FeedEventType>. Empty = show everything. Non-empty =
// show only matching types — matches the "filter pill" UI where a user
// opts in to a narrow slice rather than clicking eight "off" chips.

import { create } from "zustand";

const MAX_ITEMS = 1000;

export const useFeed = create((set, get) => ({
  items: [],
  queue: [],
  paused: false,
  filters: new Set(),        // FeedEventType names to include; empty = all
  unreadCount: 0,
  wsStatus: "disconnected",  // connected | connecting | disconnected

  push: (event) => {
    if (!event || !event.id) return;
    const { paused, filters, items, queue, unreadCount } = get();
    // Always keep pause-first semantics. When paused, new events pile
    // into `queue`; the UI flushes on click/resume.
    if (paused) {
      set({ queue: [event, ...queue].slice(0, MAX_ITEMS) });
      return;
    }
    // Filter by active type set (empty = pass-through).
    if (filters.size > 0 && !filters.has(event.type)) return;
    const next = [event, ...items];
    if (next.length > MAX_ITEMS) next.length = MAX_ITEMS;
    set({ items: next, unreadCount: unreadCount + 1 });
  },

  flushQueue: () => {
    const { queue, items, filters } = get();
    // Respect the filter when flushing so the queue doesn't smuggle
    // filtered-out events back in.
    const toAdd = filters.size > 0 ? queue.filter((e) => filters.has(e.type)) : queue;
    const next = [...toAdd, ...items];
    if (next.length > MAX_ITEMS) next.length = MAX_ITEMS;
    set({ items: next, queue: [], unreadCount: get().unreadCount + toAdd.length });
  },

  setPaused: (val) => {
    const paused = !!val;
    set({ paused });
    if (!paused) get().flushQueue();
  },

  toggleFilter: (type) => {
    const next = new Set(get().filters);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    set({ filters: next });
  },

  clearUnread: () => set({ unreadCount: 0 }),

  setWsStatus: (status) => set({ wsStatus: status }),
}));
