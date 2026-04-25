// backend/db/client.js — PostgreSQL connection pool
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ironshield";
// Render/Supabase/Heroku managed Postgres require SSL. Only skip for localhost.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

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

module.exports = { pool, query, transaction, migrate, close };
