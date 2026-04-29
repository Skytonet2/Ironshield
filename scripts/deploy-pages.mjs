// scripts/deploy-pages.mjs — guarded Cloudflare Pages deploy.
//
// Why this exists: the project was renamed ironshield → azuka, but
// the old `ironshield` Pages project still exists and still accepts
// deploys. Every time someone (human or agent) ran the literal
// command from CLAUDE.md / older runbooks (`wrangler pages deploy
// out --project-name=ironshield ...`), the bytes landed on a stale
// alias nobody reads. This wrapper hardcodes the live project so
// the only way to redirect is to edit this file in a PR.
//
// Usage (replaces `npx wrangler pages deploy out ...`):
//   npm run deploy:pages
// or:
//   node scripts/deploy-pages.mjs
//
// Pre-req: `npm run build` produces `out/`. This script never builds;
// it only ships what's already there. Keeps build and deploy decoupled
// so a failed deploy doesn't waste a build.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT = "azuka";
const BRANCH  = "main";
const OUT_DIR = resolve(process.cwd(), "out");

// Refuse to run if the build artifacts aren't present. Without this
// wrangler still tries and uploads zero files (silent no-op deploy
// that looks successful in logs — exactly the failure mode that
// hid the rename bug for five PRs).
if (!existsSync(OUT_DIR) || !statSync(OUT_DIR).isDirectory()) {
  console.error(`[deploy-pages] missing build artifact: ${OUT_DIR}`);
  console.error(`               run \`npm run build\` first.`);
  process.exit(1);
}

const args = [
  "wrangler@latest",
  "pages",
  "deploy",
  OUT_DIR,
  `--project-name=${PROJECT}`,
  `--branch=${BRANCH}`,
  `--commit-dirty=true`,
];

console.log(`[deploy-pages] target  : ${PROJECT}.pages.dev`);
console.log(`[deploy-pages] branch  : ${BRANCH}`);
console.log(`[deploy-pages] artifact: ${OUT_DIR}`);

const r = spawnSync("npx", ["--yes", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
