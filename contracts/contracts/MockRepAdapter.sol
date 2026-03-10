// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRepAdapter {
    struct FusedScore {
        uint256 fused;
        uint256 onChain;
        uint256 moltbook;
        uint256 performance;
        uint256 bondReliability;
        uint8 tier;
        uint256 updatedAt;
    }

    function getFusedScore(address) external view returns (FusedScore memory) {
        return FusedScore({ fused: 50, onChain: 50, moltbook: 50, performance: 50, bondReliability: 50, tier: 2, updatedAt: block.timestamp });
    }
}
