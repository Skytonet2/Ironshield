"use client";
// ref — NEAR swaps via Ref Finance.
//
// Deferred to Phase 3B-4 because @ref-finance/ref-sdk imports Node's
// `fs` at module top-level, which Turbopack can't bundle for the
// browser. Hand-rolled path (skip the SDK, call Ref's view methods
// directly via near-api-js + build ft_transfer_call ourselves) takes
// ~half a session. Tracking this explicitly so it doesn't quietly
// regress back to "coming soon" territory.
//
// Resolution path:
//   1. Query Ref view methods (get_pool, get_return) via near-api-js
//      provider.query for a quote.
//   2. Build ft_transfer_call to v2.ref-finance.near with
//      { actions: [{pool_id, token_in, token_out, amount_in,
//        min_amount_out}] } as the msg.
//   3. Prepend ft_transfer of 0.2% to fees.ironshield.near.
//   4. Sign both via selector.wallet().signAndSendTransactions.
//
// The executeSwap dispatcher still routes NEAR here; the error below
// surfaces cleanly in OrderPanel's status strip rather than crashing.

export async function swapOnRef() {
  throw new Error(
    "NEAR swaps via Ref Finance are implemented in Phase 3B-4. " +
    "Use app.ref.finance for NEAR trades today; SOL swaps are live " +
    "via Jupiter."
  );
}
