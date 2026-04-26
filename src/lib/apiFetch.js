"use client";
// src/lib/apiFetch.js
// Authenticated HTTP wrapper. Spec: docs/auth-contract.md.
//
// GET / HEAD or `options.public === true` → plain fetch, no auth.
//
// Mutating requests prefer Day-5.6 session tokens:
//   1. Read the cached session for the current wallet. If it's valid,
//      send `Authorization: Bearer <token>` and skip signing entirely.
//   2. Cache miss / expired / wallet-mismatch → call /api/auth/login
//      (which signs once via the existing NEP-413 flow), store the
//      returned 24h token, retry the original request with Bearer.
//   3. Server returns 401 with code `bad-token`/`expired-token` →
//      clear cached session, login again, retry once.
//
// /api/auth/login itself bypasses the token branch (would loop) and
// always signs.
//
// The wallet selector is registered by WalletProvider via
// setWalletState below. Wallet disconnect clears the cached session
// so the next consumer logs in fresh.

import { Buffer } from "buffer";
import { API_BASE } from "./apiBase";
import {
  readSession, saveSession, clearSession, isExpired, sessionFor,
} from "./session";

const RECIPIENT = "ironshield.near";

let _wallet = { selector: null, walletType: null };
export function setWalletState(next) {
  const prev = _wallet;
  _wallet = next || { selector: null, walletType: null };
  // Disconnect or wallet swap → drop the cached session so the next
  // mutating call logs in under the new identity.
  const lostSelector = prev.selector && !_wallet.selector;
  if (lostSelector) clearSession();
}

async function sha256Hex(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input
    : input == null ? new Uint8Array(0)
    : new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeBase64UrlToBuffer(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

async function fetchNonce(api) {
  const r = await fetch(`${api}/api/auth/nonce`);
  if (!r.ok) throw new Error(`nonce fetch failed (${r.status})`);
  const j = await r.json();
  if (!j?.nonce) throw new Error("nonce response missing nonce field");
  return j.nonce;
}

async function signRequest({ method, path, body, nonce }) {
  if (!_wallet.selector) {
    if (_wallet.walletType && _wallet.walletType !== "near") {
      throw new Error("wallet-type-unsupported");
    }
    throw new Error("not-connected");
  }
  if (_wallet.walletType && _wallet.walletType !== "near") {
    throw new Error("wallet-type-unsupported");
  }
  const wallet = await _wallet.selector.wallet();
  if (!wallet) throw new Error("not-connected");
  const bodyStr = typeof body === "string" ? body : body == null ? "" : "";
  const hash = await sha256Hex(bodyStr);
  const message = `ironshield-auth:v1\n${method.toUpperCase()}\n${path}\n${hash}`;
  const nonceBuf = decodeBase64UrlToBuffer(nonce);
  if (nonceBuf.length !== 32) throw new Error(`bad nonce length: ${nonceBuf.length}`);
  const signed = await wallet.signMessage({ message, recipient: RECIPIENT, nonce: nonceBuf });
  if (!signed?.signature || !signed?.publicKey || !signed?.accountId) {
    throw new Error("sign-message-failed");
  }
  return signed;
}

// One signed-mutation round-trip with one expired-nonce retry.
// Day 5.6 still uses this for the initial /api/auth/login call (and
// as a last-resort fallback if login itself fails).
async function signedFetch(path, options = {}) {
  const api = API_BASE;
  const method = (options.method || "GET").toUpperCase();
  let nonce  = await fetchNonce(api);
  let signed = await signRequest({ method, path, body: options.body, nonce });

  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {
      ...(options.headers || {}),
      "x-wallet":     signed.accountId,
      "x-public-key": signed.publicKey,
      "x-nonce":      nonce,
      "x-signature":  signed.signature,
    };
    const r = await fetch(`${api}${path}`, { ...options, headers });
    if (r.status !== 401 || attempt > 0) return r;

    let code;
    try { code = (await r.clone().json())?.code; } catch {}
    if (code !== "expired-nonce") return r;

    nonce  = await fetchNonce(api);
    signed = await signRequest({ method, path, body: options.body, nonce });
  }
}

async function currentWalletAddress() {
  if (!_wallet.selector) return null;
  if (_wallet.walletType && _wallet.walletType !== "near") return null;
  try {
    const w = await _wallet.selector.wallet();
    if (!w || typeof w.getAccounts !== "function") return null;
    const accounts = await w.getAccounts();
    const id = accounts?.[0]?.accountId;
    return id ? String(id).toLowerCase().trim() : null;
  } catch { return null; }
}

// In-flight login dedupe so two concurrent mutations don't each pop
// the wallet. The first caller signs; everyone else awaits the same
// promise and gets the resulting token.
let loginInFlight = null;

async function loginAndStore(wallet) {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    try {
      const r = await signedFetch("/api/auth/login", { method: "POST" });
      if (!r.ok) throw new Error(`login failed: ${r.status}`);
      const j = await r.json();
      if (!j?.token || !j?.expiresAt) throw new Error("login: malformed response");
      // Server echoes the wallet it bound the token to; prefer that
      // over our local read in case of any normalization drift.
      const boundWallet = String(j.wallet || wallet || "").toLowerCase().trim();
      saveSession({ wallet: boundWallet, token: j.token, expiresAt: j.expiresAt });
      return j.token;
    } finally {
      loginInFlight = null;
    }
  })();
  return loginInFlight;
}

async function tokenFetch(api, path, options, token) {
  return fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${token}`,
    },
  });
}

const AUTH_FAIL_CODES = new Set(["bad-token", "expired-token"]);

export async function apiFetch(path, options = {}) {
  const api = API_BASE;
  const method = (options.method || "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD" || options.public === true;
  if (isRead) return fetch(`${api}${path}`, options);

  // /login MUST sign — recursing into the token path here would loop.
  if (path === "/api/auth/login") return signedFetch(path, options);

  const wallet = await currentWalletAddress();
  if (!wallet) {
    // No connected wallet — let signedFetch surface the real error
    // (preserves existing not-connected behavior for callers that
    // gate UI on wallet presence).
    return signedFetch(path, options);
  }

  let session = sessionFor(wallet);
  if (!session) {
    // No usable cached token for this wallet — sign once, mint one.
    try {
      await loginAndStore(wallet);
      session = sessionFor(wallet);
    } catch {
      // Login failed (rejected sig, network, etc.). Fall back to the
      // pre-Day-5.6 behavior so a one-off mutation can still succeed.
      return signedFetch(path, options);
    }
  }

  if (!session) return signedFetch(path, options);

  const r = await tokenFetch(api, path, options, session.token);
  if (r.status !== 401) return r;

  // 401 with a known auth-failure code — token is bad/expired. Clear
  // and retry once via fresh login. Other 401s (route-level rejection)
  // pass straight through.
  let code;
  try { code = (await r.clone().json())?.code; } catch {}
  if (!AUTH_FAIL_CODES.has(code)) return r;

  clearSession();
  try {
    await loginAndStore(wallet);
  } catch {
    return r;
  }
  const fresh = sessionFor(wallet);
  if (!fresh) return r;
  return tokenFetch(api, path, options, fresh.token);
}
