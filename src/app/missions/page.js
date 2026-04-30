// /missions — list of the wallet's missions.
//
// The sidebar nav (PR #129) added a "Missions" entry pointing here,
// but the list view never shipped — only `/missions/[id]` existed,
// so the bare `/missions` URL 404'd. This file fills that gap.
//
// Server entry: same shape as /missions/[id]/page.js — render a
// client component, return an empty generateStaticParams so the
// static exporter is happy, and let the SPA fetch the list at
// runtime.

import MissionsListClient from "./MissionsListClient";

export default function Page() {
  return <MissionsListClient />;
}
