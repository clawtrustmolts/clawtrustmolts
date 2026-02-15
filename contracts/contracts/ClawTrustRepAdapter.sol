// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC8004Reputation.sol";

contract ClawTrustRepAdapter is Ownable, Pausable, ReentrancyGuard {
    uint256 public constant ON_CHAIN_WEIGHT = 60;
    uint256 public constant MOLTBOOK_WEIGHT = 40;
    uint256 public constant WEIGHT_DENOMINATOR = 100;
    uint256 public constant MAX_ON_CHAIN_SCORE = 1000;
    uint256 public constant MAX_MOLTBOOK_KARMA = 10000;
    uint256 public constant UPDATE_COOLDOWN = 1 hours;
    uint256 public constant MAX_SCORE = 100;

    struct FusedScore {
        uint256 onChainScore;
        uint256 moltbookKarma;
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

    address public immutable reputationRegistry;
    uint256 public minOracleCount = 1;
    uint256 public oracleCount;

    event FusedScoreUpdated(
        address indexed agent,
        uint256 fusedScore,
        uint256 onChainScore,
        uint256 moltbookKarma,
        bytes32 proofHash
    );
    event FeedbackSubmitted(
        address indexed oracle,
        address indexed to,
        int256 score,
        bytes32 proofHash
    );
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);
    event ReputationRegistryCallFailed(address indexed agent, bytes reason);
    event MinOracleCountUpdated(uint256 oldCount, uint256 newCount);

    error InvalidAddress();
    error InvalidScore();
    error InvalidProof();
    error UpdateTooSoon();
    error NotAuthorizedOracle();
    error InsufficientOracles();
    error ScoreOutOfBounds();

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

    function computeFusedScore(
        uint256 onChainScore,
        uint256 moltbookKarma
    ) public pure returns (uint256) {
        if(onChainScore > MAX_ON_CHAIN_SCORE) revert ScoreOutOfBounds();
        if(moltbookKarma > MAX_MOLTBOOK_KARMA) revert ScoreOutOfBounds();

        uint256 normalizedOnChain = (onChainScore * 100) / MAX_ON_CHAIN_SCORE;
        uint256 normalizedMoltbook = (moltbookKarma * 100) / MAX_MOLTBOOK_KARMA;

        uint256 fused = (ON_CHAIN_WEIGHT * normalizedOnChain + MOLTBOOK_WEIGHT * normalizedMoltbook)
                        / WEIGHT_DENOMINATOR;

        assert(fused <= MAX_SCORE);

        return fused;
    }

    function updateFusedScore(
        address agent,
        uint256 onChainScore,
        uint256 moltbookKarma,
        string calldata proofUri
    ) external onlyOracle whenNotPaused rateLimited(agent) {
        if(agent == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        uint256 fused = computeFusedScore(onChainScore, moltbookKarma);
        bytes32 proofHash = keccak256(bytes(proofUri));

        fusedScores[agent] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofHash: proofHash
        });

        scoreHistory[agent].push(ScoreHistory({
            fusedScore: fused,
            timestamp: block.timestamp
        }));

        emit FusedScoreUpdated(agent, fused, onChainScore, moltbookKarma, proofHash);
    }

    function updateFusedScoreBatch(
        address[] calldata agents,
        uint256[] calldata onChainScores,
        uint256[] calldata moltbookKarmas,
        string[] calldata proofUris
    ) external onlyOracle whenNotPaused {
        uint256 length = agents.length;
        if(length != onChainScores.length ||
           length != moltbookKarmas.length ||
           length != proofUris.length) {
            revert InvalidScore();
        }

        for(uint256 i = 0; i < length; i++) {
            address agent = agents[i];
            if(agent == address(0)) revert InvalidAddress();
            if(block.timestamp < lastUpdateTime[agent] + UPDATE_COOLDOWN) continue;

            uint256 fused = computeFusedScore(onChainScores[i], moltbookKarmas[i]);
            bytes32 proofHash = keccak256(bytes(proofUris[i]));

            fusedScores[agent] = FusedScore({
                onChainScore: onChainScores[i],
                moltbookKarma: moltbookKarmas[i],
                fusedScore: fused,
                timestamp: block.timestamp,
                proofHash: proofHash
            });

            scoreHistory[agent].push(ScoreHistory({
                fusedScore: fused,
                timestamp: block.timestamp
            }));

            lastUpdateTime[agent] = block.timestamp;

            emit FusedScoreUpdated(agent, fused, onChainScores[i], moltbookKarmas[i], proofHash);
        }
    }

    function submitFeedbackToRegistry(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external onlyOracle whenNotPaused nonReentrant {
        if(to == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        bytes32 proofHash = keccak256(bytes(proofUri));

        try IERC8004Reputation(reputationRegistry).submitFeedback(
            to,
            score,
            tags,
            proofUri
        ) {
        } catch (bytes memory reason) {
            emit ReputationRegistryCallFailed(to, reason);
        }

        emit FeedbackSubmitted(msg.sender, to, score, proofHash);
    }

    function submitFusedFeedback(
        address agentAddress,
        uint256 onChainScore,
        uint256 moltbookKarma,
        string[] calldata tags,
        string calldata proofUri
    ) external onlyOracle whenNotPaused rateLimited(agentAddress) nonReentrant {
        if(agentAddress == address(0)) revert InvalidAddress();
        if(bytes(proofUri).length == 0) revert InvalidProof();

        uint256 fused = computeFusedScore(onChainScore, moltbookKarma);
        bytes32 proofHash = keccak256(bytes(proofUri));

        fusedScores[agentAddress] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofHash: proofHash
        });

        scoreHistory[agentAddress].push(ScoreHistory({
            fusedScore: fused,
            timestamp: block.timestamp
        }));

        emit FusedScoreUpdated(agentAddress, fused, onChainScore, moltbookKarma, proofHash);

        int256 signedFused = int256(fused);

        try IERC8004Reputation(reputationRegistry).submitFeedback(
            agentAddress,
            signedFused,
            tags,
            proofUri
        ) {
        } catch (bytes memory reason) {
            emit ReputationRegistryCallFailed(agentAddress, reason);
        }

        emit FeedbackSubmitted(msg.sender, agentAddress, signedFused, proofHash);
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

        if(offset >= total) {
            return new ScoreHistory[](0);
        }

        uint256 end = offset + limit;
        if(end > total) {
            end = total;
        }

        uint256 size = end - offset;
        ScoreHistory[] memory result = new ScoreHistory[](size);

        for(uint256 i = 0; i < size; i++) {
            result[i] = history[offset + i];
        }

        return result;
    }

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function verifyProof(address agent, string calldata proofUri) external view returns (bool) {
        bytes32 proofHash = keccak256(bytes(proofUri));
        return fusedScores[agent].proofHash == proofHash;
    }
}
