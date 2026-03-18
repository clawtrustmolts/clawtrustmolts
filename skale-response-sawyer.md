# ClawTrust — SKALE Integration Compliance Report

**To:** Sawyer / SKALE Team
**From:** ClawTrust (Chronos_Vault)
**Date:** March 18, 2026
**Re:** Action items from your feedback — confirmed complete

---

## Overview

This document confirms that all technical action items raised in your feedback have been addressed and are live on SKALE on Base testnet as of today.

---

## Item 1 — Chain: SKALE on Base

**Your instruction:** Use the correct chain — SKALE on Base.

**Status: Complete.**

ClawTrust is deployed and operating on **SKALE on Base Sepolia** (chain ID `324705682`), the exact network documented at [docs.skale.space/get-started/quick-start/skale-on-base](https://docs.skale.space/get-started/quick-start/skale-on-base).

| Parameter | Value |
|---|---|
| Chain ID | `324705682` |
| RPC | `https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha` |
| Explorer | `https://base-sepolia-testnet-explorer.skalenodes.com` |
| USDC | `0x2e08028E3C4c2356572E096d8EF835cD5C6030bD` |

All 8 ClawTrust contracts are live and verified on this network. See full address table in Item 2 below.

---

## Item 2 — Canonical ERC-8004 Contracts: Not Redeployed

**Your instruction:** Use the canonical ERC-8004 contracts already deployed on testnet and mainnet — do not redeploy them.

**Status: Complete.**

ClawTrust has never redeployed the canonical ERC-8004 contracts. From day one, our integration reads the canonical registry addresses as immutable constants. They are not part of our deploy script. The comment in our codebase reads:

```
// canonical ERC-8004 — never redeploy
```

The canonical addresses in use:

| Contract | Address | Chain |
|---|---|---|
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | SKALE on Base Sepolia |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | SKALE on Base Sepolia |

These are wired as read-only references across both our Base Sepolia deployment and our SKALE on Base deployment.

We have reviewed the PR at [erc-8004-contracts#56](https://github.com/erc-8004/erc-8004-contracts/pull/56) and will integrate any updated mainnet addresses from that PR when we graduate to mainnet.

---

## ClawTrust Contracts — SKALE on Base Sepolia (Live)

All 8 contracts deployed 2026-03-18 via `scripts/deploy-skale-base.mjs`:

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

**Security note:** `ClawTrustEscrow` is deployed with `x402Facilitator = address(0)` by default, and the facilitator address is set via a separate post-deploy `setX402Facilitator` call. This ensures no privileged address is baked into the constructor and the contract is inert until explicitly configured.

---

## Item 3 — Incentives

Noted. We will follow up directly with @dantereminick once everything has been reviewed on their end.

---

## Summary

Both technical items from your feedback are confirmed complete:

- SKALE on Base is the active chain in production
- Canonical ERC-8004 contracts are used as-is — never redeployed

We are ready for any further review or next steps you or the team require. Please do not hesitate to reach out.

— **ClawTrust / Chronos_Vault**
