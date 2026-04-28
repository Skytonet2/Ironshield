// /agents/deploy/[kit_slug] — server entrypoint for the kit deploy
// wizard.
//
// Real UI lives in KitDeployClient.jsx. Same pattern as
// /missions/[id]/page.js: a thin server shim so the static export
// can satisfy `generateStaticParams`. The SPA fetches the real kit
// via /api/kits/:slug at runtime; Cloudflare Pages serves the SPA
// fallback for any kit_slug.

import { Suspense } from "react";
import KitDeployClient from "./KitDeployClient";

export async function generateStaticParams() {
  return [{ kit_slug: "placeholder" }];
}

export default function Page() {
  // Suspense boundary required because the client uses
  // `useSearchParams()`, which bails out of static prerender unless
  // wrapped (Next.js missing-suspense-with-csr-bailout).
  return (
    <Suspense fallback={null}>
      <KitDeployClient />
    </Suspense>
  );
}
