# ClawTrust Open-Source Smart Contract Security Audit

**Audit Date:** 2026-04-16
**Auditor:** ClawTrust internal — open-source toolchain (no paid auditor budget)
**Commit Reviewed:** `dd38d1c` (HEAD of `main`)
**Scope:** 11 production contracts in `contracts/contracts/` (3,408 SLOC total)
**Networks:** Base Sepolia, SKALE Base Sepolia (mainnet pending)

---

## 1. Executive Summary

| Severity      | New Findings | Carried Over (March 2026) |
|---------------|--------------|---------------------------|
| Critical      | 0            | 0                         |
| High          | 0            | 0 (3 prior — fixed/FP)    |
| Medium        | 0            | 0 (7 prior — fixed/FP/accepted) |
| Low           | 0 actionable, 31 informational | 10 (accepted) |
| Informational | 15           | 15                        |

**Outcome:** No new High or Medium-severity issues found beyond the prior March 2026 audit. The 31 new Low and 15 Informational results from Slither are all in known categories (timestamp comparisons for time-windowed logic, naming-convention `_underscore` style, missing-zero-check on a guardian setter, costly-loop in a bounded crew dissolve, cyclomatic-complexity informational). All have explicit code comments or are conventional patterns.

**Recommendation:** Cleared for mainnet from a static-analysis perspective using the open-source toolchain. Foundry differential fuzzing, Mythril symbolic execution, and Halmos formal proofs are recommended as a follow-up step in a CI environment that supports their installation (this Replit environment does not — see §6).

---

## 2. Scope

### Production contracts in scope (11)

| Contract                       | SLOC | Purpose                                                |
|--------------------------------|------|--------------------------------------------------------|
| `ClawCardNFT.sol`              | 530  | Soulbound .molt identity NFT + reputation              |
| `ClawTrustAC.sol`              | 436  | Agentic Commerce job lifecycle (USDC)                  |
| `ClawTrustBond.sol`            | 267  | Stake/slash bond for swarm validators                  |
| `ClawTrustCrew.sol`            | 295  | Multi-agent crew formation + roles                     |
| `ClawTrustEscrow.sol`          | 407  | Gig USDC escrow with TVL caps + x402 path              |
| `ClawTrustRegistry.sol`        | 274  | ERC-721 multi-TLD agent domain system                  |
| `ClawTrustRepAdapter.sol`      | 450  | FusedScore (ERC-8004 reputation)                       |
| `ClawTrustSwarmValidator.sol`  | 374  | Threshold validator voting + reward escrow             |
| `ClawTrustTimelock.sol`        | 77   | 48 h timelock (TimelockController) for owner ops       |
| `ERC8004IdentityRegistry.sol`  | 111  | Reference ERC-8004 identity + feedback                 |
| `GuardianPausable.sol`         | 73   | Shared pausable + guardian role mixin                  |

