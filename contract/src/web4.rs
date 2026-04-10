// contract/src/web4.rs
// ─────────────────────────────────────────────────────────────────
// Web4 static-site adapter for the IronShield staking contract.
//
// We deliberately do NOT add the static URL to the StakingContract
// borsh struct — that would force a state migration. Instead we store
// the URL in a raw key/value pair via env::storage_write/read so the
// existing contract layout stays untouched and the upgrade is a pure
// code-only deploy.
//
// Routing:
//   web4_get() rewrites the incoming path onto the configured static
//   URL prefix and returns it as `bodyUrl`. The `*.near.page` gateway
//   then fetches that URL and streams it back to the browser. The
//   prefix can be any http(s)://, ipfs://, or ipns:// URL — owner can
//   swap it at any time via `set_web4_url` without a contract redeploy.
//
//   Default prefix is the Cloudflare Pages production URL of the
//   Next.js static export. We can flip back to a real IPFS CID later
//   (web3.storage / Pinata) once we want full decentralization.
// ─────────────────────────────────────────────────────────────────

use crate::*;
use near_sdk::serde::{Deserialize, Serialize};

const WEB4_STATIC_URL_KEY: &[u8] = b"WEB4_STATIC_URL";

/// Default static URL — Cloudflare Pages production URL of the Next.js
/// static export. Owner can swap to any http(s)://, ipfs:// or ipns://
/// prefix via `set_web4_url` without a contract redeploy.
const DEFAULT_WEB4_STATIC_URL: &str = "https://ironshield.pages.dev";

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Web4Request {
    #[serde(rename = "accountId")]
    pub account_id: Option<String>,
    pub path: String,
    #[serde(default)]
    pub params: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub query: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub preloads: std::collections::HashMap<String, Web4Response>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Web4Response {
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(rename = "bodyUrl", skip_serializing_if = "Option::is_none")]
    pub body_url: Option<String>,
    #[serde(rename = "preloadUrls", skip_serializing_if = "Option::is_none")]
    pub preload_urls: Option<Vec<String>>,
}

/// Internal helper — read the configured static URL or fall back to default.
fn read_static_url() -> String {
    env::storage_read(WEB4_STATIC_URL_KEY)
        .and_then(|raw| String::from_utf8(raw).ok())
        .unwrap_or_else(|| DEFAULT_WEB4_STATIC_URL.to_string())
}

/// Normalize an incoming web4 path so it always starts with `/`.
fn normalize_path(path: &str) -> String {
    if path.is_empty() {
        "/".to_string()
    } else if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    }
}

#[near]
impl StakingContract {
    /// Web4 entrypoint. Rewrites the incoming path onto the configured
    /// static URL prefix and returns it as `bodyUrl`. The `*.near.page`
    /// gateway then fetches that URL and streams the response back to
    /// the browser.
    pub fn web4_get(&self, request: Web4Request) -> Web4Response {
        let static_url = read_static_url();
        let prefix = static_url.trim_end_matches('/').to_string();
        let path = normalize_path(&request.path);
        Web4Response {
            content_type: None,
            status: None,
            body: None,
            body_url: Some(format!("{}{}", prefix, path)),
            preload_urls: None,
        }
    }

    /// View the currently configured static URL prefix.
    pub fn web4_static_url(&self) -> String {
        read_static_url()
    }

    /// Owner-only: point web4_get at a new static URL prefix.
    /// Examples: `https://ironshield.pages.dev`, `ipfs://bafy...`,
    /// `ipns://ironshield.eth`. No contract redeploy required.
    pub fn set_web4_url(&mut self, url: String) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only the contract owner can call this"
        );
        assert!(!url.is_empty(), "url must not be empty");
        env::storage_write(WEB4_STATIC_URL_KEY, url.as_bytes());
    }
}
