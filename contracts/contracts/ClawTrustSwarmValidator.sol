// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ClawTrustSwarmValidator is Ownable {
    enum VoteType { None, Approve, Reject }
    enum ValidationStatus { Pending, Approved, Rejected }

    struct ValidationRequest {
        bytes32 gigId;
        address[] candidates;
        mapping(address => VoteType) votes;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 threshold;
        ValidationStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 rewardPool;
    }

    struct ValidationInfo {
        bytes32 gigId;
        address[] candidates;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 threshold;
        ValidationStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 rewardPool;
    }

    mapping(bytes32 => ValidationRequest) internal validations;
    mapping(bytes32 => bool) public validationExists;

    address public reputationAdapter;
    address public escrowContract;
    uint256 public constant REWARD_RATE = 50;
    uint256 public constant REWARD_DENOMINATOR = 10000;
    uint256 public defaultThreshold = 3;
    uint256 public defaultCandidateCount = 5;

    event ValidationCreated(bytes32 indexed gigId, address[] candidates, uint256 threshold, uint256 rewardPool);
    event VoteCast(bytes32 indexed gigId, address indexed voter, VoteType vote);
    event ValidationResolved(bytes32 indexed gigId, ValidationStatus status, uint256 votesFor, uint256 votesAgainst);
    event RewardDistributed(bytes32 indexed gigId, address indexed validator, uint256 amount);

    constructor(address _reputationAdapter, address _escrowContract) Ownable(msg.sender) {
        reputationAdapter = _reputationAdapter;
        escrowContract = _escrowContract;
    }

    function createValidation(
        bytes32 gigId,
        address[] calldata candidates,
        uint256 threshold,
        uint256 rewardPool
    ) external {
        require(!validationExists[gigId], "Validation already exists");
        require(candidates.length >= threshold, "Not enough candidates for threshold");
        require(threshold > 0, "Threshold must be > 0");

        ValidationRequest storage v = validations[gigId];
        v.gigId = gigId;
        v.threshold = threshold;
        v.status = ValidationStatus.Pending;
        v.createdAt = block.timestamp;
        v.rewardPool = rewardPool;

        for (uint256 i = 0; i < candidates.length; i++) {
            v.candidates.push(candidates[i]);
        }

        validationExists[gigId] = true;

        emit ValidationCreated(gigId, candidates, threshold, rewardPool);
    }

    function vote(bytes32 gigId, VoteType _vote) external {
        require(validationExists[gigId], "Validation does not exist");
        ValidationRequest storage v = validations[gigId];
        require(v.status == ValidationStatus.Pending, "Validation already resolved");
        require(_vote == VoteType.Approve || _vote == VoteType.Reject, "Invalid vote");
        require(v.votes[msg.sender] == VoteType.None, "Already voted");
        require(_isCandidate(v, msg.sender), "Not a selected validator");

        v.votes[msg.sender] = _vote;

        if (_vote == VoteType.Approve) {
            v.votesFor++;
        } else {
            v.votesAgainst++;
        }

        emit VoteCast(gigId, msg.sender, _vote);

        _checkThreshold(gigId);
    }

    function _isCandidate(ValidationRequest storage v, address addr) internal view returns (bool) {
        for (uint256 i = 0; i < v.candidates.length; i++) {
            if (v.candidates[i] == addr) return true;
        }
        return false;
    }

    function _checkThreshold(bytes32 gigId) internal {
        ValidationRequest storage v = validations[gigId];

        if (v.votesFor >= v.threshold) {
            v.status = ValidationStatus.Approved;
            v.resolvedAt = block.timestamp;
            emit ValidationResolved(gigId, ValidationStatus.Approved, v.votesFor, v.votesAgainst);
            _distributeRewards(gigId);
        } else if (v.votesAgainst >= v.threshold) {
            v.status = ValidationStatus.Rejected;
            v.resolvedAt = block.timestamp;
            emit ValidationResolved(gigId, ValidationStatus.Rejected, v.votesFor, v.votesAgainst);
        }
    }

    function _distributeRewards(bytes32 gigId) internal {
        ValidationRequest storage v = validations[gigId];
        if (v.rewardPool == 0 || v.votesFor == 0) return;

        uint256 rewardPerValidator = v.rewardPool / v.votesFor;

        for (uint256 i = 0; i < v.candidates.length; i++) {
            if (v.votes[v.candidates[i]] == VoteType.Approve) {
                emit RewardDistributed(gigId, v.candidates[i], rewardPerValidator);
            }
        }
    }

    function aggregateVotes(bytes32 gigId) external view returns (
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 threshold,
        ValidationStatus status,
        bool isApproved
    ) {
        require(validationExists[gigId], "Validation does not exist");
        ValidationRequest storage v = validations[gigId];
        return (v.votesFor, v.votesAgainst, v.threshold, v.status, v.status == ValidationStatus.Approved);
    }

    function getValidationInfo(bytes32 gigId) external view returns (ValidationInfo memory) {
        require(validationExists[gigId], "Validation does not exist");
        ValidationRequest storage v = validations[gigId];
        return ValidationInfo({
            gigId: v.gigId,
            candidates: v.candidates,
            votesFor: v.votesFor,
            votesAgainst: v.votesAgainst,
            threshold: v.threshold,
            status: v.status,
            createdAt: v.createdAt,
            resolvedAt: v.resolvedAt,
            rewardPool: v.rewardPool
        });
    }

    function hasVoted(bytes32 gigId, address voter) external view returns (bool) {
        require(validationExists[gigId], "Validation does not exist");
        return validations[gigId].votes[voter] != VoteType.None;
    }

    function getVote(bytes32 gigId, address voter) external view returns (VoteType) {
        require(validationExists[gigId], "Validation does not exist");
        return validations[gigId].votes[voter];
    }

    function setDefaultThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0 && _threshold <= 20, "Invalid threshold");
        defaultThreshold = _threshold;
    }

    function setDefaultCandidateCount(uint256 _count) external onlyOwner {
        require(_count >= 3 && _count <= 20, "Invalid candidate count");
        defaultCandidateCount = _count;
    }

    function setEscrowContract(address _escrow) external onlyOwner {
        escrowContract = _escrow;
    }

    function setReputationAdapter(address _adapter) external onlyOwner {
        reputationAdapter = _adapter;
    }

    function computeRewardPool(uint256 gigBudget) external pure returns (uint256) {
        return (gigBudget * REWARD_RATE) / REWARD_DENOMINATOR;
    }
}
