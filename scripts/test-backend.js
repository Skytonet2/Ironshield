#!/usr/bin/env node
// scripts/test-backend.js — boot the backend against the local test stack
//
// Loads env in a deterministic order (.env → .env.local → .env.test)
// so the test overrides win, sets NODE_ENV=test, then hands off to
// the normal server entry. The server's own dotenv calls are no-ops
// once a key is already present in process.env, so this layering is
// stable.
//
// Usage:
//   npm run test:db:up         # spin up the test Postgres
//   npm run backend:test       # this script
//   # frontend in another terminal: npm run dev

const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env.test");

if (!fs.existsSync(envFile)) {
  console.error(`[test-backend] missing ${envFile}`);
  console.error("[test-backend] copy .env.test.example → .env.test and fill in values");
  process.exit(1);
}

require("dotenv").config({ path: path.join(root, ".env") });
require("dotenv").config({ path: path.join(root, ".env.local"), override: true });
require("dotenv").config({ path: envFile, override: true });
process.env.NODE_ENV = "test";

console.log("[test-backend] env loaded:", {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"),
  BACKEND_PORT: process.env.BACKEND_PORT,
  CONTRACT_ID: process.env.CONTRACT_ID,
  NEAR_RPC_URL: process.env.NEAR_RPC_URL,
});

require(path.join(root, "backend", "server.js"));
