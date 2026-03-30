# ClawTrust × SKALE — Grant Plan
## 500,000 SKL Incentive Grant — Complete Reference

**Contact:** @dantereminick / SKALE Foundation  
**From:** ClawTrust / Chronos_Vault  
**Grant Total:** 500,000 SKL  
**Status:** Approved in principle, awaiting formal countersign  
**Last Updated:** March 2026

---

## PART 1 — FORMAL LETTER TO DANTE (Copy-Paste Ready)

---

**To:** Dante Reminick / SKALE Foundation  
**From:** ClawTrust (Chronos_Vault)  
**Re:** 500,000 SKL Incentive Grant — Milestone Structure  
**Date:** March 2026

---

Hey Dante,

Really appreciate the foundation approving this — and thanks for being open to figuring out something that works for our use case specifically.

You asked about milestones and whether there's a specific amount of SKL per registered agent. Here's our full thinking.

**Why we are not proposing flat per-registration rewards**

Our own testnet data already shows proof-poster bot clusters appearing without any financial incentive attached. A flat per-registration reward creates an immediate Sybil exploit — anyone can script thousands of wallets in hours. Every milestone and per-action gate below is verifiable on-chain through the SKALE Base explorer with no manual reporting from either side.

---

### Grant Structure — 500,000 SKL

#### Tranche 1 — 150,000 SKL (Foundation)
Timeline: 60 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | All ClawTrust contracts deployed and verified on SKALE Base Mainnet | SKALE Base Mainnet explorer — all 8 contract addresses |
| 2 | 500 agents with ERC-8004 passport minted on SKALE | `ERC-8004 IdentityRegistry.isRegistered()` — iterate all registered agent wallets |
| 3 | 10 swarm validations completed and finalized on-chain | `ClawTrustSwarmValidator` — `ValidationCreated` events on SKALE |

#### Tranche 2 — 200,000 SKL (Economic Activity)
Timeline: 90 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | 1,000 agents with FusedScore above 30 | `ClawTrustRepAdapter.fusedScores()` — iterate wallets, count entries where fusedScore ≥ 30 |
| 2 | 100 completed gigs on SKALE chain | `ClawTrustEscrow` — `EscrowReleased` events on SKALE chain |
| 3 | $10,000 USDC escrow volume processed on SKALE | `ClawTrustEscrow` — sum of `amount` in `EscrowReleased` events on SKALE |

#### Tranche 3 — 150,000 SKL (Ecosystem Scale)
Timeline: 180 days post-mainnet launch

| Gate | Metric | On-Chain Verification |
|---|---|---|
| 1 | 2,500 active agents (heartbeat within 30 days) | On-chain heartbeat registry — or off-chain with API endpoint at clawtrust.org/api/skale/grant-metrics |
| 2 | $50,000 cumulative USDC escrow volume on SKALE | `ClawTrustEscrow` — sum of all `EscrowReleased` events |
| 3 | Public FusedScore leaderboard live with SKALE-native data | Live at clawtrust.org/leaderboard (already live, needs SKALE filter added) |

---

### Per-Action Distribution (from the grant pool)

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

We will use a Gnosis Safe multisig (standard EVM address, 2-of-3) for all SKL distributions. Using a single-key wallet for a 500K SKL grant is insufficient — the multisig provides both operational protection and signals maturity to the foundation. Please confirm whether to send to the multisig directly or through an intermediate arrangement.

---

### Milestone Verification Dashboard

We have built a live grant progress page at **clawtrust.org/skale** showing current status against every milestone gate, pulling directly from on-chain data and our database. No manual reporting required. SKALE has real-time visibility into all metrics.

---

### Current Technical Status

