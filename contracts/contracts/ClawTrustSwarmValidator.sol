// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/*
 * ══════════════════════════════════════════════════════════════
 * SECURITY AUDIT FINDINGS — ClawTrustSwarmValidator
 * Audit date : 2026-03-12
 * Auditor    : Internal (ClawTrust core team)
 * Severity key: [C]ritical [H]igh [M]edium [L]ow [I]nfo
 * ══════════════════════════════════════════════════════════════
 *
 * [I-01] ReentrancyGuard on vote() and claimReward().
 *   STATUS: PASS.
 *
 * [I-02] SafeERC20 used for all ERC-20 reward transfers.
 *   STATUS: PASS.
 *
 * [I-03] Candidate-gated voting: only registered candidates can vote.
 *   AssigneeCannotValidate and PosterCannotValidate prevent
 *   interested-party voting.
 *   STATUS: PASS.
 *
 * [I-04] AlreadyVoted check prevents double-voting.
 *   STATUS: PASS.
 *
 * [I-05] MAX_CANDIDATES = 50 limits gas cost of createValidation.
 *   STATUS: PASS.
 *
 * [L-01] Ownable (single-step) used instead of Ownable2Step.
 *   STATUS: FIXED — upgraded to Ownable2Step.
 *
 * [L-02] ETH reward transfers use low-level .call{value:}("").
 *   STATUS: FIXED — ETH paths removed; ERC-20 only (SafeERC20).
 *
 * [L-03] Reward per validator computed as rewardPool / votesFor.
 *   Integer division may leave dust. sweepResidualRewards() allows
 *   owner to recover this dust.
 *   STATUS: PASS — dust recovery mechanism exists.
 *
 * [I-06] Validation expiry: VALIDATION_DURATION = 7 days.
 *   Expired validations refund the reward pool to escrowContract.
 *   STATUS: PASS.
 *
 * [I-07] onlyEscrowOrOwner modifier gates createValidation.
 *   STATUS: PASS.
 *
 * [L-04] DuplicateCandidate check in createValidation loop.
 *   O(n) isCandidate mapping lookup per candidate. Gas cost bounded
 *   by MAX_CANDIDATES = 50.
 *   STATUS: ACCEPTED.
 *
 * [M-01] ETH overpayment could get stranded in contract.
 *   STATUS: FIXED — ETH path removed entirely; ERC-20 only now.
 *   rewardToken=address(0) reverts. receive() removed.
 *
 * [M-02] Missing Pausable inheritance — no emergency pause on vote()
 *   or createValidation().
 *   STATUS: FIXED — added Pausable, whenNotPaused on vote/createValidation,
 *   and pause()/unpause() admin functions.
 *
 * [M-03] sweepResidualRewards() callable immediately after approval,
 *   before validators have had time to claim.
 *   STATUS: FIXED — added SWEEP_CLAIM_WINDOW (14 days) check.
 *
 * [M-04] vote() calls _expireValidation() then reverts, rolling back
 *   all state changes. Dead code that wastes gas and does nothing.
 *   STATUS: FIXED — removed dead _expireValidation call; vote() now
 *   simply reverts when expired. Use expireValidation() for explicit expiry.
 *
 * [M-05] escrowContract mutable via setEscrowContract() — in-flight
 *   validations can refund to wrong address if rotated mid-lifecycle.
 *   STATUS: FIXED — added escrowSnapshot field to ValidationRequest,
 *   set at createValidation() time. _refundRewardPool() now uses the
 *   snapshot instead of the mutable escrowContract state.
 *
 * OVERALL: No critical or high findings. Contract is production-ready.
 * ══════════════════════════════════════════════════════════════
 */
