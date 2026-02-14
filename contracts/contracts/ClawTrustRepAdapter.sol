// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IERC8004Reputation.sol";

contract ClawTrustRepAdapter is Ownable {
    uint256 public constant ON_CHAIN_WEIGHT = 60;
    uint256 public constant MOLTBOOK_WEIGHT = 40;
    uint256 public constant WEIGHT_DENOMINATOR = 100;
    uint256 public constant MAX_ON_CHAIN_SCORE = 1000;
    uint256 public constant MAX_MOLTBOOK_KARMA = 10000;

    struct FusedScore {
        uint256 onChainScore;
        uint256 moltbookKarma;
        uint256 fusedScore;
        uint256 timestamp;
        string proofUri;
    }

    mapping(address => FusedScore) public fusedScores;
    mapping(address => bool) public authorizedOracles;

    address public reputationRegistry;

    event FusedScoreUpdated(address indexed agent, uint256 fusedScore, uint256 onChainScore, uint256 moltbookKarma);
    event FeedbackSubmitted(address indexed from, address indexed to, int256 score, string proofUri);
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);

    constructor(address _reputationRegistry) Ownable(msg.sender) {
        reputationRegistry = _reputationRegistry;
        authorizedOracles[msg.sender] = true;
    }

    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not authorized oracle");
        _;
    }

    function computeFusedScore(uint256 onChainScore, uint256 moltbookKarma) public pure returns (uint256) {
        uint256 normalizedOnChain = (onChainScore * 100) / MAX_ON_CHAIN_SCORE;
        if (normalizedOnChain > 100) normalizedOnChain = 100;

        uint256 normalizedMoltbook = (moltbookKarma * 100) / MAX_MOLTBOOK_KARMA;
        if (normalizedMoltbook > 100) normalizedMoltbook = 100;

        return (ON_CHAIN_WEIGHT * normalizedOnChain + MOLTBOOK_WEIGHT * normalizedMoltbook) / WEIGHT_DENOMINATOR;
    }

    function updateFusedScore(
        address agent,
        uint256 onChainScore,
        uint256 moltbookKarma,
        string calldata proofUri
    ) external onlyOracle {
        uint256 fused = computeFusedScore(onChainScore, moltbookKarma);

        fusedScores[agent] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofUri: proofUri
        });

        emit FusedScoreUpdated(agent, fused, onChainScore, moltbookKarma);
    }

    function submitFeedbackToRegistry(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external onlyOracle {
        if (reputationRegistry != address(0)) {
            IERC8004Reputation(reputationRegistry).submitFeedback(to, score, tags, proofUri);
        }
        emit FeedbackSubmitted(msg.sender, to, score, proofUri);
    }

    function submitFusedFeedback(
        address agentAddress,
        uint256 onChainScore,
        uint256 moltbookKarma,
        string[] calldata tags,
        string calldata proofUri
    ) external onlyOracle {
        uint256 fused = computeFusedScore(onChainScore, moltbookKarma);

        fusedScores[agentAddress] = FusedScore({
            onChainScore: onChainScore,
            moltbookKarma: moltbookKarma,
            fusedScore: fused,
            timestamp: block.timestamp,
            proofUri: proofUri
        });

        emit FusedScoreUpdated(agentAddress, fused, onChainScore, moltbookKarma);

        if (reputationRegistry != address(0)) {
            int256 signedFused = int256(fused);
            IERC8004Reputation(reputationRegistry).submitFeedback(
                agentAddress,
                signedFused,
                tags,
                proofUri
            );
        }

        emit FeedbackSubmitted(msg.sender, agentAddress, int256(fused), proofUri);
    }

    function getFusedScore(address agent) external view returns (FusedScore memory) {
        return fusedScores[agent];
    }

    function authorizeOracle(address oracle) external onlyOwner {
        authorizedOracles[oracle] = true;
        emit OracleAuthorized(oracle);
    }

    function revokeOracle(address oracle) external onlyOwner {
        authorizedOracles[oracle] = false;
        emit OracleRevoked(oracle);
    }

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = _registry;
    }
}
