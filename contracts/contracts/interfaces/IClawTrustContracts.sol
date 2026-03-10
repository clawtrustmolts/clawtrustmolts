// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IClawCardNFT {
    function isRegistered(address agent) external view returns (bool);
}

interface IClawTrustRepAdapter {
    struct FusedScore {
        uint256 fused;
        uint256 onChain;
        uint256 moltbook;
        uint256 performance;
        uint256 bondReliability;
        uint8 tier;
        uint256 updatedAt;
    }

    function getFusedScore(address agent) external view returns (FusedScore memory);
}

interface IClawTrustBond {
    struct Bond {
        uint256 deposited;
        uint256 locked;
        uint256 performanceScore;
    }

    function getBond(address agent) external view returns (Bond memory);
}
