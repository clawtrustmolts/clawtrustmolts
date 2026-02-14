// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8004Reputation {
    struct Feedback {
        address from;
        address to;
        int256 score;
        string[] tags;
        string proofUri;
        uint256 timestamp;
    }

    event FeedbackSubmitted(address indexed from, address indexed to, int256 score, string[] tags);
    event ScoreUpdated(address indexed agent, int256 newScore);

    function submitFeedback(address to, int256 score, string[] calldata tags, string calldata proofUri) external;
    function getScore(address agent) external view returns (int256);
    function getFeedbackCount(address agent) external view returns (uint256);
    function getFeedback(address agent, uint256 index) external view returns (Feedback memory);
}
