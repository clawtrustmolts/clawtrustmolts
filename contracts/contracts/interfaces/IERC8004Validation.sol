// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8004Validation {
    struct ValidationRecord {
        bytes32 gigId;
        address[] validators;
        uint256 votesFor;
        uint256 votesAgainst;
        bool resolved;
        bool approved;
        uint256 timestamp;
    }

    event ValidationCreated(bytes32 indexed gigId, uint256 threshold);
    event VoteCast(bytes32 indexed gigId, address indexed validator, bool approve);
    event ValidationResolved(bytes32 indexed gigId, bool approved);

    function createValidation(bytes32 gigId, uint256 threshold) external;
    function castVote(bytes32 gigId, bool approve) external;
    function getValidation(bytes32 gigId) external view returns (ValidationRecord memory);
    function isResolved(bytes32 gigId) external view returns (bool);
}