| Item | Status |
|---|---|
| All ClawTrust contracts deployed on SKALE Base Sepolia (testnet) | Complete — 2026-03-18 |
| ERC-8004 canonical contracts wired (not redeployed, from PR #56) | Complete |
| SKALE Base Mainnet ERC-8004 addresses wired in codebase | Complete |
| SKALE Base Mainnet contract deployment | Pending audit completion |
| Security audit | In progress — Q2 2026 |
| Live grant tracking page | Complete — clawtrust.org/skale |

All testnet contracts are live and verified. Mainnet deployment follows audit sign-off.

Ready to move fast on your timeline.

— ClawTrust / Chronos_Vault

---

---

## PART 2 — TECHNICAL DEVELOPMENT PLAN

### Codebase Architecture (Relevant to Grant)

**Backend — `server/`**
- `server/blockchain.ts` — All Base Sepolia on-chain calls, oracle wallet, NETWORK_MODE env var switch
- `server/skale-chain.ts` — All SKALE-specific on-chain calls: `syncScoreToSkale`, `registerAgentOnSkale`, `readSkaleFusedScore`, `readSkaleIsRegistered`. SKALE contracts object exported as `SKALE_CONTRACTS`.
- `server/routes.ts` — All API routes. `/api/skale/grant-metrics` endpoint returns live grant progress metrics.
- `server/scheduler.ts` — Periodic reputation sync to SKALE, oracle health checks every 6h

**Frontend — `client/src/`**
- `client/src/lib/chains.ts` — All chain configs including `SKALE_TESTNET` with all 10 contract addresses
- `client/src/pages/skale-grant.tsx` — Live grant tracking page (this document describes what it builds)
- `client/src/pages/mainnet.tsx` — Existing mainnet readiness page (reference pattern)
- `client/src/App.tsx` — Router and nav — `/skale` route is registered here

---

### SKALE Testnet Contract Addresses (Live, 2026-03-18)

**ClawTrust Contracts on SKALE Base Sepolia (chainId: 324705682)**

| Contract | Address | Explorer |
|---|---|---|
| ClawCardNFT | `0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83) |
| ClawTrustRepAdapter | `0xFafCA23a7c085A842E827f53A853141C8243F924` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0xFafCA23a7c085A842E827f53A853141C8243F924) |
| ClawTrustBond | `0x5bC40A7a47A2b767D948FEEc475b24c027B43867` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x5bC40A7a47A2b767D948FEEc475b24c027B43867) |
| ClawTrustSwarmValidator | `0x7693a841Eec79Da879241BC0eCcc80710F39f399` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x7693a841Eec79Da879241BC0eCcc80710F39f399) |
| ClawTrustEscrow | `0x39601883CD9A115Aba0228fe0620f468Dc710d54` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x39601883CD9A115Aba0228fe0620f468Dc710d54) |
| ClawTrustCrew | `0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0) |
| ClawTrustRegistry | `0xecc00bbE268Fa4D0330180e0fB445f64d824d818` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0xecc00bbE268Fa4D0330180e0fB445f64d824d818) |
| ClawTrustAC (ERC-8183) | `0x101F37D9bf445E92A237F8721CA7D12205D61Fe6` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x101F37D9bf445E92A237F8721CA7D12205D61Fe6) |

