module azuka::skills {
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::dynamic_field as df;
    use sui::event;
    use sui::sui::SUI;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::agents::{Self, AgentProfile};

    /// Caps mirror NEAR contract/src/agents.rs.
    const MAX_NAME_LEN: u64 = 48;
    const MAX_DESCRIPTION_LEN: u64 = 240;
    const MAX_CATEGORY_LEN: u64 = 32;
    const MAX_IMAGE_URL_LEN: u64 = 256;
    const MAX_TAGS: u64 = 5;
    const MAX_TAG_LEN: u64 = 24;
    const MAX_INSTALLED_PER_AGENT: u64 = 25;

    /// 15% platform / 85% author. Day-15 split, matching NEAR PLATFORM_FEE_BPS.
    const PLATFORM_FEE_BPS: u64 = 1500;
    const BPS_DENOM: u64 = 10_000;

    const E_NAME_LEN: u64 = 0;
    const E_DESCRIPTION_LEN: u64 = 1;
    const E_CATEGORY_LEN: u64 = 2;
    const E_IMAGE_URL_LEN: u64 = 3;
    const E_TAG_LEN: u64 = 4;
    const E_NOT_AUTHOR: u64 = 5;
    const E_SKILL_NOT_FOUND: u64 = 6;
    const E_INSUFFICIENT_PAYMENT: u64 = 7;
    const E_ALREADY_INSTALLED: u64 = 8;
    const E_INSTALL_LIMIT: u64 = 9;
    const E_NOT_INSTALLED: u64 = 10;

    public struct SkillCatalog has key {
        id: UID,
        next_skill_id: u64,
    }

    /// Per-owner installed-skill list. Lives in a separate shared registry
    /// so install/uninstall doesn't contend on the catalog's lock with skill
    /// authoring.
    public struct InstallRegistry has key {
        id: UID,
    }

    public struct Skill has copy, drop, store {
        id: u64,
        name: String,
        description: String,
        author: address,
        price_mist: u64,
        install_count: u64,
        category: String,
        tags: vector<String>,
        image_url: String,
        verified: bool,
        created_at_ms: u64,
    }

    public struct SkillCreated has copy, drop {
        id: u64,
        author: address,
        name: String,
        category: String,
    }

    public struct SkillMetadataUpdated has copy, drop {
        id: u64,
        author: address,
    }

    public struct SkillVerifiedChanged has copy, drop {
        id: u64,
        verified: bool,
    }

    public struct SkillInstalled has copy, drop {
        owner: address,
        skill_id: u64,
        price_mist: u64,
        paid: bool,
    }

    public struct SkillUninstalled has copy, drop {
        owner: address,
        skill_id: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(SkillCatalog {
            id: object::new(ctx),
            next_skill_id: 0,
        });
        transfer::share_object(InstallRegistry {
            id: object::new(ctx),
        });
    }

    public fun create_skill(
        catalog: &mut SkillCatalog,
        config: &Config,
        author_profile: &AgentProfile,
        name: String,
        description: String,
        price_mist: u64,
        category: String,
        tags: vector<String>,
        image_url: String,
        clock: &Clock,
        ctx: &TxContext,
    ): u64 {
        core::assert_not_paused(config);
        // Profile ownership confirms caller authored this skill.
        assert!(agents::profile_owner(author_profile) == tx_context::sender(ctx), E_NOT_AUTHOR);

        let name_t = trim(&name);
        assert!(name_t.length() > 0 && name_t.length() <= MAX_NAME_LEN, E_NAME_LEN);
        let desc_t = trim(&description);
        assert!(desc_t.length() <= MAX_DESCRIPTION_LEN, E_DESCRIPTION_LEN);
        let cat_t = trim(&category);
        assert!(cat_t.length() <= MAX_CATEGORY_LEN, E_CATEGORY_LEN);
        let img_t = trim(&image_url);
        assert!(img_t.length() <= MAX_IMAGE_URL_LEN, E_IMAGE_URL_LEN);
        let clean_tags = sanitize_tags(tags);

        let id = catalog.next_skill_id;
        catalog.next_skill_id = catalog.next_skill_id + 1;
        let now = clock::timestamp_ms(clock);
        let author = agents::profile_owner(author_profile);

        let skill = Skill {
            id,
            name: name_t,
            description: desc_t,
            author,
            price_mist,
            install_count: 0,
            category: cat_t,
            tags: clean_tags,
            image_url: img_t,
            verified: false,
            created_at_ms: now,
        };

        df::add(&mut catalog.id, id, skill);

        event::emit(SkillCreated { id, author, name: name_t, category: cat_t });
        id
    }

