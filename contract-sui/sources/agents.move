module azuka::agents {
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;

    use azuka::core::{Self, Config};

    const HANDLE_MIN_LEN: u64 = 3;
    const HANDLE_MAX_LEN: u64 = 32;
    const BIO_MAX_LEN: u64 = 280;

    const E_HANDLE_LEN: u64 = 0;
    const E_HANDLE_CHARS: u64 = 1;
    const E_HANDLE_TAKEN: u64 = 2;
    const E_BIO_LEN: u64 = 3;
    const E_NOT_OWNER: u64 = 4;

    public struct AgentRegistry has key {
        id: UID,
    }

    public struct AgentProfile has key {
        id: UID,
        owner: address,
        handle: String,
        bio: String,
        public_listed: bool,
        subscribed: bool,
        created_at_ms: u64,
    }

    public struct AgentRegistered has copy, drop {
        owner: address,
        handle: String,
        profile_id: ID,
    }

    public struct AgentBioUpdated has copy, drop {
        owner: address,
        profile_id: ID,
    }

    public struct AgentPublicSet has copy, drop {
        owner: address,
        profile_id: ID,
        public_listed: bool,
    }

    public struct AgentSubscriptionSet has copy, drop {
        owner: address,
        profile_id: ID,
        subscribed: bool,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(AgentRegistry {
            id: object::new(ctx),
        });
    }

    public fun register_agent(
        registry: &mut AgentRegistry,
        config: &Config,
        handle: String,
        bio: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_not_paused(config);
        let lower = validate_handle(&handle);
        assert!(!df::exists_<String>(&registry.id, lower), E_HANDLE_TAKEN);
        assert!(bio.length() <= BIO_MAX_LEN, E_BIO_LEN);

        let owner = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);

        let profile = AgentProfile {
            id: object::new(ctx),
            owner,
            handle,
            bio,
            public_listed: false,
            subscribed: false,
            created_at_ms: now,
        };
        let profile_id = object::id(&profile);

        df::add(&mut registry.id, lower, owner);

        event::emit(AgentRegistered {
            owner,
            handle: profile.handle,
            profile_id,
        });

        transfer::transfer(profile, owner);
    }

    public fun update_bio(
        profile: &mut AgentProfile,
        bio: String,
        ctx: &TxContext,
    ) {
        assert_profile_owner(profile, ctx);
        assert!(bio.length() <= BIO_MAX_LEN, E_BIO_LEN);
        profile.bio = bio;
        event::emit(AgentBioUpdated {
            owner: profile.owner,
            profile_id: object::id(profile),
        });
    }

    public fun set_public(
        profile: &mut AgentProfile,
        public_listed: bool,
        ctx: &TxContext,
    ) {
        assert_profile_owner(profile, ctx);
        profile.public_listed = public_listed;
        event::emit(AgentPublicSet {
            owner: profile.owner,
            profile_id: object::id(profile),
            public_listed,
        });
    }

    public fun set_subscription(
        profile: &mut AgentProfile,
        subscribed: bool,
        ctx: &TxContext,
    ) {
        assert_profile_owner(profile, ctx);
        profile.subscribed = subscribed;
        event::emit(AgentSubscriptionSet {
            owner: profile.owner,
            profile_id: object::id(profile),
            subscribed,
        });
    }

    public fun is_handle_available(registry: &AgentRegistry, handle: String): bool {
        let lower = to_lower(&handle);
        !df::exists_<String>(&registry.id, lower)
    }

    public fun resolve_handle(registry: &AgentRegistry, handle: String): address {
        let lower = to_lower(&handle);
        *df::borrow<String, address>(&registry.id, lower)
    }

    public fun handle_owner_or_zero(registry: &AgentRegistry, handle: String): address {
        let lower = to_lower(&handle);
        if (df::exists_<String>(&registry.id, lower)) {
            *df::borrow<String, address>(&registry.id, lower)
        } else {
            @0x0
        }
    }

    public fun profile_owner(profile: &AgentProfile): address { profile.owner }
    public fun profile_handle(profile: &AgentProfile): String { profile.handle }
    public fun profile_bio(profile: &AgentProfile): String { profile.bio }
    public fun profile_public_listed(profile: &AgentProfile): bool { profile.public_listed }
    public fun profile_subscribed(profile: &AgentProfile): bool { profile.subscribed }
    public fun profile_created_at_ms(profile: &AgentProfile): u64 { profile.created_at_ms }

    fun assert_profile_owner(profile: &AgentProfile, ctx: &TxContext) {
        assert!(profile.owner == tx_context::sender(ctx), E_NOT_OWNER);
    }

    /// Validate handle: 3-32 chars, [A-Za-z0-9_-] only. Returns lowercased copy
    /// for the uniqueness key.
    fun validate_handle(handle: &String): String {
        let bytes = handle.as_bytes();
        let len = bytes.length();
        assert!(len >= HANDLE_MIN_LEN && len <= HANDLE_MAX_LEN, E_HANDLE_LEN);

        let mut i = 0;
        while (i < len) {
            let b = *bytes.borrow(i);
            let ok = (b >= 0x30 && b <= 0x39) // 0-9
                || (b >= 0x41 && b <= 0x5A)   // A-Z
                || (b >= 0x61 && b <= 0x7A)   // a-z
                || b == 0x5F                  // _
                || b == 0x2D;                 // -
            assert!(ok, E_HANDLE_CHARS);
            i = i + 1;
        };

        to_lower(handle)
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

    /// Package-private: expose the registry's UID so sibling modules
    /// (sub_agents, future skills/connections) can attach their own
    /// dynamic fields to the shared registry without giving outsiders
    /// raw mutation rights.
    public(package) fun registry_uid(r: &AgentRegistry): &UID { &r.id }
    public(package) fun registry_uid_mut(r: &mut AgentRegistry): &mut UID { &mut r.id }

    /// Package-private: reserve a (already-lowercased) handle for `owner`.
    /// Aborts if the handle is taken — callers must check first.
    public(package) fun reserve_handle(r: &mut AgentRegistry, lower: String, owner: address) {
        df::add(&mut r.id, lower, owner);
    }

    /// Package-private: release a previously-reserved handle. Pass the
    /// display-cased handle; this lowercases internally so callers don't
    /// need to track casing.
    public(package) fun release_handle(r: &mut AgentRegistry, handle: String) {
        let lower = to_lower(&handle);
        if (df::exists_<String>(&r.id, lower)) {
            let _: address = df::remove<String, address>(&mut r.id, lower);
        };
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
