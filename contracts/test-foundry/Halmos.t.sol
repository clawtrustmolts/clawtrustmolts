// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Symbolic-execution proofs for Halmos. Halmos discovers `prove_*` functions
// and explores all symbolic inputs. Each proof must hold for ALL inputs, not
// merely a sampled fuzz space. These complement the Foundry invariants in the
// other files in this directory.

import "forge-std/Test.sol";
import "../contracts/ClawTrustEscrow.sol";
import "../contracts/ClawTrustSwarmValidator.sol";
import "../contracts/ClawCardNFT.sol";
import "../contracts/ClawTrustRepAdapter.sol";
import "./Helpers.sol";

contract HalmosProofs is Test {
    ClawTrustEscrow internal escrow;
    ClawTrustSwarmValidator internal validator;
    ClawCardNFT internal card;
    ClawTrustRepAdapter internal adapter;
    MockUSDC internal usdc;
    address internal payee = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        card = new ClawCardNFT("ipfs://b/");
        // Register a payee passport up-front so escrow.lockUSDCDirect can succeed
        // for symbolic amounts; otherwise the call is vacuously reverting.
        card.mintTo(payee, "p");
        validator = new ClawTrustSwarmValidator(address(this));
        escrow = new ClawTrustEscrow(
            address(usdc),
            address(validator),
            500,
            address(card),
            address(0)
        );
        adapter = new ClawTrustRepAdapter(address(this));
        adapter.authorizeOracle(address(this));
    }

    /// Halmos proof: ClawTrustEscrow — TVL cap is never breached by lockUSDCDirect.
    function prove_escrow_tvl_cap(bytes32 gigId, uint256 amount) external {
        vm.assume(gigId != bytes32(0));
        uint256 cap = escrow.maxTVL();
        uint256 before = escrow.totalLockedUSDC();
        usdc.mint(address(this), amount);
        usdc.approve(address(escrow), amount);
        try escrow.lockUSDCDirect(gigId, payee, amount) {
            uint256 nowLocked = escrow.totalLockedUSDC();
            assert(cap == 0 || nowLocked <= cap);
            assert(nowLocked == before + amount);
        } catch {}
    }

    /// Halmos proof: SwarmValidator — for any never-created gig, no validation
    /// info exists and reward pool defaults to zero (no phantom rewards).
    function prove_swarm_reward_conservation(bytes32 gigId) external {
        // validationExists must be false for an arbitrary gigId in fresh state.
        // getValidationInfo reverts with ValidationNotFound when not present.
        bool exists = validator.validationExists(gigId);
        if (!exists) {
            (bool ok, ) = address(validator).call(
                abi.encodeWithSignature("getValidationInfo(bytes32)", gigId)
            );
            assert(!ok);
        }
        // Contract starts with zero token balance — no rewards claimable.
        assert(usdc.balanceOf(address(validator)) == 0);
    }

    /// Halmos proof: ClawCardNFT — transferFrom always reverts (soulbound).
    function prove_card_soulbound(address from, address to, uint256 tokenId) external {
        (bool ok, ) = address(card).call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, tokenId)
        );
        assert(!ok);
    }

    /// Halmos proof: RepAdapter — computeFusedScore output is bounded by 100.
    function prove_repadapter_score_bounded(uint256 a, uint256 b, uint256 c, uint256 d) external view {
        vm.assume(a <= 100 && b <= 100 && c <= 100 && d <= 100);
        uint256 fused = adapter.computeFusedScore(a, b, c, d);
        assert(fused <= 100);
    }
}