    /// Author-only: rewrite category/tags/image_url. Verified flag is sticky —
    /// only `set_skill_verified` (admin) can flip it.
    public fun update_skill_metadata(
        catalog: &mut SkillCatalog,
        skill_id: u64,
        category: String,
        tags: vector<String>,
        image_url: String,
        ctx: &TxContext,
    ) {
        assert!(df::exists_<u64>(&catalog.id, skill_id), E_SKILL_NOT_FOUND);

        let cat_t = trim(&category);
        assert!(cat_t.length() <= MAX_CATEGORY_LEN, E_CATEGORY_LEN);
        let img_t = trim(&image_url);
        assert!(img_t.length() <= MAX_IMAGE_URL_LEN, E_IMAGE_URL_LEN);
        let clean_tags = sanitize_tags(tags);

        let skill: &mut Skill = df::borrow_mut(&mut catalog.id, skill_id);
        assert!(skill.author == tx_context::sender(ctx), E_NOT_AUTHOR);
        skill.category = cat_t;
        skill.tags = clean_tags;
        skill.image_url = img_t;

        event::emit(SkillMetadataUpdated { id: skill_id, author: skill.author });
    }

    /// Admin-only: flip the verified badge on a skill.
    public fun set_skill_verified(
        catalog: &mut SkillCatalog,
        config: &Config,
        cap: &AdminCap,
        skill_id: u64,
        verified: bool,
        ctx: &TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        assert!(df::exists_<u64>(&catalog.id, skill_id), E_SKILL_NOT_FOUND);
        let skill: &mut Skill = df::borrow_mut(&mut catalog.id, skill_id);
        skill.verified = verified;
        event::emit(SkillVerifiedChanged { id: skill_id, verified });
    }

