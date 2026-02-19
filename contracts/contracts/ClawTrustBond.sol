// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

contract ClawTrustBond {
    IERC20 public immutable usdcToken;
    address public owner;
    address public oracle;

    struct Bond {
        uint256 totalDeposited;
        uint256 available;
        uint256 locked;
        uint256 lastSlashTimestamp;
    }

    mapping(address => Bond) public bonds;

    uint256 public constant MIN_DEPOSIT = 10e6;
    uint256 public constant SLASH_COOLDOWN = 7 days;
    uint256 public constant MAX_SLASH_BPS = 2000;

    event BondDeposited(address indexed agent, uint256 amount);
    event BondWithdrawn(address indexed agent, uint256 amount);
    event BondLocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondUnlocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondSlashed(address indexed agent, uint256 amount, bytes32 gigId, string reason);
    event OracleUpdated(address indexed newOracle);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    constructor(address _usdcToken, address _oracle) {
        usdcToken = IERC20(_usdcToken);
        owner = msg.sender;
        oracle = _oracle;
    }

    function deposit(uint256 amount) external {
        require(amount >= MIN_DEPOSIT, "Below minimum deposit");
        require(usdcToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        Bond storage bond = bonds[msg.sender];
        bond.totalDeposited += amount;
        bond.available += amount;

        emit BondDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        Bond storage bond = bonds[msg.sender];
        require(amount <= bond.available, "Insufficient available bond");

        bond.totalDeposited -= amount;
        bond.available -= amount;

        require(usdcToken.transfer(msg.sender, amount), "Transfer failed");

        emit BondWithdrawn(msg.sender, amount);
    }

    function lockBond(address agent, uint256 amount, bytes32 gigId) external onlyOracle {
        Bond storage bond = bonds[agent];
        require(amount <= bond.available, "Insufficient available bond");

        bond.available -= amount;
        bond.locked += amount;

        emit BondLocked(agent, amount, gigId);
    }

    function unlockBond(address agent, uint256 amount, bytes32 gigId) external onlyOracle {
        Bond storage bond = bonds[agent];
        uint256 unlockAmount = amount > bond.locked ? bond.locked : amount;

        bond.locked -= unlockAmount;
        bond.available += unlockAmount;

        emit BondUnlocked(agent, unlockAmount, gigId);
    }

    function slashBond(address agent, bytes32 gigId, string calldata reason) external onlyOracle {
        Bond storage bond = bonds[agent];
        require(bond.locked > 0, "No locked bond to slash");
        require(
            block.timestamp >= bond.lastSlashTimestamp + SLASH_COOLDOWN,
            "Double-slash protection: cooldown active"
        );

        uint256 slashAmount = (bond.locked * MAX_SLASH_BPS) / 10000;
        bond.locked -= slashAmount;
        bond.totalDeposited -= slashAmount;
        bond.lastSlashTimestamp = block.timestamp;

        require(usdcToken.transfer(owner, slashAmount), "Slash transfer failed");

        emit BondSlashed(agent, slashAmount, gigId, reason);
    }

    function getBond(address agent) external view returns (
        uint256 totalDeposited,
        uint256 available,
        uint256 locked,
        uint256 lastSlashTimestamp
    ) {
        Bond storage bond = bonds[agent];
        return (bond.totalDeposited, bond.available, bond.locked, bond.lastSlashTimestamp);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
