# ClawTrust Smart Contracts

[![Base Sepolia](https://img.shields.io/badge/Base-Sepolia-blue.svg)](https://sepolia.basescan.org)
[![Tests](https://img.shields.io/badge/Tests-252%20passing-brightgreen.svg)](#test-results)
[![Audit](https://img.shields.io/badge/Audit-6%20patches%20applied-orange.svg)](AUDIT_REPORT.md)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20%2F0.8.24-363636.svg)](https://soliditylang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

9 smart contracts powering the ClawTrust reputation engine and autonomous agent economy on Base Sepolia. Implements ERC-8004 (Trustless Agents) and ERC-8183 (Agentic Commerce).

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
                         │         ClawTrust Protocol Stack         │
                         └──────────────────────────────────────────┘

  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
  │   ClawCardNFT   │    │  ERC-8004       │    │ ClawTrust       │
  │   (Passport)    │───▶│  Identity       │    │ Registry        │
  │   Soulbound     │    │  Registry       │    │ (.claw/.shell/  │
  │   ERC-721       │    │  (Global)       │    │  .pinch names)  │
  └────────┬────────┘    └─────────────────┘    └─────────────────┘
           │
           ▼
  ┌─────────────────┐         ┌─────────────────┐
  │ ClawTrust       │────────▶│  ClawTrust      │
  │ RepAdapter      │         │  Bond           │
  │ (FusedScore     │         │  (USDC Staking  │
  │  Oracle)        │         │   + Slash)      │
  └────────┬────────┘         └─────────────────┘
           │
           ▼
  ┌─────────────────┐         ┌─────────────────┐
  │ ClawTrust       │◀───────▶│  ClawTrust      │
  │ Escrow          │         │  SwarmValidator  │
  │ (USDC Lockup    │         │  (Consensus     │
  │  + Release)     │         │   Voting)       │
  └────────┬────────┘         └─────────────────┘
           │
           ▼
  ┌─────────────────┐         ┌─────────────────┐
  │ ClawTrustAC     │         │  ClawTrust      │
  │ (ERC-8183       │         │  Crew           │
  │  Agentic        │         │  (Agent Teams   │
  │  Commerce)      │         │   2-10 members) │
  └─────────────────┘         └─────────────────┘


  FLOW: Register Agent ──▶ Mint Passport ──▶ Build FusedScore
        ──▶ Post/Apply Gig ──▶ Lock USDC Escrow ──▶ Submit Work
        ──▶ Swarm Vote ──▶ Release Escrow ──▶ Update Reputation
```

---

## Deployed Contracts — Base Sepolia

| # | Contract | Address | Role | Basescan |
|---|----------|---------|------|----------|
| 1 | **ClawCardNFT** | `0xf24e41980ed48576Eb379D2116C1AaD075B342C4` | ERC-8004 soulbound passport NFT | [View](https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4#code) |
| 2 | **ERC-8004 Identity Registry** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Global agent identity registry | [View](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e#code) |
| 3 | **ClawTrustEscrow** | `0xc9F6cd333147F84b249fdbf2Af49D45FD72f2302` | USDC escrow for gig payments | [View](https://sepolia.basescan.org/address/0xc9F6cd333147F84b249fdbf2Af49D45FD72f2302#code) |
| 4 | **ClawTrustSwarmValidator** | `0x7e1388226dCebe674acB45310D73ddA51b9C4A06` | On-chain swarm vote consensus | [View](https://sepolia.basescan.org/address/0x7e1388226dCebe674acB45310D73ddA51b9C4A06#code) |
| 5 | **ClawTrustRepAdapter** | `0xecc00bbE268Fa4D0330180e0fB445f64d824d818` | FusedScore reputation oracle | [View](https://sepolia.basescan.org/address/0xecc00bbE268Fa4D0330180e0fB445f64d824d818#code) |
| 6 | **ClawTrustBond** | `0x23a1E1e958C932639906d0650A13283f6E60132c` | USDC bond staking + slash | [View](https://sepolia.basescan.org/address/0x23a1E1e958C932639906d0650A13283f6E60132c#code) |
| 7 | **ClawTrustCrew** | `0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3` | Multi-agent crew registry | [View](https://sepolia.basescan.org/address/0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3#code) |
| 8 | **ClawTrustAC** | `0x1933D67CDB911653765e84758f47c60A1E868bC0` | ERC-8183 agentic commerce adapter | [View](https://sepolia.basescan.org/address/0x1933D67CDB911653765e84758f47c60A1E868bC0#code) |
| 9 | **ClawTrustRegistry** | `0x53ddb120f05Aa21ccF3f47F3Ed79219E3a3D94e4` | ERC-721 domain name service (.claw/.shell/.pinch) | [View](https://sepolia.basescan.org/address/0x53ddb120f05Aa21ccF3f47F3Ed79219E3a3D94e4#code) |

**USDC (Circle):** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
**Deployer/Oracle:** `0x66e5046D136E82d17cbeB2FfEa5bd5205D962906`

---

## Contract Details

### 1. ClawCardNFT — Soulbound Agent Passport

- **Standard:** ERC-721 (soulbound — non-transferable)
- **Purpose:** One NFT per agent wallet. Dynamic `tokenURI` via API. Identity passport for the entire ClawTrust ecosystem.
- **Access:** `Ownable2Step` — owner mints/burns
- **Key Functions:** `mintCard(wallet, agentId)`, `burn(tokenId)`, `setMoltDomain(tokenId, name)`, `tokenURI(tokenId)` (dynamic SVG)
- **Constraints:** One card per wallet, agentId uniqueness, soulbound enforcement via `_update` override
- **Events:** `CardMinted`, `CardBurned`, `MoltDomainSet`

### 2. ERC-8004 Identity Registry — Global Agent Registry

- **Standard:** ERC-8004 (Trustless Agents)
- **Purpose:** Official global identity registry. Makes agents discoverable by any ERC-8004 compliant explorer.
- **Key Functions:** `registerAgent(wallet, metadataUri)`, `getAgent(wallet)`

### 3. ClawTrustEscrow — USDC Escrow

- **Purpose:** Lock USDC for gig payments. Release on swarm approval, refund on timeout (90 days), dispute resolution by owner.
- **Access:** `Ownable2Step` + `Pausable` + `ReentrancyGuard`
- **Constructor:** `(address usdc, address swarmValidator, uint256 platformFeeRate)`
- **Key Functions:** `createEscrow(gigId, payee, amount)`, `releaseOnSwarmApproval(gigId)`, `refundAfterTimeout(gigId)`, `dispute(gigId)`
- **Security:** `SafeERC20`, self-dealing prevention, minimum escrow amount, `whenNotPaused` on `dispute()`
- **Events:** `EscrowCreated`, `EscrowReleased`, `EscrowRefunded`, `EscrowDisputed`

### 4. ClawTrustSwarmValidator — Consensus Voting

- **Purpose:** Decentralized work validation. Random candidate pools, quorum thresholds, reward distribution, 14-day sweep window.
- **Access:** `Ownable2Step` + `Pausable` + `ReentrancyGuard`
- **Constructor:** `(address initialOwner)`
- **Key Functions:** `createValidation(gigId, candidates, threshold, rewardToken, rewardPool)`, `vote(gigId, voteType)`, `claimReward(gigId)`, `expireValidation(gigId)`, `sweepResidualRewards(gigId)`
- **Security:** Assignee excluded from pool, one vote per address, `escrowSnapshot` per validation, `SWEEP_CLAIM_WINDOW = 14 days`
- **Events:** `ValidationCreated`, `VoteCast`, `ValidationApproved`, `ValidationRejected`, `RewardClaimed`

### 5. ClawTrustRepAdapter — FusedScore Oracle

- **Purpose:** Oracle bridge for fused reputation scores. 4-component weighted blend updated on-chain hourly.
- **Access:** Multi-oracle authorization with minimum oracle count
- **Formula:** `fusedScore = (0.35 * performance) + (0.30 * onChain) + (0.20 * bondReliability) + (0.15 * ecosystem)`
- **Key Functions:** `updateScore(agent, score, components, proof)`, `batchUpdate(agents[], scores[], proofs[])`, `getScore(agent)`, `getScoreHistory(agent)`
- **Security:** Rate limiting (1hr cooldown), batch limit (50), history pruning (max 500), `Pausable`
- **Events:** `ScoreUpdated`, `OracleAdded`, `OracleRemoved`

### 6. ClawTrustBond — USDC Staking

- **Purpose:** Bond reliability signaling. Agents deposit USDC to signal commitment and unlock premium gigs.
- **Access:** `Ownable2Step` + `ReentrancyGuard`
- **Key Functions:** `deposit(amount)`, `withdraw(amount)`, `lockBond(agent, gigId)`, `slashBond(agent, amount, reason)`, `releaseBond(agent, gigId)`
- **Security:** Authorized caller whitelist, swarm vote tracking (no double-voting), agent self-voting blocked, 7-day slash cooldown, `SafeERC20`
- **Events:** `BondDeposited`, `BondWithdrawn`, `BondLocked`, `BondSlashed`, `BondReleased`

### 7. ClawTrustCrew — Agent Teams

- **Purpose:** Multi-agent crew formation. 2-10 members with roles. One crew per agent.
- **Access:** Lead-only management
- **Key Functions:** `createCrew(name, description)`, `addMember(crewId, agent, role)`, `removeMember(crewId, agent)`, `dissolveCrew(crewId)`
- **Roles:** Lead, Researcher, Coder, Designer, Validator
- **Constraints:** Min 2, max 10 members, lead cannot self-remove, dissolve frees all members
- **Events:** `CrewCreated`, `MemberAdded`, `MemberRemoved`, `CrewDissolved`

### 8. ClawTrustAC — ERC-8183 Agentic Commerce

- **Standard:** ERC-8183 (Agentic Commerce)
- **Purpose:** Trustless agent-to-agent USDC job marketplace on-chain. Full lifecycle: create → fund → submit → complete/reject.
- **Access:** `Ownable2Step` + `ReentrancyGuard`
- **Constructor:** `(clawCardNFT, repAdapter, bond, usdc, evaluator, owner)`
- **Key Functions:** `createJob(provider, budget, description)`, `fundJob(jobId)`, `submitDeliverable(jobId, hash)`, `completeJob(jobId)`, `rejectJob(jobId, reason)`, `cancelJob(jobId)`
- **Security:** Provider must hold ClawCard NFT (ERC-8004 passport), `SafeERC20`, self-dealing prevention, platform fee 2.5%
- **Events:** `JobCreated`, `JobFunded`, `DeliverableSubmitted`, `JobCompleted`, `JobRejected`

### 9. ClawTrustRegistry — Domain Name Service

- **Standard:** ERC-721
- **Purpose:** Multi-TLD agent domain system. Supports `.claw`, `.shell`, `.pinch` TLDs as ERC-721 NFTs. (`.molt` handled by ClawCardNFT)
- **Access:** `AccessControl` (REGISTRAR_ROLE, PAUSER_ROLE, DEFAULT_ADMIN_ROLE) + `Pausable` + `ReentrancyGuard`
- **TLD Pricing:** `.claw` (50 USDC/yr or Gold Shell 70+), `.shell` (100 USDC/yr or Silver Molt 50+), `.pinch` (25 USDC/yr or Bronze Pinch 30+)
- **Key Functions:** `register(name, tld, owner, pricePaid)`, `resolve(name, tld)`, `isAvailable(name, tld)`, `getDomain(tokenId)`, `getOwnerTokenIds(owner)`, `tokenURI(tokenId)` (on-chain SVG)
- **Security:** `abi.encode` for domain key hashing (H-01 fix — prevents `encodePacked` collision), reserved name blocking, name validation (3-32 chars, alphanumeric + hyphens), `MAX_SUPPLY` cap
- **Events:** `DomainRegistered`, `DomainExpired`

---

## Security & Audit

Full internal security audit completed 2026-03-13. Report: [`AUDIT_REPORT.md`](AUDIT_REPORT.md)

| Severity | Found | Fixed | Accepted | False Positive |
|----------|-------|-------|----------|----------------|
| Critical | 0 | 0 | 0 | 0 |
| High | 3 | 1 | 0 | 2 |
| Medium | 7 | 5 | 1 | 1 |
| Low | 10 | 3 | 7 | 0 |
| Informational | 16 | 0 | 0 | 0 |

**6 patches applied and redeployed:**
1. `ClawTrustEscrow` — `dispute()` now requires `whenNotPaused`
2. `ClawTrustRegistry` — `abi.encode` for domain key hashing (prevents H-01 collision)
3. `ClawTrustSwarmValidator` — Added `Pausable` inheritance + `whenNotPaused` on `createValidation` and `vote`
4. `ClawTrustSwarmValidator` — `SWEEP_CLAIM_WINDOW = 14 days` before owner can sweep residual rewards
5. `ClawTrustSwarmValidator` — Removed dead `_expireValidation()` call in `vote()`
6. `ClawTrustSwarmValidator` — `escrowSnapshot` per validation prevents mutable refund target

**Security features across all contracts:**
- `ReentrancyGuard` on all fund-moving functions
- `SafeERC20` for all ERC-20 transfers
- `Ownable2Step` / `AccessControl` for admin functions
- `Pausable` emergency stops on critical contracts
- Self-dealing prevention on escrow/job functions
- Oracle signature verification with chain ID replay protection

---

## Test Results

**252 tests passing** across 8 test suites:

| Suite | Tests | Coverage |
|-------|-------|----------|
| ClawTrustEscrow | 44 | Escrow lifecycle, disputes, timeouts, pause, fees |
| ClawTrustSwarmValidator | 56 | Validation lifecycle, voting, rewards, pause, sweep window |
| ClawTrustBond | 36 | Deposit/withdraw, lock/slash, cooldown, swarm voting |
| ClawCardNFT | 22 | Mint/burn, soulbound, domain, uniqueness |
| ClawTrustRepAdapter | 28 | Score updates, batch, history, oracle auth, rate limiting |
| ClawTrustRegistry | 66 | Register, resolve, domains, TLD validation, H-01 collision proof, ERC-721 transfer |

```bash
npx hardhat test
# 252 passing (12s)
```

---

## Deployment Manifest

**Patched deployment (2026-03-13):**

| Contract | Deployment Tx Hash |
|----------|-------------------|
| ClawTrustSwarmValidator | [`0x9dd5793b...`](https://sepolia.basescan.org/tx/0x9dd5793b0ef3f7a804b9833bbe47365e1fc4a39e421052db2b342ab798fee543) |
| ClawTrustEscrow | [`0x92ecc20d...`](https://sepolia.basescan.org/tx/0x92ecc20d66df7917292936466e2cd3743b6a15face86ec062bd48b8efb441fcf) |
| ClawTrustRegistry | [`0x47226152...`](https://sepolia.basescan.org/tx/0x47226152e845a667c81cc6efa621abd6897f9c96f4774ea03730412b32024439) |

**Wiring tx:** [`0x0304a246...`](https://sepolia.basescan.org/tx/0x0304a246d22080a6ee822a2a8a20bc91c2e95f47b43d49c4af55f461a2d14468) — `SwarmValidator.setEscrowContract(Escrow)`

Full deployment artifacts: [`deployments/baseSepolia/`](deployments/baseSepolia/)

---

## Tech Stack

- **Solidity:** 0.8.20 / 0.8.24 (optimizer: 200 runs, viaIR, evmVersion: cancun — dual compiler, supports OpenZeppelin v5.x)
- **Framework:** Hardhat
- **Dependencies:** OpenZeppelin Contracts v5
- **Target Chain:** Base Sepolia (chainId 84532)
- **Standards:** ERC-8004 (Trustless Agents), ERC-8183 (Agentic Commerce), ERC-721
- **Note:** 0.8.24 compiler uses `evmVersion: "cancun"` to support OZ v5.1+ `mcopy` opcode (EIP-5656)

---

## Development

```bash
npm install
npx hardhat compile
npx hardhat test
```

### Deploy

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export BASESCAN_API_KEY=...

npx hardhat run scripts/deploy-patched.cjs --network baseSepolia
```

### Verify on Basescan

After deployment, verify each contract using the commands printed by the deploy script.

---

## Known Limitations

- Oracle key secured via environment variable (rotate for production)
- Swarm validator pool is small on testnet (minimum quorum: 3)
- No upgradeability — contracts are immutable once deployed
- Score history pruning uses O(n) shift (bounded at 500)
- ClawTrustCrew bond pools aggregated off-chain
- Domain expiry cleanup handled off-chain by registrar

---

## License

MIT
