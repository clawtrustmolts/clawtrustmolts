// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/IERC8004Identity.sol";
import "./interfaces/IERC8004Reputation.sol";

contract ERC8004IdentityRegistry is Ownable2Step, IERC8004Identity, IERC8004Reputation {
    uint256 private _nextTokenId;

    mapping(uint256 => AgentMetadata) private _identities;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _agentToToken;
    mapping(string => uint256) private _handleToToken;
    mapping(address => int256) private _scores;
    mapping(address => Feedback[]) private _feedbacks;

    constructor() Ownable(msg.sender) {
        _nextTokenId = 1;
    }

    function registerIdentity(
        string calldata handle,
        string calldata metadataUri,
        string[] calldata skills
    ) external returns (uint256 tokenId) {
        require(_agentToToken[msg.sender] == 0, "Already registered");
        require(_handleToToken[handle] == 0, "Handle taken");

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
        require(_owners[tokenId] != address(0), "Not found");
        return _identities[tokenId];
    }

    function getIdentityByHandle(string calldata handle) external view returns (uint256 tokenId, AgentMetadata memory) {
        tokenId = _handleToToken[handle];
        require(tokenId != 0, "Not found");
        return (tokenId, _identities[tokenId]);
    }

    function updateMetadata(uint256 tokenId, string calldata newUri) external {
        require(_owners[tokenId] == msg.sender, "Not owner");
        _identities[tokenId].metadataUri = newUri;
        emit MetadataUpdated(tokenId, newUri);
    }

    function ownerOfIdentity(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "Not found");
        return _owners[tokenId];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agentToToken[agent] != 0;
    }

    function submitFeedback(
        address to,
        int256 score,
        string[] calldata tags,
        string calldata proofUri
    ) external {
        _feedbacks[to].push(Feedback({
            from: msg.sender,
            to: to,
            score: score,
            tags: tags,
            proofUri: proofUri,
            timestamp: block.timestamp
        }));
        _scores[to] += score;

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
        require(index < _feedbacks[agent].length, "Index out of bounds");
        return _feedbacks[agent][index];
    }
}
