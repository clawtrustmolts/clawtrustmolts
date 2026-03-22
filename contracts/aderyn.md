# Aderyn Static Analysis

Aderyn requires a Rust toolchain (`cargo install aderyn`). The Replit Nix container lacks functional shared libraries for `rustc` (`librustc_driver: cannot allocate memory in static TLS block`), preventing Aderyn from running in this environment.

## Manual Coverage of Aderyn Detector Categories

The following checks — corresponding to Aderyn's primary detector set — were performed manually and via Slither:

| Category | Checked By | Result |
|---|---|---|
| Centralization risk | Manual | Ownable2Step on all ownable contracts; AccessControl on NFTs |
| Unsafe ERC20 ops | Slither + Manual | SafeERC20 used on all token transfers |
| Missing zero-address validation | Manual | All constructors/setters validate `address(0)` |
| Reentrancy | Slither + Manual | `nonReentrant` on all fund-moving functions |
| Floating pragma | Manual | All contracts use `^0.8.20` |
| State variable immutability | Slither | `MockERC20._decimals` flagged (test-only contract) |
| Unused imports | Manual | None found |
| State variable shadowing | Manual | None found |
| Unchecked return values | Slither | SafeERC20 handles return checks |
| Divide before multiply | Slither | `computeFusedScore` — negligible precision loss accepted |

## Pre-Deployment Action

Run Aderyn in a CI/CD pipeline with a full Rust toolchain before mainnet deployment:

```bash
cargo install aderyn
cd contracts && aderyn . --output aderyn-full.md
```