    /// Install a skill. Caller passes a Coin<SUI> covering the price; any
    /// overpay is refunded. Free skills (price 0) accept a zero-value coin
    /// (or any coin — we just return it intact).
    ///
    /// 15% of price → admin (platform fee), 85% → author (Day-15 split).
    public fun install_skill(
        catalog: &mut SkillCatalog,
        installs: &mut InstallRegistry,
        config: &Config,
        buyer_profile: &AgentProfile,
        skill_id: u64,
        mut payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        core::assert_not_paused(config);
        let buyer = agents::profile_owner(buyer_profile);
        assert!(buyer == tx_context::sender(ctx), E_NOT_AUTHOR);
        assert!(df::exists_<u64>(&catalog.id, skill_id), E_SKILL_NOT_FOUND);

        let skill: &mut Skill = df::borrow_mut(&mut catalog.id, skill_id);
        let price = skill.price_mist;
        let paid = price > 0;

        if (paid) {
            assert!(coin::value(&payment) >= price, E_INSUFFICIENT_PAYMENT);

            // Split the exact price out; refund the rest.
            let mut price_coin = coin::split(&mut payment, price, ctx);

            // Platform cut first (rounds in admin's favor on odd splits).
            let platform_cut = price * PLATFORM_FEE_BPS / BPS_DENOM;
            if (platform_cut > 0) {
                let platform_coin = coin::split(&mut price_coin, platform_cut, ctx);
                transfer::public_transfer(platform_coin, core::admin(config));
            };
            // Whatever remains in price_coin is the author's share.
            if (coin::value(&price_coin) > 0) {
                transfer::public_transfer(price_coin, skill.author);
            } else {
                coin::destroy_zero(price_coin);
            };
        };

        // Refund the unspent balance back to the buyer (zero-value or
        // overpay both flow through here).
        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, buyer);
        } else {
            coin::destroy_zero(payment);
        };

        skill.install_count = skill.install_count + 1;

        // Track install in InstallRegistry.
        let mut list = take_or_empty_installs(installs, buyer);
        assert!(!contains(&list, skill_id), E_ALREADY_INSTALLED);
        assert!(list.length() < MAX_INSTALLED_PER_AGENT, E_INSTALL_LIMIT);
        list.push_back(skill_id);
        write_installs(installs, buyer, list);

        event::emit(SkillInstalled { owner: buyer, skill_id, price_mist: price, paid });
    }

    public fun uninstall_skill(
        catalog: &mut SkillCatalog,
        installs: &mut InstallRegistry,
        skill_id: u64,
        ctx: &TxContext,
    ) {
        let owner = tx_context::sender(ctx);
        let mut list = take_or_empty_installs(installs, owner);
        let pos = index_of(&list, skill_id);
        assert!(pos < list.length(), E_NOT_INSTALLED);
        list.remove(pos);
        write_installs(installs, owner, list);

        if (df::exists_<u64>(&catalog.id, skill_id)) {
            let skill: &mut Skill = df::borrow_mut(&mut catalog.id, skill_id);
            if (skill.install_count > 0) {
                skill.install_count = skill.install_count - 1;
            };
        };

        event::emit(SkillUninstalled { owner, skill_id });
    }

    // ── Reads ────────────────────────────────────────────────────────

    public fun has_skill(catalog: &SkillCatalog, skill_id: u64): bool {
        df::exists_<u64>(&catalog.id, skill_id)
    }

    public fun borrow_skill(catalog: &SkillCatalog, skill_id: u64): &Skill {
        assert!(df::exists_<u64>(&catalog.id, skill_id), E_SKILL_NOT_FOUND);
        df::borrow(&catalog.id, skill_id)
    }

    public fun next_skill_id(catalog: &SkillCatalog): u64 { catalog.next_skill_id }

    public fun installed_count(installs: &InstallRegistry, owner: address): u64 {
        if (df::exists_<address>(&installs.id, owner)) {
            let list: &vector<u64> = df::borrow(&installs.id, owner);
            list.length()
        } else { 0 }
    }

    public fun is_installed(installs: &InstallRegistry, owner: address, skill_id: u64): bool {
        if (!df::exists_<address>(&installs.id, owner)) return false;
        let list: &vector<u64> = df::borrow(&installs.id, owner);
        contains(list, skill_id)
    }

    public fun skill_id(s: &Skill): u64 { s.id }
    public fun skill_name(s: &Skill): String { s.name }
    public fun skill_author(s: &Skill): address { s.author }
    public fun skill_price_mist(s: &Skill): u64 { s.price_mist }
    public fun skill_install_count(s: &Skill): u64 { s.install_count }
    public fun skill_verified(s: &Skill): bool { s.verified }
    public fun skill_category(s: &Skill): String { s.category }
    public fun skill_tags(s: &Skill): vector<String> { s.tags }

    // ── Internals ────────────────────────────────────────────────────

    fun take_or_empty_installs(installs: &mut InstallRegistry, owner: address): vector<u64> {
        if (df::exists_<address>(&installs.id, owner)) {
            df::remove<address, vector<u64>>(&mut installs.id, owner)
        } else {
            vector<u64>[]
        }
    }

    fun write_installs(installs: &mut InstallRegistry, owner: address, list: vector<u64>) {
        df::add(&mut installs.id, owner, list);
    }

    fun contains(list: &vector<u64>, target: u64): bool {
        index_of(list, target) < list.length()
    }

    fun index_of(list: &vector<u64>, target: u64): u64 {
        let len = list.length();
        let mut i = 0;
        while (i < len) {
            if (*list.borrow(i) == target) return i;
            i = i + 1;
        };
        len
    }

    /// Trim, lowercase, dedupe, cap at MAX_TAGS. Aborts if any individual
    /// tag exceeds MAX_TAG_LEN.
    fun sanitize_tags(raw: vector<String>): vector<String> {
        let mut out: vector<String> = vector::empty();
        let mut i = 0;
        let n = raw.length();
        while (i < n && out.length() < MAX_TAGS) {
            let t = trim(raw.borrow(i));
            if (t.length() > 0) {
                assert!(t.length() <= MAX_TAG_LEN, E_TAG_LEN);
                let lc = to_lower(&t);
                if (!contains_string(&out, &lc)) {
                    out.push_back(lc);
                };
            };
            i = i + 1;
        };
        out
    }

    fun contains_string(list: &vector<String>, target: &String): bool {
        let n = list.length();
        let mut i = 0;
        while (i < n) {
            if (list.borrow(i) == target) return true;
            i = i + 1;
        };
        false
    }

    fun trim(s: &String): String {
        let bytes = s.as_bytes();
        let len = bytes.length();
        let mut start = 0;
        while (start < len) {
            let b = *bytes.borrow(start);
            if (b != 0x20 && b != 0x09 && b != 0x0A && b != 0x0D) break;
            start = start + 1;
        };
        let mut end = len;
        while (end > start) {
            let b = *bytes.borrow(end - 1);
            if (b != 0x20 && b != 0x09 && b != 0x0A && b != 0x0D) break;
            end = end - 1;
        };
        let mut out = vector<u8>[];
        let mut j = start;
        while (j < end) {
            out.push_back(*bytes.borrow(j));
            j = j + 1;
        };
        string::utf8(out)
    }

    fun to_lower(s: &String): String {
        let bytes = s.as_bytes();
        let len = bytes.length();
        let mut out: vector<u8> = vector::empty();
        let mut i = 0;
        while (i < len) {
            let b = *bytes.borrow(i);
            let lc = if (b >= 0x41 && b <= 0x5A) { b + 0x20 } else { b };
            out.push_back(lc);
            i = i + 1;
        };
        string::utf8(out)
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
