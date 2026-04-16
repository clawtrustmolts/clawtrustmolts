// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/ClawTrustBond.sol";

contract _EchidnaBondUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Property contract for Echidna/Medusa fuzzing of ClawTrustBond.
///         Targets Invariant 7 (bond solvency) from CLAWTRUST_SECURITY_AUDIT_REPORT.md §6.
contract EchidnaBond {
    _EchidnaBondUSDC public usdc;
    ClawTrustBond public bond;

    uint256 public sumDeposited;
    uint256 public sumWithdrawn;

    constructor() {
        usdc = new _EchidnaBondUSDC();
        bond = new ClawTrustBond(address(usdc));
    }

    function deposit(uint96 amount) external {
        if (amount < 100 * 1e6 || amount > 100_000 * 1e6) return;
        usdc.mint(address(this), amount);
        try usdc.approve(address(bond), amount) {} catch { return; }
        try bond.deposit(amount) {
            sumDeposited += amount;
        } catch {}
    }

    function withdraw(uint96 amount) external {
        (, uint256 available, , , ) = bond.getBond(address(this));
        if (available == 0 || amount == 0) return;
        uint256 a = uint256(amount) % available;
        if (a == 0) return;
        try bond.withdraw(a) {
            sumWithdrawn += a;
        } catch {}
    }

    /// Invariant 7: bond contract holds at least sum(deposits) - sum(withdrawals).
    function echidna_bond_solvent() public view returns (bool) {
        return usdc.balanceOf(address(bond)) >= sumDeposited - sumWithdrawn;
    }
}
