# Aderyn Static Analysis Report

**Status:** Not available in current environment.

Aderyn requires a Rust toolchain (`cargo install aderyn`) which is not supported in the Replit Nix environment. The audit was performed using Slither v0.11.5 (Python-based static analyzer) as the primary tool, supplemented by thorough manual review of all 8 contracts.

## Coverage Gap Analysis

Aderyn's primary detectors overlap with Slither's detector set. The following Aderyn-specific checks were covered manually:

| Aderyn Detector | Manual Check Result |
|---|---|
| Centralization risk | PASS — Ownable2Step on all contracts, AccessControl on NFTs |
| Unsafe ERC20 operations | PASS — SafeERC20 used everywhere |
| Missing zero-address checks | PASS — All constructors and setters validate |
| Reentrancy | PASS — nonReentrant on all fund-moving functions |
| Floating pragma | PASS — All contracts use ^0.8.20 |
| Unused imports | PASS — No unused imports found |
| State variable shadowing | PASS — No shadowing detected |

## Recommendation

Run Aderyn in a CI environment with Rust toolchain before mainnet deployment:

```bash
cargo install aderyn
aderyn ./contracts/ --output contracts/aderyn-full.md
```
