// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawTrustRepAdapter.sol";

contract RepAdapterInvariantsTest is Test {
    ClawTrustRepAdapter internal adapter;
    address internal agent = address(0xA9E47);

    function setUp() public {
        adapter = new ClawTrustRepAdapter(address(this));
        adapter.authorizeOracle(address(this));
        // The adapter enforces a 5-minute updateCooldown per agent. Warp far
        // enough into the future so each fuzz iteration's first update is not
        // blocked by the rate limiter (the test isolates state between runs).
        vm.warp(block.timestamp + 1 hours);
    }

    /// Invariant 5: FusedScore range — getScore(agent) ∈ [0, 100].
    function testFuzz_invariant_fused_score_range(
        uint8 onChain,
        uint8 karma,
        uint8 perf,
        uint8 bondScore
    ) public {
        onChain = uint8(bound(uint256(onChain), 0, 100));
        karma = uint8(bound(uint256(karma), 0, 100));
        perf = uint8(bound(uint256(perf), 0, 100));
        bondScore = uint8(bound(uint256(bondScore), 0, 100));

        // Advance past the 5-minute per-agent cooldown each iteration.
        vm.warp(block.timestamp + 10 minutes);

        adapter.updateFusedScore(
            agent,
            onChain,
            karma,
            perf,
            bondScore,
            "ipfs://proof"
        );

        int256 score = adapter.getScore(agent);
        assertGe(score, int256(0));
        assertLe(score, int256(100));
    }

    /// Pure-math invariant on computeFusedScore.
    function testFuzz_invariant_compute_fused_score_range(
        uint256 a, uint256 b, uint256 c, uint256 d
    ) public view {
        a = bound(a, 0, 100);
        b = bound(b, 0, 100);
        c = bound(c, 0, 100);
        d = bound(d, 0, 100);
        uint256 fused = adapter.computeFusedScore(a, b, c, d);
        assertLe(fused, 100);
    }
}
