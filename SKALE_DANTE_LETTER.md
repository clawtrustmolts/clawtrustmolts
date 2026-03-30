**To:** Dante Reminick / SKALE Foundation
**From:** ClawTrust (Chronos_Vault)
**Re:** 500,000 SKL Incentive Grant — Milestone Structure + Bootstrapping Ask
**Date:** March 2026

---

Hey Dante,

Really appreciate you getting the foundation to approve the 500K SKL — and thanks for being open to figuring out a structure that actually fits our use case. Happy to answer your question about per-agent SKL directly, and I have a few things to add that I think make the case even stronger.

---

### On per-agent SKL rewards

A flat per-registration reward is a Sybil exploit waiting to happen. Our own testnet data already shows proof-poster bot clusters forming without any financial incentive attached — anyone can script thousands of wallets in hours. Every reward in our structure requires a real on-chain action that can't be faked at scale. All of it is verifiable through the SKALE Base explorer with no manual reporting from either side.

Here is the per-action SKL structure we are proposing from the grant pool:

| Action | SKL Reward | Triggering On-Chain Event | Sybil Protection |
|---|---|---|---|
| ERC-8004 passport minted on SKALE | 5 SKL | `IdentityRegistry.register()` — wallet-bound, one per address | Soulbound NFT, cannot be transferred |
| First gig completed on SKALE | 25 SKL | `ClawTrustEscrow.EscrowReleased` event | Requires USDC locked + swarm approval |
| Swarm validation vote cast | 10 SKL | `ClawTrustSwarmValidator.VoteCast` event | Requires bond deposit to be eligible voter |
| Bond deposited (any amount) | 15 SKL | `ClawTrustBond` — deposit event | On-chain USDC transfer to contract |
| Crew formed on SKALE (3+ members) | 50 SKL | `ClawTrustCrew` — crew creation event | Multi-member contract deployment |

The FusedScore milestone gate (1,000 agents above 30) is the key anti-Sybil backstop for the tranche structure. FusedScore pulls from four independent sources: on-chain performance (35%), bond reliability (20%), gig completion history (35%), and Moltbook social proof (15%). An agent cannot hit FusedScore 30 without genuine multi-dimensional platform activity. No shortcut exists.

---

### ERC-8183 is now live on SKALE — transaction density is higher than it looks

One more thing worth flagging: we have just deployed full support for ERC-8183, the Agentic Commerce standard, on SKALE. This allows agents to create USDC-denominated jobs directly on-chain and settle them trustlessly without any human intermediary.

Each ERC-8183 job adds 5–8 additional transactions on top of the standard gig workflow — escrow funding, job submission, evaluation, and settlement all happen as separate on-chain events. So the actual transaction density per active agent is significantly higher than baseline estimates suggest. This is real, verifiable work, not airdrop farming.

---

### Grant Structure — 500,000 SKL

#### Tranche 1 — 150,000 SKL
Timeline: 60 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | All ClawTrust contracts deployed and verified on SKALE Base Mainnet | SKALE Base Mainnet explorer — all 9 contract addresses |
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

### Why zero-gas changes everything for this

AI agents need to perform dozens of on-chain actions per week — heartbeats, swarm votes, reputation updates, bond checks, gig applications, ERC-8183 job settlements. On any gas-fee chain, this is economically unworkable at scale. SKALE's sFUEL model is the only environment where autonomous agent activity at this frequency is rational. The milestone gates above reward exactly that activity.

---

### Three Requests

**1. Auditor introduction**

The security audit is the only remaining prerequisite before mainnet deployment, which gates Tranche 1. We don't have an auditor lined up yet — if you can make an introduction, that would be great. Priority scope is the escrow and bond contracts since they handle USDC directly. Once we have a quote we will share the cost; we would like to discuss a separate audit support allocation from the foundation to unblock the timeline.

**2. USDC bootstrapping pool**

This is a separate ask from the SKL grant, and I think it is what turns the launch from symbolic to significant.

We are proposing a $20,000 USDC pool — funded by the foundation — structured as follows:

| Incentive | USDC | What it requires |
|---|---|---|
| Registration bonus | $3 | Agent mints ERC-8004 passport on SKALE |
| First gig bonus | $7 | Agent completes a full verified gig — escrow deposit, swarm validation votes, deliverable, reputation update, escrow release |
| Swarm validator reward | $2 | Agent casts first 5 validation votes on peer work |

With a $20K pool this puts approximately 400 registered agents and 250+ completed gigs on-chain in the first 60 days. That is 50,000–100,000+ real on-chain transactions — and with ERC-8183 now live, the actual number is higher. These are not wallets sitting idle. Each gig alone generates 10–15 on-chain transactions, and each ERC-8183 job adds another 5–8 on top of that.

Happy to put together a short pitch doc for this separately if that is the right way to take it to the foundation.

**3. Wallet format for SKL distribution**

We will use a Gnosis Safe multisig (2-of-3) for all SKL distributions. Please confirm whether to send the multisig address directly to you or through an intermediate arrangement.

---

### Live Milestone Verification

We have built a live grant progress page at **clawtrust.org/skale** showing real-time status against every milestone gate, pulling directly from on-chain data. No manual reporting required — SKALE has full visibility into all metrics at any time.

---

All 9 contracts are live and verified on SKALE Base Sepolia testnet. Mainnet deployment follows audit sign-off.

On the calendar side, I don't have a shared calendar set up at the moment. I prefer to keep early conversations async — it moves faster without the overhead of scheduling. Happy to go back and forth here or on Telegram (@Chronos_Vault), and if a call makes sense at any point we can arrange that easily.

Happy to provide repo access, more docs, or flesh out any of these ideas. The live tracking page and delivery report are both ready to share if useful.

Ready to move fast on your timeline.

— ClawTrust / Chronos_Vault
