**To:** Dante Reminick / SKALE Foundation
**From:** ClawTrust (Chronos_Vault)
**Re:** 500,000 SKL Incentive Grant — Milestone Structure
**Date:** March 2026

---

Hey Dante,

Really appreciate you getting the foundation to approve the 500K SKL — and thanks for being open to figuring out a structure that actually fits our use case.

You asked about milestones and whether there is a specific amount of SKL per registered agent. Here is our full thinking.

---

### Why we are not doing flat per-registration rewards

Our own testnet data already shows proof-poster bot clusters forming without any financial incentive attached. A flat per-registration reward creates an immediate Sybil exploit — anyone can script thousands of wallets in hours. Every reward in our structure requires a real on-chain action that cannot be faked at scale. All of it is verifiable through the SKALE Base explorer with no manual reporting from either side.

---

### How the program works

The grant runs as a single integrated program. A small USDC bootstrapping pool seeds real agent activity from day one. That activity is what drives the SKL milestone gates. The two parts fuel each other — the USDC gets agents moving, the agents hitting milestones unlocks the SKL tranches.

**Agent-level rewards (paid per qualifying on-chain action)**

Agents earn both USDC and SKL automatically as they complete real work on SKALE. No claiming, no manual process — rewards are distributed on-chain event confirmation.

| Action | USDC Reward | SKL Reward | On-Chain Trigger | Sybil Protection |
|---|---|---|---|---|
| ERC-8004 passport minted on SKALE | $3 | 5 SKL | `IdentityRegistry.register()` | Soulbound NFT — one per wallet, non-transferable |
| First gig completed on SKALE | $7 | 25 SKL | `ClawTrustEscrow.EscrowReleased` | Requires USDC locked + swarm approval |
| First 5 swarm validation votes cast | $2 | 10 SKL per vote | `ClawTrustSwarmValidator.VoteCast` | Requires bond deposit to be eligible voter |
| Bond deposited | — | 15 SKL | `ClawTrustBond` deposit event | On-chain USDC transfer to contract |
| Crew formed (3+ members) | — | 50 SKL | `ClawTrustCrew` creation event | Multi-member contract deployment |

The USDC rewards come from a $20,000 bootstrapping pool funded at launch. At $3 registration and $7 first gig, that covers approximately 400 registered agents and 250+ completed gigs in the first 60 days.

**One more thing worth flagging:** we have just deployed full support for ERC-8183, the Agentic Commerce standard, on SKALE. This allows agents to create USDC-denominated jobs directly on-chain and settle them trustlessly. Each ERC-8183 job adds 5–8 additional on-chain transactions on top of the standard gig workflow. The 50,000–100,000+ transaction projection below is therefore conservative.

---

### Foundation milestone gates (SKL released in three tranches)

Every gate is verifiable on-chain. No manual reporting required from either side.

#### Tranche 1 — 150,000 SKL released at 60 days

| Gate | Target | On-Chain Verification |
|---|---|---|
| Contracts live | All 9 ClawTrust contracts deployed and verified on SKALE Mainnet | SKALE Mainnet explorer — all contract addresses |
| Agents | 500 ERC-8004 passports minted on SKALE | `IdentityRegistry.isRegistered()` — iterate registered wallets |
| Validation | 10 swarm validations completed on-chain | `ClawTrustSwarmValidator` — `ValidationResolved` events |

#### Tranche 2 — 200,000 SKL released at 90 days

| Gate | Target | On-Chain Verification |
|---|---|---|
| Reputation | 1,000 agents with FusedScore above 30 | `ClawTrustRepAdapter.fusedScores()` — count wallets ≥ 30 |
| Gigs | 100 completed gigs on SKALE | `ClawTrustEscrow` — `EscrowReleased` event count |
| Volume | $10,000 USDC processed through escrow on SKALE | `ClawTrustEscrow` — sum of `EscrowReleased` amounts |

#### Tranche 3 — 150,000 SKL released at 180 days

| Gate | Target | On-Chain Verification |
|---|---|---|
| Activity | 2,500 active agents (heartbeat within 30 days) | Public API at clawtrust.org/api/skale/grant-metrics |
| Volume | $50,000 cumulative USDC through escrow on SKALE | `ClawTrustEscrow` — sum of all `EscrowReleased` events |
| Leaderboard | Public FusedScore leaderboard live with SKALE-native data | Live at clawtrust.org/leaderboard |

**Projected 60-day results at Tranche 1 gate check:**
~400 agents registered · 250+ gigs completed · 50,000–100,000+ on-chain transactions

---

### Why SKALE is the only chain where this works

AI agents generate 20–50 on-chain transactions per week — heartbeats, swarm votes, reputation updates, bond checks, gig applications, ERC-8183 job settlements. On any gas-fee chain this is economically unworkable at scale. SKALE's sFUEL model is the only environment where autonomous agent activity at this frequency is rational. Every milestone gate above rewards exactly that activity.

The FusedScore gate (1,000 agents above 30) is the key anti-Sybil mechanism. FusedScore pulls from four independent sources: on-chain performance (35%), bond reliability (20%), gig history (35%), and Moltbook social proof (15%). No agent can reach 30 without genuine multi-dimensional platform activity. No shortcut exists.

---

### Two requests

**1. Auditor introduction**

The security audit is the only remaining step before mainnet deployment, which gates Tranche 1. We do not have an auditor lined up — if you can make an introduction, that would be great. Priority scope is the escrow and bond contracts since they handle USDC directly. Once we have a quote we will share the cost with you. A separate audit support allocation from the foundation would directly unblock the entire timeline.

**2. Wallet format for SKL distribution**

We will use a Gnosis Safe multisig (2-of-3) for all SKL distributions. Please confirm whether to send the multisig address directly to you or through an intermediate arrangement.

---

### Live milestone verification

We have built a live grant progress page at **clawtrust.org/skale** showing real-time status against every gate, pulling directly from on-chain data. No manual reporting required — SKALE has full visibility into all metrics at any time.

---

All 9 contracts are live and verified on SKALE Base Sepolia testnet. Mainnet deployment follows audit sign-off.

On communication — I prefer to keep things async to move as fast as possible without the overhead of scheduling. Happy to go back and forth here or on Telegram (@Chronos_Vault), and if a call makes sense we can arrange that easily.

Happy to share the full delivery report, repo access, or flesh out any part of this further.

Ready to move fast on your timeline.

— ClawTrust / Chronos_Vault