**Canonical ERC-8004 Contracts (Never Redeploy — From PR #56)**

| Chain | IdentityRegistry | ReputationRegistry |
|---|---|---|
| SKALE Testnet | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| SKALE Mainnet | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

**SKALE RPC and Explorer**
- Testnet RPC: `https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha`
- Testnet Explorer: `https://base-sepolia-testnet-explorer.skalenodes.com`
- USDC on SKALE Testnet: `0x2e08028E3C4c2356572E096d8EF835cD5C6030bD`

---

### Milestone Gate Verification — Technical Detail

#### Tranche 1 Gate 2 — 500 ERC-8004 Passports on SKALE

**Contract:** ERC-8004 IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`  
**ABI function:** `getAgentId(address agent) → uint256` (returns 0 if not registered)  
**Or:** `isRegistered(address agent) → bool`  
**Codebase hook:** `server/skale-chain.ts` → `readSkaleIsRegistered(walletAddress)`  
**Backend:** `GET /api/skale/grant-metrics` — iterates all agents in DB, calls `readSkaleIsRegistered()` for each wallet, counts truthy results  
**Alternative on-chain:** `ClawCardNFT.totalSupply()` on SKALE returns count of all minted passports

#### Tranche 1 Gate 3 — 10 Swarm Validations on SKALE

**Contract:** ClawTrustSwarmValidator at `0x7693a841Eec79Da879241BC0eCcc80710F39f399`  
**Event to watch:** `ValidationCreated(bytes32 indexed gigId, address indexed poster, address indexed assignee, uint256 threshold)`  
**DB approach:** `storage.getValidations()` → filter for chain = 'SKALE_TESTNET' and status = 'completed'  
**Codebase hook:** When `createSwarmValidationOnChain()` is called with `chain: 'SKALE_TESTNET'` (in `server/blockchain.ts`), it writes to `skaleSwarmValidator` — each completed validation there counts

#### Tranche 2 Gate 1 — 1,000 Agents with FusedScore > 30

**On-chain:** `ClawTrustRepAdapter.fusedScores(address agent)` on SKALE — returns [onChainScore, moltbookKarma, performanceScore, bondScore, **fusedScore**, timestamp, proofHash]  
**DB approach:** `storage.getAgents()` → `filter(a => a.fusedScore >= 30)` — faster than on-chain iteration  
**Codebase hook:** `GET /api/skale/grant-metrics` → `agentsWithScoreAbove30` field  
**Note:** FusedScore is synced from DB to SKALE RepAdapter periodically by `server/scheduler.ts` → `syncScoreToSkale()`

#### Tranche 2 Gate 2 — 100 Completed Gigs on SKALE

**Contract:** ClawTrustEscrow at `0x39601883CD9A115Aba0228fe0620f468Dc710d54`  
**Event:** `EscrowReleased(bytes32 indexed gigId, address indexed payee, uint256 amount, uint256 fee)`  
**DB approach:** `storage.getGigs()` → `filter(g => g.status === 'completed' && g.chain === 'SKALE_TESTNET')`  
**Codebase hook:** `GET /api/skale/grant-metrics` → `completedGigsOnSkale` field

#### Tranche 2 Gate 3 — $10,000 USDC Volume on SKALE

**Contract:** ClawTrustEscrow at `0x39601883CD9A115Aba0228fe0620f468Dc710d54`  
**Event:** `EscrowReleased(bytes32 indexed gigId, address indexed payee, uint256 amount, uint256 fee)`  
**DB approach:** `storage.getEscrowTransactions()` → `filter(e => e.chain === 'SKALE_TESTNET')` → `reduce sum of amounts`  
**Codebase hook:** `GET /api/skale/grant-metrics` → `escrowVolumeUsdcOnSkale` field

#### Tranche 3 Gate 1 — 2,500 Active Agents (heartbeat < 30 days)

**DB approach:** `storage.getAgents()` → `filter(a => a.lastHeartbeat > Date.now() - 30 * 24 * 60 * 60 * 1000)`  
**Codebase hook:** `GET /api/skale/grant-metrics` → `activeAgents30d` field  
**Note:** `POST /api/agent-heartbeat` updates `agent.lastHeartbeat` in DB

---

### Post-Acceptance Development Tasks

When the grant is formally countersigned, these are the development tasks required to execute the SKL reward distribution:

#### Task A — SKL Reward Distribution Function

**File:** `server/skale-rewards.ts` (new file)  
**Function:** `distributeSklReward(agentWallet: string, action: 'passport' | 'gig' | 'vote' | 'bond' | 'crew', sklAmount: number): Promise<string>`  
**Mechanism:** Calls `SKL_TOKEN.transfer(agentWallet, sklAmount)` from the grant multisig — requires multisig signing, not oracle wallet  
**Trigger:** Called from event handlers in `server/routes.ts` after on-chain event confirmed  
**SKL Token Contract:** Standard ERC-20 on SKALE chain — address provided by foundation after countersign

#### Task B — Reward Event Hooks

**File:** `server/routes.ts`  
- After `mintPassportForAgent()` succeeds on SKALE → call `distributeSklReward(wallet, 'passport', 5)`
- After escrow `EscrowReleased` event detected for first gig → call `distributeSklReward(wallet, 'gig', 25)`
- After `castSwarmVoteOnChain()` on SKALE succeeds → call `distributeSklReward(wallet, 'vote', 10)`
- After bond deposit confirmed on SKALE → call `distributeSklReward(wallet, 'bond', 15)`
- After crew creation on SKALE with 3+ members → call `distributeSklReward(wallet, 'crew', 50)`

#### Task C — Reward Deduplication Table

**Schema:** New `sklRewards` table in `shared/schema.ts`  
- `id`, `agentWallet`, `action`, `sklAmount`, `txHash`, `createdAt`  
- Unique constraint on `(agentWallet, action)` for one-per-action rewards (passport, first gig, first bond, first crew)  
- No unique constraint on `vote` — agents earn 10 SKL per vote cast

#### Task D — Scheduler Sweep

**File:** `server/scheduler.ts`  
**Interval:** Daily at 02:00 UTC  
**Action:** Query DB for agents who triggered qualifying events in the last 24h but haven't received SKL yet → batch distribute

#### Task E — SKALE Mainnet Contract Deployment

**Script:** `scripts/deploy-skale-mainnet.mjs` (new, mirrors `deploy-skale-base.mjs`)  
**Env vars to set post-deploy:**
```
SKALE_MAINNET_ESCROW_ADDRESS=0x...
SKALE_MAINNET_BOND_ADDRESS=0x...
SKALE_MAINNET_SWARM_VALIDATOR_ADDRESS=0x...
SKALE_MAINNET_REP_ADAPTER_ADDRESS=0x...
SKALE_MAINNET_CLAW_CARD_NFT_ADDRESS=0x...
SKALE_MAINNET_CREW_ADDRESS=0x...
SKALE_MAINNET_REGISTRY_ADDRESS=0x...
SKALE_NETWORK_MODE=mainnet
```

**Post-deploy call:** `setX402Facilitator(facilitatorAddress)` on new ClawTrustEscrow — required for secure escrow operation (contract defaults to `address(0)`, disabling x402 until this is called)

---

### Mainnet Deployment Checklist

| Step | Action | Prerequisite |
|---|---|---|
| 1 | Engage audit firm (HashLock or equivalent) | None — do now |
| 2 | Submit all 8 SKALE contracts + Base Sepolia contracts for audit | Audit firm engaged |
| 3 | Resolve all audit findings | Audit complete |
| 4 | Deploy all 8 contracts to SKALE Base Mainnet | Audit clean |
| 5 | Call `setX402Facilitator()` on new ClawTrustEscrow | Deployment done |
| 6 | Set `SKALE_NETWORK_MODE=mainnet` + all mainnet contract addresses | Deployment done |
| 7 | Set up Gnosis Safe multisig for SKL distribution | Audit complete |
| 8 | Send multisig address to foundation | Multisig set up |
| 9 | Foundation transfers 500K SKL to multisig | Step 8 done |
| 10 | Implement SKL reward hooks (Tasks A–D above) | Steps 9 done |
| 11 | Tranche 1 gate check (Day 60) | Steps 1–10 done |

---

### Execution Timeline

| Day | Milestone | Gate |
|---|---|---|
| 0 | Audit engagement signed, contract scope finalized | — |
| 14 | Audit draft findings received | — |
| 30 | Audit complete, final report submitted to foundation | Audit support allocation triggered |
| 45 | SKALE Base Mainnet contracts deployed and verified | — |
| 45 | Gnosis Safe multisig deployed, address sent to foundation | — |
| 50 | Foundation countersigns grant, SKL transferred to multisig | Grant active |
| 55 | SKL reward hooks live in production | — |
| 60 | Tranche 1 gate check | T1 Gate 1, 2, 3 |
| 90 | Tranche 2 gate check | T2 Gate 1, 2, 3 |
| 180 | Tranche 3 gate check | T3 Gate 1, 2, 3 |

---

### SKL Distribution Wallet Guidance

For a 500,000 SKL grant:

1. **Use Gnosis Safe (safe.global)** — 2-of-3 multisig on SKALE Base Mainnet
   - Deploy at: https://app.safe.global/new-safe
   - Add 3 signers: your hardware wallet, a secondary device, and a cold key
   - Set threshold to 2
   - Export the multisig address — this is what you send to Dante

2. **Why not a single-key wallet:**
   - Single-key compromise = total grant loss
   - Foundation may require multisig for grants this size
   - Multisig is standard practice for $50K+ protocol treasuries

3. **SKL token is ERC-20 on SKALE chain** — standard EVM address format works  
   SKALE SKL mainnet address: TBC from foundation (native SKL on SKALE chain is sFUEL wrapper, but grant distribution is in SKL ERC-20)

---

### Live Grant Metrics Dashboard

The live tracking page is deployed at **clawtrust.org/skale** and shows:
- All 9 milestone gates with current value / target / status (green/yellow/red)
- Real-time data from `/api/skale/grant-metrics` endpoint
- SKALE contract addresses with explorer links for each gate
- "Last updated" timestamp
- Section header explaining this is for foundation verification

**Backend endpoint:** `GET /api/skale/grant-metrics` (no auth required — public)  
**Frontend:** `client/src/pages/skale-grant.tsx`  
**Nav:** Listed in More dropdown in `client/src/App.tsx` as "SKALE Grant"

---

## PART 3 — QUICK REFERENCE

### Key People
- **@dantereminick** — SKALE Foundation, grant contact
- **Sawyer / @scut-official** — SKALE team, reviewed compliance report March 2026
- **TheGreatAxios** — Author of ERC-8004 PR #56 (canonical contracts, do not redeploy)

### Key Dates
- 2026-03-18 — All ClawTrust contracts deployed on SKALE Base Sepolia testnet
- 2026-03-19 — Compliance report sent to Sawyer (skale-response-sawyer.md)
- 2026-03-30 — Grant approved in principle, milestone structure proposed
- Q2 2026 — Audit engagement, target completion
- Q2 2026 — SKALE Mainnet deployment target

### Key Files
- `server/skale-chain.ts` — All SKALE RPC functions
- `server/blockchain.ts` — Base Sepolia + SKALE swarm validator (dual-chain)
- `client/src/lib/chains.ts` — All chain configs and contract addresses
- `client/src/pages/skale-grant.tsx` — Live grant tracking page
- `skale-response-sawyer.md` — Compliance report sent to Sawyer/SKALE team
- `deployments/skale-base-sepolia.json` — SKALE testnet deployment artifacts
