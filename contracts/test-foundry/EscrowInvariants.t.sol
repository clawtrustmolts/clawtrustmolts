// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawTrustEscrow.sol";
import "../contracts/ClawTrustSwarmValidator.sol";
import "../contracts/ClawCardNFT.sol";
import "./Helpers.sol";

/// @notice Bounded handler that drives Escrow state changes during invariant runs.
contract EscrowHandler is Test {
    ClawTrustEscrow public escrow;
    MockUSDC public usdc;
    address[] public depositors;
    bytes32[] public gigIds;
    mapping(bytes32 => bool) internal _seen;

    constructor(ClawTrustEscrow _escrow, MockUSDC _usdc, address[] memory _depositors) {
        escrow = _escrow;
        usdc = _usdc;
        depositors = _depositors;
    }

    function lock(uint256 actorSeed, uint256 payeeSeed, uint96 amount, bytes32 gigId) external {
        address depositor = depositors[actorSeed % depositors.length];
        address payee = depositors[payeeSeed % depositors.length];
        if (payee == depositor) return;
        if (_seen[gigId]) return;

        amount = uint96(bound(uint256(amount), 1, 10_000 * 1e6));
        usdc.mint(depositor, amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        try escrow.lockUSDCDirect(gigId, payee, amount) {
            _seen[gigId] = true;
            gigIds.push(gigId);
        } catch {}
        vm.stopPrank();
    }

    function release(uint256 idx) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        (, address depositor,,,,,,,) = _readEscrow(gigId);
        if (depositor == address(0)) return;
        vm.prank(depositor);
        try escrow.release(gigId) {} catch {}
    }

    function refund(uint256 idx) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        (, address depositor,,,,,,,) = _readEscrow(gigId);
        if (depositor == address(0)) return;
        vm.prank(depositor);
        try escrow.refund(gigId) {} catch {}
    }

    function _readEscrow(bytes32 gigId)
        internal
        view
        returns (
            bytes32, address, address, uint256, uint8, uint256, uint256, bool, uint256
        )
    {
        return escrow.escrows(gigId);
    }
}

contract EscrowInvariantsTest is Test {
    ClawTrustEscrow internal escrow;
    ClawTrustSwarmValidator internal validator;
    ClawCardNFT internal card;
    MockUSDC internal usdc;
    EscrowHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        // The escrow uses IClawCardNFT(identityRegistry).isRegistered(payee) to
        // gate locks, so the identity registry must be a ClawCardNFT and every
        // payee must hold a passport.
        card = new ClawCardNFT("ipfs://b/");
        validator = new ClawTrustSwarmValidator(address(this));
        escrow = new ClawTrustEscrow(
            address(usdc),
            address(validator),
            500, // 5% fee
            address(card),
            address(0)
        );

        address[] memory actors = new address[](4);
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B);
        actors[2] = address(0xCAFE);
        actors[3] = address(0xDEAD);

        // Mint passports for every actor so they can act as registered payees.
        card.mintTo(actors[0], "agent-a");
        card.mintTo(actors[1], "agent-b");
        card.mintTo(actors[2], "agent-c");
        card.mintTo(actors[3], "agent-d");

        handler = new EscrowHandler(escrow, usdc, actors);

        targetContract(address(handler));
    }

    /// Invariant 1: Escrow conservation — contract balance covers all locked funds.
    function invariant_escrow_conservation() public view {
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalLockedUSDC());
    }

    /// Invariant 2: TVL cap respected.
    function invariant_tvl_cap() public view {
        uint256 cap = escrow.maxTVL();
        if (cap != 0) {
            assertLe(escrow.totalLockedUSDC(), cap);
        }
    }
}