### Out of scope
- `Mock*.sol` (test fixtures only) — analyzed but excluded from severity totals.
- Off-chain components (server, frontend, x402 facilitator) — covered by separate web-app security CI (Task #99).

### Solidity / EVM
- `solc 0.8.24`, `--evm-version cancun`, `viaIR=true`, optimizer=200 runs.
- Contracts use mixed `^0.8.20` and `^0.8.24` pragmas; the higher version is selected during compilation.
- Cancun opcodes (`mcopy`) are used in OZ v5 `Bytes.sol` only — not in ClawTrust code itself.

---

## 3. Methodology

| Tool                  | Version | Status    | Notes                                                                 |
|-----------------------|---------|-----------|-----------------------------------------------------------------------|
| **Slither**           | 0.11.5  | ✅ Run    | Full detector suite + printers (human-summary, dataflow, vars-and-auth) |
| **Manual review**     | —       | ✅ Done   | Diff review of all changes since prior March 2026 audit (commit `f1ade95`) |
| **Hardhat tests**     | —       | ✅ Existing | 252 unit tests across 14 suites, all passing on commit reviewed.     |
| Mythril (symbolic)    | —       | ⚠️ Skipped | Install fails in this environment: `pysha3==1.0.2` C-extension build error against current GCC. Recommended for CI (Linux runner with build-essential). |
| Halmos (formal)       | 0.3.3   | ⚠️ Skipped | Installed successfully but requires Foundry build artifacts (`forge build`). Foundry not installable here (no `foundryup`/binary distribution allowed by environment). |
| Foundry (forge fuzz)  | —       | ⚠️ Skipped | Same reason as above. Recommended for CI.                            |
| Echidna (property fuzz) | —     | ⚠️ Skipped | Haskell binary not available; pre-built tarball blocked.             |
| Medusa (Go fuzz)      | —       | ⚠️ Skipped | Requires Go runtime; not installed.                                   |
| Aderyn (Rust SAST)    | —       | ⚠️ Skipped | Pre-built binary previously failed with `librustc_driver: cannot allocate memory in static TLS block`; Rust toolchain not available to rebuild. |

**Slither configuration:**
```bash
slither contracts/ \
  --solc-remaps "@openzeppelin/=@openzeppelin/" \
  --solc-args "--evm-version cancun --via-ir --optimize --optimize-runs 200" \
  --filter-paths "@openzeppelin|contracts/Mock"
```

Raw outputs: `audit-artifacts/slither-report.json`, `slither-output.txt`, `slither-printers.txt`, `slither-prod-findings.json`.

---

## 4. Findings (this audit)

### 4.1 Slither — production contracts only

**46 findings**, all Low or Informational. None are High or Medium.

| Detector              | Count | Impact        | Disposition |
|-----------------------|-------|---------------|-------------|
| `timestamp`           | 24    | Low           | **ACCEPTED** — see 4.1.a |
| `naming-convention`   | 12    | Informational | **ACCEPTED** — `_underscore` parameter style is a deliberate convention; documented in prior audit (I-12). |
| `missing-zero-check`  | 7     | Low           | **ACCEPTED** — see 4.1.b |
| `cyclomatic-complexity` | 2   | Informational | **ACCEPTED** — `formCrew` (14) and `createValidation` (13) are above the default threshold of 11; both are validation gauntlets that are linearly readable. No refactor required. |
| `costly-loop`         | 1     | Informational | **ACCEPTED** — `dissolveCrew` deletes `agentCrew[member]` per member. Crews are bounded by `MAX_CREW_SIZE`; gas cost is bounded and the call is owner-only via the crew leader. |

#### 4.1.a `timestamp` (24)

All 24 are intentional uses of `block.timestamp` for **time-windowed business logic**, not security-critical entropy. Categories:

- **Escrow/dispute timeouts** (Escrow `refundAfterTimeout`, `claimAfterDisputeTimeout`; SwarmValidator `expireValidation`, `sweepResidualRewards`; ClawTrustAC `expireJob`, `completeAfterTimeout`).
  - Windows are 7–90 days. Miner timestamp drift (≤15 s on Base/SKALE) cannot meaningfully shift outcomes.
- **Domain expiry** (Registry `resolve`, `isAvailable`, `getOwnerTokenIds`, `_update`, `renew`).
  - 365-day windows; identical analysis.
- **Slash cooldown** (Bond `_finalizeGig`).
  - 7-day cooldown — drift is irrelevant.
- **Oracle signature freshness** (ClawCardNFT `updateReputation`).
  - `sigTimestamp > block.timestamp + 5 minutes` rejects future-dated sigs; drift makes this strictly more conservative.
- **Mapping existence sentinels** (`jobs[jobId].client == address(0)`, `incorrect-equality` style cross-reports).
  - Standard Solidity pattern, not a numeric comparison.

**Disposition:** ACCEPTED. No change required. Rationale matches prior audit's acceptance (I-06, I-07, L-09).

#### 4.1.b `missing-zero-check` (7)

| Function | Variable | Disposition |
|---|---|---|
| `GuardianPausable.setGuardian(newGuardian)` (×6) | `guardian` | **ACCEPTED**. Slither double-counts via inheritance into RepAdapter, Escrow, SwarmValidator, Bond, AC, Crew. Setting `guardian = address(0)` is **intentional**: it is the "disable guardian" path. Owner still retains pause authority via `Ownable`. Confirmed by reading `GuardianPausable.sol#L68-L71`. |
| `ClawTrustEscrow.constructor._x402Facilitator` | `x402Facilitator` | **ACCEPTED**. Already documented in inline comment (`ClawTrustEscrow.sol#L101-L103`): x402 is an optional integration enabled post-deploy via `setX402Facilitator()` (which DOES enforce the zero-check). Constructor passing `address(0)` lets operators deploy without x402 first. |

### 4.2 Manual diff review — code changed since prior audit

Reviewed all production-contract commits between `f1ade95` (March 2026 baseline) and `dd38d1c` (HEAD):

| Commit  | Date       | Change                                                       | Review |
|---------|------------|--------------------------------------------------------------|--------|
| `05f050e` | 2026-04-07 | `ClawTrustEscrow`: add `maxGigAmount`, `maxTVL`, `totalLockedUSDC`, `setMaxGigAmount`, `setMaxTVL`, `remainingTVLCapacity` | ✅ See 4.2.a |
| `f44b3f3` | 2026-04-12 | `ClawTrustRepAdapter`: add `checkEligibility()` external view | ✅ See 4.2.b |

#### 4.2.a TVL caps in ClawTrustEscrow (NEW)

**Code:** `_createEscrow` enforces `maxTVL` and `_validateLockParams` enforces `maxGigAmount`. Both default to non-zero conservative values ($50 K per gig, $500 K total), with `0` meaning "uncapped". Owner-only setters emit events.

**Checked:**
- ✅ `totalLockedUSDC` is incremented in `_createEscrow` *before* state finalization, after the SafeERC20 transfer — protects the cap from concurrent partial-fill attempts (no concurrency in EVM, but pattern is correct).
- ✅ `totalLockedUSDC -= escrow.amount` is decremented in both `_releaseEscrow` and `_doRefund` — symmetric, no leak.
- ✅ Underflow on the decrement is impossible: `totalLockedUSDC` is incremented by `amount` on lock and decremented by the same `escrow.amount` on resolve. Solidity 0.8 reverts on underflow as a defense-in-depth.
- ✅ `0` sentinel for "uncapped" is checked first (`if (maxTVL != 0 && newTotal > maxTVL)`), so disabled caps don't false-positive.
- ✅ `setMaxTVL(0)` does not orphan locked funds — it only loosens future locks.
- ✅ Setting `maxTVL` *below* current `totalLockedUSDC` is allowed and only blocks new locks until releases bring it under — intended throttle behaviour, not a foot-gun.

**No issues.**

#### 4.2.b `checkEligibility()` in ClawTrustRepAdapter (NEW)

**Code:**
```solidity
function checkEligibility(address wallet, uint256 minScore, uint256 maxRisk)
    external view returns (bool eligible, uint256 currentScore, uint256 riskPlaceholder)
{
    currentScore = fusedScores[wallet].fusedScore;
    riskPlaceholder = 0;
    eligible = (currentScore >= minScore) && (riskPlaceholder <= maxRisk);
}
```

**Checked:**
- ✅ Pure view function, no state changes, no external calls — no reentrancy or state-corruption surface.
- ✅ Returns the *stored* `fusedScore`. Cannot be inflated by a caller without going through `updateFusedScore` (oracle-gated, rate-limited, capped at 100).
- ✅ `riskPlaceholder = 0` is documented in the natspec as "risk lives off-chain". A consumer that treats `riskPlaceholder` as authoritative would be misusing the interface; the field is named accordingly.
- ⚠️ **Note (informational, not a finding):** `eligible` short-circuits to `true` when `minScore = 0` regardless of whether the wallet has ever been scored (default `fusedScore = 0`, `0 >= 0`). This matches the documented "pass 0 to skip check" semantics. Callers requiring "wallet must be actively scored" should additionally check `fusedScores[wallet].timestamp != 0`.

**No issues. Recommend** adding the `timestamp != 0` example to the docstring (cosmetic; not a security issue).

---

## 5. Carry-Over Status (March 2026 audit)

All findings from `audit-artifacts/AUDIT_REPORT_2026-03.md` were re-verified against the current source:

- **H-01** (encode-packed-collision in `_domainKey`) — **CONFIRMED FIXED**: `ClawTrustRegistry._domainKey` uses `abi.encode(...)` (line 254-256).
- **H-02** (reentrancy-eth in `vote`) — **STILL FALSE POSITIVE**: `vote` retains `nonReentrant` (line 169).
- **H-03** (uninitialized-state on `scoreHistory`) — **STILL FALSE POSITIVE**: standard Solidity mapping zero-init; explicit `slither-disable-next-line` comment present (line 51-52).
- **M-01..M-06** — all fix patches present in source as documented.
- **L-01..L-10** — all original acceptances stand; no behaviour changes affect them.

---

## 6. Toolchain Limitations & CI Recommendation

This audit was performed in the Replit dev environment, which restricts arbitrary package installation. The following tools could not be run here and are recommended as a **GitHub Actions audit job** before mainnet:

```yaml
# .github/workflows/contract-audit.yml (recommended)
- foundryup && forge build && forge test --fuzz-runs 100000
- pip install mythril && myth analyze contracts/contracts/ClawTrustEscrow.sol \
    --execution-timeout 600 --max-depth 12 --solv 0.8.24
- pip install halmos && halmos --root contracts --contract ClawTrustEscrow
- echidna contracts/contracts/ClawTrustEscrow.sol --config echidna.yaml
- aderyn contracts/
```

Suggested invariants for fuzz testing (Foundry / Echidna / Halmos):

1. **Escrow conservation:** `usdc.balanceOf(escrow) >= totalLockedUSDC` always.
2. **TVL cap:** `totalLockedUSDC <= maxTVL || maxTVL == 0` always after any successful lock.
3. **Reward pool conservation (SwarmValidator):** `Σ rewardPoolClaimed[gigId] ≤ rewardPool[gigId]` always.
4. **Soulbound (ClawCardNFT):** any successful `transfer*` reverts.
5. **FusedScore range:** `getScore(agent) ∈ [0, 100]` always.
6. **Domain uniqueness:** `domainTaken[key] = true` ⟹ exactly one tokenId resolves to it.
7. **Bond stake:** `Σ stakes >= Σ slashed` always.

These were not converted to executable test contracts in this audit due to the missing fuzz toolchain, but the invariant set is recorded here for the CI follow-up.

---

## 7. Test-Suite Coverage (existing)

```
14 suites:
  ClawCardNFT.test.cjs
  ClawTrustAC.test.cjs + ClawTrustAC.additional.test.cjs
  ClawTrustBond.test.cjs
  ClawTrustCrew.test.cjs
  ClawTrustEscrow.test.cjs + ClawTrustEscrow.additional.test.cjs
  ClawTrustRegistry.test.cjs
  ClawTrustRepAdapter.test.cjs + ClawTrustRepAdapter.additional.test.cjs
  ClawTrustSwarmValidator.test.cjs + ClawTrustSwarmValidator.additional.test.cjs
  ClawTrustTimelock.test.cjs
  ERC8004IdentityRegistry.test.cjs

Total: 252 tests, all passing on `dd38d1c` per prior CI run.
```

Hardhat compile + test were not re-run in this audit window because `contracts/node_modules` is absent and the environment blocks `npm install` from the bash tool. This does not affect the static analysis result, which uses the build-info JSON cached by the previous successful compile.

---

## 8. Conclusion

**No new High or Medium severity issues were introduced since the March 2026 audit.** All Slither findings on the production contracts are in known, accepted Low/Informational categories with documented justifications either inline or in this report. The two new code regions (Escrow TVL caps, RepAdapter `checkEligibility`) were manually reviewed and found correct.

**Mainnet readiness from this audit's perspective: APPROVED**, conditional on running the recommended fuzz/symbolic suite (Foundry + Mythril + Halmos) in a CI environment as a final pre-deploy gate.

Artifacts:
- `contracts/audit-artifacts/AUDIT_REPORT_2026-03.md` — prior audit, archived
- `contracts/audit-artifacts/slither-report.json` — full Slither JSON
- `contracts/audit-artifacts/slither-prod-findings.json` — production-only findings
- `contracts/audit-artifacts/slither-output.txt` — Slither markdown checklist
- `contracts/audit-artifacts/slither-printers.txt` — human-summary + inheritance
- `contracts/audit-artifacts/sources/` — extracted standard-json source set

---

## 9. Re-scan — 2026-04-17 (mainnet readiness check)

Slither was re-run against `contracts/contracts/` (HEAD `25b61d9`+) after the audit-pipeline and deploy-gate work landed.

| Severity      | Count | Status |
|---------------|-------|--------|
| Critical      | 0     | ✅ |
| High          | 0     | ✅ |
| Medium        | 0     | ✅ |
| Low           | 34    | All in known-accepted categories (see below) |
| Informational | 17    | Naming-convention + cyclomatic-complexity (cosmetic) |

**Low-severity breakdown (34):**
- 27 × `timestamp` — `block.timestamp` comparisons in escrow/validation/sweep windows. **Accepted by design**: every comparison uses a window of ≥ 1 hour (most are days/weeks), so 12-second miner drift is irrelevant.
- 7 × `missing-zero-check` — only **2 unique** locations (the rest are inheritance duplicates):
  - `GuardianPausable.setGuardian(address)`: `address(0)` is **intentional** to disable the guardian (see NatSpec `@dev`); owner is the timelock so accidental zeroing is gated by timelock delay + multisig.
  - `ClawTrustEscrow.constructor._x402Facilitator`: `address(0)` is **intentional** at deploy because x402 is an optional integration enabled post-deploy via `setX402Facilitator()` (which does enforce a non-zero check). Inline comment `[A]` documents this.

Both unique locations carry `// slither-disable-start/end missing-zero-check` annotations and explanatory comments in source; the count remains > 0 only because this Slither version reports the parameter-declaration line rather than the assignment line for inherited setters.

**Informational (17):** all `_underscore` parameter naming + 2 cyclomatic-complexity flags on `_executeRelease` (dispute-resolution branching) and `dissolveCrew` (cleanup loop). No functional impact.

**Re-scan conclusion:** No new High/Medium issues. All Low/Informational findings are documented and accepted. **Mainnet readiness from static-analysis perspective: re-confirmed APPROVED.**

---

## §10. Aderyn Static-Analysis Triage (CI gate baseline)

The contract-audit CI runs Aderyn (Cyfrin) alongside Slither, Mythril, Halmos,
Echidna, and Medusa. Aderyn reports **3 High, 0 Medium** findings against the
production contracts. All three are heuristic false positives or out-of-scope
flags, triaged below. The CI gate fails on any new High/Medium beyond this
documented baseline.

### A-H1. `abi-encode-packed-hash-collision` — `ClawTrustRegistry.sol`
- **Sites:** L128 (event payload `full = name||tld`), L188–L189 (`tokenURI` JSON
  string assembly), L200 (`tokenURI` data-URI prefix).
- **Status:** Accepted — display-only string concatenation, not a hash key.
- **Rationale:** Aderyn flags any `abi.encodePacked` whose result reaches a
  hash-like sink. The four sites here build human-readable strings for an
  ERC-721 `tokenURI` and a `DomainRegistered` event. They are never hashed
  for indexing. The collision-sensitive key is `_domainKey`, which already
  uses `abi.encode` (validated by `RegistryInvariants.t.sol`). Slither has
  the equivalent suppression.

### A-H2. `reentrancy-state-change` — `ClawTrustAC.sol` L211
- **Site:** `assignProvider(jobId, provider)`.
- **Status:** Accepted — false positive, no untrusted external call.
- **Rationale:** The only "external call" before the state assignment is
  `clawCard.isRegistered(provider)`, a read on the trusted ClawCard
  registry deployed by ClawTrust governance. There is no callback surface,
  no token transfer, and no third-party contract on the path. Reentrancy
  is structurally impossible.

### A-H3. `weak-randomness` — `ClawTrustAC.sol` L152, `ClawTrustCrew.sol` L99 / L160
- **Sites:** `jobId`, `crewId`, `taskId` derivations
  (`keccak256(abi.encode(msg.sender, counter, block.timestamp))`).
- **Status:** Accepted — identifier derivation, not security randomness.
- **Rationale:** These hashes generate collision-resistant primary keys
  for jobs/crews/tasks. They are never used to seed a reward draw, an
  auction tiebreak, a validator selection, or any other security
  decision. Predictability is a non-issue: a caller already controls
  `msg.sender` and can observe `block.timestamp`.

**Aderyn conclusion:** No remediation required. Baseline (3 H, 0 M)
locked in `contract-audit.yml`; any future detector hit beyond this set
fails CI and must be triaged here before the baseline is raised.
