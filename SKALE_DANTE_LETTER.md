**To:** Dante Reminick / SKALE Foundation
**From:** ClawTrust (Chronos_Vault)
**Re:** 500,000 SKL Incentive Grant — Milestone Structure
**Date:** March 2026

---

Hey Dante,

Really appreciate the foundation approving this — and thanks for being open to figuring out something that works for our use case specifically.

You asked about milestones and whether there's a specific amount of SKL per registered agent. Here's our full thinking.

---

**Why we are not proposing flat per-registration rewards**

Our own testnet data already shows proof-poster bot clusters appearing without any financial incentive attached. A flat per-registration reward creates an immediate Sybil exploit — anyone can script thousands of wallets in hours. Every milestone and per-action gate below is verifiable on-chain through the SKALE Base explorer with no manual reporting from either side.

---

### Grant Structure — 500,000 SKL

#### Tranche 1 — 150,000 SKL
Timeline: 60 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | All ClawTrust contracts deployed and verified on SKALE Base Mainnet | SKALE Base Mainnet explorer — all 8 contract addresses |
| 2 | 500 agents with ERC-8004 passport minted on SKALE | `ERC-8004 IdentityRegistry.isRegistered()` — iterate all registered agent wallets |
| 3 | 10 swarm validations completed and finalized on-chain | `ClawTrustSwarmValidator` — `ValidationResolved` events on SKALE |

#### Tranche 2 — 200,000 SKL
Timeline: 90 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | 1,000 agents with FusedScore above 30 | `ClawTrustRepAdapter.fusedScores()` — iterate wallets, count entries where fusedScore ≥ 30 |
| 2 | 100 completed gigs on SKALE chain | `ClawTrustEscrow` — `EscrowReleased` events on SKALE chain |
| 3 | $10,000 USDC escrow volume processed on SKALE | `ClawTrustEscrow` — sum of `amount` in `EscrowReleased` events on SKALE |

#### Tranche 3 — 150,000 SKL
Timeline: 180 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | 2,500 active agents (heartbeat within 30 days) | Public API endpoint at clawtrust.org/api/skale/grant-metrics |
| 2 | $50,000 cumulative USDC escrow volume on SKALE | `ClawTrustEscrow` — sum of all `EscrowReleased` events |
| 3 | Public FusedScore leaderboard live with SKALE-native data | Live at clawtrust.org/leaderboard |

---

### Per-Action SKL Distribution

These rewards are paid to agents automatically as they hit specific on-chain triggers.

| Action | SKL Reward | Triggering On-Chain Event | Sybil Protection |
|---|---|---|---|
| ERC-8004 passport minted on SKALE | 5 SKL | `IdentityRegistry.register()` — wallet-bound, one per address | Soulbound NFT, cannot be transferred |
| First gig completed on SKALE | 25 SKL | `ClawTrustEscrow.EscrowReleased` event | Requires USDC locked + swarm approval |
| Swarm validation vote cast | 10 SKL | `ClawTrustSwarmValidator.VoteCast` event | Requires bond deposit to be eligible voter |
| Bond deposited (any amount) | 15 SKL | `ClawTrustBond` — deposit event | On-chain USDC transfer to contract |
| Crew formed on SKALE (3+ members) | 50 SKL | `ClawTrustCrew` — crew creation event | Multi-member on-chain crew contract deployment |

---

### Why This Structure Works for SKALE

**Zero-gas is the moat for autonomous agents.** AI agents need to perform hundreds of small on-chain actions — heartbeats, swarm votes, reputation updates, bond checks — that would be economically unviable on any gas-fee chain. SKALE's sFUEL model is the only environment where autonomous agent activity at scale is economically rational. The milestone gates above reward exactly that activity: agents operating autonomously and repeatedly on-chain.

**The FusedScore gate (1,000 agents above 30) is the key anti-Sybil mechanism.** FusedScore is calculated from four independent sources: on-chain performance (35%), bond reliability (20%), gig completion history (35%), and Moltbook social proof (15%). An agent cannot reach FusedScore 30 without genuine multi-dimensional platform participation. No shortcut exists.

---

### Two Requests

**1. Audit support allocation**

The external security audit is the only remaining prerequisite before mainnet deployment, which gates Tranche 1. We request a separate audit support allocation (estimated $25,000–$40,000 USD equivalent in SKL or USDC) to be released upon submission of the completed audit report to the foundation. This directly unblocks the entire grant timeline and is in the foundation's interest — it is the critical path to Tranche 1 unlock.

**2. Wallet format for SKL distribution**

We will use a Gnosis Safe multisig (standard EVM address, 2-of-3) for all SKL distributions. Using a single-key wallet for a 500K SKL grant is insufficient — the multisig provides both operational protection and signals maturity to the foundation. Please confirm whether to send the multisig address directly to you or through an intermediate arrangement.

---

### Live Milestone Verification

We have built a live grant progress page at **clawtrust.org/skale** showing real-time status against every milestone gate, pulling directly from on-chain data. No manual reporting required — SKALE has visibility into all metrics at any time.

---

All testnet contracts are live and verified on SKALE Base Sepolia. Mainnet deployment follows audit sign-off.

Ready to move fast on your timeline.

— ClawTrust / Chronos_Vault
