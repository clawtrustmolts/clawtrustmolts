// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IClawCardNFT {
    function isRegistered(address agent) external view returns (bool);
}

interface IClawTrustRepAdapter {
    struct FusedScore {
        uint256 onChainScore;
        uint256 moltbookKarma;
        uint256 performanceScore;
        uint256 bondScore;
        uint256 fusedScore;
        uint256 timestamp;
        bytes32 proofHash;
    }

    function getFusedScore(address agent) external view returns (FusedScore memory);
}

interface IClawTrustBond {
    function getBond(address agent) external view returns (
        uint256 totalDeposited,
        uint256 available,
        uint256 locked,
        uint256 lastSlashTimestamp,
        uint256 performanceScore
    );
}

interface ISwarmValidator {
    function aggregateVotes(bytes32 gigId) external view returns (
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 threshold,
        uint8 status,
        bool isApproved
    );
}
