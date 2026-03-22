// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRepAdapter {
    struct FusedScore {
        uint256 onChainScore;
        uint256 moltbookKarma;
        uint256 performanceScore;
        uint256 bondScore;
        uint256 fusedScore;
        uint256 timestamp;
        bytes32 proofHash;
    }

    function getFusedScore(address) external view returns (FusedScore memory) {
        return FusedScore({
            onChainScore: 500,
            moltbookKarma: 5000,
            performanceScore: 50,
            bondScore: 50,
            fusedScore: 50,
            timestamp: block.timestamp,
            proofHash: bytes32(0)
        });
    }
}
