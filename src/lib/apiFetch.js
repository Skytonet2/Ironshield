"use client";
// src/lib/apiFetch.js
// Signed-message HTTP wrapper. Spec: docs/auth-contract.md.
//
// GET / HEAD or `options.public === true` → plain fetch, no signing.
// Anything else → fetch a fresh nonce, sign {method, path, sha256(body)}
// via the connected NEAR wallet's NEP-413 signMessage, attach the four
// auth headers, send. On 401 expired-nonce, retry once with a new nonce.
//
// The wallet selector lives inside React state (WalletProvider in
// src/lib/contexts.js); since apiFetch is callable from non-component
// contexts (event handlers, tests, libs), the provider registers the
// live selector + walletType through setWalletState below.

import { Buffer } from "buffer";
import { API_BASE } from "./apiBase";

const RECIPIENT = "ironshield.near";

// Live wallet ref. WalletProvider keeps this in sync.
let _wallet = { selector: null, walletType: null };
export function setWalletState(next) { _wallet = next || { selector: null, walletType: null }; }

async function sha256Hex(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input
    : input == null ? new Uint8Array(0)
    : new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Decode base64url to a Node-style Buffer. Wallet selector adapters
// (Meteor / HERE / HOT / Intear) call Buffer.isBuffer(nonce) and reject
// plain Uint8Array — Buffer is a subclass but isBuffer() is identity-strict.
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

export async function apiFetch(path, options = {}) {
  const api = API_BASE;
  const method = (options.method || "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD" || options.public === true;
  if (isRead) return fetch(`${api}${path}`, options);

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
