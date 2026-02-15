// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ClawCardNFT
 * @notice Dynamic NFT representing an agent's ClawTrust reputation card.
 *         ONE CARD PER WALLET - Transfers are restricted to maintain this invariant.
 *         Token metadata is served dynamically via the ClawTrust API.
 *         Supports soulbound (non-transferable) mode per token.
 */
contract ClawCardNFT is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;
    string public baseTokenURI;
    uint256 public constant MAX_SUPPLY = 1_000_000;

    mapping(address => uint256) public walletToToken;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => bool) public soulbound;
    mapping(uint256 => string) public tokenAgentId;
    mapping(string => bool) public agentIdUsed;
    mapping(string => uint256) public agentIdToToken;

    bool public transfersEnabled = true;

    event CardMinted(address indexed wallet, uint256 indexed tokenId, string agentId, bool isSoulbound);
    event CardBurned(address indexed wallet, uint256 indexed tokenId, string agentId);
    event SoulboundLocked(uint256 indexed tokenId);
    event BaseURIUpdated(string newBaseURI);
    event AgentIdUpdated(uint256 indexed tokenId, string oldAgentId, string newAgentId);
    event TransfersToggled(bool enabled);

    error AlreadyMinted();
    error InvalidAgentId();
    error AgentIdInUse();
    error NotTokenOwner();
    error TokenIsSoulbound();
    error TransfersDisabled();
    error MaxSupplyReached();
    error InvalidBaseURI();
    error TokenDoesNotExist();

    modifier onlyTokenOwner(uint256 tokenId) {
        if(ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _;
    }

    constructor(
        string memory _baseTokenURI
    ) ERC721("ClawTrust Card", "CLAW") Ownable(msg.sender) {
        if(bytes(_baseTokenURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = _baseTokenURI;
        _nextTokenId = 1;
    }

    function mint(string calldata agentId, bool makeSoulbound) external {
        _mintCard(msg.sender, agentId, makeSoulbound);
    }

    function adminMint(
        address to,
        string calldata agentId,
        bool makeSoulbound
    ) external onlyOwner {
        _mintCard(to, agentId, makeSoulbound);
    }

    function _mintCard(
        address to,
        string calldata agentId,
        bool makeSoulbound
    ) internal {
        if(hasMinted[to]) revert AlreadyMinted();
        if(bytes(agentId).length == 0) revert InvalidAgentId();
        if(agentIdUsed[agentId]) revert AgentIdInUse();
        if(_nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        walletToToken[to] = tokenId;
        hasMinted[to] = true;
        tokenAgentId[tokenId] = agentId;
        agentIdUsed[agentId] = true;
        agentIdToToken[agentId] = tokenId;

        if (makeSoulbound) {
            soulbound[tokenId] = true;
        }

        emit CardMinted(to, tokenId, agentId, makeSoulbound);
    }

    function burn(uint256 tokenId) external onlyTokenOwner(tokenId) {
        address tokenOwner = ownerOf(tokenId);
        string memory agentId = tokenAgentId[tokenId];

        delete walletToToken[tokenOwner];
        delete hasMinted[tokenOwner];
        delete soulbound[tokenId];
        delete tokenAgentId[tokenId];
        delete agentIdUsed[agentId];
        delete agentIdToToken[agentId];

        _burn(tokenId);

        emit CardBurned(tokenOwner, tokenId, agentId);
    }

    function lockAsSoulbound(uint256 tokenId) external onlyTokenOwner(tokenId) {
        if(soulbound[tokenId]) return;

        _approve(address(0), tokenId, msg.sender);

        soulbound[tokenId] = true;
        emit SoulboundLocked(tokenId);
    }

    function updateAgentId(
        uint256 tokenId,
        string calldata newAgentId
    ) external onlyTokenOwner(tokenId) {
        if(soulbound[tokenId]) revert TokenIsSoulbound();
        if(bytes(newAgentId).length == 0) revert InvalidAgentId();
        if(agentIdUsed[newAgentId]) revert AgentIdInUse();

        string memory oldAgentId = tokenAgentId[tokenId];

        delete agentIdUsed[oldAgentId];
        delete agentIdToToken[oldAgentId];

        tokenAgentId[tokenId] = newAgentId;
        agentIdUsed[newAgentId] = true;
        agentIdToToken[newAgentId] = tokenId;

        emit AgentIdUpdated(tokenId, oldAgentId, newAgentId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory agentId = tokenAgentId[tokenId];

        return string.concat(
            baseTokenURI,
            "/api/agents/",
            agentId,
            "/card/metadata"
        );
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        if(bytes(newBaseURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        emit TransfersToggled(enabled);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            if(soulbound[tokenId]) revert TokenIsSoulbound();
            if(!transfersEnabled) revert TransfersDisabled();
            if(hasMinted[to]) revert AlreadyMinted();

            delete walletToToken[from];
            delete hasMinted[from];

            walletToToken[to] = tokenId;
            hasMinted[to] = true;
        }

        return super._update(to, tokenId, auth);
    }

    function approve(address to, uint256 tokenId) public override {
        if(soulbound[tokenId]) revert TokenIsSoulbound();
        super.approve(to, tokenId);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function getTokenByAgentId(string calldata agentId) external view returns (uint256) {
        if(!agentIdUsed[agentId]) revert InvalidAgentId();
        return agentIdToToken[agentId];
    }

    function isAgentIdAvailable(string calldata agentId) external view returns (bool) {
        return !agentIdUsed[agentId];
    }

    function getCardInfo(uint256 tokenId) external view returns (
        address cardOwner,
        string memory agentId,
        bool isSoulbound,
        bool transferable
    ) {
        cardOwner = ownerOf(tokenId);
        agentId = tokenAgentId[tokenId];
        isSoulbound = soulbound[tokenId];
        transferable = !isSoulbound && transfersEnabled;
    }
}
