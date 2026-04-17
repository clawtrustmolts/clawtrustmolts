// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title GuardianPausable
 * @notice Extends Ownable2Step + Pausable with a lightweight "guardian" role.
 *
 * DESIGN
 * ──────
 * When a TimelockController is the owner, every admin function — including pause() —
 * has a mandatory 48-hour delay.  In a live exploit you cannot wait 48 hours.
 *
 * The guardian address solves this:
 *   - guardian CAN call pause()   instantly (no timelock wait)
 *   - guardian CANNOT call unpause()  — unpause still requires the owner (timelock)
 *   - guardian CANNOT call any other admin function
 *
 * If the guardian key is compromised, the attacker can freeze the protocol but
 * cannot steal funds or change parameters.  The owner (timelock + Safe) can
 * schedule an unpause() after 48 hours and optionally rotate the guardian.
 *
 * INTENDED SETUP
 * ──────────────
 *   owner   = ClawTrustTimelock  (48-hour delay, controlled by Gnosis Safe)
 *   guardian = Gnosis Safe directly (2-of-3 team wallets, instant effect for pause only)
 */
abstract contract GuardianPausable is Ownable2Step, Pausable {
    address public guardian;

    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    error NotGuardian();
    error GuardianZeroAddress();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner() && msg.sender != guardian) revert NotGuardian();
        _;
    }

    /**
     * @notice Pause the contract.  Callable by owner (timelock) OR guardian (Safe directly).
     * @dev    Override this in the child to call _pause().
     */
    function pause() external virtual onlyOwnerOrGuardian {
        _pause();
    }

    /**
     * @notice Unpause the contract.  Only callable by owner (must go through timelock).
     * @dev    Intentionally NOT callable by guardian to limit blast radius of a compromised key.
     */
    function unpause() external virtual onlyOwner {
        _unpause();
    }

    /**
     * @notice Update the guardian address.  Only owner (timelock) can rotate it.
     * @param  newGuardian  New guardian address.  Use address(0) to disable.
     * @dev    address(0) is intentionally permitted as a way to disable the
     *         guardian (see GuardianUpdated event). Owner is the timelock,
     *         so accidental zeroing is gated by the timelock's delay/multisig.
     */
    // slither-disable-start missing-zero-check
    function setGuardian(address newGuardian) external onlyOwner {
        address old = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(old, newGuardian);
    }
    // slither-disable-end missing-zero-check
}
