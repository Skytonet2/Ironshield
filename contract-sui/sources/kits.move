module azuka::kits {
    use std::string::String;
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;

    use azuka::core::{Self, Config, AdminCap};

    const KIT_STATUS_ACTIVE: vector<u8> = b"active";
    const KIT_STATUS_BETA: vector<u8> = b"beta";
    const KIT_STATUS_DEPRECATED: vector<u8> = b"deprecated";

    const BPS_TOTAL: u32 = 10_000;
    const SLUG_MAX_LEN: u64 = 64;
    const TITLE_MAX_LEN: u64 = 96;
    const VERTICAL_MAX_LEN: u64 = 48;

    const E_SLUG_EMPTY: u64 = 0;
    const E_SLUG_TOO_LONG: u64 = 1;
    const E_TITLE_LEN: u64 = 2;
    const E_VERTICAL_LEN: u64 = 3;
    const E_MANIFEST_REQUIRED: u64 = 4;
    const E_BPS_SUM: u64 = 5;
    const E_SLUG_TAKEN: u64 = 6;
    const E_INVALID_STATUS: u64 = 7;
    const E_KIT_NOT_FOUND: u64 = 8;

    public struct KitCatalog has key {
        id: UID,
    }

    public struct Kit has copy, drop, store {
        slug: String,
        title: String,
        vertical: String,
        curator: address,
        manifest_hash: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
        status: String,
        created_at_ms: u64,
        updated_at_ms: u64,
    }

    public struct KitRegistered has copy, drop {
        slug: String,
        curator: address,
        status: String,
    }

    public struct KitManifestUpdated has copy, drop {
        slug: String,
        manifest_hash: String,
    }

    public struct KitStatusSet has copy, drop {
        slug: String,
        status: String,
    }

    public struct KitRevenueSplitUpdated has copy, drop {
        slug: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(KitCatalog {
            id: object::new(ctx),
        });
    }

    public fun register_kit(
        catalog: &mut KitCatalog,
        config: &Config,
        cap: &AdminCap,
        slug: String,
        title: String,
        vertical: String,
        curator: address,
        manifest_hash: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
        status: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        core::assert_not_paused(config);

        validate_slug(&slug);
        validate_title(&title);
        validate_vertical(&vertical);
        assert!(manifest_hash.length() > 0, E_MANIFEST_REQUIRED);
        validate_split(kit_curator_bps, agent_owner_bps, platform_bps);
        validate_status(&status);
        assert!(!df::exists_<String>(&catalog.id, slug), E_SLUG_TAKEN);

        let now = clock::timestamp_ms(clock);
        let key = slug;
        let kit = Kit {
            slug: key,
            title,
            vertical,
            curator,
            manifest_hash,
            kit_curator_bps,
            agent_owner_bps,
            platform_bps,
            status: key_status_copy(&status),
            created_at_ms: now,
            updated_at_ms: now,
        };

        event::emit(KitRegistered {
            slug: key,
            curator,
            status,
        });
        df::add(&mut catalog.id, key, kit);
    }

    public fun update_kit_manifest(
        catalog: &mut KitCatalog,
        config: &Config,
        cap: &AdminCap,
        slug: String,
        manifest_hash: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        core::assert_not_paused(config);
        assert!(manifest_hash.length() > 0, E_MANIFEST_REQUIRED);
        assert!(df::exists_<String>(&catalog.id, slug), E_KIT_NOT_FOUND);

        let kit: &mut Kit = df::borrow_mut(&mut catalog.id, slug);
        kit.manifest_hash = manifest_hash;
        kit.updated_at_ms = clock::timestamp_ms(clock);

        event::emit(KitManifestUpdated {
            slug,
            manifest_hash: kit.manifest_hash,
        });
    }

    public fun set_kit_status(
        catalog: &mut KitCatalog,
        config: &Config,
        cap: &AdminCap,
        slug: String,
        status: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        core::assert_not_paused(config);
        validate_status(&status);
        assert!(df::exists_<String>(&catalog.id, slug), E_KIT_NOT_FOUND);

        let kit: &mut Kit = df::borrow_mut(&mut catalog.id, slug);
        kit.status = status;
        kit.updated_at_ms = clock::timestamp_ms(clock);

        event::emit(KitStatusSet { slug, status });
    }

    public fun update_kit_revenue_split(
        catalog: &mut KitCatalog,
        config: &Config,
        cap: &AdminCap,
        slug: String,
        kit_curator_bps: u32,
        agent_owner_bps: u32,
        platform_bps: u32,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        core::assert_not_paused(config);
        validate_split(kit_curator_bps, agent_owner_bps, platform_bps);
        assert!(df::exists_<String>(&catalog.id, slug), E_KIT_NOT_FOUND);

        let kit: &mut Kit = df::borrow_mut(&mut catalog.id, slug);
        kit.kit_curator_bps = kit_curator_bps;
        kit.agent_owner_bps = agent_owner_bps;
        kit.platform_bps = platform_bps;
        kit.updated_at_ms = clock::timestamp_ms(clock);

        event::emit(KitRevenueSplitUpdated {
            slug,
            kit_curator_bps,
            agent_owner_bps,
            platform_bps,
        });
    }

    public fun has_kit(catalog: &KitCatalog, slug: String): bool {
        df::exists_<String>(&catalog.id, slug)
    }

    public fun borrow_kit(catalog: &KitCatalog, slug: String): &Kit {
        assert!(df::exists_<String>(&catalog.id, slug), E_KIT_NOT_FOUND);
        df::borrow(&catalog.id, slug)
    }

    public fun kit_status(kit: &Kit): String { kit.status }
    public fun kit_curator(kit: &Kit): address { kit.curator }
    public fun kit_manifest_hash(kit: &Kit): String { kit.manifest_hash }
    public fun kit_revenue_bps(kit: &Kit): (u32, u32, u32) {
        (kit.kit_curator_bps, kit.agent_owner_bps, kit.platform_bps)
    }
    public fun kit_updated_at_ms(kit: &Kit): u64 { kit.updated_at_ms }

    fun validate_slug(slug: &String) {
        let len = slug.length();
        assert!(len > 0, E_SLUG_EMPTY);
        assert!(len <= SLUG_MAX_LEN, E_SLUG_TOO_LONG);
    }

    fun validate_title(title: &String) {
        let len = title.length();
        assert!(len > 0 && len <= TITLE_MAX_LEN, E_TITLE_LEN);
    }

    fun validate_vertical(vertical: &String) {
        let len = vertical.length();
        assert!(len > 0 && len <= VERTICAL_MAX_LEN, E_VERTICAL_LEN);
    }

    fun validate_split(a: u32, b: u32, c: u32) {
        assert!(a + b + c == BPS_TOTAL, E_BPS_SUM);
    }

    fun validate_status(status: &String) {
        let bytes = status.as_bytes();
        assert!(
            bytes == &KIT_STATUS_ACTIVE
                || bytes == &KIT_STATUS_BETA
                || bytes == &KIT_STATUS_DEPRECATED,
            E_INVALID_STATUS,
        );
    }

    fun key_status_copy(status: &String): String { *status }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }

    #[test_only]
    public fun status_active(): vector<u8> { KIT_STATUS_ACTIVE }

    #[test_only]
    public fun status_beta(): vector<u8> { KIT_STATUS_BETA }

    #[test_only]
    public fun status_deprecated(): vector<u8> { KIT_STATUS_DEPRECATED }
}
