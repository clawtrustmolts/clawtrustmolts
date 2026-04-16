// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/ClawTrustEscrow.sol";
import "../contracts/ClawTrustSwarmValidator.sol";
import "../contracts/ClawCardNFT.sol";

contract _EchidnaUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Property contract for Echidna and Medusa coverage-guided fuzzing.
///         Targets ClawTrustEscrow Invariants 1 (escrow conservation) and 2 (TVL cap)
///         from CLAWTRUST_SECURITY_AUDIT_REPORT.md §6.
contract EchidnaEscrow {
    _EchidnaUSDC public usdc;
    ClawCardNFT public card;
    ClawTrustSwarmValidator public validator;
    ClawTrustEscrow public escrow;

    address[3] public actors;
    uint256 internal _gigCounter;

    constructor() {
        usdc = new _EchidnaUSDC();
        card = new ClawCardNFT("ipfs://b/");
        validator = new ClawTrustSwarmValidator(address(this));
        escrow = new ClawTrustEscrow(
            address(usdc),
            address(validator),
            500, // 5% fee
            address(card),
            address(0)
        );

        actors[0] = address(0x10000);
        actors[1] = address(0x20000);
        actors[2] = address(0x30000);

        card.mintTo(actors[0], "agent-a");
        card.mintTo(actors[1], "agent-b");
        card.mintTo(actors[2], "agent-c");
    }

    // ─── Fuzzed entry points ───────────────────────────────────────

    function lock(uint8 actorSeed, uint8 payeeSeed, uint96 amount) external {
        address depositor = actors[actorSeed % 3];
        address payee = actors[payeeSeed % 3];
        if (depositor == payee) return;
        if (amount == 0) return;
        amount = uint96(uint256(amount) % (10_000 * 1e6));
        if (amount == 0) return;

        bytes32 gigId = keccak256(abi.encode("gig", ++_gigCounter));
        usdc.mint(depositor, amount);
        try usdc.approve(address(escrow), amount) {} catch { return; }
        try escrow.lockUSDCDirect(gigId, payee, amount) {} catch {}
    }

    function release(bytes32 gigId) external {
        try escrow.release(gigId) {} catch {}
    }

    function refund(bytes32 gigId) external {
        try escrow.refund(gigId) {} catch {}
    }

    // ─── Properties ────────────────────────────────────────────────

    /// Invariant 1: contract balance must always cover total locked USDC.
    function echidna_escrow_conservation() public view returns (bool) {
        return usdc.balanceOf(address(escrow)) >= escrow.totalLockedUSDC();
    }

    /// Invariant 2: total locked USDC must never exceed the configured TVL cap.
    function echidna_tvl_cap_respected() public view returns (bool) {
        uint256 cap = escrow.maxTVL();
        return cap == 0 || escrow.totalLockedUSDC() <= cap;
    }
}
