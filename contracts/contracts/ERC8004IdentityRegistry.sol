// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/IERC8004Identity.sol";
import "./interfaces/IERC8004Reputation.sol";

contract ERC8004IdentityRegistry is Ownable2Step, IERC8004Identity, IERC8004Reputation {
    uint256 private _nextTokenId;

    error AlreadyRegistered();
    error HandleTaken();
    error NotFound();
    error NotOwner();
    error IndexOutOfBounds();

    mapping(uint256 => AgentMetadata) private _identities;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _agentToToken;
    mapping(string => uint256) private _handleToToken;
    mapping(address => int256) private _scores;
    mapping(address => Feedback[]) private _feedbacks;

    // M-07: authorized feedback callers (in addition to owner)
    mapping(address => bool) public authorizedFeedbackCallers;

    event FeedbackCallerAdded(address indexed caller);
    event FeedbackCallerRemoved(address indexed caller);

    constructor() Ownable(msg.sender) {
        _nextTokenId = 1;
    }

    function registerIdentity(
        string calldata handle,
        string calldata metadataUri,
        string[] calldata skills
    ) external returns (uint256 tokenId) {
        if (_agentToToken[msg.sender] != 0) revert AlreadyRegistered();
        if (_handleToToken[handle] != 0) revert HandleTaken();

        tokenId = _nextTokenId++;
        _identities[tokenId] = AgentMetadata({
            handle: handle,
            metadataUri: metadataUri,
            skills: skills,
            registeredAt: block.timestamp
        });
        _owners[tokenId] = msg.sender;
        _agentToToken[msg.sender] = tokenId;
        _handleToToken[handle] = tokenId;

        emit IdentityRegistered(tokenId, msg.sender, handle);
    }

    function getIdentity(uint256 tokenId) external view returns (AgentMetadata memory) {
        if (_owners[tokenId] == address(0)) revert NotFound();
        return _identities[tokenId];
    }

    function getIdentityByHandle(string calldata handle) external view returns (uint256 tokenId, AgentMetadata memory) {
        tokenId = _handleToToken[handle];
        if (tokenId == 0) revert NotFound();
        return (tokenId, _identities[tokenId]);
    }

    function updateMetadata(uint256 tokenId, string calldata newUri) external {
        if (_owners[tokenId] != msg.sender) revert NotOwner();
        _identities[tokenId].metadataUri = newUri;
        emit MetadataUpdated(tokenId, newUri);
    }

    function ownerOfIdentity(uint256 tokenId) external view returns (address) {
        if (_owners[tokenId] == address(0)) revert NotFound();
        return _owners[tokenId];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agentToToken[agent] != 0;
    }

    // M-07: add/remove authorized feedback callers (e.g. RepAdapter on SKALE)
    function addFeedbackCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert NotFound();
        authorizedFeedbackCallers[caller] = true;
        emit FeedbackCallerAdded(caller);
    }

    function removeFeedbackCaller(address caller) external onlyOwner {
        authorizedFeedbackCallers[caller] = false;
        emit FeedbackCallerRemoved(caller);
    }

    function submitFeedback(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external {
        // M-07: allow authorized callers (e.g. RepAdapter on SKALE) in addition to owner
        if (msg.sender != owner() && !authorizedFeedbackCallers[msg.sender]) revert NotOwner();
        _feedbacks[to].push(Feedback({
            from: msg.sender,
            to: to,
            score: score,
            tags: tags,
            proofUri: proofUri,
            timestamp: block.timestamp
        }));
        int256 newScore = _scores[to] + score;
        if (newScore > 10000) newScore = 10000;
        if (newScore < -10000) newScore = -10000;
        _scores[to] = newScore;

        emit FeedbackSubmitted(msg.sender, to, score, tags);
        emit ScoreUpdated(to, _scores[to]);
    }

    function getScore(address agent) external view returns (int256) {
        return _scores[agent];
    }

    function getFeedbackCount(address agent) external view returns (uint256) {
        return _feedbacks[agent].length;
    }

    function getFeedback(address agent, uint256 index) external view returns (Feedback memory) {
        if (index >= _feedbacks[agent].length) revert IndexOutOfBounds();
        return _feedbacks[agent][index];
    }
}
