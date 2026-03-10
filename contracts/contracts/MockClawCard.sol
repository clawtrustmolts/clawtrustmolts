// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockClawCard {
    mapping(address => bool) private _registered;

    function setRegistered(address agent, bool registered) external {
        _registered[agent] = registered;
    }

    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }
}
