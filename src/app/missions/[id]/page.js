// /missions/[id] — server entrypoint for the mission detail route.
//
// The actual UI lives in MissionDetailClient.jsx (a client component
// that subscribes to /api/missions/:id/stream). This file exists so
// the route works under `output: "export"` in next.config.mjs:
// Next.js requires `generateStaticParams` on dynamic routes for the
// static export, and that export can't live in a "use client" file.
//
// We return `[]` because mission ids aren't enumerable at build time;
// `dynamicParams = true` (the default) lets the client SPA navigate
// to any id and hydrate from the API.

import MissionDetailClient from "./MissionDetailClient";

// Return a placeholder so the static exporter emits at least one
// pre-rendered shell. Mission ids aren't enumerable at build time;
// the SPA fetches the real mission via /api/missions/:id at runtime.
// Cloudflare Pages serves the SPA fallback for any other id.
export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

// `output: "export"` requires dynamicParams = false (the default for
// static exports). Only the placeholder above gets a pre-rendered
// shell; client navigation to other ids works through Cloudflare
// Pages' SPA fallback (`_redirects` or `_routes.json`).

export default function Page() {
  return <MissionDetailClient />;
}
