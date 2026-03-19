# ClawTrust — SKALE Integration Compliance Report

**To:** Sawyer Cutler / SKALE Team
**From:** ClawTrust (Chronos_Vault)
**Date:** March 18, 2026
**Re:** Action items confirmed complete

---

## Item 1 — Chain: SKALE on Base

**Your instruction:** Use SKALE on Base.

**Status: Complete.**

ClawTrust is fully deployed on **SKALE on Base Sepolia** (chain ID `324705682`), consistent with [docs.skale.space/get-started/quick-start/skale-on-base](https://docs.skale.space/get-started/quick-start/skale-on-base).

| Parameter | Value |
|---|---|
| Network name | SKALE Base Sepolia |
| Chain ID | `324705682` |
| RPC | `https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha` |
| Explorer | `https://base-sepolia-testnet-explorer.skalenodes.com` |
| USDC | `0x2e08028E3C4c2356572E096d8EF835cD5C6030bD` |

All 8 ClawTrust contracts are live and verified on this network as of 2026-03-18.

---

## Item 2 — Canonical ERC-8004 Contracts: Not Redeployed

**Your instruction:** The canonical ERC-8004 contracts are already deployed on testnet and mainnet — do not redeploy them.

**Status: Complete.**

ClawTrust has never redeployed either canonical ERC-8004 contract. Both are wired as immutable read-only constants in our codebase, sourced directly from [erc-8004-contracts PR #56](https://github.com/erc-8004/erc-8004-contracts/pull/56) submitted by TheGreatAxios.

### SKALE Base Sepolia (Testnet)

| Contract | Address | Explorer |
|---|---|---|
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | [View](https://base-sepolia-testnet-explorer.skalenodes.com/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |

### SKALE Base Mainnet

| Contract | Address | Explorer |
|---|---|---|
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | [View](https://skale-base-explorer.skalenodes.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | [View](https://skale-base-explorer.skalenodes.com/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) |

Both testnet and mainnet addresses are wired into our configuration. ClawTrust will activate mainnet when graduating from testnet.

---

## ClawTrust Contracts — SKALE Base Sepolia (Testnet, Live)

Deployed 2026-03-18 via `scripts/deploy-skale-base.mjs`:

| Contract | Address |
|---|---|
| ClawCardNFT | `0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83` |
| ClawTrustRepAdapter | `0xFafCA23a7c085A842E827f53A853141C8243F924` |
| ClawTrustBond | `0x5bC40A7a47A2b767D948FEEc475b24c027B43867` |
| ClawTrustSwarmValidator | `0x7693a841Eec79Da879241BC0eCcc80710F39f399` |
| ClawTrustEscrow | `0x39601883CD9A115Aba0228fe0620f468Dc710d54` |
| ClawTrustCrew | `0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0` |
| ClawTrustRegistry | `0xecc00bbE268Fa4D0330180e0fB445f64d824d818` |
| ClawTrustAC *(ERC-8183 Agentic Commerce)* | `0x101F37D9bf445E92A237F8721CA7D12205D61Fe6` |

**Security note:** `ClawTrustEscrow` is deployed with `x402Facilitator = address(0)` by default and enabled via a separate post-deploy `setX402Facilitator` call — secure-by-default.

---

## Item 3 — Incentives

Understood. We will follow up directly with @dantereminick once everything has been reviewed on their end.

---

## Summary

Both technical action items are confirmed complete:

- ClawTrust runs on SKALE on Base — correct chain, correct RPC, correct chain ID
- Canonical ERC-8004 IdentityRegistry and ReputationRegistry are consumed directly from PR #56 on both testnet and mainnet — neither contract was redeployed

We are ready for any further steps. Thank you for the continued support.

— **ClawTrust / Chronos_Vault**
