// backend/services/logger.js
//
// Structured logger — pre-configured pino instance with secret-field
// redaction. New code paths use this; existing console.warn callsites
// across the codebase stay as-is unless they're touched for other reasons.
//
// Why structured logs: Render's stdout capture is fine for grep but
// terrible for queryable telemetry. JSON-shaped lines with stable
// keys are parseable by any log analytics ingester (Datadog, Honeycomb,
// Loki, etc.) if/when we wire one up.
//
// Redaction: any field path that might carry a secret is censored
// before write. The list is conservative — when in doubt, don't log
// the value at all.

const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "ironclaw-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      // OAuth + session tokens
      "access_token", "refresh_token", "*.access_token", "*.refresh_token",
      "li_at", "*.li_at",
      // SMTP/IMAP passwords
      "smtp.pass", "imap.pass", "*.smtp.pass", "*.imap.pass",
      // Webhook + app secrets
      "app_secret", "client_secret", "*.app_secret", "*.client_secret",
      // Wallet seeds (defensive — shouldn't ever be logged)
      "ADMIN_WALLET_SEED", "*.ADMIN_WALLET_SEED",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
