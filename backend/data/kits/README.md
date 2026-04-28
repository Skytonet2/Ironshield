# Phase 10 Tier 4 — Kit manifests

This directory holds JSON manifests for the four spec Kits + the Wallet Watch Kit (Tier 3, separate PR). The Tier 1 bulk-import CLI ingests these and:

1. Registers each `bundled_skills` entry as a Skill on-chain (creating `Skill` rows + emitting `skill_created` events) — only `builtin:*` slugs end up backed by a real skill module.
2. Inserts an `agent_kits` row with the manifest hash + revenue split + skill ID array.
3. Inserts a matching `mission_templates` row (one per Kit) so users can post missions that target this Kit.
4. Calls `register_kit` on the contract with `(slug, vertical, manifest_hash, revenue_split_bps, curator_wallet)`.

## Manifest fields

| Field | Notes |
|---|---|
| `slug` | Lowercase kebab-case. Matches on-chain `KitId`. |
| `vertical` | Free-text but should match an existing `mission_templates.vertical` value when possible. Tier 4 introduces `realestate`, `commerce`, `lead_gen`, `reputation`. |
| `bundled_skills` | Either a flat array of skill *categories* (`"builtin:scout_jiji"`) OR an array of step objects with per-step parameter wiring (`{ "skill": "builtin:negotiator", "params": { "listing_title": "$prev.items[0].title" } }`). The DSL form lets a Kit thread one skill's output into the next without each skill having to re-read the same shared blob. Bulk-import resolves the categories to Skill IDs and writes the BIGINT[] into `agent_kits.bundled_skill_ids`; the DSL params live in this JSON file and are read at runtime by `kitRunner`. See "Param template syntax" below. |
| `required_connectors` | Connector names that MUST be connected before the Kit will run a mission. UI surfaces a "connect now" CTA. |
| `optional_connectors` | Improves Kit output if connected; not blocking. |
| `preset_config_schema` | JSON-Schema for the deployment-time form. The schema lives in `agent_kits.preset_config_schema_json` and the form renders against it. |
| `revenue_split_bps` | Three-way split summing to 10000. Validated by the schema's `agent_kits_revenue_sums_to_10000` constraint. |
| `default_pricing` | Pricing applied when a kit_deployment doesn't override. |

## Adding a Kit

1. Drop a manifest into this directory.
2. Make sure every `builtin:*` skill referenced is registered in `backend/services/skills/index.js`.
3. Run the bulk-import (Tier 1) — `npm run kit:import -- backend/data/kits/<slug>.json` — once Tier 1 has merged.

## Param template syntax

Inside a step's `params` map, any string value starting with `$` is treated as a template that resolves at runtime against the prior steps + deployment env. Anything else passes through unchanged.

| Template | Resolves to |
|---|---|
| `"$prev"`              | The previous step's full result object |
| `"$prev.items[0].title"` | Dot + bracket path into the previous result |
| `"$0.items[0].url"`    | Step N's result, 0-based |
| `"$preset.target_price"` | The Kit deployment's `preset_config_json` |
| `"$mission.poster_wallet"` | The mission's mirrored row |

Missing references resolve to `undefined` (no exception) so a typo in one step doesn't freeze the whole crew. The downstream skill decides what to do with absent fields. Templates inside arrays / nested objects are walked recursively.

The Realtor Kit is the canonical example — `scout_jiji` runs first, `verifier_listing` reads `$prev.items[0]`, `negotiator` reads from `$1.items[0]` plus `$preset.price_range.max`, and `outreach_dm` finally sends `$prev.message` to `$preset.contact_handle`.

## Files

- `realtor.json` — Realtor Agent (Phase 10 Tier 4). Skills: scout_fb, scout_jiji, verifier_listing, negotiator, outreach_dm. **Uses the DSL** — chains scout → verifier → negotiator → outreach.
- `car_sales.json` — Car Sales Agent (Phase 10 Tier 4). Skills: scout_fb, scout_jiji, outreach_dm, negotiator, verifier_scam.
- `freelancer_hunter.json` — Freelancer Hunter (Phase 10 Tier 4). Skills: scout_x, scout_tg, outreach_dm, pitch_gen.
- `background_checker.json` — Background Checker (Phase 10 Tier 4). Skills: scout_x, scout_fb, verifier_listing, scam_detect, report_gen.
