// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns(bool);
    function transfer(address to, uint256 amount) external returns(bool);
    function balanceOf(address account) external view returns(uint256);
}

contract ClawTrustBond {
    IERC20 public immutable usdcToken;
    address public owner;

    struct Bond {
        uint256 totalDeposited;
        uint256 available;
        uint256 locked;
        uint256 lastSlashTimestamp;
        uint256 performanceScore; // 0-100
    }

    struct Gig {
        bytes32 gigId;
        address agent;
        uint256 lockedAmount;
        uint256 approvals;
        uint256 rejections;
        bool finalized;
    }

    mapping(address => Bond) public bonds;
    mapping(bytes32 => Gig) public gigs;

    uint256 public constant MIN_DEPOSIT = 10e6;
    uint256 public constant SLASH_COOLDOWN = 7 days;
    uint256 public constant MAX_SLASH_BPS = 2000; // Max 20% of locked bond
    uint256 public constant SWARM_THRESHOLD = 3;
    uint256 public constant MIN_FUSED_SCORE = 50; // Example threshold for auto-slash

    // Events
    event BondDeposited(address indexed agent, uint256 amount);
    event BondWithdrawn(address indexed agent, uint256 amount);
    event BondLocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondUnlocked(address indexed agent, uint256 amount, bytes32 gigId);
    event BondSlashed(address indexed agent, uint256 amount, bytes32 gigId, string reason);
    event SwarmVote(bytes32 gigId, address validator, bool approve);
    event PerformanceScoreUpdated(address indexed agent, uint256 performanceScore);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdcToken) {
        usdcToken = IERC20(_usdcToken);
        owner = msg.sender;
    }

    // --- Bond Management ---
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

    // --- Performance Score ---
    function updatePerformanceScore(address agent, uint256 score) external onlyOwner {
        require(score <= 100, "Score > 100");
        bonds[agent].performanceScore = score;
        emit PerformanceScoreUpdated(agent, score);
    }

    // --- Gig Actions ---
    function lockBondForGig(bytes32 gigId, uint256 amount) external {
        Bond storage bond = bonds[msg.sender];
        require(amount <= bond.available, "Insufficient bond");
        require(gigs[gigId].agent == address(0), "Gig already exists");

        // Auto-slash if performance score is below threshold
        if (bond.performanceScore < MIN_FUSED_SCORE) {
            uint256 slashAmount = (amount * MAX_SLASH_BPS) / 10000;
            bond.totalDeposited -= slashAmount;
            bond.available -= slashAmount;
            emit BondSlashed(msg.sender, slashAmount, gigId, "Low FusedScore auto-slash");
            return;
        }

        bond.available -= amount;
        bond.locked += amount;

        gigs[gigId] = Gig({
            gigId: gigId,
            agent: msg.sender,
            lockedAmount: amount,
            approvals: 0,
            rejections: 0,
            finalized: false
        });

        emit BondLocked(msg.sender, amount, gigId);
    }

    function swarmVote(bytes32 gigId, bool approve) external {
        Gig storage gig = gigs[gigId];
        require(!gig.finalized, "Gig already finalized");

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
        require(!gig.finalized, "Already finalized");

        gig.finalized = true;

        if (success) {
            bond.locked -= gig.lockedAmount;
            bond.available += gig.lockedAmount;
            emit BondUnlocked(gig.agent, gig.lockedAmount, gigId);
        } else {
            uint256 slashAmount = (gig.lockedAmount * MAX_SLASH_BPS) / 10000;
            bond.locked -= slashAmount;
            bond.totalDeposited -= slashAmount;
            bond.lastSlashTimestamp = block.timestamp;
            require(usdcToken.transfer(owner, slashAmount), "Slash transfer failed");

            emit BondSlashed(gig.agent, slashAmount, gigId, "Swarm-rejected");
        }
    }

    // --- Read Functions ---
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
}
