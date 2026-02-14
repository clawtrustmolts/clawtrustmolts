// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ClawCardNFT
 * @notice Dynamic NFT representing an agent's ClawTrust reputation card.
 *         Token metadata is served dynamically via the ClawTrust API,
 *         so the card updates as the agent's score changes.
 *         Supports soulbound (non-transferable) mode per token.
 */
contract ClawCardNFT is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;
    string public baseTokenURI;

    mapping(address => uint256) public walletToToken;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => bool) public soulbound;
    mapping(uint256 => string) public tokenAgentId;

    event CardMinted(address indexed wallet, uint256 indexed tokenId, string agentId, bool isSoulbound);
    event SoulboundToggled(uint256 indexed tokenId, bool isSoulbound);
    event BaseURIUpdated(string newBaseURI);

    constructor(
        string memory _baseTokenURI
    ) ERC721("ClawTrust Card", "CLAW") Ownable(msg.sender) {
        baseTokenURI = _baseTokenURI;
        _nextTokenId = 1;
    }

    /**
     * @notice Mint a Claw Card NFT for the caller.
     * @param agentId The ClawTrust agent ID to associate with this card.
     * @param makeSoulbound If true, the card cannot be transferred after minting.
     */
    function mint(string calldata agentId, bool makeSoulbound) external {
        require(!hasMinted[msg.sender], "ClawCard: already minted");
        require(bytes(agentId).length > 0, "ClawCard: agentId required");

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        walletToToken[msg.sender] = tokenId;
        hasMinted[msg.sender] = true;
        tokenAgentId[tokenId] = agentId;

        if (makeSoulbound) {
            soulbound[tokenId] = true;
        }

        emit CardMinted(msg.sender, tokenId, agentId, makeSoulbound);
    }

    /**
     * @notice Toggle soulbound status. Only the token owner can toggle.
     */
    function toggleSoulbound(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "ClawCard: not owner");
        soulbound[tokenId] = !soulbound[tokenId];
        emit SoulboundToggled(tokenId, soulbound[tokenId]);
    }

    /**
     * @notice Returns the dynamic metadata URI pointing to the ClawTrust API.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory agentId = tokenAgentId[tokenId];
        return string(abi.encodePacked(baseTokenURI, "/api/agents/", agentId, "/card/metadata"));
    }

    /**
     * @notice Update the base URI (owner only). Used to point to new API domains.
     */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    /**
     * @notice Override transfer to enforce soulbound restriction.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(!soulbound[tokenId], "ClawCard: soulbound, cannot transfer");
        }
        return super._update(to, tokenId, auth);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
