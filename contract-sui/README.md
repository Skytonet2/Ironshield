# AZUKA Sui Contracts

Phase B.2 skeleton for the Sui-native AZUKA contract package.

This package intentionally contains only the core foundation:

- `azuka::core::Config`: shared root config object.
- `azuka::core::AdminCap`: owned admin capability.
- Pause, orchestrator, and admin-transfer controls.

No backend, frontend, or NEAR production route is wired to this package yet.

## Toolchain

Use Sui CLI 1.45 or newer. The package uses Move edition `2024` and relies on the modern implicit Sui framework dependency.

Expected commands from the repo root:

```powershell
sui move build --path contract-sui
sui move test --path contract-sui
```

Local note: the Sui CLI was not installed on this machine when the skeleton was created, so build/test must be run after the CLI is provisioned.

## Next Slices

Recommended next implementation order:

1. Add Sui Move tests for `azuka::core`.
2. Add `azuka::kits` using the existing off-chain manifest hash model.
3. Add `azuka::agents` / `azuka::skills`.
4. Add `azuka::missions` with SUI escrow in MIST.
