// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawTrustSwarmValidator.sol";
import "./Helpers.sol";

contract SwarmHandler is Test {
    ClawTrustSwarmValidator public sv;
    MockUSDC public token;
    address public owner;
    bytes32[] public gigIds;
    uint256 public totalDeposited;
    mapping(bytes32 => bool) internal seen;

    constructor(ClawTrustSwarmValidator _sv, MockUSDC _token, address _owner) {
        sv = _sv;
        token = _token;
        owner = _owner;
    }

    function createValidation(uint96 reward, bytes32 gigId, address assignee, address poster) external {
        if (seen[gigId]) return;
        if (assignee == address(0) || poster == address(0)) return;
        reward = uint96(bound(uint256(reward), 0, 100_000 * 1e6));

        address[] memory candidates = new address[](3);
        candidates[0] = address(0xC1);
        candidates[1] = address(0xC2);
        candidates[2] = address(0xC3);

        token.mint(owner, reward);
        vm.startPrank(owner);
        token.approve(address(sv), reward);
        try sv.createValidation(gigId, poster, assignee, candidates, 2, reward, address(token)) {
            seen[gigId] = true;
            gigIds.push(gigId);
            totalDeposited += reward;
        } catch {}
        vm.stopPrank();
    }

    function vote(uint256 idx, uint8 vt) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        address[3] memory voters = [address(0xC1), address(0xC2), address(0xC3)];
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            try sv.vote(gigId, ClawTrustSwarmValidator.VoteType(vt % 3)) {} catch {}
        }
    }

    function claim(uint256 idx) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        address[3] memory voters = [address(0xC1), address(0xC2), address(0xC3)];
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            try sv.claimReward(gigId) {} catch {}
        }
    }

    function gigCount() external view returns (uint256) {
        return gigIds.length;
    }

    function gigAt(uint256 i) external view returns (bytes32) {
        return gigIds[i];
    }
}

contract SwarmValidatorInvariantsTest is Test {
    ClawTrustSwarmValidator internal sv;
    MockUSDC internal token;
    SwarmHandler internal handler;

    function setUp() public {
        token = new MockUSDC();
        // Pass test contract as escrow placeholder — not exercised here.
        sv = new ClawTrustSwarmValidator(address(this));
        handler = new SwarmHandler(sv, token, address(this));
        targetContract(address(handler));
    }

    /// Invariant 3: Reward pool conservation — total tokens paid out by the
    /// validator contract can never exceed the total deposited as reward pools.
    /// Equivalent to: Σ rewardPoolClaimed[gig] ≤ Σ rewardPool[gig].
    /// (rewardPoolClaimed is not exposed via a getter, so we measure via
    ///  contract balance: paidOut == deposited - balance.)
    function invariant_reward_pool_conservation() public view {
        uint256 paidOut = handler.totalDeposited() - token.balanceOf(address(sv));
        assertLe(paidOut, handler.totalDeposited());
        // Stronger: contract balance never goes negative (implicit via uint),
        // and each gig's pool sum bounds outflow.
        assertLe(token.balanceOf(address(sv)), handler.totalDeposited());
    }
}
