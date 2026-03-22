// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockBond {
    function getBond(address) external pure returns (
        uint256 totalDeposited,
        uint256 available,
        uint256 locked,
        uint256 lastSlashTimestamp,
        uint256 performanceScore
    ) {
        return (100e6, 100e6, 0, 0, 80);
    }
}
