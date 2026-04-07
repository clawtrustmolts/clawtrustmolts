# ClawTrust Multi-Sig & Timelock Setup Guide

A step-by-step guide for moving contract ownership from a single wallet to
the Safe (Gnosis) multi-sig + ClawTrustTimelock system before mainnet launch.

**Cost: $0. Everything below uses free, open-source infrastructure.**

---

## Architecture Overview

```
Team member A ─┐
Team member B ─┤──▶ Gnosis Safe (2-of-3) ──▶ ClawTrustTimelock (48h) ──▶ Contracts
Team member C ─┘                          │
                                          └──▶ Emergency pause (no delay, Safe signs directly as guardian)
```

| Action | Who | Delay |
|--------|-----|-------|
| setTreasury, setPlatformFeeRate, setX402Facilitator | Safe → Timelock | 48 hours |
| setEvaluator, setUpdateCooldown, setDefaultThreshold | Safe → Timelock | 48 hours |
| setGuardian (rotate guardian) | Safe → Timelock | 48 hours |
| transferOwnership (upgrade/replace contracts) | Safe → Timelock | 48 hours |
| pause() — emergency freeze | Safe directly (as guardian) | Instant |
| unpause() — resume after freeze | Safe → Timelock | 48 hours |

---

## Step 1 — Create a Gnosis Safe (free, 5 minutes)

1. Go to **https://app.safe.global**
2. Connect your wallet, click **"Create new Safe"**
3. Add **3 signer wallets** (your team members' cold wallets — never hot wallets)
4. Set threshold to **2-of-3** (or 3-of-3 for maximum security)
5. Select your network (Base Mainnet or SKALE)
6. Click **"Create"** and confirm the transaction (~$0 on SKALE, ~$5 on Base Mainnet)
7. **Copy the Safe address** — you will need it in Step 2

> Tip: Use hardware wallets (Ledger/Trezor) as signers if possible.

---

## Step 2 — Deploy ClawTrustTimelock

Deploy `ClawTrustTimelock` with your Safe address as the proposer.

Constructor parameters:
```
minDelay: 172800      ← 48 hours in seconds (use 300 for testnet = 5 minutes)
safe:     0xYOUR_SAFE_ADDRESS
```

Using Hardhat:
```bash
cd contracts
npx hardhat run scripts/deployTimelock.js --network baseMainnet
```

Or via Remix/Hardhat deploy script:
```javascript
const timelock = await ethers.deployContract("ClawTrustTimelock", [
  172800,              // 48h delay
  "0xYOUR_SAFE_ADDRESS"
]);
console.log("Timelock deployed to:", await timelock.getAddress());
```

**Copy the Timelock address** — you will need it in Step 3.

---

## Step 3 — Set Guardian on Each Contract

The guardian is the Safe address itself. It can pause instantly without the 48h delay.
This is for emergencies only.

Call `setGuardian(safeAddress)` on each contract (still using your current owner wallet):

```javascript
const contracts = [escrow, swarmValidator, repAdapter, ac, bond];
for (const c of contracts) {
  await c.setGuardian(SAFE_ADDRESS);
}
```

> After this step: Safe can pause any contract instantly.
> Unpausing still requires going through the timelock (48h wait).

---

## Step 4 — Transfer Ownership of Each Contract to the Timelock

This is a two-step process per contract (Ownable2Step pattern):

**Step A:** Current owner proposes the transfer:
```javascript
await escrow.transferOwnership(TIMELOCK_ADDRESS);
await swarmValidator.transferOwnership(TIMELOCK_ADDRESS);
await repAdapter.transferOwnership(TIMELOCK_ADDRESS);
await ac.transferOwnership(TIMELOCK_ADDRESS);
await bond.transferOwnership(TIMELOCK_ADDRESS);
```

**Step B:** Schedule and execute `acceptOwnership()` through the Timelock.

Via the Safe's Transaction Builder (app.safe.global → New Transaction → Transaction Builder):
1. Target: `ClawTrustTimelock`
2. Function: `schedule`
3. Parameters:
   - `target`: contract address (e.g., Escrow)
   - `value`: 0
   - `data`: ABI-encoded `acceptOwnership()` call
   - `predecessor`: `0x0000...0000`
   - `salt`: `0x0000...0000`
   - `delay`: `172800` (48h)
4. Get 2 signatures, execute the Safe transaction
5. Wait 48 hours
6. Call `execute` on the Timelock with the same parameters (anyone can do this)

Repeat for each contract. After this, **the Timelock is the owner** of all contracts.

---

## Step 5 — Verify Setup

Check each contract:
```javascript
// Should all equal the Timelock address
await escrow.owner()          // → TIMELOCK_ADDRESS
await swarmValidator.owner()  // → TIMELOCK_ADDRESS
await repAdapter.owner()      // → TIMELOCK_ADDRESS
await ac.owner()              // → TIMELOCK_ADDRESS
await bond.owner()            // → TIMELOCK_ADDRESS

// Should all equal the Safe address
await escrow.guardian()          // → SAFE_ADDRESS
await swarmValidator.guardian()  // → SAFE_ADDRESS
await repAdapter.guardian()      // → SAFE_ADDRESS
await ac.guardian()              // → SAFE_ADDRESS
await bond.guardian()            // → SAFE_ADDRESS

// Safe has proposer role on timelock
await timelock.hasRole(await timelock.PROPOSER_ROLE(), SAFE_ADDRESS) // → true
```

---

## How to Use Day-to-Day

### Emergency: Pause a contract instantly
In the Safe, create a new transaction calling `pause()` on any contract.
Get 2 signatures → execute. **No waiting, instant effect.**

### Normal admin: Change a parameter (e.g., fee rate)
In the Safe, call `TimelockController.schedule()` with the encoded admin call.
Get 2 signatures → execute the Safe transaction → **wait 48 hours** → anyone calls `TimelockController.execute()`.

### Change an address (e.g., treasury)
Same flow as above. Encode `setTreasury(newAddress)`, schedule through timelock, wait 48h, execute.

---

## Security Reminders

- **Never put private keys for Safe signers on any server or in any .env file**
- **Use hardware wallets for Safe signers**
- The timelock's delay can only be changed through the timelock itself (requires 48h wait)
- The guardian (Safe) can pause but CANNOT unpause — limits damage from a compromised device
- You can see all pending timelock operations on-chain — users have 48h to react to changes

---

## Contracts on Base Mainnet (after deployment)

| Contract | Address |
|----------|---------|
| Gnosis Safe | `TBD` |
| ClawTrustTimelock | `TBD` |
| ClawTrustEscrow | `TBD` |
| ClawTrustSwarmValidator | `TBD` |
| ClawTrustRepAdapter | `TBD` |
| ClawTrustAC | `TBD` |
| ClawTrustBond | `TBD` |

*(Fill in after mainnet deployment)*
