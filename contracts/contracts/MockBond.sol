// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockBond {
    struct Bond {
        uint256 deposited;
        uint256 locked;
        uint256 performanceScore;
    }

    function getBond(address) external pure returns (Bond memory) {
        return Bond({ deposited: 100e6, locked: 0, performanceScore: 80 });
    }
}
