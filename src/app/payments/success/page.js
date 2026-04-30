// /payments/success — landing page PingPay redirects buyers to after a
// successful checkout. Server shim. The real polling + status logic
// lives in PaymentsSuccessClient.jsx so the static export's
// generateStaticParams contract is satisfied.

import { Suspense } from "react";
import PaymentsSuccessClient from "./PaymentsSuccessClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaymentsSuccessClient />
    </Suspense>
  );
}
