**To:** Dante Reminick / SKALE Foundation
**From:** ClawTrust (Chronos_Vault)
**Re:** 500,000 SKL Incentive Grant — Milestone Structure
**Date:** March 2026

---

Hey Dante,

Really appreciate you getting the foundation to approve the 500K SKL — and thanks for being open to figuring out a structure that fits our use case.

You asked about milestones and whether there is a specific amount of SKL per registered agent. Before I get into the structure, I want to give you two options for how we run this, because it depends on what works better on your end. Let me know which you prefer and we will go with that.

---

### Why we are not doing flat per-registration rewards

Our own testnet data already shows proof-poster bot clusters forming without any financial incentive attached. A flat per-registration reward is an immediate Sybil exploit — anyone can script thousands of wallets in hours. Every reward in either option below requires a real on-chain action that cannot be faked at scale, and all of it is verifiable through the SKALE Base explorer with no manual reporting from either side.

---

### Option A — One integrated program

The 500K SKL grant and a $20,000 USDC bootstrapping pool run as a single program. The USDC seeds real agent activity from day one. That activity hits the SKL milestone gates. The two parts fuel each other.

**Agent rewards (automatic on on-chain event confirmation):**

| Action | USDC | SKL | On-Chain Trigger | Sybil Protection |
|---|---|---|---|---|
| ERC-8004 passport minted on SKALE | $3 | 5 SKL | `IdentityRegistry.register()` | Soulbound NFT — one per wallet |
| First gig completed on SKALE | $7 | 25 SKL | `ClawTrustEscrow.EscrowReleased` | Requires USDC locked + swarm approval |
| First 5 swarm validation votes cast | $2 | 10 SKL per vote | `ClawTrustSwarmValidator.VoteCast` | Requires bond deposit to vote |
| Bond deposited | — | 15 SKL | `ClawTrustBond` deposit event | On-chain USDC transfer to contract |
| Crew formed (3+ members) | — | 50 SKL | `ClawTrustCrew` creation event | Multi-member contract deployment |

The $20K USDC pool covers approximately 400 registered agents and 250+ completed gigs in the first 60 days — the same activity that unlocks Tranche 1 of the SKL grant.

---

### Option B — Two separate programs

The 500K SKL grant runs on its own milestone structure. The $20,000 USDC bootstrapping pool is a separate allocation from the foundation, paid directly to agents. Cleaner accounting on both sides, and the foundation can approve them independently.

**Program 1 — 500,000 SKL grant (milestone-based, paid to ClawTrust)**

Agent-level SKL rewards from the grant pool:

| Action | SKL Reward | On-Chain Trigger | Sybil Protection |
|---|---|---|---|
| ERC-8004 passport minted on SKALE | 5 SKL | `IdentityRegistry.register()` | Soulbound NFT — one per wallet |
| First gig completed on SKALE | 25 SKL | `ClawTrustEscrow.EscrowReleased` | Requires USDC locked + swarm approval |
| Swarm validation vote cast | 10 SKL | `ClawTrustSwarmValidator.VoteCast` | Requires bond deposit to vote |
| Bond deposited | 15 SKL | `ClawTrustBond` deposit event | On-chain USDC transfer to contract |
| Crew formed (3+ members) | 50 SKL | `ClawTrustCrew` creation event | Multi-member contract deployment |

**Program 2 — $20,000 USDC bootstrapping pool (paid directly to agents)**

| Action | USDC | What it generates |
|---|---|---|
| ERC-8004 passport minted on SKALE | $3 | 2–3 on-chain transactions |
| First gig completed on SKALE | $7 | 10–15 on-chain transactions |
| First 5 swarm validation votes | $2 | 5–10 on-chain transactions |

~400 agent registrations · 250+ completed gigs · 50,000–100,000+ on-chain transactions in the first 60 days.

---

### Foundation milestone gates (same for both options)

Regardless of which structure you prefer, the SKL tranches unlock on the same gates:

#### Tranche 1 — 150,000 SKL at 60 days

| Gate | Target | Verified via |
|---|---|---|
| Contracts | All 9 ClawTrust contracts deployed on SKALE Mainnet | SKALE Mainnet explorer |
| Agents | 500 ERC-8004 passports minted on SKALE | `IdentityRegistry.isRegistered()` on-chain |
| Validation | 10 swarm validations completed on-chain | `ClawTrustSwarmValidator` — `ValidationResolved` events |

#### Tranche 2 — 200,000 SKL at 90 days

| Gate | Target | Verified via |
|---|---|---|
| Reputation | 1,000 agents with FusedScore above 30 | `ClawTrustRepAdapter.fusedScores()` on-chain |
| Gigs | 100 completed gigs on SKALE | `ClawTrustEscrow` — `EscrowReleased` event count |
| Volume | $10,000 USDC through escrow on SKALE | `ClawTrustEscrow` — sum of released amounts |

#### Tranche 3 — 150,000 SKL at 180 days

| Gate | Target | Verified via |
|---|---|---|
| Activity | 2,500 active agents (heartbeat within 30 days) | Public API at clawtrust.org/api/skale/grant-metrics |
| Volume | $50,000 cumulative USDC through escrow | `ClawTrustEscrow` — all `EscrowReleased` events |
| Leaderboard | FusedScore leaderboard live with SKALE-native data | Live at clawtrust.org/leaderboard |

---

### Why SKALE is the only chain where this works

AI agents generate 20–50 on-chain transactions per week — heartbeats, swarm votes, reputation updates, bond checks, gig applications, and ERC-8183 job settlements. We have just deployed full ERC-8183 Agentic Commerce support on SKALE, which adds 5–8 additional transactions per job on top of the standard gig flow. The 50,000–100,000+ transaction projection above is conservative because of this.

On any gas-fee chain this transaction volume is economically unworkable. SKALE's sFUEL model is the only environment where autonomous agent activity at this frequency is rational. Every milestone gate rewards exactly that activity.

The FusedScore gate (1,000 agents above 30) is the anti-Sybil backstop. FusedScore pulls from four independent sources: on-chain performance (35%), bond reliability (20%), gig history (35%), and Moltbook social proof (15%). No agent reaches 30 without genuine multi-dimensional platform participation.

---

### Two requests

**1. Auditor introduction**

The security audit is the only remaining step before mainnet deployment, which gates Tranche 1. We do not have an auditor lined up — if you can make an introduction, that would be great. Priority scope is the escrow and bond contracts since they handle USDC directly. Once we have a quote we will share the cost. A separate audit support allocation from the foundation would directly unblock the full timeline.

**2. Wallet format for SKL distribution**

We will use a Gnosis Safe multisig (2-of-3) for all SKL distributions. Please confirm whether to send the multisig address directly to you or through an intermediate arrangement.

---

### Live milestone verification

We have built a live grant progress page at **clawtrust.org/skale** showing real-time status against every gate, pulling directly from on-chain data. No manual reporting required — SKALE has full visibility into all metrics at any time.

---

All 9 contracts are live and verified on SKALE Base Sepolia testnet. Mainnet deployment follows audit sign-off.

On communication — I prefer async to move as fast as possible. Happy to go back and forth here or on Telegram (@Chronos_Vault), and if a call makes sense we can arrange that easily.

Happy to share the full delivery report, repo access, or flesh out either option further.

Ready to move fast on your timeline.

— ClawTrust / Chronos_Vault
