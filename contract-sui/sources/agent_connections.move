module azuka::agent_connections {
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;

    use azuka::core::{Self, Config};
    use azuka::agents::{Self, AgentProfile};
    use azuka::sub_agents::{Self, SubAgent};

    /// Caps mirror NEAR contract/src/agents.rs.
    const MAX_CONNECTIONS_PER_AGENT: u64 = 8;
    const MAX_FRAMEWORK_LEN: u64 = 32;
    const MAX_EXTERNAL_ID_LEN: u64 = 96;
    const MAX_ENDPOINT_LEN: u64 = 256;
    const MAX_META_LEN: u64 = 1024;

    const E_FRAMEWORK_LEN: u64 = 0;
    const E_EXTERNAL_ID_LEN: u64 = 1;
    const E_ENDPOINT_LEN: u64 = 2;
    const E_META_LEN: u64 = 3;
    const E_LIMIT_REACHED: u64 = 4;
    const E_NOT_OWNER: u64 = 5;
    const E_NOT_ORCHESTRATOR: u64 = 6;
    const E_CONNECTION_NOT_FOUND: u64 = 7;
    const E_NO_CONNECTIONS: u64 = 8;

    public struct AgentConnectionsRegistry has key {
        id: UID,
    }

    /// Public side of an agent ↔ framework binding. Auth tokens stay
    /// off-chain in the backend; this row only carries fields that are
    /// safe to publish.
    public struct AgentConnection has copy, drop, store {
        framework: String,
        external_id: String,
        endpoint: String,
        meta: String,
        created_at_ms: u64,
        last_seen_ms: u64,
    }

    public struct ConnectionSet has copy, drop {
        agent_id: ID,
        framework: String,
    }

    public struct ConnectionRemoved has copy, drop {
        agent_id: ID,
        framework: String,
    }

    public struct ConnectionSeen has copy, drop {
        agent_id: ID,
        framework: String,
        last_seen_ms: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(AgentConnectionsRegistry {
            id: object::new(ctx),
        });
    }

    // ── Owner-gated writes ─────────────────────────────────────────────

    public fun set_connection_for_profile(
        registry: &mut AgentConnectionsRegistry,
        config: &Config,
        profile: &AgentProfile,
        framework: String,
        external_id: String,
        endpoint: String,
        meta: String,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(agents::profile_owner(profile) == tx_context::sender(ctx), E_NOT_OWNER);
        set_connection_inner(registry, object::id(profile), framework, external_id, endpoint, meta, clock);
    }

    public fun set_connection_for_sub(
        registry: &mut AgentConnectionsRegistry,
        config: &Config,
        sub: &SubAgent,
        framework: String,
        external_id: String,
        endpoint: String,
        meta: String,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(sub_agents::sub_owner(sub) == tx_context::sender(ctx), E_NOT_OWNER);
        set_connection_inner(registry, object::id(sub), framework, external_id, endpoint, meta, clock);
    }

    public fun remove_connection_for_profile(
        registry: &mut AgentConnectionsRegistry,
        profile: &AgentProfile,
        framework: String,
        ctx: &TxContext,
    ) {
        assert!(agents::profile_owner(profile) == tx_context::sender(ctx), E_NOT_OWNER);
        remove_connection_inner(registry, object::id(profile), framework);
    }

    public fun remove_connection_for_sub(
        registry: &mut AgentConnectionsRegistry,
        sub: &SubAgent,
        framework: String,
        ctx: &TxContext,
    ) {
        assert!(sub_agents::sub_owner(sub) == tx_context::sender(ctx), E_NOT_OWNER);
        remove_connection_inner(registry, object::id(sub), framework);
    }

    // ── Orchestrator-gated mark-seen ───────────────────────────────────

    public fun mark_seen(
        registry: &mut AgentConnectionsRegistry,
        config: &Config,
        agent_id: ID,
        framework: String,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == core::orchestrator(config), E_NOT_ORCHESTRATOR);
        let fw = trim(&framework);
        assert!(df::exists_<ID>(&registry.id, agent_id), E_NO_CONNECTIONS);

        let list: &mut vector<AgentConnection> = df::borrow_mut(&mut registry.id, agent_id);
        let pos = find_framework(list, &fw);
        assert!(pos < list.length(), E_CONNECTION_NOT_FOUND);

        let now = clock::timestamp_ms(clock);
        let conn = list.borrow_mut(pos);
        conn.last_seen_ms = now;

        event::emit(ConnectionSeen { agent_id, framework: fw, last_seen_ms: now });
    }

    // ── Read views ─────────────────────────────────────────────────────

    public fun connection_count(registry: &AgentConnectionsRegistry, agent_id: ID): u64 {
        if (df::exists_<ID>(&registry.id, agent_id)) {
            let list: &vector<AgentConnection> = df::borrow(&registry.id, agent_id);
            list.length()
        } else { 0 }
    }

    public fun has_connection(registry: &AgentConnectionsRegistry, agent_id: ID, framework: String): bool {
        if (!df::exists_<ID>(&registry.id, agent_id)) return false;
        let list: &vector<AgentConnection> = df::borrow(&registry.id, agent_id);
        let fw = trim(&framework);
        find_framework(list, &fw) < list.length()
    }

    public fun connection_last_seen_ms(
        registry: &AgentConnectionsRegistry,
        agent_id: ID,
        framework: String,
    ): u64 {
        let list: &vector<AgentConnection> = df::borrow(&registry.id, agent_id);
        let fw = trim(&framework);
        let pos = find_framework(list, &fw);
        assert!(pos < list.length(), E_CONNECTION_NOT_FOUND);
        list.borrow(pos).last_seen_ms
    }

    public fun connection_endpoint(
        registry: &AgentConnectionsRegistry,
        agent_id: ID,
        framework: String,
    ): String {
        let list: &vector<AgentConnection> = df::borrow(&registry.id, agent_id);
        let fw = trim(&framework);
        let pos = find_framework(list, &fw);
        assert!(pos < list.length(), E_CONNECTION_NOT_FOUND);
        list.borrow(pos).endpoint
    }

    // ── Internals ──────────────────────────────────────────────────────

    fun set_connection_inner(
        registry: &mut AgentConnectionsRegistry,
        agent_id: ID,
        framework: String,
        external_id: String,
        endpoint: String,
        meta: String,
        clock: &Clock,
    ) {
        let fw = trim(&framework);
        let xid = trim(&external_id);
        let ep = trim(&endpoint);
        assert!(fw.length() > 0 && fw.length() <= MAX_FRAMEWORK_LEN, E_FRAMEWORK_LEN);
        assert!(xid.length() <= MAX_EXTERNAL_ID_LEN, E_EXTERNAL_ID_LEN);
        assert!(ep.length() <= MAX_ENDPOINT_LEN, E_ENDPOINT_LEN);
        assert!(meta.length() <= MAX_META_LEN, E_META_LEN);

        let now = clock::timestamp_ms(clock);

        if (!df::exists_<ID>(&registry.id, agent_id)) {
            let list = vector<AgentConnection>[
                AgentConnection {
                    framework: fw,
                    external_id: xid,
                    endpoint: ep,
                    meta,
                    created_at_ms: now,
                    last_seen_ms: 0,
                },
            ];
            df::add(&mut registry.id, agent_id, list);
            event::emit(ConnectionSet { agent_id, framework });
            return
        };

        let list: &mut vector<AgentConnection> = df::borrow_mut(&mut registry.id, agent_id);
        let pos = find_framework(list, &fw);

        if (pos < list.length()) {
            // Update in place; preserve created_at_ms and last_seen_ms.
            let existing = list.borrow_mut(pos);
            existing.external_id = xid;
            existing.endpoint = ep;
            existing.meta = meta;
            // framework stays the same (matched lookup)
        } else {
            assert!(list.length() < MAX_CONNECTIONS_PER_AGENT, E_LIMIT_REACHED);
            list.push_back(AgentConnection {
                framework: fw,
                external_id: xid,
                endpoint: ep,
                meta,
                created_at_ms: now,
                last_seen_ms: 0,
            });
        };

        event::emit(ConnectionSet { agent_id, framework });
    }

    fun remove_connection_inner(
        registry: &mut AgentConnectionsRegistry,
        agent_id: ID,
        framework: String,
    ) {
        let fw = trim(&framework);
        assert!(df::exists_<ID>(&registry.id, agent_id), E_NO_CONNECTIONS);

        let list: &mut vector<AgentConnection> = df::borrow_mut(&mut registry.id, agent_id);
        let pos = find_framework(list, &fw);
        assert!(pos < list.length(), E_CONNECTION_NOT_FOUND);

        list.remove(pos);

        // If the per-agent vec is empty, drop the dynamic field entry so
        // a fresh `set_connection` after a full clear starts clean.
        if (list.length() == 0) {
            let _: vector<AgentConnection> = df::remove(&mut registry.id, agent_id);
        };

        event::emit(ConnectionRemoved { agent_id, framework: fw });
    }

    fun find_framework(list: &vector<AgentConnection>, fw: &String): u64 {
        let len = list.length();
        let mut i = 0;
        while (i < len) {
            if (&list.borrow(i).framework == fw) return i;
            i = i + 1;
        };
        len
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

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
