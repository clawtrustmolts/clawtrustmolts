// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC8004Reputation.sol";

/**
 * @title ClawTrustRepAdapter
 * @notice Computes and stores FusedScore for ClawTrust agents.
 *         Implements IERC8004Reputation and supports ERC-8004 feedback model.
 *
 *         FusedScore formula (sum = 100):
 *           onChain        45%
 *           moltbookKarma  25%
 *           performance    20%
 *           bondReliability 10%
 */
contract ClawTrustRepAdapter is Ownable, Pausable, ReentrancyGuard, IERC8004Reputation {
    uint256 public constant ON_CHAIN_WEIGHT       = 45;
    uint256 public constant MOLTBOOK_WEIGHT       = 25;
    uint256 public constant PERFORMANCE_WEIGHT    = 20;
    uint256 public constant BOND_WEIGHT           = 10;
    uint256 public constant WEIGHT_DENOMINATOR    = 100;

    uint256 public constant MAX_ON_CHAIN_SCORE    = 1000;
    uint256 public constant MAX_MOLTBOOK_KARMA    = 10000;
    uint256 public constant MAX_PERFORMANCE_SCORE = 100;
    uint256 public constant MAX_BOND_SCORE        = 100;
    uint256 public constant UPDATE_COOLDOWN       = 1 hours;
    uint256 public constant MAX_SCORE             = 100;
    uint256 public constant MAX_BATCH_SIZE        = 50;
    uint256 public constant MAX_HISTORY_LENGTH    = 500;

    struct FusedScore {
        uint256 onChainScore;
        uint256 moltbookKarma;
        uint256 performanceScore;
        uint256 bondScore;
        uint256 fusedScore;
        uint256 timestamp;
        bytes32 proofHash;
    }

    struct ScoreHistory {
        uint256 fusedScore;
        uint256 timestamp;
    }

    mapping(address => FusedScore) public fusedScores;
    mapping(address => ScoreHistory[]) public scoreHistory;
    mapping(address => bool) public authorizedOracles;
    mapping(address => uint256) public lastUpdateTime;

    // ERC-8004 feedback storage
    mapping(address => Feedback[]) internal _feedbacks;

    address public immutable reputationRegistry;
    uint256 public minOracleCount = 1;
    uint256 public oracleCount;

    event FusedScoreUpdated(
        address indexed agent,
        uint256 fusedScore,
        uint256 onChainScore,
        uint256 moltbookKarma,
        uint256 performanceScore,
        uint256 bondScore,
        bytes32 proofHash
    );
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);
    event ReputationRegistryCallFailed(address indexed agent, bytes reason);
    event MinOracleCountUpdated(uint256 oldCount, uint256 newCount);
    event ScoreHistoryPruned(address indexed agent, uint256 removedCount);

    error InvalidAddress();
    error InvalidScore();
    error InvalidProof();
    error UpdateTooSoon();
    error NotAuthorizedOracle();
    error InsufficientOracles();
    error ScoreOutOfBounds();
    error BatchTooLarge();

    modifier onlyOracle() {
        if(!authorizedOracles[msg.sender]) revert NotAuthorizedOracle();
        _;
    }

    modifier rateLimited(address agent) {
        if(block.timestamp < lastUpdateTime[agent] + UPDATE_COOLDOWN) {
            revert UpdateTooSoon();
        }
        _;
        lastUpdateTime[agent] = block.timestamp;
    }

    constructor(address _reputationRegistry) Ownable(msg.sender) {
        if(_reputationRegistry == address(0)) revert InvalidAddress();
        reputationRegistry = _reputationRegistry;
    }

    // ─── FusedScore ─────────────────────────────────────────────────

    /**
     * @notice Compute FusedScore from all 4 components.
     *         onChainScore: 0-1000, moltbookKarma: 0-10000,
     *         performanceScore: 0-100, bondScore: 0-100
     */
    function computeFusedScore(
        uint256 onChainScore,
        uint256 moltbookKarma,
        uint256 performanceScore,
        uint256 bondScore
    ) public pure returns (uint256) {
        if(onChainScore > MAX_ON_CHAIN_SCORE) revert ScoreOutOfBounds();
        if(moltbookKarma > MAX_MOLTBOOK_KARMA) revert ScoreOutOfBounds();
        if(performanceScore > MAX_PERFORMANCE_SCORE) revert ScoreOutOfBounds();
        if(bondScore > MAX_BOND_SCORE) revert ScoreOutOfBounds();

        uint256 normalizedOnChain    = (onChainScore    * 100) / MAX_ON_CHAIN_SCORE;
        uint256 normalizedMoltbook   = (moltbookKarma   * 100) / MAX_MOLTBOOK_KARMA;

        uint256 fused = (
            ON_CHAIN_WEIGHT    * normalizedOnChain  +
            MOLTBOOK_WEIGHT    * normalizedMoltbook +
            PERFORMANCE_WEIGHT * performanceScore   +
            BOND_WEIGHT        * bondScore
        ) / WEIGHT_DENOMINATOR;

        assert(fused <= MAX_SCORE);
        return fused;
    }

    function updateFusedScore(
        address agent,
        uint256 onChainScore,
        uint256 moltbookKarma,
        uint256 performanceScore,
        uint256 bondScore,
        string calldata proofUri
    ) external onlyOracle whenNotPaused rateLimited(agent) {
        if(agent == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        uint256 fused = computeFusedScore(onChainScore, moltbookKarma, performanceScore, bondScore);
        bytes32 proofHash = keccak256(bytes(proofUri));

        fusedScores[agent] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            performanceScore: performanceScore,
            bondScore: bondScore,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofHash: proofHash
        });

        _appendHistory(agent, fused);

        emit FusedScoreUpdated(agent, fused, onChainScore, moltbookKarma, performanceScore, bondScore, proofHash);
    }

    function updateFusedScoreBatch(
        address[] calldata agents,
        uint256[] calldata onChainScores,
        uint256[] calldata moltbookKarmas,
        uint256[] calldata performanceScores,
        uint256[] calldata bondScores,
        string[] calldata proofUris
    ) external onlyOracle whenNotPaused {
        uint256 length = agents.length;
        if(length > MAX_BATCH_SIZE) revert BatchTooLarge();
        if(length != onChainScores.length ||
           length != moltbookKarmas.length ||
           length != performanceScores.length ||
           length != bondScores.length ||
           length != proofUris.length) {
            revert InvalidScore();
        }

        for(uint256 i = 0; i < length; i++) {
            address agent = agents[i];
            if(agent == address(0)) revert InvalidAddress();
            if(block.timestamp < lastUpdateTime[agent] + UPDATE_COOLDOWN) continue;

            uint256 fused = computeFusedScore(onChainScores[i], moltbookKarmas[i], performanceScores[i], bondScores[i]);
            bytes32 proofHash = keccak256(bytes(proofUris[i]));

            fusedScores[agent] = FusedScore({
                onChainScore: onChainScores[i],
                moltbookKarma: moltbookKarmas[i],
                performanceScore: performanceScores[i],
                bondScore: bondScores[i],
                fusedScore: fused,
                timestamp: block.timestamp,
                proofHash: proofHash
            });

            _appendHistory(agent, fused);
            lastUpdateTime[agent] = block.timestamp;

            emit FusedScoreUpdated(agent, fused, onChainScores[i], moltbookKarmas[i], performanceScores[i], bondScores[i], proofHash);
        }
    }

    // ─── ERC-8004 Reputation Interface ───────────────────────────────

    /**
     * @notice Submit feedback for an agent (ERC-8004).
     *         Only authorized oracles may submit feedback.
     *         Also forwards to external reputationRegistry if available.
     */
    function submitFeedback(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external override onlyOracle whenNotPaused nonReentrant {
        if(to == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        _feedbacks[to].push(Feedback({
            from: msg.sender,
            to: to,
            score: score,
            tags: tags,
            proofUri: proofUri,
            timestamp: block.timestamp
        }));

        emit FeedbackSubmitted(msg.sender, to, score, tags);
        emit ScoreUpdated(to, score);

        try IERC8004Reputation(reputationRegistry).submitFeedback(to, score, tags, proofUri) {
        } catch (bytes memory reason) {
            emit ReputationRegistryCallFailed(to, reason);
        }
    }

    /**
     * @notice Get the current FusedScore for an agent (ERC-8004 compatible).
     */
    function getScore(address agent) external view override returns (int256) {
        return int256(fusedScores[agent].fusedScore);
    }

    /**
     * @notice Get count of feedback entries for an agent.
     */
    function getFeedbackCount(address agent) external view override returns (uint256) {
        return _feedbacks[agent].length;
    }

    /**
     * @notice Get a specific feedback entry for an agent.
     */
    function getFeedback(address agent, uint256 index) external view override returns (Feedback memory) {
        return _feedbacks[agent][index];
    }

    /**
     * @notice Get full reputation profile for an agent.
     *         Returns score (0-100), tier (0-4), lastUpdated, and validation count.
     */
    function getReputation(address agent) external view returns (
        uint256 score,
        uint8 tier,
        uint256 lastUpdated,
        uint256 validations
    ) {
        FusedScore storage fs = fusedScores[agent];
        score = fs.fusedScore;
        tier = _computeTier(score);
        lastUpdated = fs.timestamp;
        validations = _feedbacks[agent].length;
    }

    function _computeTier(uint256 score) internal pure returns (uint8) {
        if (score >= 90) return 4; // Diamond Claw
        if (score >= 75) return 3; // Gold Shell
        if (score >= 55) return 2; // Silver Molt
        if (score >= 35) return 1; // Bronze Pinch
        return 0;                  // Hatchling
    }

    // ─── Submit fused feedback to both this contract and the registry ──

    function submitFusedFeedback(
        address agentAddress,
        uint256 onChainScore,
        uint256 moltbookKarma,
        uint256 performanceScore,
        uint256 bondScore,
        string[] calldata tags,
        string calldata proofUri
    ) external onlyOracle whenNotPaused rateLimited(agentAddress) nonReentrant {
        if(agentAddress == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        uint256 fused = computeFusedScore(onChainScore, moltbookKarma, performanceScore, bondScore);
        bytes32 proofHash = keccak256(bytes(proofUri));

        fusedScores[agentAddress] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            performanceScore: performanceScore,
            bondScore: bondScore,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofHash: proofHash
        });

        _appendHistory(agentAddress, fused);

        emit FusedScoreUpdated(agentAddress, fused, onChainScore, moltbookKarma, performanceScore, bondScore, proofHash);

        int256 signedFused = int256(fused);

        try IERC8004Reputation(reputationRegistry).submitFeedback(
            agentAddress, signedFused, tags, proofUri
        ) {
        } catch (bytes memory reason) {
            emit ReputationRegistryCallFailed(agentAddress, reason);
        }

        emit FeedbackSubmitted(msg.sender, agentAddress, signedFused, tags);
    }

    // ─── History ─────────────────────────────────────────────────────

    function _appendHistory(address agent, uint256 fused) internal {
        ScoreHistory[] storage history = scoreHistory[agent];

        if(history.length >= MAX_HISTORY_LENGTH) {
            uint256 pruneCount = history.length - MAX_HISTORY_LENGTH + 1;
            for(uint256 i = 0; i < history.length - pruneCount; i++) {
                history[i] = history[i + pruneCount];
            }
            for(uint256 i = 0; i < pruneCount; i++) {
                history.pop();
            }
            emit ScoreHistoryPruned(agent, pruneCount);
        }

        history.push(ScoreHistory({ fusedScore: fused, timestamp: block.timestamp }));
    }

    function getFusedScore(address agent) external view returns (FusedScore memory) {
        return fusedScores[agent];
    }

    function getScoreHistory(
        address agent,
        uint256 offset,
        uint256 limit
    ) external view returns (ScoreHistory[] memory) {
        ScoreHistory[] storage history = scoreHistory[agent];
        uint256 total = history.length;
        if(offset >= total) return new ScoreHistory[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 size = end - offset;
        ScoreHistory[] memory result = new ScoreHistory[](size);
        for(uint256 i = 0; i < size; i++) {
            result[i] = history[offset + i];
        }
        return result;
    }

    function getHistoryLength(address agent) external view returns (uint256) {
        return scoreHistory[agent].length;
    }

    // ─── Oracle Management ───────────────────────────────────────────

    function authorizeOracle(address oracle) external onlyOwner {
        if(oracle == address(0)) revert InvalidAddress();
        if(!authorizedOracles[oracle]) {
            authorizedOracles[oracle] = true;
            oracleCount++;
            emit OracleAuthorized(oracle);
        }
    }

    function revokeOracle(address oracle) external onlyOwner {
        if(authorizedOracles[oracle]) {
            if(oracleCount <= minOracleCount) revert InsufficientOracles();
            authorizedOracles[oracle] = false;
            oracleCount--;
            emit OracleRevoked(oracle);
        }
    }

    function setMinOracleCount(uint256 _minCount) external onlyOwner {
        if(_minCount == 0) revert InvalidScore();
        if(_minCount > oracleCount) revert InsufficientOracles();
        uint256 oldCount = minOracleCount;
        minOracleCount = _minCount;
        emit MinOracleCountUpdated(oldCount, _minCount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function verifyProof(address agent, string calldata proofUri) external view returns (bool) {
        bytes32 proofHash = keccak256(bytes(proofUri));
        return fusedScores[agent].proofHash == proofHash;
    }
}
