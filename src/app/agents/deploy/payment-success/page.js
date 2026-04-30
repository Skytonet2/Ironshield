// /agents/deploy/payment-success — landing page Paystack redirects to.
// Polls /api/payments/psp/session/:reference until the webhook has run
// settlement on-chain, then shows the on_chain_id and a link to the
// mission detail page. Server shim like the deploy wizard's page.js.

import { Suspense } from "react";
import PaymentSuccessClient from "./PaymentSuccessClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaymentSuccessClient />
    </Suspense>
  );
}
