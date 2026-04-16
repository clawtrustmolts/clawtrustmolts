// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ClawTrustRepAdapter.sol";

/// @notice Property contract for Echidna/Medusa fuzzing of ClawTrustRepAdapter.
///         Targets Invariant 5 (FusedScore range) from
///         CLAWTRUST_SECURITY_AUDIT_REPORT.md §6: getScore(agent) ∈ [0, 100]
///         and computeFusedScore(...) ≤ 100 for all valid inputs.
contract EchidnaRepAdapter {
    ClawTrustRepAdapter public adapter;

    address[3] public agents;
    bool public anyUpdated;

    // Fuzzed pure-compute inputs persisted between calls so the property
    // function below can re-evaluate `computeFusedScore` on whatever the
    // fuzzer most recently explored. This turns the pure-formula property
    // into a real coverage-guided check across the full bounded input space
    // rather than a single corner-case sample.
    uint256 public lastOnChain;
    uint256 public lastKarma;
    uint256 public lastPerf;
    uint256 public lastBond;
    bool    public hasComputeSample;

    constructor() {
        // Property contract is owner (msg.sender for Ownable).
        adapter = new ClawTrustRepAdapter(address(this));
        adapter.authorizeOracle(address(this));
        // Lower the cooldown floor to its minimum so per-agent updates can
        // happen as Echidna rolls block timestamps forward.
        adapter.setUpdateCooldown(30);

        agents[0] = address(0xA1);
        agents[1] = address(0xA2);
        agents[2] = address(0xA3);
    }

    // ─── Fuzzed entry points ───────────────────────────────────────

    function updateScore(
        uint8 agentSeed,
        uint16 onChain,
        uint16 karma,
        uint8 perf,
        uint8 bondScore
    ) external {
        // Bound to each individual input's documented maximum so the
        // fuzz sequence isn't dominated by ScoreOutOfBounds reverts.
        uint256 oc = uint256(onChain) % (adapter.MAX_ON_CHAIN_SCORE() + 1);
        uint256 mk = uint256(karma) % (adapter.MAX_MOLTBOOK_KARMA() + 1);
        uint256 pf = uint256(perf) % (adapter.MAX_PERFORMANCE_SCORE() + 1);
        uint256 bs = uint256(bondScore) % (adapter.MAX_BOND_SCORE() + 1);
        address agent = agents[agentSeed % 3];

        try adapter.updateFusedScore(agent, oc, mk, pf, bs, "ipfs://proof-xyz") {
            anyUpdated = true;
        } catch {}

        // Record the bounded inputs for the pure-formula property below,
        // so each fuzz call carries forward a fresh sample point.
        lastOnChain = oc;
        lastKarma   = mk;
        lastPerf    = pf;
        lastBond    = bs;
        hasComputeSample = true;
    }

    /// Dedicated pure-compute fuzz entrypoint: records bounded inputs
    /// without touching adapter state, so the formula property is exercised
    /// even when the per-agent cooldown rejects updateFusedScore calls.
    function sampleCompute(
        uint16 onChain,
        uint16 karma,
        uint8 perf,
        uint8 bondScore
    ) external {
        lastOnChain = uint256(onChain) % (adapter.MAX_ON_CHAIN_SCORE() + 1);
        lastKarma   = uint256(karma)   % (adapter.MAX_MOLTBOOK_KARMA() + 1);
        lastPerf    = uint256(perf)    % (adapter.MAX_PERFORMANCE_SCORE() + 1);
        lastBond    = uint256(bondScore) % (adapter.MAX_BOND_SCORE() + 1);
        hasComputeSample = true;
    }

    // ─── Properties ────────────────────────────────────────────────

    /// Invariant 5a: every agent's stored fused score is in [0, 100].
    function echidna_score_in_range() public view returns (bool) {
        for (uint256 i = 0; i < agents.length; i++) {
            int256 s = adapter.getScore(agents[i]);
            if (s < int256(0) || s > int256(uint256(adapter.MAX_SCORE()))) return false;
        }
        return true;
    }

    /// Invariant 5b: pure compute path is bounded by MAX_SCORE for the
    /// most recent (onChain, karma, perf, bond) tuple set by the fuzzed
    /// `updateScore` / `sampleCompute` entrypoints. Each fuzz iteration
    /// records a new sample, so over a 50k-iteration run this becomes a
    /// per-step check across many bounded inputs — not a single fixed
    /// corner case.
    function echidna_compute_bounded() public view returns (bool) {
        if (!hasComputeSample) return true;
        uint256 fused = adapter.computeFusedScore(
            lastOnChain, lastKarma, lastPerf, lastBond
        );
        return fused <= adapter.MAX_SCORE();
    }
}
