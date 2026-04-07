// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ClawTrustTimelock
 * @notice A 48-hour timelock that acts as the owner of all ClawTrust contracts.
 *
 * ARCHITECTURE
 * ────────────
 * Gnosis Safe (2-of-3 team wallets)
 *        │
 *        ▼  schedules operations
 * ClawTrustTimelock  ──48 hours──▶  ClawTrust contracts (setTreasury, setPlatformFeeRate, etc.)
 *
 * ROLES
 * ─────
 * PROPOSER_ROLE  — The Gnosis Safe.  Only it can schedule and cancel operations.
 * EXECUTOR_ROLE  — address(0), meaning anyone can execute a ready operation after the delay.
 *                  This removes the need for the Safe to stay online just to trigger execution.
 * Admin          — Set to address(0) at deployment (self-administered only).
 *
 * WHAT IS TIMELOCKED?
 * ───────────────────
 * Every onlyOwner admin action in ClawTrust contracts:
 *   - setTreasury, setPlatformFeeRate, setX402Facilitator, setEvaluator
 *   - setUpdateCooldown, setMinOracleCount, setDefaultThreshold, setEscrowContract
 *   - transferOwnership / acceptOwnership
 *
 * WHAT IS NOT TIMELOCKED?
 * ────────────────────────
 * pause() / unpause()  — handled by the guardian address directly (see GuardianPausable).
 *                        In an emergency you cannot wait 48 hours.
 *
 * CHANGING THE DELAY
 * ──────────────────
 * The delay can only be changed through the timelock itself (self-administered).
 * Even the Safe cannot lower it instantly — it must schedule a delay-update operation
 * and wait out the current delay before the lower delay takes effect.
 *
 * MIN_DELAY notes:
 *   - Mainnet:  172800 seconds (48 hours)
 *   - Testnet:  can be set to 300 seconds (5 minutes) for faster iteration
 */
contract ClawTrustTimelock is TimelockController {
    /// @notice 48-hour delay for mainnet. For testnet use 300 (5 minutes).
    uint256 public constant MAINNET_DELAY = 48 hours;

    /**
     * @param minDelay  Seconds that must pass between scheduling and executing.
     *                  Pass MAINNET_DELAY (172800) for production deployments.
     * @param safe      Address of the Gnosis Safe. Gets PROPOSER_ROLE and CANCELLER_ROLE.
     *                  This is the only address that can queue or cancel operations.
     */
    constructor(
        uint256 minDelay,
        address safe
    ) TimelockController(
        minDelay,
        _toArray(safe),   // proposers — only the Safe can propose
        _emptyArray(),    // executors — address(0) means anyone can execute after delay
        address(0)        // admin    — address(0) means self-administered only
    ) {}

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _toArray(address a) private pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _emptyArray() private pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = address(0); // open execution — anyone can trigger after delay passes
    }
}
