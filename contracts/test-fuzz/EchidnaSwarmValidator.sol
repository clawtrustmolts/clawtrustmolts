// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/ClawTrustSwarmValidator.sol";

contract _EchidnaSVUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Property contract for Echidna/Medusa fuzzing of ClawTrustSwarmValidator.
///         Targets Invariant 3 (reward-pool conservation) from
///         CLAWTRUST_SECURITY_AUDIT_REPORT.md §6:
///             Σ rewardPoolClaimed[gig] ≤ Σ rewardPool[gig].
///         Equivalently the contract balance never falls below
///             totalDeposited − totalClaimedOrRefunded.
///         We measure outflow via the contract balance: paid-out =
///         deposited − balance. Both directions are checked.
contract EchidnaSwarmValidator {
    _EchidnaSVUSDC public usdc;
    ClawTrustSwarmValidator public sv;

    address[3] public candidates;
    address[2] public parties; // [poster, assignee] — kept distinct from candidates
    bytes32[] public gigIds;
    mapping(bytes32 => bool) internal seen;

    uint256 public totalDeposited;
    uint256 internal _gigCounter;

    constructor() {
        usdc = new _EchidnaSVUSDC();
        // Pass this contract as the trusted "escrow" so we can call createValidation.
        sv = new ClawTrustSwarmValidator(address(this));

        // Voter proxies double as candidate identities so vote()/claimReward()
        // can be invoked with the correct msg.sender from this property
        // contract (Echidna cannot prank arbitrary EOAs).
        candidates[0] = address(new _Voter());
        candidates[1] = address(new _Voter());
        candidates[2] = address(new _Voter());

        // Poster and assignee are kept disjoint from the candidate set so
        // createValidation does not revert with PosterCannotValidate /
        // AssigneeCannotValidate.
        parties[0] = address(0xDEAD0001); // poster
        parties[1] = address(0xDEAD0002); // assignee
    }

    // ─── Fuzzed entry points ───────────────────────────────────────

    function createValidation(uint96 reward) external {
        uint256 r = uint256(reward) % (100_000 * 1e6 + 1);
        bytes32 gigId = keccak256(abi.encode("gig", ++_gigCounter));
        if (seen[gigId]) return;

        address poster = parties[0];
        address assignee = parties[1];

        address[] memory cands = new address[](3);
        cands[0] = candidates[0];
        cands[1] = candidates[1];
        cands[2] = candidates[2];

        usdc.mint(address(this), r);
        try usdc.approve(address(sv), r) {} catch { return; }
        try sv.createValidation(gigId, poster, assignee, cands, 2, r, address(usdc)) {
            seen[gigId] = true;
            gigIds.push(gigId);
            totalDeposited += r;
        } catch {}
    }

    function vote(uint256 idx, uint8 voterSeed, uint8 vt) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        // Echidna senders cannot prank arbitrary voters; instead, the candidate
        // addresses must call. We can't change msg.sender from a contract, so
        // we intentionally route via a per-candidate proxy below.
        address voter = candidates[voterSeed % 3];
        try _Voter(voter).castVote(sv, gigId, ClawTrustSwarmValidator.VoteType(vt % 3)) {} catch {}
    }

    function claim(uint256 idx, uint8 voterSeed) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        address voter = candidates[voterSeed % 3];
        try _Voter(voter).claim(sv, gigId) {} catch {}
    }

    function expire(uint256 idx) external {
        if (gigIds.length == 0) return;
        bytes32 gigId = gigIds[idx % gigIds.length];
        try sv.expireValidation(gigId) {} catch {}
    }

    // ─── Properties ────────────────────────────────────────────────

    /// Invariant 3a (per-gig): for every created validation, the amount
    /// claimed from its reward pool can never exceed the amount deposited
    /// into it. This is the literal statement of audit invariant 3:
    ///     ∀ gig.  rewardPoolClaimed[gig] ≤ rewardPool[gig]
    /// Reads `rewardPoolClaimed` directly via the on-chain getter.
    function echidna_per_gig_reward_pool_conservation() public view returns (bool) {
        for (uint256 i = 0; i < gigIds.length; i++) {
            ClawTrustSwarmValidator.ValidationInfo memory info = sv.getValidationInfo(gigIds[i]);
            if (info.rewardPoolClaimed > info.rewardPool) return false;
        }
        return true;
    }

    /// Invariant 3b (aggregate, no leaks): the validator's USDC balance
    /// equals the sum over all gigs of `rewardPool − rewardPoolClaimed`.
    /// Equivalently: every USDC the contract still holds is accounted
    /// for by an outstanding (unclaimed and unrefunded) reward pool, so
    /// no funds can be created or stranded outside the per-gig accounting.
    function echidna_aggregate_pool_matches_balance() public view returns (bool) {
        uint256 outstanding = 0;
        for (uint256 i = 0; i < gigIds.length; i++) {
            ClawTrustSwarmValidator.ValidationInfo memory info = sv.getValidationInfo(gigIds[i]);
            // Per-gig inequality must hold for the subtraction to be safe.
            if (info.rewardPoolClaimed > info.rewardPool) return false;
            outstanding += info.rewardPool - info.rewardPoolClaimed;
        }
        return usdc.balanceOf(address(sv)) == outstanding;
    }
}

/// @dev Standalone proxy whose address is the candidate identity. Echidna's
///      sender controls cannot impersonate validator candidates; routing votes
///      through these per-candidate contracts gives them the correct msg.sender.
contract _Voter {
    function castVote(
        ClawTrustSwarmValidator sv,
        bytes32 gigId,
        ClawTrustSwarmValidator.VoteType vt
    ) external {
        sv.vote(gigId, vt);
    }

    function claim(ClawTrustSwarmValidator sv, bytes32 gigId) external {
        sv.claimReward(gigId);
    }
}
