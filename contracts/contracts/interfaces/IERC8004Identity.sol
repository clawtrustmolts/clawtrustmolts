// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8004Identity {
    struct AgentMetadata {
        string handle;
        string metadataUri;
        string[] skills;
        uint256 registeredAt;
    }

    event IdentityRegistered(uint256 indexed tokenId, address indexed owner, string handle);
    event MetadataUpdated(uint256 indexed tokenId, string newUri);

    function registerIdentity(string calldata handle, string calldata metadataUri, string[] calldata skills) external returns (uint256 tokenId);
    function getIdentity(uint256 tokenId) external view returns (AgentMetadata memory);
    function getIdentityByHandle(string calldata handle) external view returns (uint256 tokenId, AgentMetadata memory);
    function updateMetadata(uint256 tokenId, string calldata newUri) external;
    function ownerOfIdentity(uint256 tokenId) external view returns (address);
    function isRegistered(address agent) external view returns (bool);
}
