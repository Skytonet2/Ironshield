module azuka::sub_agents {
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;

    use azuka::core::{Self, Config};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};

    /// Per-owner cap. Matches NEAR's MAX_SUB_AGENTS_PER_OWNER.
    const MAX_SUB_AGENTS_PER_OWNER: u8 = 10;
    const HANDLE_MIN_LEN: u64 = 3;
    const HANDLE_MAX_LEN: u64 = 32;
    const BIO_MAX_LEN: u64 = 280;

    const E_HANDLE_LEN: u64 = 0;
    const E_HANDLE_CHARS: u64 = 1;
    const E_HANDLE_TAKEN: u64 = 2;
    const E_BIO_LEN: u64 = 3;
    const E_NOT_OWNER: u64 = 4;
    const E_LIMIT_REACHED: u64 = 5;
    const E_NO_PRIMARY_PROFILE: u64 = 6;

    /// Per-owner sub-agent counter, tracked as dynamic_field<address, u8>
    /// on the AgentRegistry shared object. Used to enforce the cap without
    /// scanning every owned object.
    public struct SubAgentCounter has copy, drop, store {
        count: u8,
    }

    /// Owned sub-agent object. The owner address holds it; transfer it to
    /// re-assign (Sui has no NEAR-style sub-account hierarchy, so the
    /// `agent_account` field NEAR carried collapses into the owner address).
    public struct SubAgent has key {
        id: UID,
        owner: address,
        handle: String,
        bio: String,
        created_at_ms: u64,
    }

    public struct SubAgentRegistered has copy, drop {
        owner: address,
        handle: String,
        sub_agent_id: ID,
    }

    public struct SubAgentBioUpdated has copy, drop {
        owner: address,
        sub_agent_id: ID,
    }

    public struct SubAgentRemoved has copy, drop {
        owner: address,
        handle: String,
        sub_agent_id: ID,
    }

    public fun register_sub_agent(
        registry: &mut AgentRegistry,
        config: &Config,
        primary: &AgentProfile,
        handle: String,
        bio: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        core::assert_not_paused(config);
        let owner = tx_context::sender(ctx);
        // Sui's owned-object resolution already proves caller owns `primary`.
        // Belt-and-suspenders.
        assert!(agents::profile_owner(primary) == owner, E_NO_PRIMARY_PROFILE);

        let lower = validate_handle(&handle);
        // Shared namespace with primary handles per NEAR semantics.
        assert!(agents::is_handle_available(registry, handle), E_HANDLE_TAKEN);
        assert!(bio.length() <= BIO_MAX_LEN, E_BIO_LEN);

        // Bump per-owner counter.
        let count_before = current_count(registry, owner);
        assert!(count_before < MAX_SUB_AGENTS_PER_OWNER, E_LIMIT_REACHED);
        write_count(registry, owner, count_before + 1);

        // Reserve handle in the shared registry. We use the agents module's
        // dynamic_field convention (lowercase handle -> address). The address
        // we record here is the owner — same as primary, so resolve_handle
        // works for both.
        agents::reserve_handle(registry, lower, owner);

        let now = clock::timestamp_ms(clock);
        let sub = SubAgent {
            id: object::new(ctx),
            owner,
            handle,
            bio,
            created_at_ms: now,
        };
        let sub_id = object::id(&sub);

        event::emit(SubAgentRegistered {
            owner,
            handle: sub.handle,
            sub_agent_id: sub_id,
        });

        transfer::transfer(sub, owner);
    }

    public fun update_bio(
        sub: &mut SubAgent,
        bio: String,
        ctx: &TxContext,
    ) {
        assert_owner(sub, ctx);
        assert!(bio.length() <= BIO_MAX_LEN, E_BIO_LEN);
        sub.bio = bio;
        event::emit(SubAgentBioUpdated {
            owner: sub.owner,
            sub_agent_id: object::id(sub),
        });
    }

    /// Owner: drop a sub-agent. Frees its handle in the registry and
    /// decrements the per-owner counter. Burns the SubAgent object.
    public fun remove_sub_agent(
        registry: &mut AgentRegistry,
        sub: SubAgent,
        ctx: &TxContext,
    ) {
        assert_owner(&sub, ctx);
        let SubAgent { id, owner, handle, bio: _, created_at_ms: _ } = sub;
        let sub_id = id.to_inner();
        agents::release_handle(registry, handle);

        let count_before = current_count(registry, owner);
        if (count_before > 0) {
            write_count(registry, owner, count_before - 1);
        };

        event::emit(SubAgentRemoved {
            owner,
            handle,
            sub_agent_id: sub_id,
        });

        id.delete();
    }

    public fun sub_agent_count(registry: &AgentRegistry, owner: address): u8 {
        current_count_view(registry, owner)
    }

    public fun sub_owner(s: &SubAgent): address { s.owner }
    public fun sub_handle(s: &SubAgent): String { s.handle }
    public fun sub_bio(s: &SubAgent): String { s.bio }
    public fun sub_created_at_ms(s: &SubAgent): u64 { s.created_at_ms }

    fun assert_owner(sub: &SubAgent, ctx: &TxContext) {
        assert!(sub.owner == tx_context::sender(ctx), E_NOT_OWNER);
    }

    fun current_count(registry: &mut AgentRegistry, owner: address): u8 {
        let key = counter_key(owner);
        if (df::exists_<vector<u8>>(agents::registry_uid_mut(registry), key)) {
            let row: SubAgentCounter = df::remove<vector<u8>, SubAgentCounter>(agents::registry_uid_mut(registry), key);
            row.count
        } else {
            0
        }
    }

    fun current_count_view(registry: &AgentRegistry, owner: address): u8 {
        let key = counter_key(owner);
        if (df::exists_<vector<u8>>(agents::registry_uid(registry), key)) {
            let row: &SubAgentCounter = df::borrow<vector<u8>, SubAgentCounter>(agents::registry_uid(registry), key);
            row.count
        } else {
            0
        }
    }

    fun write_count(registry: &mut AgentRegistry, owner: address, count: u8) {
        let key = counter_key(owner);
        df::add(agents::registry_uid_mut(registry), key, SubAgentCounter { count });
    }

    fun counter_key(owner: address): vector<u8> {
        let mut k = b"sub_count:";
        k.append(sui::address::to_bytes(owner));
        k
    }

    fun validate_handle(handle: &String): String {
        let bytes = handle.as_bytes();
        let len = bytes.length();
        assert!(len >= HANDLE_MIN_LEN && len <= HANDLE_MAX_LEN, E_HANDLE_LEN);

        let mut i = 0;
        while (i < len) {
            let b = *bytes.borrow(i);
            let ok = (b >= 0x30 && b <= 0x39)
                || (b >= 0x41 && b <= 0x5A)
                || (b >= 0x61 && b <= 0x7A)
                || b == 0x5F
                || b == 0x2D;
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
}
