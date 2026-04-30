// /skills/[id]/versions — server entrypoint for the version-history route.
//
// The UI lives in SkillVersionsPage (client component). This file
// exists so the route works under `output: "export"` in next.config.
// Next.js requires `generateStaticParams` on dynamic routes; that
// export can't live in a "use client" file. The placeholder gives
// the static exporter exactly one pre-rendered shell — client
// navigation to other ids works through Cloudflare Pages' SPA
// fallback (`_redirects` / `_routes.json`).

import SkillVersionsClient from "./SkillVersionsClient";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function Page() {
  return <SkillVersionsClient />;
}