contract ClawTrustSwarmValidator is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum VoteType { None, Approve, Reject }
    enum ValidationStatus { Pending, Approved, Rejected, Expired }

    struct ValidationRequest {
        bytes32 gigId;
        address poster;
        address assignee;
        address[] candidates;
        mapping(address => VoteType) votes;
        mapping(address => bool) isCandidate;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 threshold;
        ValidationStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 expiresAt;
        uint256 rewardPool;
        uint256 rewardPoolClaimed;
        address rewardToken;
        address escrowSnapshot;
        mapping(address => bool) rewardClaimed;
    }

    struct ValidationInfo {
        bytes32 gigId;
        address poster;
        address assignee;
        address[] candidates;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 threshold;
        ValidationStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 expiresAt;
        uint256 rewardPool;
        address rewardToken;
    }

    mapping(bytes32 => ValidationRequest) internal validations;
    mapping(bytes32 => bool) public validationExists;

    address public escrowContract;
    uint256 public constant MAX_CANDIDATES = 50;
    uint256 public constant VALIDATION_DURATION = 7 days;
    uint256 public constant SWEEP_CLAIM_WINDOW = 14 days;
    uint256 public defaultThreshold = 3;
    uint256 public defaultCandidateCount = 5;

    event ValidationCreated(
        bytes32 indexed gigId,
        address indexed assignee,
        address[] candidates,
        uint256 threshold,
        uint256 rewardPool,
        address rewardToken,
        uint256 expiresAt
    );
    event VoteCast(bytes32 indexed gigId, address indexed voter, VoteType vote);
    event ValidationResolved(
        bytes32 indexed gigId,
        ValidationStatus status,
        uint256 votesFor,
        uint256 votesAgainst
    );
    event RewardClaimed(bytes32 indexed gigId, address indexed validator, uint256 amount);
    event ResidualRewardSwept(bytes32 indexed gigId, address indexed to, uint256 amount);
    event ValidationExpired(bytes32 indexed gigId);
    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);
    event DefaultThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    error ValidationAlreadyExists();
    error InsufficientCandidates();
    error InvalidThreshold();
    error ValidationNotFound();
    error ValidationAlreadyResolved();
    error InvalidVote();
    error AlreadyVoted();
    error NotCandidate();
    error TooManyCandidates();
    error DuplicateCandidate();
    error InvalidAddress();
    error NoRewardAvailable();
    error RewardAlreadyClaimed();
    error InsufficientRewardPool();
    error ValidationNotApproved();
    error TransferFailed();
    error NotExpired();
    error AssigneeCannotValidate();
    error PosterCannotValidate();

    modifier onlyEscrowOrOwner() {
        if(msg.sender != escrowContract && msg.sender != owner()) revert InvalidAddress();
        _;
    }

    constructor(address _escrowContract) Ownable(msg.sender) {
        if(_escrowContract == address(0)) revert InvalidAddress();
        escrowContract = _escrowContract;
    }

    function createValidation(
        bytes32 gigId,
        address poster,
        address assignee,
        address[] calldata candidates,
        uint256 threshold,
        uint256 rewardPool,
        address rewardToken
    ) external onlyEscrowOrOwner whenNotPaused {
        if(validationExists[gigId]) revert ValidationAlreadyExists();
        if(poster == address(0)) revert InvalidAddress();
        if(candidates.length > MAX_CANDIDATES) revert TooManyCandidates();
        if(candidates.length < threshold) revert InsufficientCandidates();
        if(threshold == 0) revert InvalidThreshold();
        if(rewardToken == address(0)) revert InvalidAddress();

        if(rewardPool > 0) {
            IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewardPool);
        }

        ValidationRequest storage v = validations[gigId];
        v.gigId = gigId;
        v.poster = poster;
        v.assignee = assignee;
        v.threshold = threshold;
        v.status = ValidationStatus.Pending;
        v.createdAt = block.timestamp;
        v.expiresAt = block.timestamp + VALIDATION_DURATION;
        v.rewardPool = rewardPool;
        v.rewardToken = rewardToken;
        v.escrowSnapshot = escrowContract;

        for (uint256 i = 0; i < candidates.length; i++) {
            address candidate = candidates[i];
            if(candidate == address(0)) revert InvalidAddress();
            if(v.isCandidate[candidate]) revert DuplicateCandidate();
            if(candidate == assignee) revert AssigneeCannotValidate();
            if(candidate == poster) revert PosterCannotValidate();

            v.candidates.push(candidate);
            v.isCandidate[candidate] = true;
        }

        validationExists[gigId] = true;

        emit ValidationCreated(gigId, assignee, candidates, threshold, rewardPool, rewardToken, v.expiresAt);
    }

    function vote(bytes32 gigId, VoteType _vote) external nonReentrant whenNotPaused {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];

        if(v.status != ValidationStatus.Pending) revert ValidationAlreadyResolved();
        if(block.timestamp >= v.expiresAt) {
            revert ValidationAlreadyResolved();
        }
        if(_vote != VoteType.Approve && _vote != VoteType.Reject) revert InvalidVote();
        if(v.votes[msg.sender] != VoteType.None) revert AlreadyVoted();
        if(!v.isCandidate[msg.sender]) revert NotCandidate();
        if(msg.sender == v.assignee) revert AssigneeCannotValidate();
        if(msg.sender == v.poster) revert PosterCannotValidate();

        v.votes[msg.sender] = _vote;

        if (_vote == VoteType.Approve) {
            v.votesFor++;
        } else {
            v.votesAgainst++;
        }

        emit VoteCast(gigId, msg.sender, _vote);

        _checkThreshold(gigId);
    }

    function _checkThreshold(bytes32 gigId) internal {
        ValidationRequest storage v = validations[gigId];

        if (v.votesFor >= v.threshold) {
            v.status = ValidationStatus.Approved;
            v.resolvedAt = block.timestamp;
            emit ValidationResolved(gigId, ValidationStatus.Approved, v.votesFor, v.votesAgainst);
        } else if (v.votesAgainst >= v.threshold) {
            v.status = ValidationStatus.Rejected;
            v.resolvedAt = block.timestamp;
            emit ValidationResolved(gigId, ValidationStatus.Rejected, v.votesFor, v.votesAgainst);
            _refundRewardPool(gigId);
        }
    }

    function _expireValidation(bytes32 gigId) internal {
        ValidationRequest storage v = validations[gigId];
        v.status = ValidationStatus.Expired;
        v.resolvedAt = block.timestamp;
        emit ValidationExpired(gigId);
        _refundRewardPool(gigId);
    }

    function expireValidation(bytes32 gigId) external {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];
        if(v.status != ValidationStatus.Pending) revert ValidationAlreadyResolved();
        if(block.timestamp < v.expiresAt) revert NotExpired();

        _expireValidation(gigId);
    }

    function _refundRewardPool(bytes32 gigId) internal {
        ValidationRequest storage v = validations[gigId];
        if(v.rewardPool == 0) return;

        uint256 amount = v.rewardPool - v.rewardPoolClaimed;
        if(amount == 0) return;
        v.rewardPoolClaimed = v.rewardPool;

        IERC20(v.rewardToken).safeTransfer(v.escrowSnapshot, amount);
    }

    function claimReward(bytes32 gigId) external nonReentrant {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];

        if(v.status != ValidationStatus.Approved) revert ValidationNotApproved();
        if(v.votes[msg.sender] != VoteType.Approve) revert NoRewardAvailable();
        if(v.rewardClaimed[msg.sender]) revert RewardAlreadyClaimed();
        if(v.rewardPool == 0 || v.votesFor == 0) revert NoRewardAvailable();

        uint256 rewardPerValidator = v.rewardPool / v.votesFor;
        if(rewardPerValidator == 0) revert NoRewardAvailable();

        uint256 remaining = v.rewardPool - v.rewardPoolClaimed;
        if(remaining == 0) revert NoRewardAvailable();
        if(rewardPerValidator > remaining) {
            rewardPerValidator = remaining;
        }

        v.rewardClaimed[msg.sender] = true;
        v.rewardPoolClaimed += rewardPerValidator;

        IERC20(v.rewardToken).safeTransfer(msg.sender, rewardPerValidator);

        emit RewardClaimed(gigId, msg.sender, rewardPerValidator);
    }

    function aggregateVotes(bytes32 gigId) external view returns (
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 threshold,
        uint8 status,
        bool isApproved
    ) {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];
        return (
            v.votesFor,
            v.votesAgainst,
            v.threshold,
            uint8(v.status),
            v.status == ValidationStatus.Approved
        );
    }

    function getValidationInfo(bytes32 gigId) external view returns (ValidationInfo memory) {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];
        return ValidationInfo({
            gigId: v.gigId,
            poster: v.poster,
            assignee: v.assignee,
            candidates: v.candidates,
            votesFor: v.votesFor,
            votesAgainst: v.votesAgainst,
            threshold: v.threshold,
            status: v.status,
            createdAt: v.createdAt,
            resolvedAt: v.resolvedAt,
            expiresAt: v.expiresAt,
            rewardPool: v.rewardPool,
            rewardToken: v.rewardToken
        });
    }

    function hasVoted(bytes32 gigId, address voter) external view returns (bool) {
        if(!validationExists[gigId]) revert ValidationNotFound();
        return validations[gigId].votes[voter] != VoteType.None;
    }

    function getVote(bytes32 gigId, address voter) external view returns (VoteType) {
        if(!validationExists[gigId]) revert ValidationNotFound();
        return validations[gigId].votes[voter];
    }

    function isCandidate(bytes32 gigId, address addr) external view returns (bool) {
        if(!validationExists[gigId]) revert ValidationNotFound();
        return validations[gigId].isCandidate[addr];
    }

    function setDefaultThreshold(uint256 _threshold) external onlyOwner {
        if(_threshold == 0 || _threshold > 20) revert InvalidThreshold();
        uint256 oldThreshold = defaultThreshold;
        defaultThreshold = _threshold;
        emit DefaultThresholdUpdated(oldThreshold, _threshold);
    }

    function setDefaultCandidateCount(uint256 _count) external onlyOwner {
        if(_count < 3 || _count > MAX_CANDIDATES) revert InvalidThreshold();
        defaultCandidateCount = _count;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setEscrowContract(address _escrow) external onlyOwner {
        if(_escrow == address(0)) revert InvalidAddress();
        address oldEscrow = escrowContract;
        escrowContract = _escrow;
        emit EscrowContractUpdated(oldEscrow, _escrow);
    }

    error SweepTooEarly();

    function sweepResidualRewards(bytes32 gigId, address to) external onlyOwner nonReentrant {
        if(!validationExists[gigId]) revert ValidationNotFound();
        if(to == address(0)) revert InvalidAddress();
        ValidationRequest storage v = validations[gigId];
        if(v.status != ValidationStatus.Approved) revert ValidationNotApproved();
        if(block.timestamp < v.resolvedAt + SWEEP_CLAIM_WINDOW) revert SweepTooEarly();

        uint256 residual = v.rewardPool - v.rewardPoolClaimed;
        if(residual == 0) revert NoRewardAvailable();

        v.rewardPoolClaimed += residual;

        IERC20(v.rewardToken).safeTransfer(to, residual);

        emit ResidualRewardSwept(gigId, to, residual);
    }

    function computeRewardPool(uint256 gigBudget, uint256 rewardRate, uint256 denominator) external pure returns (uint256) {
        return (gigBudget * rewardRate) / denominator;
    }
}
