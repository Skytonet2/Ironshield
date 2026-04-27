// contract/src/kits.rs
//
// Phase 10 — Agent Economy: on-chain Kit registry.
//
// A Kit is a curated, vertical-tuned bundle of skills with a preset
// config schema. The verbose body (skill list, preset schema, hero
// image, marketing copy) lives off-chain in Postgres; the on-chain
// row is the integrity anchor — slug, vertical, curator, revenue
// split, and the manifest hash that pins the off-chain payload.
//
// At v1 only the contract owner can `register_kit`. Phase 5 will
// route this through the existing governance proposal flow so the
// DAO curates the catalog.
//
// Storage prefix b"k" (lowercase) was unused before Phase 10; chosen
// to read distinct from b"K" (skills).

use crate::*;

pub const KIT_STATUS_ACTIVE:     &str = "active";
pub const KIT_STATUS_BETA:       &str = "beta";
pub const KIT_STATUS_DEPRECATED: &str = "deprecated";

/// On-chain Kit row. Bundled-skill ids and preset schema live off-chain
/// and are committed via `manifest_hash`. Revenue split bps must sum to
/// 10_000 — enforced at register time.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct Kit {
    pub slug: String,
    pub title: String,
    pub vertical: String,
    pub curator: AccountId,
    pub manifest_hash: String,
    pub kit_curator_bps: u32,
    pub agent_owner_bps: u32,
    pub platform_bps: u32,
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[near]
impl StakingContract {
    /// Owner-only at v1. Registers a new Kit and pins the manifest hash.
    /// Revenue split bps must sum to 10_000.
    pub fn register_kit(
        &mut self,
        slug: String,
        title: String,
        vertical: String,
        curator: AccountId,
        manifest_hash: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
        status: Option<String>,
    ) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
        assert!(!slug.is_empty(), "slug required");
        assert!(slug.len() <= 64, "slug too long");
        assert!(!title.is_empty() && title.len() <= 96, "title 1-96 chars");
        assert!(!vertical.is_empty() && vertical.len() <= 48, "vertical 1-48 chars");
        assert!(!manifest_hash.is_empty(), "manifest_hash required");
        assert!(
            kit_curator_bps + agent_owner_bps + platform_bps == 10_000,
            "Revenue split must sum to 10000 bps"
        );
        assert!(self.kits.get(&slug).is_none(), "slug already registered");

        let resolved_status = status.unwrap_or_else(|| KIT_STATUS_BETA.to_string());
        assert!(
            matches!(
                resolved_status.as_str(),
                KIT_STATUS_ACTIVE | KIT_STATUS_BETA | KIT_STATUS_DEPRECATED
            ),
            "Invalid status"
        );

        let now = env::block_timestamp();
        let kit = Kit {
            slug: slug.clone(),
            title,
            vertical,
            curator,
            manifest_hash,
            kit_curator_bps,
            agent_owner_bps,
            platform_bps,
            status: resolved_status,
            created_at: now,
            updated_at: now,
        };
        self.kits.insert(slug.clone(), kit);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"kit_registered\",\"data\":{{\"slug\":\"{}\"}}}}",
            slug,
        ));
    }

    /// Owner-only: bump the manifest hash and update timestamp. Use when the
    /// off-chain Kit definition (skill bundle, preset schema, hero image)
    /// changes so the on-chain hash stays the source of truth.
    pub fn update_kit_manifest(&mut self, slug: String, manifest_hash: String) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
        assert!(!manifest_hash.is_empty(), "manifest_hash required");
        let mut kit = self.kits.get(&slug).cloned().expect("Kit not found");
        kit.manifest_hash = manifest_hash.clone();
        kit.updated_at = env::block_timestamp();
        self.kits.insert(slug.clone(), kit);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"kit_manifest_updated\",\"data\":{{\"slug\":\"{}\",\"manifest_hash\":\"{}\"}}}}",
            slug, manifest_hash,
        ));
    }

    /// Owner-only: change a Kit's status (active/beta/deprecated).
    pub fn set_kit_status(&mut self, slug: String, status: String) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
        assert!(
            matches!(
                status.as_str(),
                KIT_STATUS_ACTIVE | KIT_STATUS_BETA | KIT_STATUS_DEPRECATED
            ),
            "Invalid status"
        );
        let mut kit = self.kits.get(&slug).cloned().expect("Kit not found");
        kit.status = status.clone();
        kit.updated_at = env::block_timestamp();
        self.kits.insert(slug.clone(), kit);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"kit_status_set\",\"data\":{{\"slug\":\"{}\",\"status\":\"{}\"}}}}",
            slug, status,
        ));
    }

    /// Owner-only: rotate the revenue split. Must still sum to 10000 bps.
    pub fn update_kit_revenue_split(
        &mut self,
        slug: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
    ) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
        assert!(
            kit_curator_bps + agent_owner_bps + platform_bps == 10_000,
            "Revenue split must sum to 10000 bps"
        );
        let mut kit = self.kits.get(&slug).cloned().expect("Kit not found");
        kit.kit_curator_bps = kit_curator_bps;
        kit.agent_owner_bps = agent_owner_bps;
        kit.platform_bps = platform_bps;
        kit.updated_at = env::block_timestamp();
        self.kits.insert(slug.clone(), kit);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"kit_revenue_split_updated\",\"data\":{{\"slug\":\"{}\"}}}}",
            slug,
        ));
    }

    pub fn get_kit(&self, slug: String) -> Option<Kit> {
        self.kits.get(&slug).cloned()
    }

    /// Returns up to `limit` Kits. Iteration order follows the underlying
    /// UnorderedMap. Frontend should treat this as catalog-style listing,
    /// not a stable feed.
    pub fn list_kits(&self, limit: u64) -> Vec<Kit> {
        let cap = limit.min(100);
        self.kits
            .values()
            .take(cap as usize)
            .cloned()
            .collect()
    }

    pub fn list_kits_by_status(&self, status: String, limit: u64) -> Vec<Kit> {
        let cap = limit.min(100);
        self.kits
            .values()
            .filter(|k| k.status == status)
            .take(cap as usize)
            .cloned()
            .collect()
    }
}
