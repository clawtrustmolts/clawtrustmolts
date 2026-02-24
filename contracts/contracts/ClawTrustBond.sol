// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ClawTrustBond is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdcToken;

    struct Bond {
        uint256 totalDeposited;
        uint256 available;
        uint256 locked;
        uint256 lastSlashTimestamp;
        uint256 performanceScore;
    }

    struct Gig {
        bytes32 gigId;
        address agent;
        uint256 lockedAmount;
        uint256 approvals;
        uint256 rejections;
        bool finalized;
        mapping(address => bool) hasVoted;
    }

    mapping(address => Bond) public bonds;
    mapping(bytes32 => Gig) internal gigs;
    mapping(bytes32 => bool) public gigExists;
    mapping(address => bool) public authorizedCallers;

    uint256 public constant MIN_DEPOSIT = 10e6;
    uint256 public constant SLASH_COOLDOWN = 7 days;
    uint256 public constant MAX_SLASH_BPS = 2000;
    uint256 public constant SWARM_THRESHOLD = 3;
    uint256 public constant MIN_FUSED_SCORE = 50;

    event BondDeposited(address indexed agent, uint256 amount);
    event BondWithdrawn(address indexed agent, uint256 amount);
    event BondLocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondUnlocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondSlashed(address indexed agent, uint256 amount, bytes32 gigId, string reason);
    event SwarmVote(bytes32 gigId, address validator, bool approve);
    event PerformanceScoreUpdated(address indexed agent, uint256 performanceScore);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    error BelowMinDeposit();
    error InsufficientBond();
    error GigAlreadyExists();
    error GigNotFound();
    error GigAlreadyFinalized();
    error AlreadyVoted();
    error ScoreTooLow();
    error SlashCooldownActive();
    error ScoreOutOfRange();
    error NotAuthorizedCaller();
    error SelfDealingNotAllowed();
    error InvalidAddress();
    error ZeroAmount();

    modifier onlyAuthorized() {
        if(!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorizedCaller();
        _;
    }

    constructor(address _usdcToken) Ownable(msg.sender) {
        if(_usdcToken == address(0)) revert InvalidAddress();
        usdcToken = IERC20(_usdcToken);
    }

    function deposit(uint256 amount) external nonReentrant {
        if(amount < MIN_DEPOSIT) revert BelowMinDeposit();

        IERC20(usdcToken).safeTransferFrom(msg.sender, address(this), amount);

        Bond storage bond = bonds[msg.sender];
        bond.totalDeposited += amount;
        bond.available += amount;

        emit BondDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if(amount == 0) revert ZeroAmount();
        Bond storage bond = bonds[msg.sender];
        if(amount > bond.available) revert InsufficientBond();

        bond.totalDeposited -= amount;
        bond.available -= amount;

        IERC20(usdcToken).safeTransfer(msg.sender, amount);

        emit BondWithdrawn(msg.sender, amount);
    }

    function updatePerformanceScore(address agent, uint256 score) external onlyOwner {
        if(score > 100) revert ScoreOutOfRange();
        bonds[agent].performanceScore = score;
        emit PerformanceScoreUpdated(agent, score);
    }

    function lockBondForGig(bytes32 gigId, address agent, uint256 amount) external onlyAuthorized nonReentrant {
        if(gigExists[gigId]) revert GigAlreadyExists();
        if(amount == 0) revert ZeroAmount();

        Bond storage bond = bonds[agent];
        if(amount > bond.available) revert InsufficientBond();
        if(bond.performanceScore < MIN_FUSED_SCORE && bond.totalDeposited > 0) revert ScoreTooLow();

        bond.available -= amount;
        bond.locked += amount;

        Gig storage gig = gigs[gigId];
        gig.gigId = gigId;
        gig.agent = agent;
        gig.lockedAmount = amount;
        gigExists[gigId] = true;

        emit BondLocked(agent, amount, gigId);
    }

    function swarmVote(bytes32 gigId, bool approve) external nonReentrant {
        if(!gigExists[gigId]) revert GigNotFound();
        Gig storage gig = gigs[gigId];
        if(gig.finalized) revert GigAlreadyFinalized();
        if(gig.hasVoted[msg.sender]) revert AlreadyVoted();
        if(msg.sender == gig.agent) revert SelfDealingNotAllowed();

        gig.hasVoted[msg.sender] = true;

        if (approve) {
            gig.approvals += 1;
        } else {
            gig.rejections += 1;
        }

        emit SwarmVote(gigId, msg.sender, approve);

        if (gig.approvals >= SWARM_THRESHOLD) {
            _finalizeGig(gigId, true);
        } else if (gig.rejections >= SWARM_THRESHOLD) {
            _finalizeGig(gigId, false);
        }
    }

    function _finalizeGig(bytes32 gigId, bool success) internal {
        Gig storage gig = gigs[gigId];
        Bond storage bond = bonds[gig.agent];

        gig.finalized = true;

        if (success) {
            bond.locked -= gig.lockedAmount;
            bond.available += gig.lockedAmount;
            emit BondUnlocked(gig.agent, gig.lockedAmount, gigId);
        } else {
            if(block.timestamp < bond.lastSlashTimestamp + SLASH_COOLDOWN) {
                bond.locked -= gig.lockedAmount;
                bond.available += gig.lockedAmount;
                emit BondUnlocked(gig.agent, gig.lockedAmount, gigId);
                return;
            }

            uint256 slashAmount = (gig.lockedAmount * MAX_SLASH_BPS) / 10000;
            uint256 remaining = gig.lockedAmount - slashAmount;

            bond.locked -= gig.lockedAmount;
            bond.totalDeposited -= slashAmount;
            bond.available += remaining;
            bond.lastSlashTimestamp = block.timestamp;

            IERC20(usdcToken).safeTransfer(owner(), slashAmount);

            emit BondSlashed(gig.agent, slashAmount, gigId, "Swarm-rejected");
            if(remaining > 0) {
                emit BondUnlocked(gig.agent, remaining, gigId);
            }
        }
    }

    function adminFinalize(bytes32 gigId, bool success) external onlyOwner nonReentrant {
        if(!gigExists[gigId]) revert GigNotFound();
        Gig storage gig = gigs[gigId];
        if(gig.finalized) revert GigAlreadyFinalized();
        _finalizeGig(gigId, success);
    }

    function authorizeCaller(address caller) external onlyOwner {
        if(caller == address(0)) revert InvalidAddress();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    function getBond(address agent) external view returns (
        uint256 totalDeposited,
        uint256 available,
        uint256 locked,
        uint256 lastSlashTimestamp,
        uint256 performanceScore
    ) {
        Bond storage bond = bonds[agent];
        return (bond.totalDeposited, bond.available, bond.locked, bond.lastSlashTimestamp, bond.performanceScore);
    }

    function getGigInfo(bytes32 gigId) external view returns (
        address agent,
        uint256 lockedAmount,
        uint256 approvals,
        uint256 rejections,
        bool finalized
    ) {
        if(!gigExists[gigId]) revert GigNotFound();
        Gig storage gig = gigs[gigId];
        return (gig.agent, gig.lockedAmount, gig.approvals, gig.rejections, gig.finalized);
    }

    function hasVoted(bytes32 gigId, address voter) external view returns (bool) {
        if(!gigExists[gigId]) revert GigNotFound();
        return gigs[gigId].hasVoted[voter];
    }
}
