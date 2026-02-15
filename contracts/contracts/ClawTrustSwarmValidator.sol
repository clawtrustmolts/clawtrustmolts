// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ClawTrustSwarmValidator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum VoteType { None, Approve, Reject }
    enum ValidationStatus { Pending, Approved, Rejected, Expired }

    struct ValidationRequest {
        bytes32 gigId;
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
        mapping(address => bool) rewardClaimed;
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
        uint256 expiresAt;
        uint256 rewardPool;
        address rewardToken;
    }

    mapping(bytes32 => ValidationRequest) internal validations;
    mapping(bytes32 => bool) public validationExists;

    address public escrowContract;
    uint256 public constant MAX_CANDIDATES = 50;
    uint256 public constant VALIDATION_DURATION = 7 days;
    uint256 public defaultThreshold = 3;
    uint256 public defaultCandidateCount = 5;

    event ValidationCreated(
        bytes32 indexed gigId,
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

    modifier onlyEscrow() {
        if(msg.sender != escrowContract) revert InvalidAddress();
        _;
    }

    constructor(address _escrowContract) Ownable(msg.sender) {
        if(_escrowContract == address(0)) revert InvalidAddress();
        escrowContract = _escrowContract;
    }

    function createValidation(
        bytes32 gigId,
        address[] calldata candidates,
        uint256 threshold,
        uint256 rewardPool,
        address rewardToken
    ) external payable onlyEscrow {
        if(validationExists[gigId]) revert ValidationAlreadyExists();
        if(candidates.length > MAX_CANDIDATES) revert TooManyCandidates();
        if(candidates.length < threshold) revert InsufficientCandidates();
        if(threshold == 0) revert InvalidThreshold();

        if(rewardToken == address(0)) {
            if(msg.value < rewardPool) revert InsufficientRewardPool();
        } else {
            if(rewardPool > 0) {
                IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewardPool);
            }
        }

        ValidationRequest storage v = validations[gigId];
        v.gigId = gigId;
        v.threshold = threshold;
        v.status = ValidationStatus.Pending;
        v.createdAt = block.timestamp;
        v.expiresAt = block.timestamp + VALIDATION_DURATION;
        v.rewardPool = rewardPool;
        v.rewardToken = rewardToken;

        for (uint256 i = 0; i < candidates.length; i++) {
            address candidate = candidates[i];
            if(candidate == address(0)) revert InvalidAddress();
            if(v.isCandidate[candidate]) revert DuplicateCandidate();

            v.candidates.push(candidate);
            v.isCandidate[candidate] = true;
        }

        validationExists[gigId] = true;

        emit ValidationCreated(gigId, candidates, threshold, rewardPool, rewardToken, v.expiresAt);
    }

    function vote(bytes32 gigId, VoteType _vote) external {
        if(!validationExists[gigId]) revert ValidationNotFound();
        ValidationRequest storage v = validations[gigId];

        if(v.status != ValidationStatus.Pending) revert ValidationAlreadyResolved();
        if(block.timestamp >= v.expiresAt) {
            _expireValidation(gigId);
            revert ValidationAlreadyResolved();
        }
        if(_vote != VoteType.Approve && _vote != VoteType.Reject) revert InvalidVote();
        if(v.votes[msg.sender] != VoteType.None) revert AlreadyVoted();
        if(!v.isCandidate[msg.sender]) revert NotCandidate();

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

        if(v.rewardToken == address(0)) {
            (bool success, ) = escrowContract.call{value: amount}("");
            if(!success) revert TransferFailed();
        } else {
            IERC20(v.rewardToken).safeTransfer(escrowContract, amount);
        }
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

        if(v.rewardToken == address(0)) {
            (bool success, ) = msg.sender.call{value: rewardPerValidator}("");
            if(!success) revert TransferFailed();
        } else {
            IERC20(v.rewardToken).safeTransfer(msg.sender, rewardPerValidator);
        }

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

    function setEscrowContract(address _escrow) external onlyOwner {
        if(_escrow == address(0)) revert InvalidAddress();
        address oldEscrow = escrowContract;
        escrowContract = _escrow;
        emit EscrowContractUpdated(oldEscrow, _escrow);
    }

    function computeRewardPool(uint256 gigBudget, uint256 rewardRate, uint256 denominator) external pure returns (uint256) {
        return (gigBudget * rewardRate) / denominator;
    }

    receive() external payable {}
}
