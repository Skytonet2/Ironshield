// backend/middleware/requireAnyWallet.js
// Phase C — dual-auth dispatcher.
//
// Looks at the `x-wallet-chain` request header and delegates to the right
// signed-message verifier:
//   "sui"           → backend/middleware/requireSuiWallet.js
//   missing / "near"→ backend/middleware/requireWallet.js (NEP-413, default)
//
// Default-to-NEAR keeps every existing client working unchanged. Sui clients
// opt in by sending `x-wallet-chain: sui` plus the headers documented in
// docs/SUI_AUTH_CONTRACT.md.
//
// On success the downstream handler sees:
//   req.wallet         — string address (NEAR account id OR Sui 0x... hex)
//   req.walletChain    — "near" | "sui"
//   req.identity       — { chain, address, wallet } (Sui path only;
//                        the NEAR path leaves it undefined for back-compat —
//                        new code that needs chain awareness should read
//                        req.walletChain and fall back to "near")
//
// Set AUTH_DISABLE_NEAR=true in the env to reject NEAR-signed requests
// post cut-over without touching every route.

const defaultRequireNear = require("./requireWallet");
const defaultRequireSui = require("./requireSuiWallet");

const NEAR_DISABLED = String(process.env.AUTH_DISABLE_NEAR || "").toLowerCase() === "true";

function makeRequireAnyWallet({
  requireNear = defaultRequireNear,
  requireSui = defaultRequireSui,
  nearDisabled = NEAR_DISABLED,
} = {}) {
  return function requireAnyWallet(req, res, next) {
    const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim();

    if (chain === "sui") {
      // Wrap next() so we can stamp walletChain even on the NEAR path. The
      // Sui middleware already sets req.walletChain = "sui" itself, so just
      // delegate.
      return requireSui(req, res, next);
    }

    if (chain && chain !== "near") {
      return res.status(401).json({
        error: "unsupported wallet chain",
        code: "bad-chain",
      });
    }

    if (nearDisabled) {
      return res.status(401).json({
        error: "NEAR auth disabled — use x-wallet-chain: sui",
        code: "near-disabled",
      });
    }

    // NEAR auth path. Stamp walletChain after success so downstream handlers
    // can branch chain-aware logic (e.g., on-chain reads against the right
    // contract).
    requireNear(req, res, function nearNext(err) {
      if (err) return next(err);
      req.walletChain = "near";
      // Don't synthesize req.identity for NEAR — leave it undefined so old
      // handlers that test `if (req.identity)` short-circuit cleanly until
      // they're explicitly migrated.
      next();
    });
  };
}

module.exports = Object.assign(makeRequireAnyWallet(), {
  makeRequireAnyWallet,
});
