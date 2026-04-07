// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8004Reputation.sol";

contract MockRepRegistry is IERC8004Reputation {
    mapping(address => int256) private _scores;
    mapping(address => Feedback[]) private _feedbacks;

    function submitFeedback(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external override {
        _feedbacks[to].push(Feedback({
            from: msg.sender,
            to: to,
            score: score,
            tags: tags,
            proofUri: proofUri,
            timestamp: block.timestamp
        }));
        _scores[to] = score;
        emit FeedbackSubmitted(msg.sender, to, score, tags);
        emit ScoreUpdated(to, score);
    }

    function getScore(address agent) external view override returns (int256) {
        return _scores[agent];
    }

    function getFeedbackCount(address agent) external view override returns (uint256) {
        return _feedbacks[agent].length;
    }

    function getFeedback(address agent, uint256 index) external view override returns (Feedback memory) {
        return _feedbacks[agent][index];
    }
}
