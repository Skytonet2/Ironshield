# IronShield - Backend Developer Handoff 🛡️

Welcome! You are taking over the IronShield NEAR application after a major architectural refactor. The UI/UX is fully complete and responsively built, and we have migrated away from a centralized Vercel/NextJS backend towards a completely decentralized architecture hosted on IPFS `.near.page`.

This document maps out the specific junction points where you need to implement `near-api-js` API calls to replace the temporary `localStorage` stubs we used during development.

---

## 1. The Staking Smart Contract
**Location:** `/contract/src/`

We developed a production-ready, MasterChef-algorithm staking contract in Rust (using `near-sdk v5.1.0` syntax, compatible optimally down via NearToken wrappers). 
* **Asset Model:** Users stake `$IRONCLAW` (NEP-141) and passively earn `$NEAR` from protocol revenue.
* **Math Strategy:** Constant time $O(1)$ reward distribution mapping using `acc_reward_per_share`.
* **Important:** We implemented a deflationary penalty on early unstaking. Slashed $IRONCLAW tokens are purposely sent to the `system` dead address via `ext_ft_contract` cross-contract callbacks.

**Your Tasks:**
- Audit `pool.rs` and `actions.rs` in the `contract/` folder.
- Execute the WASM build: `cargo build --target wasm32-unknown-unknown --release` (We fixed the `Cargo.toml` yanked dependencies bypass).
- Deploy the contract to `ironshield.near` and initialize it.

---

## 2. Frontend / Smart Contract Integration
**Current State:** The frontend navigation and wallet connection (`@near-wallet-selector`) are completely implemented. 

**Your Task:**
Locate `src/components/StakingPage.jsx` and `src/components/EarnPage.jsx` and replace the visual dummy text rendering with real API calls using our pre-installed `near-api-js`:

### A. The Staking Logic (`StakingPage.jsx`)
- **Read State:** Fetch the connected user's `user.amount`, `pool.total_staked`, and calculate `pending_reward`.
- **Stake Callback:** When the user clicks **Stake Tokens**, trigger precisely *one* transaction: an `ft_transfer_call` on the `$IRONCLAW` contract with a `msg` payload equal to the `pool_id`. (The Rust staking contract's `ft_on_transfer` listener handles the rest automatically).
- **Claim / Unstake:** Bind the **Claim** and **Unstake** buttons to call the Rust `claim` and `unstake` function calls directly natively.

### B. The Application Database (`AdminPanel.jsx` & Data Flow)
Since we abandoned Vercel API routes for total Web3 compliance, the Admin Panel adjustments were temporarily saved in browser local storage.
- You must create a secondary Smart Contract (or append to the Staking contract) to permanently store the structural configuration of `Leaderboard Stats`, `Pending Contests`, and Application configurations on the blockchain state.

---

## 3. Deployment Protocol

1. Any changes you make to the UI must be compiled using `npm run build`. This generates the `out/` static directory.
2. Ensure you have the `ironshield.near` full-access credential stored in `~/.near-credentials`.
3. To update the live Decentralized `.near.page` URL, execute:
```bash
npx web4-deploy out ironshield.near
```

Best of luck! The scaffolding is bulletproof—now all it needs is the plumbing.
