// backend/db/client.js — PostgreSQL connection pool
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ironshield";
// Render/Supabase/Heroku managed Postgres require SSL. Only skip for localhost.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);
// max=30: Render Postgres Starter caps at ~97 connections; 30 leaves headroom
// for the worker services (governance + bot) once they're live and still
// absorbs a 1k-user spike without exhausting. Day 6.2 — pre-PgBouncer.
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 30,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Idle-client errors (e.g. server-side conn drops) shouldn't crash the
// process — pg already removes the bad client from the pool. Log and move on.
pool.on("error", (err) => {
  console.error("[DB] idle pool client error:", { message: err.message, code: err.code });
});

// withRetry: wrap a single pool/client.query call in a one-shot retry that
// only fires for the narrow 'connection terminated unexpectedly' case
// Render Postgres throws when a managed restart drops mid-flight queries.
// Anything else (constraint violation, syntax error, pool exhaustion) is
// surfaced unchanged on the first failure.
const isTransientConnDrop = (err) =>
  err && /connection terminated unexpectedly/i.test(String(err.message || ""));
const withRetry = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientConnDrop(err)) throw err;
    console.warn("[DB] retrying after transient connection drop");
    return await fn();
  }
};

// Query helper
const query = (text, params) => pool.query(text, params);

// Transaction helper
const transaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Run schema migration
const migrate = async () => {
  const fs = require("fs");
  const path = require("path");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  try {
    await pool.query(schema);
    console.log("[DB] Schema migration complete");
    await seedAdminAllowlist();
    // One-shot disk→DB copy for the four legacy agent JSON files. No-op
    // when none exist on disk (which is the normal state on fresh deploys).
    await require("./agentState").migrateFromDisk(require("path").resolve(__dirname, "../.."));
  } catch (err) {
    console.error("[DB] Migration error:", err.message);
    throw err;
  }
};

// First-boot admin seed: if admin_wallets is empty and ADMIN_WALLET_SEED is
// set, insert that wallet so a fresh deploy isn't locked out of AdminPanel.
// After that, manage the table directly via SQL — no admin-management UI.
const seedAdminAllowlist = async () => {
  const seed = (process.env.ADMIN_WALLET_SEED || "").trim().toLowerCase();
  if (!seed) return;
  const { rows } = await pool.query("SELECT 1 FROM admin_wallets LIMIT 1");
  if (rows.length) return;
  await pool.query(
    "INSERT INTO admin_wallets (wallet, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING",
    [seed]
  );
  console.log(`[DB] Seeded admin_wallets with ${seed}`);
};

// Graceful shutdown
const close = () => pool.end();

module.exports = { pool, query, transaction, migrate, close, withRetry };
