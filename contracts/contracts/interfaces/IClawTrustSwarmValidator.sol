// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IClawTrustSwarmValidator {
    enum VoteType { None, Approve, Reject }
    enum ValidationStatus { Pending, Approved, Rejected, Expired }

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

    function aggregateVotes(bytes32 gigId) external view returns (
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 threshold,
        uint8 status,
        bool isApproved
    );

    function getValidationInfo(bytes32 gigId) external view returns (ValidationInfo memory);
    function hasVoted(bytes32 gigId, address voter) external view returns (bool);
    function getVote(bytes32 gigId, address voter) external view returns (VoteType);
    function isCandidate(bytes32 gigId, address addr) external view returns (bool);
    function validationExists(bytes32 gigId) external view returns (bool);
}
